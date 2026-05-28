// このファイルは麻雀ゲームの「進行ロジック」をまとめた中心的なクラスです。
// 配牌→ツモ→打牌→鳴き判定→和了 or 流局 という一連の流れを状態管理しながら回します。
// 状態が変わるごとにコールバック（onStateChange など）でルームに通知し、
// ルームから各クライアントに状態を配信する設計になっています。
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
import { checkWin, isTenpai, getChiCombinations } from './winCheck.js';

// 鳴きの判断を待つ最大時間（ミリ秒）。8秒経っても応答がなければ自動でスキップ扱いに。
const CLAIM_TIMEOUT_MS = 8000;

// クラス内部だけで使うプレイヤー状態（サーバー側に持つ完全な情報）
// 型を export せずに interface 宣言にとどめているのはこのため。
interface PlayerState {
  socketId: string;                          // 接続しているクライアントを識別するID
  name: string;
  seat: number;                              // 席番号(0〜3)
  hand: Tile[];                              // 手牌（中身を含む）
  discards: Tile[];                          // 捨て牌
  melds: Meld[];                             // 鳴いた面子
  score: number;                             // 持ち点
  claimResponse?: ClaimRequest | null;       // 鳴き応答: undefined=未応答, null=スキップ
}

/**
 * 1ルーム分のゲーム進行を管理するクラス。
 * クラスは関連するデータと関数（メソッド）をひとまとめにできるTSの機能です。
 */
export class MahjongGame {
  // `private` を付けるとクラス外から見えなくなる（カプセル化）。
  // ここは状態の保持場所。初期化を = で書いておくとコンストラクタで上書きしない限りこの値になる。
  private players: PlayerState[] = [];
  private wall: Tile[] = [];                 // 山牌
  private phase: GamePhase = 'dealing';
  private round: Wind = 'east';
  private roundNumber = 1;
  private honbaCount = 0;
  private dealer = 0;
  private currentTurn = 0;
  private doraIndicators: Tile[] = [];
  private lastDiscard?: { tile: Tile; seat: number };
  // setTimeout の返り値は環境によって型が違うため `ReturnType<typeof setTimeout>` で取得
  private claimTimer?: ReturnType<typeof setTimeout>;
  private readyCount = 0;                    // 局終了後「次へ」を押した人数

  /**
   * コンストラクタ引数に `private readonly` を付けると、自動でクラスのプロパティとして保持されます。
   * これは TS の便利機能（パラメータプロパティ）です。
   */
  constructor(
    private readonly playerCount: 3 | 4,
    players: { socketId: string; name: string; seat: number }[],
    private readonly onStateChange: () => void,                                  // 状態が変わったら呼ぶ
    private readonly onRoundEnd: (result: RoundResult) => void,                  // 局終了で呼ぶ
    private readonly onClaimWindow: (                                            // 鳴きチャンス発生で呼ぶ
      seat: number,
      deadline: number,
      available: Array<'chi' | 'pon' | 'ron'>,
      chiCombos: [string, string][]
    ) => void
  ) {
    // map は「配列の各要素を変換して新しい配列を作る」メソッド
    // 受け取った最小限の情報に、ゲーム用の追加プロパティ(hand, scoreなど)を足している
    this.players = players.map(p => ({
      ...p,                                                  // 既存のプロパティをそのままコピー
      hand: [],
      discards: [],
      melds: [],
      score: playerCount === 4 ? 25000 : 35000,              // 4人なら25,000点、3人なら35,000点
    }));
  }

