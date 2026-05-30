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
import { checkWin, isTenpai, getChiCombinations } from './winCheck.js';
import { calculateScore, calcRonPayment, calcTsumoPayment } from './scoring.js';

// 鳴きの判断を待つ最大時間
const CLAIM_TIMEOUT_MS = 8000;
// リーチ供託額
const RIICHI_STICK = 1000;

// クラス内部だけで使うプレイヤー状態
interface PlayerState {
  socketId: string;
  name: string;
  seat: number;
  hand: Tile[];
  discards: Tile[];
  melds: Meld[];
  score: number;
  claimResponse?: ClaimRequest | null;
  isRiichi: boolean;                       // リーチ済みかどうか
  isDoubleRiichi: boolean;                 // ダブル立直（第1打でのリーチ）
  ippatsuEligible: boolean;                // 一発の権利が残っているか
  rinshanEligible: boolean;                // 次の和了が嶺上開花になり得るか（カン直後）
  kitaCount: number;                       // 三麻の北抜き枚数
}

export class MahjongGame {
  private players: PlayerState[] = [];
  private wall: Tile[] = [];
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
  private claimTimer?: ReturnType<typeof setTimeout>;
  private readyCount = 0;
  // 配牌直後だけ true。九種九牌宣言期間の管理。
  private firstGoAround = false;
  // この局で一度でも鳴き（ポン・チー・カン）があったか。ダブル立直の判定に使う。
  private anyCallMade = false;
  // リーチ宣言の打牌だけ、リーチ後の打牌制限を一時的に解除するためのフラグ。
  private bypassRiichiLock = false;

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
      p.kitaCount = 0;
    }

    // 親から順番に13枚ずつ配る
    for (let i = 0; i < 13; i++) {
      for (let offset = 0; offset < this.playerCount; offset++) {
        const seat = (this.dealer + offset) % this.playerCount;
        this.players[seat].hand.push(this.wall.shift()!);
      }
    }

    for (const p of this.players) {
      p.hand = sortHand(p.hand);
    }

    this.currentTurn = this.dealer;
    const extraTile = this.wall.shift();
    if (extraTile) {
      this.players[this.dealer].hand.push(extraTile);
      this.players[this.dealer].hand = sortHand(this.players[this.dealer].hand);
    }

    // 配牌直後は九種九牌宣言の余地あり
    this.firstGoAround = true;
    this.phase = 'discard';
    this.lastDiscard = undefined;
    this.readyCount = 0;
    this.onStateChange();
  }

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

  handleDiscard(socketId: string, tileId: string): void {
    const player = this.players.find(p => p.socketId === socketId);
    if (!player || player.seat !== this.currentTurn || this.phase !== 'discard') return;

    // リーチ中は手牌の自由打牌不可（ツモ切りに相当する最後の牌のみ可）。
    // ただしリーチ宣言の打牌そのものは bypassRiichiLock により許可する。
    if (
      player.isRiichi &&
      !this.bypassRiichiLock &&
      player.hand[player.hand.length - 1].id !== tileId
    ) {
      return;
    }

    const idx = player.hand.findIndex(t => t.id === tileId);
    if (idx === -1) return;

    // リーチ後、自分の次の打牌（ツモ切り）を行った時点で一発の権利は消滅する。
    // リーチ宣言の打牌（bypass中）では消さない。
    if (player.ippatsuEligible && !this.bypassRiichiLock) {
      player.ippatsuEligible = false;
    }
    // 嶺上開花の権利は、補充ツモ後に打牌（＝ツモらず捨てた）時点で消滅する。
    player.rinshanEligible = false;

    const tile = player.hand.splice(idx, 1)[0];
    player.discards.push(tile);
    this.lastDiscard = { tile, seat: player.seat };
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

    // 親流れ無しの流局
    const scoreDelta: Record<number, number> = {};
    for (const p of this.players) scoreDelta[p.seat] = 0;

    this.phase = 'roundEnd';
    this.onRoundEnd({
      isDraw: true,
      isKyushuhai: true,
      scoreDelta,
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

  private startClaimWindow(): void {
    if (!this.lastDiscard) return;

    const { tile: discardTile, seat: discardSeat } = this.lastDiscard;
    const deadline = Date.now() + CLAIM_TIMEOUT_MS;

    for (const p of this.players) {
      p.claimResponse = undefined;
    }
    this.players.find(p => p.seat === discardSeat)!.claimResponse = null;

    let anyPending = false;
    for (const p of this.players) {
      if (p.seat === discardSeat) continue;
      const available = this.getAvailableClaims(p.seat, discardTile, discardSeat);
      const chiCombos = getChiCombinations(p.hand, discardTile);
      if (available.length > 0) {
        anyPending = true;
        this.onClaimWindow(p.seat, deadline, available, chiCombos);
      } else {
        p.claimResponse = null;
      }
    }

    if (!anyPending || this.players.every(p => p.claimResponse !== undefined)) {
      this.processClaims();
      return;
    }

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
    discardSeat: number
  ): Array<'chi' | 'pon' | 'kan' | 'ron'> {
    const player = this.players.find(p => p.seat === seat)!;
    const result: Array<'chi' | 'pon' | 'kan' | 'ron'> = [];

    if (checkWin(player.hand, player.melds, tile).isWin) result.push('ron');

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

  handleClaim(socketId: string, claim: ClaimRequest): void {
    const player = this.players.find(p => p.socketId === socketId);
    if (!player || this.phase !== 'claiming' || player.claimResponse !== undefined) return;

    player.claimResponse = claim;

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

    const nextSeat = (discardSeat + 1) % this.playerCount;
    this.currentTurn = nextSeat;
    const drew = this.drawForPlayer(nextSeat);
    if (drew) {
      this.phase = 'discard';
      this.onStateChange();
    }
  }

  private resolveRon(winner: PlayerState, loserSeat: number): void {
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

    const payment = calcRonPayment(scoring.basePoint, isDealer)
      + this.honbaCount * 300;
    const loser = this.players.find(p => p.seat === loserSeat)!;
    const totalForWinner = payment + this.riichiSticks * RIICHI_STICK;

    loser.score -= payment;
    winner.score += totalForWinner;
    this.riichiSticks = 0;

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
      handTiles: [...winner.hand],
      melds: [...winner.melds],
      yakuList: scoring.yakuList,
      totalHan: scoring.totalHan,
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
    player.rinshanEligible = true;        // 次のツモ和了は嶺上開花
    return true;
  }

  /**
   * 暗槓（あんかん）。自分の手番で同じ牌を4枚持っている時に宣言できる。
   * 暗槓は門前を崩さないのでリーチ後でも本来は可能だが、
   * 待ちが変わる暗槓の判定が複雑なため、ここではリーチ後の暗槓は不可とする。
   * @param tileId 4枚のうちどれか1枚のID（同じ種類4枚をまとめてカンする）
   */
  handleAnkan(socketId: string, tileId: string): void {
    const player = this.players.find(p => p.socketId === socketId);
    if (!player || player.seat !== this.currentTurn || this.phase !== 'discard') return;
    if (player.isRiichi) return;          // リーチ後の暗槓は未対応

    const target = player.hand.find(t => t.id === tileId);
    if (!target) return;
    const quad = player.hand.filter(t => tilesEqual(t, target));
    if (quad.length !== 4) return;        // 4枚揃っていなければ不可

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

    // ポンを明槓（カン）に昇格させ、手牌から1枚移す
    player.hand = player.hand.filter(t => t.id !== tileId);
    pon.type = 'minkan';
    pon.tiles = [...pon.tiles, target];

    this.onCallMade();
    this.revealNewKanDora();
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

  private resolvePon(claimer: PlayerState): void {
    const discardTile = this.lastDiscard!.tile;
    const ponTiles: Tile[] = [];
    const newHand: Tile[] = [];
    let count = 0;

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

    this.currentTurn = claimer.seat;
    this.phase = 'discard';
    this.onStateChange();
  }

  private resolveChi(claimer: PlayerState): void {
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
    const meldTiles = [...chiFromHand, discardTile].sort((a, b) => a.value - b.value);
    claimer.melds.push({ type: 'chi', tiles: meldTiles, fromSeat: this.lastDiscard!.seat });
    this.removeClaimedTileFromRiver();
    this.onCallMade();

    this.currentTurn = claimer.seat;
    this.phase = 'discard';
    this.onStateChange();
  }

  handleTsumo(socketId: string): void {
    const player = this.players.find(p => p.socketId === socketId);
    if (!player || player.seat !== this.currentTurn || this.phase !== 'discard') return;

    let winTile: Tile | undefined;
    for (const tile of player.hand) {
      const rest = player.hand.filter(t => t.id !== tile.id);
      if (checkWin(rest, player.melds, tile).isWin) {
        winTile = tile;
        break;
      }
    }
    if (!winTile) return;

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
    const honbaPay = this.honbaCount * 100;

    const scoreDelta: Record<number, number> = {};
    let totalGain = 0;

    for (const p of this.players) {
      if (p.seat === player.seat) {
        scoreDelta[p.seat] = 0;
        continue;
      }
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
      doraIndicators: [...this.doraIndicators],
      uraDoraIndicators: player.isRiichi ? [...this.uraDoraIndicators] : undefined,
      scoreDelta,
      newScores: Object.fromEntries(this.players.map(p => [p.seat, p.score])),
    });
  }

  private handleExhaustedWall(): void {
    const tenpaiSeats = this.players
      .filter(p => isTenpai(p.hand, p.melds))
      .map(p => p.seat);
    const noshiroSeats = this.players
      .filter(p => !tenpaiSeats.includes(p.seat))
      .map(p => p.seat);

    const scoreDelta: Record<number, number> = {};
    for (const p of this.players) scoreDelta[p.seat] = 0;

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

  handleReadyNext(socketId: string): void {
    if (this.phase !== 'roundEnd') return;
    if (!this.players.find(p => p.socketId === socketId)) return;

    this.readyCount++;
    if (this.readyCount >= this.playerCount) {
      this.startRound();
    }
  }

  advanceAfterRon(winnerSeat: number): void {
    if (winnerSeat !== this.dealer) {
      this.advanceDealer();
    }
  }

  private advanceDealer(): void {
    this.dealer = (this.dealer + 1) % this.playerCount;
    if (this.dealer === 0) {
      const roundIdx = WINDS.indexOf(this.round);
      this.round = WINDS[(roundIdx + 1) % WINDS.length];
    }
    this.roundNumber++;
    this.honbaCount = 0;
  }

  /**
   * 指定したプレイヤー視点の「見える情報」を作って返す。
   */
  getViewForPlayer(socketId: string): GameView | null {
    const me = this.players.find(p => p.socketId === socketId);
    if (!me) return null;

    const players: PlayerView[] = this.players.map(p => ({
      seat: p.seat,
      name: p.name,
      handCount: p.hand.length,
      discards: p.discards,
      melds: p.melds,
      score: p.score,
      isDealer: p.seat === this.dealer,
      seatWind: WINDS[p.seat] as Wind,
      isRiichi: p.isRiichi,
      kitaCount: p.kitaCount,
    }));

    // 自分が今リーチ宣言可能かを判定（暗槓のみなら門前を維持）
    const canRiichi =
      me.seat === this.currentTurn &&
      this.phase === 'discard' &&
      !me.isRiichi &&
      this.isMenzen(me) &&
      me.score >= RIICHI_STICK &&
      this.wall.length >= 4 &&
      isTenpai(me.hand, me.melds);

    // カン可能か（自分の手番・打牌フェーズ・リーチ中でない）
    const myTurnDiscard =
      me.seat === this.currentTurn && this.phase === 'discard' && !me.isRiichi;
    // 暗槓: 同じ牌4枚ごとに代表牌のIDを1つ返す
    const ankanOptions: string[] = [];
    // 加槓: 既存のポンに足せる手牌のIDを返す
    const kakanOptions: string[] = [];
    if (myTurnDiscard) {
      const seen = new Set<string>();
      for (const t of me.hand) {
        const key = `${t.suit}_${t.value}`;
        if (!seen.has(key)) {
          seen.add(key);
          if (me.hand.filter(x => tilesEqual(x, t)).length === 4) ankanOptions.push(t.id);
        }
        if (me.melds.some(m => m.type === 'pon' && tilesEqual(m.tiles[0], t))) {
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
      canRiichi,
      canKita,
      canKyushuhai,
      ankanOptions,
      kakanOptions,
    };
  }

  getViewWithClaims(
    socketId: string,
    available: Array<'chi' | 'pon' | 'kan' | 'ron'>,
    chiCombinations: [string, string][]
  ): GameView | null {
    const view = this.getViewForPlayer(socketId);
    if (!view) return null;
    return { ...view, availableClaims: available, chiCombinations };
  }

  getPhase(): GamePhase {
    return this.phase;
  }

  getPlayerCount(): number {
    return this.playerCount;
  }
}
