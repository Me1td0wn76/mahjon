import type { GameView, Tile } from '../types/mahjong';

/**
 * Dev-only mock GameView for previewing the board layout without a live game.
 * Visit the app with `?preview` to render it. Safe to delete.
 */

let n = 0;
const t = (suit: Tile['suit'], value: number): Tile => ({
  id: `pv-${n++}`,
  suit,
  value,
});

const discards = (specs: [Tile['suit'], number][]): Tile[] =>
  specs.map(([s, v]) => t(s, v));

export const previewGameView: GameView = {
  phase: 'discard',
  round: 'east',
  roundNumber: 1,
  honbaCount: 0,
  dealer: 0,
  currentTurn: 3,
  wallCount: 43,
  doraIndicators: [t('sou', 5)],
  lastDiscard: { tile: t('pin', 2), seat: 0 },
  mySeat: 3,
  myHand: [
    t('man', 4),
    t('man', 4),
    t('man', 6),
    t('man', 7),
    t('man', 8),
    t('pin', 3),
    t('pin', 4),
    t('pin', 5),
    t('sou', 6),
    t('sou', 7),
    t('sou', 8),
    t('honor', 1),
    t('honor', 1),
    t('honor', 3),
  ],
  players: [
    {
      seat: 0,
      name: 'マサハル',
      handCount: 13,
      discards: discards([['man', 1], ['pin', 9], ['sou', 1], ['honor', 5], ['man', 2], ['pin', 2]]),
      melds: [],
      score: 25000,
      isDealer: true,
      seatWind: 'east',
    },
    {
      seat: 1,
      name: '菊池さん',
      handCount: 13,
      discards: discards([['sou', 9], ['man', 9], ['honor', 7], ['pin', 1]]),
      melds: [],
      score: 25000,
      isDealer: false,
      seatWind: 'south',
    },
    {
      seat: 2,
      name: 'タックン',
      handCount: 13,
      discards: discards([['honor', 2], ['man', 3], ['pin', 8], ['sou', 2], ['man', 5]]),
      melds: [],
      score: 25000,
      isDealer: false,
      seatWind: 'west',
    },
    {
      seat: 3,
      name: 'プレイヤー',
      handCount: 14,
      discards: discards([['honor', 6], ['sou', 3], ['man', 1], ['pin', 7]]),
      melds: [],
      score: 25000,
      isDealer: false,
      seatWind: 'north',
    },
  ],
};