  /**
   * 1局の開始処理。山を作って配牌し、親がツモ牌を引いた状態にする。
   */
  startRound(): void {
    // 前回の鳴き待ちタイマーが残っていれば解除
    if (this.claimTimer) {
      clearTimeout(this.claimTimer);
      this.claimTimer = undefined;
    }

    // 全牌を作ってシャッフル
    const allTiles = shuffleTiles(createTileset(this.playerCount));
    // 末尾14枚を「王牌（ワンパイ）」として確保（ドラ表示牌＋嶺上牌等の領域）
    const deadWall = allTiles.slice(-14);
    this.wall = allTiles.slice(0, -14);                      // ツモる山
    this.doraIndicators = [deadWall[0]];                     // ドラ表示牌は王牌の先頭

    // プレイヤーの状態をリセット
    for (const p of this.players) {
      p.hand = [];
      p.discards = [];
      p.melds = [];
      p.claimResponse = undefined;
    }

    // 親から順番に13枚ずつ配る
    for (let i = 0; i < 13; i++) {
      for (let offset = 0; offset < this.playerCount; offset++) {
        const seat = (this.dealer + offset) % this.playerCount;
        // shift() は先頭を取り出して配列を縮める。末尾の `!` は「nullじゃないと保証」する印。
        this.players[seat].hand.push(this.wall.shift()!);
      }
    }

    // 配り終わったら見やすく並べる
    for (const p of this.players) {
      p.hand = sortHand(p.hand);
    }

    // 親が最初のツモ牌（14枚目）を引いて打牌スタート
    this.currentTurn = this.dealer;
    const extraTile = this.wall.shift();
    if (extraTile) {
      this.players[this.dealer].hand.push(extraTile);
      this.players[this.dealer].hand = sortHand(this.players[this.dealer].hand);
    }

    this.phase = 'discard';
    this.lastDiscard = undefined;
    this.readyCount = 0;
    this.onStateChange();                                    // 状態が変わったので通知
  }

  /**
   * 指定の席のプレイヤーが1枚ツモる。山が空なら流局処理。
   * 返り値: ツモできたかどうか
   */
  private drawForPlayer(seat: number): boolean {
    if (this.wall.length === 0) {
      this.handleExhaustedWall();
      return false;
    }
    const tile = this.wall.shift()!;
    this.players[seat].hand.push(tile);
    this.players[seat].hand = sortHand(this.players[seat].hand);
    return true;
  }

  /**
   * クライアントから「この牌を捨てる」と来たときの処理。
   * バリデーションして OK なら捨て牌に加え、鳴きチャンスを開始する。
   */
  handleDiscard(socketId: string, tileId: string): void {
    const player = this.players.find(p => p.socketId === socketId);
    // 不正なリクエストを弾く: 存在しない / 手番じゃない / フェーズが違う
    if (!player || player.seat !== this.currentTurn || this.phase !== 'discard') return;

    // 手牌から該当する牌のインデックスを探す
    const idx = player.hand.findIndex(t => t.id === tileId);
    if (idx === -1) return;                                  // 持っていない牌

    // splice(idx, 1) は idx の位置から1個取り除いて、その要素を配列で返す。[0]で1枚を取得。
    const tile = player.hand.splice(idx, 1)[0];
    player.discards.push(tile);
    this.lastDiscard = { tile, seat: player.seat };
    this.phase = 'claiming';                                 // 他家の鳴き判断フェーズへ
    this.startClaimWindow();
  }

  /**
   * 「鳴きチャンスを各プレイヤーに通知して応答を待つ」処理。
   * 全員がスキップしたら次のプレイヤーに進む。
   */
  private startClaimWindow(): void {
    if (!this.lastDiscard) return;

    const { tile: discardTile, seat: discardSeat } = this.lastDiscard;
    // 締切時刻を作成（クライアント側のカウントダウン用）
    const deadline = Date.now() + CLAIM_TIMEOUT_MS;

    // 全員の応答状態をリセット
    for (const p of this.players) {
      p.claimResponse = undefined;
    }
    // 捨てた本人は鳴かないので自動スキップ
    this.players.find(p => p.seat === discardSeat)!.claimResponse = null;

    let anyPending = false;                                  // 待つ人がいるか
    for (const p of this.players) {
      if (p.seat === discardSeat) continue;
      // この席が「ロン/ポン/チー」のどれを宣言できるか調べる
      const available = this.getAvailableClaims(p.seat, discardTile, discardSeat);
      const chiCombos = getChiCombinations(p.hand, discardTile);
      if (available.length > 0) {
        anyPending = true;
        this.onClaimWindow(p.seat, deadline, available, chiCombos);
      } else {
        // 鳴ける選択肢が無ければ即スキップ扱い
        p.claimResponse = null;
      }
    }

    // 誰も鳴ける選択肢がなければすぐ判定へ
    if (!anyPending || this.players.every(p => p.claimResponse !== undefined)) {
      this.processClaims();
      return;
    }

    // 時間切れになったら、未応答者をスキップ扱いにして判定
    this.claimTimer = setTimeout(() => {
      for (const p of this.players) {
        if (p.claimResponse === undefined) p.claimResponse = null;
      }
      this.processClaims();
    }, CLAIM_TIMEOUT_MS);
  }

