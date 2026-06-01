// このファイルは麻雀ゲームの「進行ロジック」をまとめた中心的なクラスです。
// 配牌→ツモ→打牌→鳴き判定→和了 or 流局 という一連の流れを状態管理しながら回します。
// リーチ・北抜き・九種九牌・3麻のチー禁止・点数計算などの拡張ルールに対応しています。
import {
  Tile,
  Meld,
  GamePhase,
  Wind,
  ClaimRequest,
  PlayerView,
  GameView,
  RoundResult,
  WINDS,
} from '../types.js';
import { createTileset, shuffleTiles, sortHand, tilesEqual } from './tiles.js';
import { checkWin, isTenpai, waitingTileKeys, getChiCombinations } from './winCheck.js';
import { calculateScore, calcRonPayment, calcTsumoPayment } from './scoring.js';

// マジックナンバー（意味のある定数）は名前を付けて1か所にまとめる。
// 値の意味が明確になり、調整するときもここだけ直せばよくなる。
// 鳴きの判断を待つ最大時間（ミリ秒）
const CLAIM_TIMEOUT_MS = 8000;
// リーチ供託額
const RIICHI_STICK = 1000;

// クラス内部だけで使うプレイヤー状態。types.ts の PlayerView と違い、
// 手牌の中身など「本人にしか見せない秘密情報」もここに持つ（外には出さない）。
interface PlayerState {
  socketId: string;        // 接続ID（リロード再接続で張り替えられる）
  name: string;
  seat: number;
  hand: Tile[];                            // 手牌（秘密情報）
  discards: Tile[];                        // 捨て牌（河）
  melds: Meld[];                           // 鳴いてさらした面子
  score: number;
  // 鳴き確認中の返答。`?`で省略可能、`| null`で「明示的に無し」も表せる。
  // undefined=まだ未回答、null=見送り済み、と3状態を区別するために両方使う。
  claimResponse?: ClaimRequest | null;
  isRiichi: boolean;                       // リーチ済みかどうか
  isDoubleRiichi: boolean;                 // ダブル立直（第1打でのリーチ）
  ippatsuEligible: boolean;                // 一発の権利が残っているか
  rinshanEligible: boolean;                // 次の和了が嶺上開花になり得るか（カン直後）
  lastDrawnTileId?: string;                // 直前にツモった牌のID（リーチ後のツモ切り判定用）
  // 今まさに手牌に浮いている「ツモ牌」のID。手牌の一番右に分けて表示するために使う。
  // 山/嶺上から引いた・北抜きで補充した時に設定し、打牌や鳴き(ツモ無し)で解除する。
  // lastDrawnTileId と違い、打牌するとクリアされる点が異なる。
  drawnTileId?: string;
  kitaCount: number;                       // 三麻の北抜き枚数
}

export class MahjongGame {
  // `private` を付けたフィールドはクラスの外から触れない（＝内部状態を守る）。
  // ゲームの状態はすべてここに集約し、メソッド経由でだけ変更する設計。
  private players: PlayerState[] = [];
  private wall: Tile[] = [];               // 山（ツモる牌の列）
  private phase: GamePhase = 'dealing';
  private round: Wind = 'east';
  private roundNumber = 1;
  private honbaCount = 0;
  private riichiSticks = 0;                // 場に積まれている供託リーチ棒
  private dealer = 0;
  private currentTurn = 0;
  private doraIndicators: Tile[] = [];
  private uraDoraIndicators: Tile[] = [];  // 裏ドラ表示牌（リーチ和了時のみ公開）
  private deadWall: Tile[] = [];           // 王牌14枚（嶺上牌・ドラ/裏ドラ表示牌）
  private rinshanTiles: Tile[] = [];       // 嶺上牌（カンの補充ツモ用、最大4枚）
  private kanCount = 0;                     // この局で行われたカンの回数（新ドラ・嶺上牌の管理）
  private lastDiscard?: { tile: Tile; seat: number };
  // 鳴き待ちのタイマー。`ReturnType<typeof setTimeout>` は「setTimeout が返す型」を
  // 環境（Node/ブラウザで型が違う）に依存せず自動で表すための書き方。
  private claimTimer?: ReturnType<typeof setTimeout>;
  private readyCount = 0;                   // 「次へ」を押した人数
  // 配牌直後だけ true。九種九牌宣言期間の管理。
  private firstGoAround = false;
  // この局で一度でも鳴き（ポン・チー・カン）があったか。ダブル立直の判定に使う。
  private anyCallMade = false;
  // リーチ宣言の打牌だけ、リーチ後の打牌制限を一時的に解除するためのフラグ。
  private bypassRiichiLock = false;
  // 加槓の槍槓（チャンカン）確認待ち。ロンされなければカンが成立する。
  private pendingKakan?: { player: PlayerState; tile: Tile; pon: Meld };

  // コンストラクタ引数に `private readonly` を付けると、
  // 「同名のフィールドを作って、渡された値を自動でそこに代入」してくれる（引数プロパティ）。
  // つまり this.playerCount などを別途宣言・代入する手間が省ける。
  // readonly は「生成後は変更不可」。試合中に人数やコールバックが変わらないことを保証する。
  // onStateChange / onRoundEnd / onClaimWindow は「状態が動いたときに外へ知らせる」関数。
  // このクラス自身は通信手段を持たず、何をするかは呼び出し側に委ねている（疎結合）。
  constructor(
    private readonly playerCount: 3 | 4,
    players: { socketId: string; name: string; seat: number }[],
    private readonly onStateChange: () => void,
    private readonly onRoundEnd: (result: RoundResult) => void,
    private readonly onClaimWindow: (
      seat: number,
      deadline: number,
      available: Array<'chi' | 'pon' | 'kan' | 'ron'>,
      chiCombos: [string, string][]
    ) => void
  ) {
    // 受け取った最小限の情報(p)に、ゲーム用の初期状態を足して PlayerState を作る。
    // `...p` はスプレッド構文で「p の各プロパティをそのまま展開してコピー」する書き方。
    this.players = players.map(p => ({
      ...p,
      hand: [],
      discards: [],
      melds: [],
      // 初期点数を 30000 点に統一（リーチ供託 + 順位ボーナス前提の均衡値）
      score: 30000,
      isRiichi: false,
      isDoubleRiichi: false,
      ippatsuEligible: false,
      rinshanEligible: false,
      kitaCount: 0,
    }));
  }

