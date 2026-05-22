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

const CLAIM_TIMEOUT_MS = 8000;

interface PlayerState {
  socketId: string;
  name: string;
  seat: number;
  hand: Tile[];
  discards: Tile[];
  melds: Meld[];
  score: number;
  claimResponse?: ClaimRequest | null; // undefined=pending, null=skip
}

export class MahjongGame {
  private players: PlayerState[] = [];
  private wall: Tile[] = [];
  private phase: GamePhase = 'dealing';
  private round: Wind = 'east';
  private roundNumber = 1;
  private honbaCount = 0;
  private dealer = 0;
  private currentTurn = 0;
  private doraIndicators: Tile[] = [];
  private lastDiscard?: { tile: Tile; seat: number };
  private claimTimer?: ReturnType<typeof setTimeout>;
  private readyCount = 0;

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
      score: playerCount === 4 ? 25000 : 35000,
    }));
  }

  startRound(): void {
    if (this.claimTimer) {
      clearTimeout(this.claimTimer);
      this.claimTimer = undefined;
    }

    const allTiles = shuffleTiles(createTileset(this.playerCount));
    // Reserve last 14 tiles as dead wall
    const deadWall = allTiles.slice(-14);
    this.wall = allTiles.slice(0, -14);
    this.doraIndicators = [deadWall[0]];

    for (const p of this.players) {
      p.hand = [];
      p.discards = [];
      p.melds = [];
      p.claimResponse = undefined;
    }

    // Deal 13 tiles to each player, starting from dealer
    for (let i = 0; i < 13; i++) {
      for (let offset = 0; offset < this.playerCount; offset++) {
        const seat = (this.dealer + offset) % this.playerCount;
        this.players[seat].hand.push(this.wall.shift()!);
      }
    }

    for (const p of this.players) {
      p.hand = sortHand(p.hand);
    }

    // Dealer draws the 14th tile to start
    this.currentTurn = this.dealer;
    const extraTile = this.wall.shift();
    if (extraTile) {
      this.players[this.dealer].hand.push(extraTile);
      this.players[this.dealer].hand = sortHand(this.players[this.dealer].hand);
    }

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

    const idx = player.hand.findIndex(t => t.id === tileId);
    if (idx === -1) return;

    const tile = player.hand.splice(idx, 1)[0];
    player.discards.push(tile);
    this.lastDiscard = { tile, seat: player.seat };
    this.phase = 'claiming';
    this.startClaimWindow();
  }

  private startClaimWindow(): void {
    if (!this.lastDiscard) return;

    const { tile: discardTile, seat: discardSeat } = this.lastDiscard;
    const deadline = Date.now() + CLAIM_TIMEOUT_MS;

    for (const p of this.players) {
      p.claimResponse = undefined;
    }
    // Discarder auto-skips
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

    const matching = player.hand.filter(t => tilesEqual(t, tile));
    if (matching.length >= 2) result.push('pon');

    const nextSeat = (discardSeat + 1) % this.playerCount;
    if (seat === nextSeat && getChiCombinations(player.hand, tile).length > 0) {
      result.push('chi');
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

    // Ron first
    const ronner = this.players.find(p => p.claimResponse?.type === 'ron');
    if (ronner) {
      this.resolveRon(ronner, discardSeat);
      return;
    }

    // Pon
    const ponner = this.players.find(p => p.claimResponse?.type === 'pon');
    if (ponner) {
      this.resolvePon(ponner);
      return;
    }

    // Chi
    const chier = this.players.find(p => p.claimResponse?.type === 'chi');
    if (chier) {
      this.resolveChi(chier);
      return;
    }

    // No claims — advance to next player
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
    const payment = isDealer ? 12000 : 8000;

    const loser = this.players.find(p => p.seat === loserSeat)!;
    loser.score -= payment;
    winner.score += payment;

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

    // Find the winning tile
    let winTile: Tile | undefined;
    for (const tile of player.hand) {
      const rest = player.hand.filter(t => t.id !== tile.id);
      if (checkWin(rest, player.melds, tile).isWin) {
        winTile = tile;
        break;
      }
    }
    if (!winTile) return;

    const isDealer = player.seat === this.dealer;
    const scoreDelta: Record<number, number> = {};
    let totalGain = 0;

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
    // Dealer wins: stay (honba stays or increments in full rules — skip here)
  }

  private advanceDealer(): void {
    this.dealer = (this.dealer + 1) % this.playerCount;
    if (this.dealer === 0) {
      // Completed a full rotation — advance round wind
      const roundIdx = WINDS.indexOf(this.round);
      this.round = WINDS[(roundIdx + 1) % WINDS.length];
    }
    this.roundNumber++;
    this.honbaCount = 0;
  }

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