  /**
   * 指定席のプレイヤーが「ロン/ポン/チー」のうちどれを宣言できるかを返す。
   * ロン: 和了形になる、ポン: 同種2枚あり、チー: 上家の捨て牌＆順子を作れる
   */
  private getAvailableClaims(
    seat: number,
    tile: Tile,
    discardSeat: number
  ): Array<'chi' | 'pon' | 'ron'> {
    const player = this.players.find(p => p.seat === seat)!;
    const result: Array<'chi' | 'pon' | 'ron'> = [];

    // ロンチェック
    if (checkWin(player.hand, player.melds, tile).isWin) result.push('ron');

    // ポンチェック（同じ牌を2枚持っているか）
    const matching = player.hand.filter(t => tilesEqual(t, tile));
    if (matching.length >= 2) result.push('pon');

    // チーは上家(直前のプレイヤー)からのみ
    const nextSeat = (discardSeat + 1) % this.playerCount;
    if (seat === nextSeat && getChiCombinations(player.hand, tile).length > 0) {
      result.push('chi');
    }

    return result;
  }

  /**
   * クライアントから鳴き応答（chi/pon/ron/skip）が来た時に呼ばれる。
   * 全員の応答が揃えば即時で判定処理に進む。
   */
  handleClaim(socketId: string, claim: ClaimRequest): void {
    const player = this.players.find(p => p.socketId === socketId);
    // 既に応答済みや、フェーズが違うリクエストは無視
    if (!player || this.phase !== 'claiming' || player.claimResponse !== undefined) return;

    player.claimResponse = claim;

    // every: すべての要素が条件を満たすかを true/false で返す
    if (this.players.every(p => p.claimResponse !== undefined)) {
      if (this.claimTimer) {
        clearTimeout(this.claimTimer);
        this.claimTimer = undefined;
      }
      this.processClaims();
    }
  }

  /**
   * 鳴き応答が出揃った後の判定処理。
   * 優先度: ロン > ポン > チー > 鳴きなし。
   */
  private processClaims(): void {
    if (!this.lastDiscard) return;
    const { seat: discardSeat } = this.lastDiscard;

    // ロンが最優先
    const ronner = this.players.find(p => p.claimResponse?.type === 'ron');
    if (ronner) {
      this.resolveRon(ronner, discardSeat);
      return;
    }

    // ポン
    const ponner = this.players.find(p => p.claimResponse?.type === 'pon');
    if (ponner) {
      this.resolvePon(ponner);
      return;
    }

    // チー
    const chier = this.players.find(p => p.claimResponse?.type === 'chi');
    if (chier) {
      this.resolveChi(chier);
      return;
    }

    // 誰も鳴かなかった → 次のプレイヤーへ進める
    const nextSeat = (discardSeat + 1) % this.playerCount;
    this.currentTurn = nextSeat;
    const drew = this.drawForPlayer(nextSeat);
    if (drew) {
      this.phase = 'discard';
      this.onStateChange();
    }
  }

  /**
   * ロン和了の処理。点数移動と結果通知。
   * 簡易ルールなので役による点数計算はしておらず、固定額にしている。
   */
  private resolveRon(winner: PlayerState, loserSeat: number): void {
    const winTile = this.lastDiscard!.tile;
    const isDealer = winner.seat === this.dealer;
    const payment = isDealer ? 12000 : 8000;                 // 親なら12000、子なら8000の固定額

    const loser = this.players.find(p => p.seat === loserSeat)!;
    loser.score -= payment;
    winner.score += payment;

    // 全員分のスコア変動を埋めるためのオブジェクト
    const scoreDelta: Record<number, number> = {};
    for (const p of this.players) scoreDelta[p.seat] = 0;
    scoreDelta[winner.seat] = payment;
    scoreDelta[loserSeat] = -payment;

    this.phase = 'roundEnd';
    this.onRoundEnd({
      isDraw: false,
      winner: winner.seat,
      losers: [loserSeat],
      winTile,
      winType: 'ron',
      handTiles: [...winner.hand],
      melds: [...winner.melds],
      scoreDelta,
      // Object.fromEntries: [キー, 値] のペア配列をオブジェクトに変換するヘルパー
      newScores: Object.fromEntries(this.players.map(p => [p.seat, p.score])),
    });
  }