  /**
   * 1局の開始処理。配牌・親のツモ・九種九牌チェック許可までを実施。
   */
  startRound(): void {
    if (this.claimTimer) {
      clearTimeout(this.claimTimer);
      this.claimTimer = undefined;
    }

    // 全牌を作ってシャッフルし、末尾14枚を王牌（使わずに取り分ける牌）として切り離す。
    // slice(-14) は「末尾から14枚」、slice(0, -14) は「末尾14枚を除いた残り全部」。
    const allTiles = shuffleTiles(createTileset(this.playerCount));
    const deadWall = allTiles.slice(-14);
    this.wall = allTiles.slice(0, -14);
    // 王牌14枚の簡易配置:
    //   index 0-3   … 嶺上牌（カンの補充ツモ、最大4回）
    //   index 4,6,8,10,12 … ドラ表示牌（初期＋カンごとに1枚めくる）
    //   index 5,7,9,11,13 … その裏（裏ドラ表示牌）
    this.deadWall = deadWall;
    this.rinshanTiles = deadWall.slice(0, 4);
    this.doraIndicators = [deadWall[4]];
    this.uraDoraIndicators = [deadWall[5]];
    this.kanCount = 0;
    this.anyCallMade = false;

    for (const p of this.players) {
      p.hand = [];
      p.discards = [];
      p.melds = [];
      p.claimResponse = undefined;
      p.isRiichi = false;
      p.isDoubleRiichi = false;
      p.ippatsuEligible = false;
      p.rinshanEligible = false;
      p.lastDrawnTileId = undefined;
      p.drawnTileId = undefined;
      p.kitaCount = 0;
    }

    // 親から順番に13枚ずつ配る。外側ループ=配る周回、内側ループ=各プレイヤー。
    // `(this.dealer + offset) % this.playerCount` の `%`（剰余）は席を輪のように回す定番技。
    //   例: 4人で親が2なら 2,3,0,1 の順に席が回る（人数を超えたら0に戻る）。
    // `this.wall.shift()` は山の先頭を1枚取り出す。末尾の `!` は
    //   「ここでは必ず牌がある」と TS に断言する非nullアサーション（配る分は確保済みのため安全）。
    for (let i = 0; i < 13; i++) {
      for (let offset = 0; offset < this.playerCount; offset++) {
        const seat = (this.dealer + offset) % this.playerCount;
        this.players[seat].hand.push(this.wall.shift()!);
      }
    }

    for (const p of this.players) {
      p.hand = sortHand(p.hand);
    }

    // 最初の手番は親。親だけ第1ツモにあたる14枚目を引いてスタートする。
    this.currentTurn = this.dealer;
    const extraTile = this.wall.shift();
    // shift() は山が空だと undefined を返すので、if で存在を確認してから扱う。
    if (extraTile) {
      this.players[this.dealer].hand.push(extraTile);
      this.players[this.dealer].hand = sortHand(this.players[this.dealer].hand);
      this.players[this.dealer].lastDrawnTileId = extraTile.id;
      this.players[this.dealer].drawnTileId = extraTile.id;
    }

    // 配牌直後は九種九牌宣言の余地あり
    this.firstGoAround = true;
    this.phase = 'discard';
    this.lastDiscard = undefined;
    this.readyCount = 0;
    this.onStateChange();
  }

  // 指定した席が山から1枚ツモる。山が尽きていれば流局処理へ。
  // 戻り値の boolean で「ツモできたか（＝局が続くか）」を呼び出し側に伝える。
  private drawForPlayer(seat: number): boolean {
    if (this.wall.length === 0) {
      this.handleExhaustedWall();
      return false;
    }
    const tile = this.wall.shift()!;
    this.players[seat].hand.push(tile);
    this.players[seat].hand = sortHand(this.players[seat].hand);
    // 直前にツモった牌を覚えておく。リーチ後の「ツモ切りしか許さない」判定に使う。
    this.players[seat].lastDrawnTileId = tile.id;
    // 手牌の一番右に分けて表示する「ツモ牌」として記録する。
    this.players[seat].drawnTileId = tile.id;
    return true;
  }

  handleDiscard(socketId: string, tileId: string): void {
    const player = this.players.find(p => p.socketId === socketId);
    if (!player || player.seat !== this.currentTurn || this.phase !== 'discard') return;

    // リーチ中は手牌の自由打牌不可（直前にツモった牌のみ切れる＝ツモ切り）。
    // ただしリーチ宣言の打牌そのものは bypassRiichiLock により許可する。
    // ツモ後に sortHand で並びが変わるため、配列末尾ではなく lastDrawnTileId で判定する。
    if (
      player.isRiichi &&
      !this.bypassRiichiLock &&
      player.lastDrawnTileId !== tileId
    ) {
      return;
    }

    // findIndex は条件に合う要素の位置（0始まり）を返し、無ければ -1。
    // 手元に無い牌IDが送られてきた不正操作はここで弾く。
    const idx = player.hand.findIndex(t => t.id === tileId);
    if (idx === -1) return;

    // リーチ後、自分の次の打牌（ツモ切り）を行った時点で一発の権利は消滅する。
    // リーチ宣言の打牌（bypass中）では消さない。
    if (player.ippatsuEligible && !this.bypassRiichiLock) {
      player.ippatsuEligible = false;
    }
    // 嶺上開花の権利は、補充ツモ後に打牌（＝ツモらず捨てた）時点で消滅する。
    player.rinshanEligible = false;

    // splice(idx, 1) は idx の位置から1個取り除き、取り除いた要素の配列を返す。
    // その先頭 [0] が捨てる牌。これで手牌から抜きつつ捨て牌を取得している。
    const tile = player.hand.splice(idx, 1)[0];
    player.discards.push(tile);
    this.lastDiscard = { tile, seat: player.seat };
    // 打牌したのでツモ牌の浮き表示は解除する。
    player.drawnTileId = undefined;
    // 誰かが打牌したら、その時点で「一巡目」は終了（九種九牌は宣言できなくなる）
    this.firstGoAround = false;
    this.phase = 'claiming';
    this.startClaimWindow();
  }

