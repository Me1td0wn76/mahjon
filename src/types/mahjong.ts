export type Suit = 'man' | 'pin' | 'sou' | 'honor';

export interface Tile {
  id: string;
  suit: Suit;
  value: number;
}

export interface Meld {
  type: 'chi' | 'pon' | 'minkan' | 'ankan';
  tiles: Tile[];
  fromSeat?: number;
}

export type GamePhase =
  | 'dealing'
  | 'draw'
  | 'discard'
  | 'claiming'
  | 'roundEnd'
  | 'gameOver';

export type Wind = 'east' | 'south' | 'west' | 'north';

export interface PlayerView {
  seat: number;
  name: string;
  handCount: number;
  discards: Tile[];
  melds: Meld[];
  score: number;
  isDealer: boolean;
  seatWind: Wind;
}

export interface GameView {
  phase: GamePhase;
  round: Wind;
  roundNumber: number;
  honbaCount: number;
  dealer: number;
  currentTurn: number;
  wallCount: number;
  doraIndicators: Tile[];
  lastDiscard?: { tile: Tile; seat: number };
  players: PlayerView[];
  myHand: Tile[];
  mySeat: number;
  availableClaims?: Array<'chi' | 'pon' | 'ron'>;
  chiCombinations?: [string, string][];
}

export interface RoundResult {
  isDraw: boolean;
  winner?: number;
  losers?: number[];
  winTile?: Tile;
  winType?: 'tsumo' | 'ron';
  handTiles?: Tile[];
  melds?: Meld[];
  scoreDelta: Record<number, number>;
  newScores: Record<number, number>;
}

export interface RoomInfo {
  id: string;
  name: string;
  maxPlayers: 3 | 4;
  currentPlayers: number;
  status: 'waiting' | 'playing';
}

export const WIND_LABEL: Record<Wind, string> = {
  east: '東',
  south: '南',
  west: '西',
  north: '北',
};

export const HONOR_NAMES = ['東', '南', '西', '北', '白', '発', '中'];
export const SUIT_CHARS: Record<string, string> = { man: '万', pin: '筒', sou: '索' };

export function getTileName(tile: Tile): string {
  if (tile.suit === 'honor') return HONOR_NAMES[tile.value - 1];
  return `${tile.value}${SUIT_CHARS[tile.suit]}`;
}

export function canTsumoCheck(hand: Tile[], melds: Meld[]): boolean {
  for (const tile of hand) {
    const rest = hand.filter(t => t.id !== tile.id);
    if (isWinningHandClient(rest, melds, tile)) return true;
  }
  return false;
}

function isWinningHandClient(closedHand: Tile[], openMelds: Meld[], winTile: Tile): boolean {
  const full = [...closedHand, winTile];
  const needed = 4 - openMelds.length;
  if (full.length !== needed * 3 + 2) return false;

  // Chiitoitsu
  if (openMelds.length === 0 && full.length === 14) {
    const sorted = [...full].sort(compareTiles);
    let chi7 = true;
    for (let i = 0; i < sorted.length; i += 2) {
      if (sorted[i].suit !== sorted[i + 1]?.suit || sorted[i].value !== sorted[i + 1]?.value) {
        chi7 = false;
        break;
      }
    }
    if (chi7) return true;
  }

  // Standard form
  const sorted = [...full].sort(compareTiles);
  const tried = new Set<string>();
  for (let i = 0; i < sorted.length - 1; i++) {
    const key = `${sorted[i].suit}_${sorted[i].value}`;
    if (tried.has(key)) continue;
    if (sorted[i].suit === sorted[i + 1].suit && sorted[i].value === sorted[i + 1].value) {
      tried.add(key);
      const rest = [...sorted.slice(0, i), ...sorted.slice(i + 2)];
      if (canFormMeldsClient(rest)) return true;
    }
  }
  return false;
}

function canFormMeldsClient(tiles: Tile[]): boolean {
  if (tiles.length === 0) return true;
  if (tiles.length % 3 !== 0) return false;
  const sorted = [...tiles].sort(compareTiles);
  const first = sorted[0];
  const rest = sorted.slice(1);

  // Triplet
  const t1 = rest.findIndex(t => t.suit === first.suit && t.value === first.value);
  if (t1 !== -1) {
    const r2 = [...rest];
    r2.splice(t1, 1);
    const t2 = r2.findIndex(t => t.suit === first.suit && t.value === first.value);
    if (t2 !== -1) {
      const r3 = [...r2];
      r3.splice(t2, 1);
      if (canFormMeldsClient(r3)) return true;
    }
  }

  // Sequence
  if (first.suit !== 'honor' && first.value <= 7) {
    const n1 = rest.findIndex(t => t.suit === first.suit && t.value === first.value + 1);
    if (n1 !== -1) {
      const r2 = [...rest];
      r2.splice(n1, 1);
      const n2 = r2.findIndex(t => t.suit === first.suit && t.value === first.value + 2);
      if (n2 !== -1) {
        const r3 = [...r2];
        r3.splice(n2, 1);
        if (canFormMeldsClient(r3)) return true;
      }
    }
  }
  return false;
}

function compareTiles(a: Tile, b: Tile): number {
  const o: Record<string, number> = { man: 0, pin: 1, sou: 2, honor: 3 };
  if (o[a.suit] !== o[b.suit]) return o[a.suit] - o[b.suit];
  return a.value - b.value;
}