  /**
   * ポンの処理。手牌から同じ牌を2枚取り出し、相手の捨て牌と合わせて鳴き面子を作る。
   */
  private resolvePon(claimer: PlayerState): void {
    const discardTile = this.lastDiscard!.tile;
    const ponTiles: Tile[] = [];                             // 鳴きに使う手牌2枚
    const newHand: Tile[] = [];                              // 鳴きに使わない手牌
    let count = 0;

    // 同じ牌を最大2枚まで取り出し、残りは手牌に戻す
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

    // 鳴いたプレイヤーがすぐ捨てる番
    this.currentTurn = claimer.seat;
    this.phase = 'discard';
    this.onStateChange();
  }

  /**
   * チーの処理。クライアントから渡された2枚のID(chiTiles)で順子を組む。
   * 不正な指定の場合はスキップ扱いに戻して再判定。
   */
  private resolveChi(claimer: PlayerState): void {
    // `as ClaimRequest & { type: 'chi' }` は「chi 型に絞り込む」型アサーション
    const claim = claimer.claimResponse as ClaimRequest & { type: 'chi' };
    if (!claim.chiTiles) {
      claimer.claimResponse = null;
      this.processClaims();
      return;
    }

    const discardTile = this.lastDiscard!.tile;
    const [id1, id2] = claim.chiTiles;                       // 分割代入でタプルを2変数に取り出す
    const chiFromHand: Tile[] = [];
    const newHand: Tile[] = [];

    // 指定された id を持つ牌だけ抜き出す
    for (const t of claimer.hand) {
      if ((t.id === id1 || t.id === id2) && chiFromHand.length < 2) {
        chiFromHand.push(t);
      } else {
        newHand.push(t);
      }
    }

    // ちゃんと2枚見つからなければ無効として戻す
    if (chiFromHand.length !== 2) {
      claimer.claimResponse = null;
      this.processClaims();
      return;
    }

    claimer.hand = newHand;
    // 表示のために値順に並べる（小→大）
    const meldTiles = [...chiFromHand, discardTile].sort((a, b) => a.value - b.value);
    claimer.melds.push({ type: 'chi', tiles: meldTiles, fromSeat: this.lastDiscard!.seat });

    this.currentTurn = claimer.seat;
    this.phase = 'discard';
    this.onStateChange();
  }