  /**
   * リーチ宣言。テンパイ・門前・1000点以上 かつ 山に4枚以上残っている必要がある。
   * 同時に捨て牌を1枚指定する（横向き表示が想定）。
   */
  handleRiichi(socketId: string, tileId: string): void {
    const player = this.players.find(p => p.socketId === socketId);
    if (!player || player.seat !== this.currentTurn || this.phase !== 'discard') return;
    if (player.isRiichi) return;
    if (!this.isMenzen(player)) return;               // 門前限定（暗槓は門前を崩さない）
    if (player.score < RIICHI_STICK) return;
    if (this.wall.length < 4) return;

    // 該当牌を仮に捨てたとして、残った手牌がテンパイか確認
    const idx = player.hand.findIndex(t => t.id === tileId);
    if (idx === -1) return;
    const remaining = [...player.hand.slice(0, idx), ...player.hand.slice(idx + 1)];
    if (!isTenpai(remaining, player.melds)) return;

    // ダブル立直: この局でまだ鳴きが入っておらず、自分の第1打である場合。
    const isDouble = !this.anyCallMade && player.discards.length === 0;

    player.isRiichi = true;
    player.isDoubleRiichi = isDouble;
    player.score -= RIICHI_STICK;
    this.riichiSticks += 1;
    // 宣言打牌の直前に一発の権利を付与しておく。
    // （宣言牌が鳴かれた場合は resolvePon/Chi 側で権利が取り消される）
    player.ippatsuEligible = true;

    // リーチ宣言の打牌はリーチ制限を一時解除して処理する。
    this.bypassRiichiLock = true;
    this.handleDiscard(socketId, tileId);
    this.bypassRiichiLock = false;
  }

  /**
   * 三麻の北抜き。手牌から北牌(value=4, suit='honor')を1枚抜いて補充ツモ。
   */
  handleKita(socketId: string): void {
    if (this.playerCount !== 3) return;
    const player = this.players.find(p => p.socketId === socketId);
    if (!player || player.seat !== this.currentTurn || this.phase !== 'discard') return;
    if (player.isRiichi) return;                       // リーチ中は不可

    const idx = player.hand.findIndex(t => t.suit === 'honor' && t.value === 4);
    if (idx === -1) return;
    player.hand.splice(idx, 1);
    player.kitaCount += 1;
    // 山から1枚補充。山が尽きていれば流局へ
    if (this.wall.length === 0) {
      this.handleExhaustedWall();
      return;
    }
    const tile = this.wall.shift()!;
    player.hand.push(tile);
    player.hand = sortHand(player.hand);
    // 北抜きの補充牌も、手牌右端の「ツモ牌」として表示する。
    player.lastDrawnTileId = tile.id;
    player.drawnTileId = tile.id;
    this.onStateChange();
  }

  /**
   * 九種九牌の流局宣言。配牌直後の自分のターンで、么九牌が9種類以上ある時のみ可能。
   */
  handleKyushuhai(socketId: string): void {
    const player = this.players.find(p => p.socketId === socketId);
    if (!player || player.seat !== this.currentTurn || this.phase !== 'discard') return;
    if (!this.firstGoAround) return;
    if (player.melds.length > 0) return;
    if (!this.checkKyushuhai(player.hand)) return;

    // 親流れ無しの流局。点の増減は全員0なので、各席に0を入れた表を作る。
    const scoreDelta: Record<number, number> = {};
    for (const p of this.players) scoreDelta[p.seat] = 0;

    this.phase = 'roundEnd';
    this.onRoundEnd({
      isDraw: true,
      isKyushuhai: true,
      scoreDelta,
      // Object.fromEntries は [キー, 値] の配列の配列を1つのオブジェクトに変換する。
      // ここでは [[席, 点], ...] を { 席: 点, ... } という点数表にしている。
      newScores: Object.fromEntries(this.players.map(p => [p.seat, p.score])),
    });
  }

  /** 手牌内に么九牌（1・9・字牌）が9種類以上あるか判定。 */
  private checkKyushuhai(hand: Tile[]): boolean {
    const set = new Set<string>();
    for (const t of hand) {
      if (t.suit === 'honor' || t.value === 1 || t.value === 9) {
        set.add(`${t.suit}_${t.value}`);
      }
    }
    return set.size >= 9;
  }

  // 捨て牌に対する鳴き／ロンの受付窓を開く。ronOnly=true は槍槓確認（ロンだけ受け付ける）。
  private startClaimWindow(ronOnly = false): void {
    if (!this.lastDiscard) return;

    // 分割代入でフィールドを取り出しつつ、`tile: discardTile` のように別名を付けている。
    const { tile: discardTile, seat: discardSeat } = this.lastDiscard;
    const deadline = Date.now() + CLAIM_TIMEOUT_MS;   // 締め切り時刻（現在時刻＋制限時間）

    // いったん全員の返答を「未回答(undefined)」に戻す。
    for (const p of this.players) {
      p.claimResponse = undefined;
    }
    // 捨てた本人は鳴き対象外なので、最初から「見送り(null)」にしておく。
    this.players.find(p => p.seat === discardSeat)!.claimResponse = null;

    // 鳴ける人が1人でもいるか。誰も鳴けなければ待たずに次へ進める。
    let anyPending = false;
    for (const p of this.players) {
      if (p.seat === discardSeat) continue;            // 本人はスキップ
      const available = this.getAvailableClaims(p.seat, discardTile, discardSeat, ronOnly);
      const chiCombos = ronOnly ? [] : getChiCombinations(p.hand, discardTile);
      if (available.length > 0) {
        anyPending = true;
        // この人に「こういう選択肢があるよ」と通知し、返答を待つ。
        this.onClaimWindow(p.seat, deadline, available, chiCombos);
      } else {
        p.claimResponse = null;                        // 鳴けない人は自動で見送り
      }
    }

    // 誰も待つ必要が無い／全員すでに返答済みなら、すぐ集計へ。
    if (!anyPending || this.players.every(p => p.claimResponse !== undefined)) {
      this.processClaims();
      return;
    }

    // 制限時間が来たら、未回答の人を見送り扱いにして強制的に集計する。
    // setTimeout に渡すアロー関数は `this` を囲みの this のまま保つので、ここで this.〜 が使える。
    this.claimTimer = setTimeout(() => {
      for (const p of this.players) {
        if (p.claimResponse === undefined) p.claimResponse = null;
      }
      this.processClaims();
    }, CLAIM_TIMEOUT_MS);
  }

