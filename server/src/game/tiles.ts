import { Tile, Suit } from '../types.js';

export function createTileset(playerCount: 3 | 4): Tile[] {
  const tiles: Tile[] = [];

  // Number suits
  for (const suit of ['man', 'pin', 'sou'] as Suit[]) {
    for (let value = 1; value <= 9; value++) {
      // 3-player Sanma: remove man 2-8
      if (playerCount === 3 && suit === 'man' && value >= 2 && value <= 8) continue;
      for (let copy = 0; copy < 4; copy++) {
        tiles.push({ id: `${suit}_${value}_${copy}`, suit, value });
      }
    }
  }

  // Honor tiles: winds 1-4 (E/S/W/N), dragons 5-7 (白/発/中)
  for (let value = 1; value <= 7; value++) {
    for (let copy = 0; copy < 4; copy++) {
      tiles.push({ id: `honor_${value}_${copy}`, suit: 'honor', value });
    }
  }

  return tiles;
}

export function shuffleTiles(tiles: Tile[]): Tile[] {
  const arr = [...tiles];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function compareTiles(a: Tile, b: Tile): number {
  const order: Record<string, number> = { man: 0, pin: 1, sou: 2, honor: 3 };
  if (order[a.suit] !== order[b.suit]) return order[a.suit] - order[b.suit];
  return a.value - b.value;
}

export function sortHand(hand: Tile[]): Tile[] {
  return [...hand].sort(compareTiles);
}

export function tilesEqual(a: Tile, b: Tile): boolean {
  return a.suit === b.suit && a.value === b.value;
}

export function getTileName(tile: Tile): string {
  if (tile.suit === 'honor') {
    return ['東', '南', '西', '北', '白', '発', '中'][tile.value - 1];
  }
  const suitChar: Record<string, string> = { man: '万', pin: '筒', sou: '索' };
  return `${tile.value}${suitChar[tile.suit]}`;
}