  /**
   * 自分のターンで「ツモ和了」を宣言したときの処理。
   * 14枚のうちどれを和了牌として外せば和了形になるかを試して、点数移動して終了。
   */
  handleTsumo(socketId: string): void {
    const player = this.players.find(p => p.socketId === socketId);
    if (!player || player.seat !== this.currentTurn || this.phase !== 'discard') return;

    // 和了の決め手となる牌（=最後にツモった牌想定）を1枚ずつ仮想して検証
    let winTile: Tile | undefined;
    for (const tile of player.hand) {
      const rest = player.hand.filter(t => t.id !== tile.id);
      if (checkWin(rest, player.melds, tile).isWin) {
        winTile = tile;
        break;
      }
    }
    if (!winTile) return;                                    // 実は和了形じゃなかった

    const isDealer = player.seat === this.dealer;
    const scoreDelta: Record<number, number> = {};
    let totalGain = 0;

    // 他家から支払いを受ける（親なら全員4000、子なら親4000・子2000）
    for (const p of this.players) {
      if (p.seat === player.seat) {
        scoreDelta[p.seat] = 0;
        continue;
      }
      const pay = isDealer ? 4000 : p.seat === this.dealer ? 4000 : 2000;
      p.score -= pay;
      scoreDelta[p.seat] = -pay;
      totalGain += pay;
    }

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
      scoreDelta,
      newScores: Object.fromEntries(this.players.map(p => [p.seat, p.score])),
    });
  }

  /**
   * 山牌が尽きた（流局）ときの処理。
   * テンパイ者と未テンパイ者で3000点をやり取りする「テンパイ料」を計算する。
   */
  private handleExhaustedWall(): void {
    const tenpaiSeats = this.players
      .filter(p => isTenpai(p.hand, p.melds))
      .map(p => p.seat);
    const noshiroSeats = this.players
      .filter(p => !tenpaiSeats.includes(p.seat))
      .map(p => p.seat);

    const scoreDelta: Record<number, number> = {};
    for (const p of this.players) scoreDelta[p.seat] = 0;

    // 双方が存在する時だけ精算（全員テンパイ or 全員ノーテンなら 0）
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

    // 親がテンパイなら連荘、ノーテンなら親流れ
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

  /**
   * 局終了後、各プレイヤーが「次の局へ」を押した時の処理。
   * 全員揃ったら自動で次の局を開始。
   */
  handleReadyNext(socketId: string): void {
    if (this.phase !== 'roundEnd') return;
    if (!this.players.find(p => p.socketId === socketId)) return;

    this.readyCount++;
    if (this.readyCount >= this.playerCount) {
      this.startRound();
    }
  }

  /**
   * ロン後の親移動処理。子が和了したら親流れ、親が和了したら連荘。
   * 簡略ルールなので本格的な本場カウントは省略。
   */
  advanceAfterRon(winnerSeat: number): void {
    if (winnerSeat !== this.dealer) {
      this.advanceDealer();
    }
    // 親の和了時は連荘扱い（本来 honba++ するが簡略化）
  }

  /**
   * 親を次の人に動かす。一周したら場風（東→南→西→北）を進める。
   */
  private advanceDealer(): void {
    this.dealer = (this.dealer + 1) % this.playerCount;
    if (this.dealer === 0) {
      // 親が一周（席0に戻った）したので場風を進める
      const roundIdx = WINDS.indexOf(this.round);
      this.round = WINDS[(roundIdx + 1) % WINDS.length];
    }
    this.roundNumber++;
    this.honbaCount = 0;
  }

  /**
   * 指定したプレイヤー視点の「見える情報」を作って返す。
   * 自分の手牌だけは中身を見せ、他人の手牌は枚数だけ送る、というプライバシー制御。
   */
  getViewForPlayer(socketId: string): GameView | null {
    const me = this.players.find(p => p.socketId === socketId);
    if (!me) return null;

    // 各プレイヤーの公開情報を作る
    const players: PlayerView[] = this.players.map(p => ({
      seat: p.seat,
      name: p.name,
      handCount: p.hand.length,
      discards: p.discards,
      melds: p.melds,
      score: p.score,
      isDealer: p.seat === this.dealer,
      seatWind: WINDS[p.seat] as Wind,
    }));

    return {
      phase: this.phase,
      round: this.round,
      roundNumber: this.roundNumber,
      honbaCount: this.honbaCount,
      dealer: this.dealer,
      currentTurn: this.currentTurn,
      wallCount: this.wall.length,
      doraIndicators: this.doraIndicators,
      lastDiscard: this.lastDiscard,
      players,
      myHand: me.hand,
      mySeat: me.seat,
    };
  }

  /**
   * 鳴きチャンス情報付きのビューを作る。
   * UIに「ロン/ポン/チー」ボタンを表示させたいときに使う。
   */
  getViewWithClaims(
    socketId: string,
    available: Array<'chi' | 'pon' | 'ron'>,
    chiCombinations: [string, string][]
  ): GameView | null {
    const view = this.getViewForPlayer(socketId);
    if (!view) return null;
    // スプレッド構文で既存ビューに追加情報を足す（イミュータブル更新）
    return { ...view, availableClaims: available, chiCombinations };
  }

  // --- 単純な getter ---
  getPhase(): GamePhase {
    return this.phase;
  }

  getPlayerCount(): number {
    return this.playerCount;
  }
}