  private getAvailableClaims(
    seat: number,
    tile: Tile,
    discardSeat: number,
    ronOnly = false
  ): Array<'chi' | 'pon' | 'kan' | 'ron'> {
    const player = this.players.find(p => p.seat === seat)!;
    const result: Array<'chi' | 'pon' | 'kan' | 'ron'> = [];

    // まずロン可能か（この牌で和了形になるか）を判定。
    if (checkWin(player.hand, player.melds, tile).isWin) result.push('ron');

    // 槍槓（チャンカン）の確認窓ではロンのみ受け付ける
    if (ronOnly) return result;
    // リーチ中は鳴き不可（ロンのみ）
    if (player.isRiichi) return result;

    const matching = player.hand.filter(t => tilesEqual(t, tile));
    if (matching.length >= 2) result.push('pon');
    // 大明槓: 手牌に同じ牌を3枚持っていれば可能
    if (matching.length >= 3) result.push('kan');

    // 三麻ではチー禁止
    if (this.playerCount === 4) {
      const nextSeat = (discardSeat + 1) % this.playerCount;
      if (seat === nextSeat && getChiCombinations(player.hand, tile).length > 0) {
        result.push('chi');
      }
    }

    return result;
  }

  // クライアントから届いた鳴き／見送りの返答を記録する。
  handleClaim(socketId: string, claim: ClaimRequest): void {
    const player = this.players.find(p => p.socketId === socketId);
    // 鳴き受付中でない／二重回答は無視（claimResponse が undefined のときだけ受け付ける）。
    if (!player || this.phase !== 'claiming' || player.claimResponse !== undefined) return;

    player.claimResponse = claim;

    // 全員の返答が出そろったら、待たずに即集計する（every=全要素が条件を満たすか）。
    if (this.players.every(p => p.claimResponse !== undefined)) {
      if (this.claimTimer) {
        clearTimeout(this.claimTimer);
        this.claimTimer = undefined;
      }
      this.processClaims();
    }
  }

  private processClaims(): void {
    if (!this.lastDiscard) return;
    const { seat: discardSeat } = this.lastDiscard;

    // 槍槓（チャンカン）の確認待ち中は、ロンされたら槍槓和了、誰もロンしなければカン成立。
    if (this.pendingKakan) {
      const robber = this.players.find(p => p.claimResponse?.type === 'ron');
      const info = this.pendingKakan;
      this.pendingKakan = undefined;
      if (robber) {
        this.resolveRon(robber, info.player.seat, true);
      } else {
        this.commitKakan(info);
      }
      return;
    }

    // ここからは麻雀の優先順位どおりに判定する: ロン > カン > ポン > チー。
    // `p.claimResponse?.type` の `?.` は claimResponse が null/undefined でも安全に type を読む書き方。
    // 優先度の高いものから探し、見つかれば処理して return（残りは無視）する。
    const ronner = this.players.find(p => p.claimResponse?.type === 'ron');
    if (ronner) {
      this.resolveRon(ronner, discardSeat);
      return;
    }

    // 大明槓はポンより優先（同じ牌をカンする人がいればポンは成立しない）
    const kanner = this.players.find(p => p.claimResponse?.type === 'kan');
    if (kanner) {
      this.resolveDaiminkan(kanner);
      return;
    }

    const ponner = this.players.find(p => p.claimResponse?.type === 'pon');
    if (ponner) {
      this.resolvePon(ponner);
      return;
    }

    const chier = this.players.find(p => p.claimResponse?.type === 'chi');
    if (chier) {
      this.resolveChi(chier);
      return;
    }

    // 誰も鳴かなければ、捨てた人の次の席が普通にツモって続行する。
    const nextSeat = (discardSeat + 1) % this.playerCount;
    this.currentTurn = nextSeat;
    const drew = this.drawForPlayer(nextSeat);
    if (drew) {
      this.phase = 'discard';
      this.onStateChange();
    }
  }

  private resolveRon(winner: PlayerState, loserSeat: number, isChankan = false): void {
    const winTile = this.lastDiscard!.tile;
    const isDealer = winner.seat === this.dealer;

    // 役判定・点数計算
    const scoring = calculateScore(
      winner.hand,
      winTile,
      winner.melds,
      false,
      winner.isRiichi,
      WINDS[winner.seat],
      this.round,
      winner.kitaCount,
      {
        isIppatsu: winner.ippatsuEligible,
        isDoubleRiichi: winner.isDoubleRiichi,
        isChankan,
        doraIndicators: this.doraIndicators,
        uraDoraIndicators: this.uraDoraIndicators,
      }
    );

    // 役なしロンは認めない（簡略: ここでは1飜以上を要求）
    if (scoring.totalHan === 0) {
      // 役なしの場合は和了無効として鳴き判定を続行（フォールトレラント）
      winner.claimResponse = null;
      this.processClaims();
      return;
    }

    // 支払い額 = 基本点から計算したロン支払い + 本場ボーナス(1本場につき300点)。
    const payment = calcRonPayment(scoring.basePoint, isDealer)
      + this.honbaCount * 300;
    const loser = this.players.find(p => p.seat === loserSeat)!;
    // 和了者は支払い額に加えて、場に積まれたリーチ棒も総取りする。
    const totalForWinner = payment + this.riichiSticks * RIICHI_STICK;

    loser.score -= payment;             // 放銃者が支払う
    winner.score += totalForWinner;     // 和了者が受け取る
    this.riichiSticks = 0;              // 供託は回収済みなので0に戻す

    // 表示用の増減表。まず全員0で初期化し、関係者だけ上書きする。
    const scoreDelta: Record<number, number> = {};
    for (const p of this.players) scoreDelta[p.seat] = 0;
    scoreDelta[winner.seat] = totalForWinner;
    scoreDelta[loserSeat] = -payment;

    this.phase = 'roundEnd';
    this.onRoundEnd({
      isDraw: false,
      winner: winner.seat,
      losers: [loserSeat],
      winTile,
      winType: 'ron',
      // `[...配列]` で複製を渡す。元の手牌が後で変化しても結果表示が壊れないようにするため。
      handTiles: [...winner.hand],
      melds: [...winner.melds],
      yakuList: scoring.yakuList,
      totalHan: scoring.totalHan,
      fu: scoring.fu,
      doraIndicators: [...this.doraIndicators],
      uraDoraIndicators: winner.isRiichi ? [...this.uraDoraIndicators] : undefined,
      scoreDelta,
      newScores: Object.fromEntries(this.players.map(p => [p.seat, p.score])),
    });
  }

