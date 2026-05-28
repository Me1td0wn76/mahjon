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
  private lastDiscard?: { tile: Tile; seat: number };
  private claimTimer?: ReturnType<typeof setTimeout>;
  private readyCount = 0;
  // 配牌直後だけ true。九種九牌宣言期間の管理。
  private firstGoAround = false;

  constructor(
    private readonly playerCount: 3 | 4,
    players: { socketId: string; name: string; seat: number }[],
    private readonly onStateChange: () => void,
    private readonly onRoundEnd: (result: RoundResult) => void,
    private readonly onClaimWindow: (
      seat: number,
      deadline: number,
      available: Array<'chi' | 'pon' | 'ron'>,
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
    this.doraIndicators = [deadWall[0]];

    for (const p of this.players) {
      p.hand = [];
      p.discards = [];
      p.melds = [];
      p.claimResponse = undefined;
      p.isRiichi = false;
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

    // リーチ中は手牌の自由打牌不可（ツモ切りに相当する最後の牌のみ可）
    if (player.isRiichi && player.hand[player.hand.length - 1].id !== tileId) return;

    const idx = player.hand.findIndex(t => t.id === tileId);
    if (idx === -1) return;

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
    if (player.melds.length > 0) return;              // 門前限定
    if (player.score < RIICHI_STICK) return;
    if (this.wall.length < 4) return;

    // 該当牌を仮に捨てたとして、残った手牌がテンパイか確認
    const idx = player.hand.findIndex(t => t.id === tileId);
    if (idx === -1) return;
    const remaining = [...player.hand.slice(0, idx), ...player.hand.slice(idx + 1)];
    if (!isTenpai(remaining, player.melds)) return;

    player.isRiichi = true;
    player.score -= RIICHI_STICK;
    this.riichiSticks += 1;

    // 通常の打牌処理に流す
    this.handleDiscard(socketId, tileId);
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
  ): Array<'chi' | 'pon' | 'ron'> {
    const player = this.players.find(p => p.seat === seat)!;
    const result: Array<'chi' | 'pon' | 'ron'> = [];

    if (checkWin(player.hand, player.melds, tile).isWin) result.push('ron');

    // リーチ中は鳴き不可（ロンのみ）
    if (player.isRiichi) return result;

    const matching = player.hand.filter(t => tilesEqual(t, tile));
    if (matching.length >= 2) result.push('pon');

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
      winner.kitaCount
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
      scoreDelta,
      newScores: Object.fromEntries(this.players.map(p => [p.seat, p.score])),
    });
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
      player.kitaCount
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

    // 自分が今リーチ宣言可能かを判定
    const canRiichi =
      me.seat === this.currentTurn &&
      this.phase === 'discard' &&
      !me.isRiichi &&
      me.melds.length === 0 &&
      me.score >= RIICHI_STICK &&
      this.wall.length >= 4 &&
      isTenpai(me.hand, me.melds);

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
    };
  }

  getViewWithClaims(
    socketId: string,
    available: Array<'chi' | 'pon' | 'ron'>,
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
