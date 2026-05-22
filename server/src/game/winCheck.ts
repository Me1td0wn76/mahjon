import { Tile, Meld } from '../types.js';
import { tilesEqual, compareTiles } from './tiles.js';

function canFormMelds(tiles: Tile[]): boolean {
  if (tiles.length === 0) return true;
  if (tiles.length % 3 !== 0) return false;

  const sorted = [...tiles].sort(compareTiles);
  const first = sorted[0];
  const rest = sorted.slice(1);

  // Try triplet
  const t1 = rest.findIndex(t => tilesEqual(t, first));
  if (t1 !== -1) {
    const rest2 = [...rest];
    rest2.splice(t1, 1);
    const t2 = rest2.findIndex(t => tilesEqual(t, first));
    if (t2 !== -1) {
      const rest3 = [...rest2];
      rest3.splice(t2, 1);
      if (canFormMelds(rest3)) return true;
    }
  }

  // Try sequence (only for number tiles)
  if (first.suit !== 'honor' && first.value <= 7) {
    const n1 = rest.findIndex(t => t.suit === first.suit && t.value === first.value + 1);
    if (n1 !== -1) {
      const rest2 = [...rest];
      rest2.splice(n1, 1);
      const n2 = rest2.findIndex(t => t.suit === first.suit && t.value === first.value + 2);
      if (n2 !== -1) {
        const rest3 = [...rest2];
        rest3.splice(n2, 1);
        if (canFormMelds(rest3)) return true;
      }
    }
  }

  return false;
}

function isChiitoitsu(tiles: Tile[]): boolean {
  if (tiles.length !== 14) return false;
  const sorted = [...tiles].sort(compareTiles);
  for (let i = 0; i < sorted.length; i += 2) {
    if (!tilesEqual(sorted[i], sorted[i + 1])) return false;
  }
  return true;
}

function isStandardWin(fullClosedHand: Tile[], openMeldCount: number): boolean {
  const needed = 4 - openMeldCount;
  if (fullClosedHand.length !== needed * 3 + 2) return false;

  const sorted = [...fullClosedHand].sort(compareTiles);
  const tried = new Set<string>();

  for (let i = 0; i < sorted.length - 1; i++) {
    const key = `${sorted[i].suit}_${sorted[i].value}`;
    if (tried.has(key)) continue;
    if (tilesEqual(sorted[i], sorted[i + 1])) {
      tried.add(key);
      const rest = [...sorted.slice(0, i), ...sorted.slice(i + 2)];
      if (canFormMelds(rest)) return true;
    }
  }

  return false;
}

export interface WinResult {
  isWin: boolean;
  isChiitoitsu?: boolean;
}

export function checkWin(closedHand: Tile[], openMelds: Meld[], winTile: Tile): WinResult {
  const full = [...closedHand, winTile];
  if (openMelds.length === 0 && isChiitoitsu(full)) {
    return { isWin: true, isChiitoitsu: true };
  }
  if (isStandardWin(full, openMelds.length)) {
    return { isWin: true };
  }
  return { isWin: false };
}

export function isTenpai(closedHand: Tile[], openMelds: Meld[]): boolean {
  const testTiles: { suit: Tile['suit']; value: number }[] = [];
  for (const suit of ['man', 'pin', 'sou'] as const) {
    for (let v = 1; v <= 9; v++) testTiles.push({ suit, value: v });
  }
  for (let v = 1; v <= 7; v++) testTiles.push({ suit: 'honor', value: v });

  for (const tt of testTiles) {
    if (checkWin(closedHand, openMelds, { id: 'test', suit: tt.suit, value: tt.value }).isWin) {
      return true;
    }
  }
  return false;
}

export function getChiCombinations(hand: Tile[], discard: Tile): [string, string][] {
  if (discard.suit === 'honor') return [];

  const combos: [string, string][] = [];
  const v = discard.value;
  const s = discard.suit;

  const pairs: [number, number][] = [];
  if (v >= 3) pairs.push([v - 2, v - 1]);
  if (v >= 2 && v <= 8) pairs.push([v - 1, v + 1]);
  if (v <= 7) pairs.push([v + 1, v + 2]);

  for (const [a, b] of pairs) {
    const tA = hand.find(t => t.suit === s && t.value === a);
    const tB = hand.find(t => t.suit === s && t.value === b);
    if (tA && tB && tA.id !== tB.id) {
      combos.push([tA.id, tB.id]);
    }
  }
  return combos;
}