  /**
   * 鳴き（ポン・チー）で取られた牌を、捨てた人の河（discards）から取り除く。
   * 鳴かれた牌は河から面子へ移動するため、河に残してはいけない。
   */
  private removeClaimedTileFromRiver(): void {
    const { tile, seat } = this.lastDiscard!;
    const discarder = this.players.find(p => p.seat === seat)!;
    const idx = discarder.discards.findIndex(t => t.id === tile.id);
    if (idx !== -1) discarder.discards.splice(idx, 1);
  }

  /**
   * 鳴き（ポン・チー・カン）が発生したときの共通処理。
   * 一発は鳴きが入った時点で全員消滅し、以後の局はダブル立直対象外になる。
   */
  private onCallMade(): void {
    this.anyCallMade = true;
    for (const p of this.players) p.ippatsuEligible = false;
  }

  /**
   * 門前（鳴いていない）状態か。暗槓は門前を崩さないため、
   * チー・ポン・明槓（大明槓/加槓）が1つでもあれば門前ではない。
   */
  private isMenzen(player: PlayerState): boolean {
    return player.melds.every(m => m.type === 'ankan');
  }

  /**
   * 今リーチを宣言できるか。
   * 重要: 手番のプレイヤーはツモ後で手牌が14枚ある。isTenpai は「あと1枚でアガれる
   * 13枚」を前提とするため14枚に直接かけると常に false になる。そこで
   * 「1枚切ってテンパイになる打牌が1つでもあるか」で判定する。
   */
  private canDeclareRiichi(player: PlayerState): boolean {
    if (player.isRiichi) return false;
    if (!this.isMenzen(player)) return false;          // 門前限定（暗槓は門前を維持）
    if (player.score < RIICHI_STICK) return false;     // 供託1000点が必要
    if (this.wall.length < 4) return false;            // 残り山が4枚未満なら不可

    // 同じ種類・数字の牌は何度試しても結果が同じなので、一度だけ調べる。
    const tried = new Set<string>();
    for (const t of player.hand) {
      const key = `${t.suit}_${t.value}`;
      if (tried.has(key)) continue;
      tried.add(key);
      const rest = player.hand.filter(x => x.id !== t.id);
      if (isTenpai(rest, player.melds)) return true;
    }
    return false;
  }

  /**
   * カン成立時に新しいドラ（と裏ドラ）表示牌を1組めくる。最大4回まで。
   */
  private revealNewKanDora(): void {
    if (this.kanCount >= 4) return;
    this.kanCount += 1;
    const di = 4 + this.kanCount * 2;     // 6, 8, 10, 12
    if (this.deadWall[di]) this.doraIndicators.push(this.deadWall[di]);
    if (this.deadWall[di + 1]) this.uraDoraIndicators.push(this.deadWall[di + 1]);
  }

  /**
   * カンの補充ツモ（嶺上牌）。嶺上牌が尽きていれば流局扱い。
   * @returns 補充できたら true。
   */
  private drawRinshan(player: PlayerState): boolean {
    const tile = this.rinshanTiles.shift();
    if (!tile) {
      this.handleExhaustedWall();
      return false;
    }
    player.hand.push(tile);
    player.hand = sortHand(player.hand);
    player.lastDrawnTileId = tile.id;
    // 嶺上牌も手牌右端の「ツモ牌」として表示する。
    player.drawnTileId = tile.id;
    player.rinshanEligible = true;        // 次のツモ和了は嶺上開花
    return true;
  }

  /**
   * 暗槓（あんかん）。自分の手番で同じ牌を4枚持っている時に宣言できる。
   * 暗槓は門前を崩さないのでリーチ後でも可能だが、
   * リーチ後は「直前にツモった牌での暗槓」かつ「待ちが一切変わらない」場合に限る
   * （送り槓・待ち変えの禁止）。
   * @param tileId 4枚のうちどれか1枚のID（同じ種類4枚をまとめてカンする）
   */
  handleAnkan(socketId: string, tileId: string): void {
    const player = this.players.find(p => p.socketId === socketId);
    if (!player || player.seat !== this.currentTurn || this.phase !== 'discard') return;

    const target = player.hand.find(t => t.id === tileId);
    if (!target) return;
    const quad = player.hand.filter(t => tilesEqual(t, target));
    if (quad.length !== 4) return;        // 4枚揃っていなければ不可

    if (player.isRiichi && !this.canAnkanDuringRiichi(player, target, quad)) return;

    // 手牌から4枚抜いて暗槓面子にする
    player.hand = player.hand.filter(t => !tilesEqual(t, target));
    player.melds.push({ type: 'ankan', tiles: quad });

    this.onCallMade();
    this.revealNewKanDora();
    if (!this.drawRinshan(player)) return;
    this.firstGoAround = false;
    this.onStateChange();
  }

  /**
   * リーチ後の暗槓が許可されるか。
   *   1. カンする牌が「直前のツモ牌」であること（手の中にあった牌での送り槓は不可）。
   *   2. カン前後で待ち牌の集合が完全に一致すること（待ち変えの禁止）。
   */
  private canAnkanDuringRiichi(player: PlayerState, target: Tile, quad: Tile[]): boolean {
    // 1. 直前のツモ牌を含むカンであること
    if (!quad.some(t => t.id === player.lastDrawnTileId)) return false;

    // 2. 待ちが変わらないこと。ツモ牌を除いた13枚（リーチ確定形）の待ちと、
    //    カン後（残り10枚＋暗槓1面子）の待ちが一致するか比較する。
    const before = player.hand.filter(t => t.id !== player.lastDrawnTileId);
    const waitBefore = waitingTileKeys(before, player.melds);
    const remaining = player.hand.filter(t => !tilesEqual(t, target));
    const ankanMeld: Meld = { type: 'ankan', tiles: quad };
    const waitAfter = waitingTileKeys(remaining, [...player.melds, ankanMeld]);

    if (waitBefore.size !== waitAfter.size) return false;
    for (const k of waitBefore) if (!waitAfter.has(k)) return false;
    return true;
  }

  /**
   * 加槓（かかん／小明槓）。既存のポン面子に同じ牌をもう1枚足してカンにする。
   * @param tileId 手牌にある追加する1枚のID
   */
  handleKakan(socketId: string, tileId: string): void {
    const player = this.players.find(p => p.socketId === socketId);
    if (!player || player.seat !== this.currentTurn || this.phase !== 'discard') return;
    if (player.isRiichi) return;          // リーチ後は手牌構成を変えられない

    const target = player.hand.find(t => t.id === tileId);
    if (!target) return;
    // 同じ牌のポン面子を探す
    const pon = player.melds.find(m => m.type === 'pon' && tilesEqual(m.tiles[0], target));
    if (!pon) return;

    // 槍槓（チャンカン）の確認: 他家がこの追加牌でロンできるなら、まず確認窓を開く。
    const robbers = this.players.filter(
      p => p.seat !== player.seat && checkWin(p.hand, p.melds, target).isWin
    );
    if (robbers.length > 0) {
      this.pendingKakan = { player, tile: target, pon };
      this.lastDiscard = { tile: target, seat: player.seat };
      this.phase = 'claiming';
      this.startClaimWindow(true);        // ロンのみの窓
      return;
    }

    // 誰もロンできなければカン成立
    this.commitKakan({ player, tile: target, pon });
  }

  /**
   * 加槓を実際に成立させる（槍槓されなかった場合）。
   * ポン面子を明槓に昇格させ、新ドラめくり・嶺上補充ツモを行う。
   */
  private commitKakan(info: { player: PlayerState; tile: Tile; pon: Meld }): void {
    const { player, tile, pon } = info;
    player.hand = player.hand.filter(t => t.id !== tile.id);
    pon.type = 'minkan';
    pon.tiles = [...pon.tiles, tile];

    this.onCallMade();
    this.revealNewKanDora();
    this.lastDiscard = undefined;
    this.phase = 'discard';
    if (!this.drawRinshan(player)) return;
    this.firstGoAround = false;
    this.onStateChange();
  }

  /**
   * 大明槓（だいみんかん）。他家の捨て牌に対し、手牌に同じ牌3枚を持つ時に成立。
   * 鳴き処理（processClaims）から呼ばれる。
   */
  private resolveDaiminkan(claimer: PlayerState): void {
    const discardTile = this.lastDiscard!.tile;
    const matching = claimer.hand.filter(t => tilesEqual(t, discardTile)).slice(0, 3);
    if (matching.length !== 3) {
      claimer.claimResponse = null;
      this.processClaims();
      return;
    }
    const matchIds = new Set(matching.map(t => t.id));
    claimer.hand = claimer.hand.filter(t => !matchIds.has(t.id));
    claimer.melds.push({
      type: 'minkan',
      tiles: [discardTile, ...matching],
      fromSeat: this.lastDiscard!.seat,
    });
    this.removeClaimedTileFromRiver();
    this.onCallMade();
    this.revealNewKanDora();
    this.currentTurn = claimer.seat;
    this.phase = 'discard';
    if (!this.drawRinshan(claimer)) return;
    this.onStateChange();
  }

  // ポン成立処理。手牌から同じ牌を2枚抜き、捨て牌と合わせて刻子の面子にする。
  private resolvePon(claimer: PlayerState): void {
    const discardTile = this.lastDiscard!.tile;
    const ponTiles: Tile[] = [];        // ポンに使う手牌2枚
    const newHand: Tile[] = [];         // ポン後に残る手牌
    let count = 0;

    // 手牌を1枚ずつ見て、同じ牌を「2枚まで」ポン側へ、それ以外は手牌側へ振り分ける。
    // count<2 の条件があるので、同じ牌が3枚以上あっても2枚しか取らない。
    for (const t of claimer.hand) {
      if (count < 2 && tilesEqual(t, discardTile)) {
        ponTiles.push(t);
        count++;
      } else {
        newHand.push(t);
      }
    }

    claimer.hand = newHand;
    claimer.melds.push({
      type: 'pon',
      tiles: [discardTile, ...ponTiles],
      fromSeat: this.lastDiscard!.seat,
    });
    this.removeClaimedTileFromRiver();
    this.onCallMade();

    // ポンは山からツモらないので、浮いた「ツモ牌」表示は無し。
    claimer.drawnTileId = undefined;
    this.currentTurn = claimer.seat;
    this.phase = 'discard';
    this.onStateChange();
  }

  // チー成立処理。指定された手牌2枚＋捨て牌で順子を作る。
  private resolveChi(claimer: PlayerState): void {
    // `as ClaimRequest & { type: 'chi' }` は型アサーション。ここに来る時点で必ずチーなので、
    // chiTiles を持つ型として扱い、TS の型エラーを避けている。
    const claim = claimer.claimResponse as ClaimRequest & { type: 'chi' };
    if (!claim.chiTiles) {
      claimer.claimResponse = null;
      this.processClaims();
      return;
    }

    const discardTile = this.lastDiscard!.tile;
    const [id1, id2] = claim.chiTiles;
    const chiFromHand: Tile[] = [];
    const newHand: Tile[] = [];

    for (const t of claimer.hand) {
      if ((t.id === id1 || t.id === id2) && chiFromHand.length < 2) {
        chiFromHand.push(t);
      } else {
        newHand.push(t);
      }
    }

    if (chiFromHand.length !== 2) {
      claimer.claimResponse = null;
      this.processClaims();
      return;
    }

    claimer.hand = newHand;
    // 手牌2枚＋捨て牌を数字順に並べて順子にする。
    // sort のコールバックは「a-b が負なら a が前」というルール（昇順）。
    const meldTiles = [...chiFromHand, discardTile].sort((a, b) => a.value - b.value);
    claimer.melds.push({ type: 'chi', tiles: meldTiles, fromSeat: this.lastDiscard!.seat });
    this.removeClaimedTileFromRiver();
    this.onCallMade();

    // チーも山からツモらないので、浮いた「ツモ牌」表示は無し。
    claimer.drawnTileId = undefined;
    this.currentTurn = claimer.seat;
    this.phase = 'discard';
    this.onStateChange();
  }

  // ツモ和了の処理。
  handleTsumo(socketId: string): void {
    const player = this.players.find(p => p.socketId === socketId);
    // 自分の手番の打牌フェーズ（ツモ直後）でなければ無視。
    if (!player || player.seat !== this.currentTurn || this.phase !== 'discard') return;

    // ツモ和了の和了牌は「直前にツモった牌」そのもの。
    // 手牌を総当たりで探すと、和了形が複数の分解を持つ場合に
    // 実際に引いた牌とは別の牌が選ばれてしまう（例: 4索でツモなのに1筒と表示）。
    // そこでまずツモ牌を和了牌として検証し、それで和了できるかを確認する。
    let winTile: Tile | undefined;
    const drawn = player.hand.find(t => t.id === player.lastDrawnTileId);
    if (drawn) {
      const rest = player.hand.filter(t => t.id !== drawn.id);
      if (checkWin(rest, player.melds, drawn).isWin) winTile = drawn;
    }
    // フォールバック: ツモ牌が特定できない異常時のみ、総当たりで和了牌を探す。
    if (!winTile) {
      for (const tile of player.hand) {
        const rest = player.hand.filter(t => t.id !== tile.id);
        if (checkWin(rest, player.melds, tile).isWin) {
          winTile = tile;
          break;
        }
      }
    }
    if (!winTile) return;               // どう見ても和了形でなければ無効

    // ツモ和了用の手牌（和了牌を除いた残り）
    const closedRest = player.hand.filter(t => t.id !== winTile!.id);
    const scoring = calculateScore(
      closedRest,
      winTile,
      player.melds,
      true,
      player.isRiichi,
      WINDS[player.seat],
      this.round,
      player.kitaCount,
      {
        isIppatsu: player.ippatsuEligible,
        isDoubleRiichi: player.isDoubleRiichi,
        isRinshan: player.rinshanEligible,
        doraIndicators: this.doraIndicators,
        uraDoraIndicators: this.uraDoraIndicators,
      }
    );

    // 役なしツモは認めない（リーチ・門前清自摸和でも0飜なら何かおかしい）
    if (scoring.totalHan === 0) return;

    const isDealer = player.seat === this.dealer;
    const payments = calcTsumoPayment(scoring.basePoint, isDealer);
    const honbaPay = this.honbaCount * 100;   // ツモは1本場につき各家100点

    const scoreDelta: Record<number, number> = {};
    let totalGain = 0;                  // 和了者が受け取る合計

    // 和了者以外の全員から支払いを集める。
    for (const p of this.players) {
      if (p.seat === player.seat) {
        scoreDelta[p.seat] = 0;
        continue;                       // 自分自身はスキップ
      }
      // 親ツモなら全員同額。子ツモなら親だけ多く払う。
      // 三項演算子のネストで「自分が親か」「相手が親か」を場合分けしている。
      const pay = isDealer
        ? payments.fromNonDealer + honbaPay
        : (p.seat === this.dealer ? payments.fromDealer : payments.fromNonDealer) + honbaPay;
      p.score -= pay;
      scoreDelta[p.seat] = -pay;
      totalGain += pay;
    }

    // リーチ棒の回収
    totalGain += this.riichiSticks * RIICHI_STICK;
    this.riichiSticks = 0;

    player.score += totalGain;
    scoreDelta[player.seat] = totalGain;

    this.phase = 'roundEnd';
    this.onRoundEnd({
      isDraw: false,
      winner: player.seat,
      winTile,
      winType: 'tsumo',
      handTiles: [...player.hand],
      melds: [...player.melds],
      yakuList: scoring.yakuList,
      totalHan: scoring.totalHan,
      fu: scoring.fu,
      doraIndicators: [...this.doraIndicators],
      uraDoraIndicators: player.isRiichi ? [...this.uraDoraIndicators] : undefined,
      scoreDelta,
      newScores: Object.fromEntries(this.players.map(p => [p.seat, p.score])),
    });
  }

  // 山が尽きたときの流局処理（荒牌平局）。テンパイ者とノーテン者で罰符をやり取りする。
  private handleExhaustedWall(): void {
    // テンパイの席と、そうでない（ノーテンの）席に分ける。
    const tenpaiSeats = this.players
      .filter(p => isTenpai(p.hand, p.melds))
      .map(p => p.seat);
    const noshiroSeats = this.players
      .filter(p => !tenpaiSeats.includes(p.seat))
      .map(p => p.seat);

    const scoreDelta: Record<number, number> = {};
    for (const p of this.players) scoreDelta[p.seat] = 0;

    // 両者がいるときだけ罰符が動く（全員テンパイ／全員ノーテンなら増減なし）。
    // 合計3000点を、テンパイ側で山分けして受け取り、ノーテン側で山分けして払う。
    // Math.floor は小数を切り捨てる（点は整数なので端数を落とす）。
    if (tenpaiSeats.length > 0 && noshiroSeats.length > 0) {
      const perTenpai = Math.floor(3000 / tenpaiSeats.length);
      const perNoshiro = Math.floor(3000 / noshiroSeats.length);
      for (const s of tenpaiSeats) {
        this.players[s].score += perTenpai;
        scoreDelta[s] = perTenpai;
      }
      for (const s of noshiroSeats) {
        this.players[s].score -= perNoshiro;
        scoreDelta[s] = -perNoshiro;
      }
    }

    // 親がテンパイなら連荘（本場を1つ積む）、ノーテンなら親が次へ移る。
    if (tenpaiSeats.includes(this.dealer)) {
      this.honbaCount++;
    } else {
      this.advanceDealer();
    }

    this.phase = 'roundEnd';
    this.onRoundEnd({
      isDraw: true,
      scoreDelta,
      newScores: Object.fromEntries(this.players.map(p => [p.seat, p.score])),
    });
  }

  // 結果表示後、各プレイヤーが「次へ」を押すたびに呼ばれる。全員揃ったら次局を開始。
  handleReadyNext(socketId: string): void {
    if (this.phase !== 'roundEnd') return;
    if (!this.players.find(p => p.socketId === socketId)) return;

    this.readyCount++;
    if (this.readyCount >= this.playerCount) {
      this.startRound();
    }
  }

  // ロン和了後の親の進行。和了者が親でなければ親が次へ移る（親なら連荘）。
  // roomManager 側から呼ぶので public にしている。
  advanceAfterRon(winnerSeat: number): void {
    if (winnerSeat !== this.dealer) {
      this.advanceDealer();
    }
  }

  // 親を次の席へ進める。一周して親が0に戻ったら場風も次へ（東場→南場）。
  private advanceDealer(): void {
    this.dealer = (this.dealer + 1) % this.playerCount;
    if (this.dealer === 0) {
      // 現在の場風が WINDS の何番目かを調べ、次の風へ。`%` で東→南→西→北→東と循環。
      const roundIdx = WINDS.indexOf(this.round);
      this.round = WINDS[(roundIdx + 1) % WINDS.length];
    }
    this.roundNumber++;
    this.honbaCount = 0;               // 親が移ると本場はリセット
  }

  /**
   * 指定したプレイヤー視点の「見える情報」を作って返す。
   */
  getViewForPlayer(socketId: string): GameView | null {
    const me = this.players.find(p => p.socketId === socketId);
    if (!me) return null;             // この接続が参加者でなければ何も返さない

    // 全員分を「公開してよい情報」だけに詰め替える。手牌は handCount（枚数）だけにして中身は隠す。
    // これが「相手の手牌を漏らさない」ための要。秘密情報の PlayerState から安全な PlayerView へ変換する。
    const players: PlayerView[] = this.players.map(p => ({
      seat: p.seat,
      name: p.name,
      handCount: p.hand.length,        // 枚数のみ
      discards: p.discards,
      melds: p.melds,
      score: p.score,
      isDealer: p.seat === this.dealer,
      seatWind: WINDS[p.seat] as Wind,
      isRiichi: p.isRiichi,
      kitaCount: p.kitaCount,
    }));

    // 自分が今リーチ宣言可能かを判定（門前・点数・残り山・打牌でテンパイ維持できるか）
    const canRiichi =
      me.seat === this.currentTurn &&
      this.phase === 'discard' &&
      this.canDeclareRiichi(me);

    // カン可能か（自分の手番・打牌フェーズ）
    const myTurnDiscard = me.seat === this.currentTurn && this.phase === 'discard';
    // 暗槓: 同じ牌4枚ごとに代表牌のIDを1つ返す（リーチ後は待ちが変わらない暗槓のみ）
    const ankanOptions: string[] = [];
    // 加槓: 既存のポンに足せる手牌のIDを返す（リーチ後は不可）
    const kakanOptions: string[] = [];
    if (myTurnDiscard) {
      // 同じ種類の牌を二重に調べないよう、見た牌の種類を Set で記録しながら走査する。
      const seen = new Set<string>();
      for (const t of me.hand) {
        const key = `${t.suit}_${t.value}`;
        if (!seen.has(key)) {
          seen.add(key);
          const quad = me.hand.filter(x => tilesEqual(x, t));
          if (quad.length === 4) {
            if (!me.isRiichi || this.canAnkanDuringRiichi(me, t, quad)) {
              ankanOptions.push(t.id);
            }
          }
        }
        if (!me.isRiichi && me.melds.some(m => m.type === 'pon' && tilesEqual(m.tiles[0], t))) {
          kakanOptions.push(t.id);
        }
      }
    }

    // 北抜き可能か（三麻のみ、北牌を持っている）
    const canKita =
      this.playerCount === 3 &&
      me.seat === this.currentTurn &&
      this.phase === 'discard' &&
      !me.isRiichi &&
      me.hand.some(t => t.suit === 'honor' && t.value === 4);

    // 九種九牌宣言可能か
    const canKyushuhai =
      me.seat === this.currentTurn &&
      this.phase === 'discard' &&
      this.firstGoAround &&
      me.melds.length === 0 &&
      this.checkKyushuhai(me.hand);

    return {
      phase: this.phase,
      round: this.round,
      roundNumber: this.roundNumber,
      honbaCount: this.honbaCount,
      riichiSticks: this.riichiSticks,
      dealer: this.dealer,
      currentTurn: this.currentTurn,
      wallCount: this.wall.length,
      doraIndicators: this.doraIndicators,
      lastDiscard: this.lastDiscard,
      players,
      myHand: me.hand,
      mySeat: me.seat,
      // ツモ牌のID（手牌の一番右に分けて表示する用）。打牌・鳴き後は undefined。
      drawnTileId: me.drawnTileId,
      canRiichi,
      canKita,
      canKyushuhai,
      ankanOptions,
      kakanOptions,
    };
  }

  // 通常のビューに「鳴きの選択肢」を足して返す。鳴き待ちの本人へ送るとき用。
  getViewWithClaims(
    socketId: string,
    available: Array<'chi' | 'pon' | 'kan' | 'ron'>,
    chiCombinations: [string, string][]
  ): GameView | null {
    const view = this.getViewForPlayer(socketId);
    if (!view) return null;
    // `{ ...view, 追加 }` は「view を全部コピーしつつフィールドを追加」する書き方。
    // 元の view を壊さず、選択肢付きの新しいオブジェクトを作って返す。
    return { ...view, availableClaims: available, chiCombinations };
  }

  // 外部から現在のフェーズ／人数を読むための getter。
  // private フィールドは外から触れないので、必要な値だけメソッド経由で公開する。
  getPhase(): GamePhase {
    return this.phase;
  }

  getPlayerCount(): number {
    return this.playerCount;
  }

  /**
   * リロード再接続時に、指定席の接続ID(socketId)を新しいものに張り替える。
   * これ以降 getViewForPlayer や emit が新しい接続へ正しく届くようになる。
   */
  reassignSocket(seat: number, newSocketId: string): void {
    const player = this.players.find(p => p.seat === seat);
    if (player) player.socketId = newSocketId;
  }

  /** 指定席のプレイヤーの現在の socketId を返す（再接続後の状態送信に使う）。 */
  getSocketIdBySeat(seat: number): string | undefined {
    return this.players.find(p => p.seat === seat)?.socketId;
  }
}
