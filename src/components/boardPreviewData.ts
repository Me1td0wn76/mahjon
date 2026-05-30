// このファイルは「開発用のモックデータ」を提供します。
// URLに `?preview` を付けると、サーバーに接続せずにこのデータでゲーム盤面の見た目を確認できます。
// 本番では使わない開発専用。レイアウト調整の効率化のために用意されています。
import type { GameView, Tile } from '../types/mahjong';

/**
 * Dev-only mock GameView for previewing the board layout without a live game.
 * Visit the app with `?preview` to render it. Safe to delete.
 */

// 牌のユニークIDをカウントアップするためのカウンタ
let n = 0;
// 牌オブジェクトを簡潔に作るためのヘルパ。
// 引数の型に `Tile['suit']` を使うと、Tile 型の suit プロパティの型を直接参照できる。
const t = (suit: Tile['suit'], value: number): Tile => ({
  id: `pv-${n++}`,                                           // 後置 `++` で「使ってから増やす」
  suit,
  value,
});

// 捨て牌の指定をシンプルに書けるユーティリティ。
// `[Tile['suit'], number][]` は [種類, 数字] のタプルの配列。
const discards = (specs: [Tile['suit'], number][]): Tile[] =>
  specs.map(([s, v]) => t(s, v));

// プレビュー用のゲーム状態。GameView 型に従って作られているのでそのまま GameBoard に渡せる。
export const previewGameView: GameView = {
  phase: 'discard',
  round: 'east',
  roundNumber: 1,
  honbaCount: 0,
  riichiSticks: 0,
  dealer: 0,
  currentTurn: 3,
  wallCount: 43,
  doraIndicators: [t('sou', 5)],
  lastDiscard: { tile: t('pin', 2), seat: 0 },
  mySeat: 3,
  // 自分の手牌（14枚 = ツモ後の状態）
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
  // 4人分のプレイヤー公開情報（中盤らしい状態でレイアウトを確認できるようにしている）
  players: [
    {
      seat: 0,
      name: 'hoge',
      handCount: 10,
      discards: discards([
        ['man', 1], ['pin', 9], ['sou', 1], ['honor', 5], ['man', 2], ['pin', 2],
        ['honor', 4], ['sou', 1], ['man', 9],
      ]),
      // ポン（中）を1つ持っている例
      melds: [
        { type: 'pon', tiles: [t('honor', 7), t('honor', 7), t('honor', 7)], fromSeat: 2 },
      ],
      score: 32000,
      isDealer: true,
      seatWind: 'east',
      isRiichi: false,
      kitaCount: 0,
    },
    {
      seat: 1,
      name: 'huga',
      handCount: 13,
      discards: discards([
        ['sou', 9], ['man', 9], ['honor', 7], ['pin', 1], ['honor', 1], ['sou', 8], ['pin', 6],
      ]),
      melds: [],
      score: 24000,
      isDealer: false,
      seatWind: 'south',
      isRiichi: true,              // リーチ中（立直タグ＋河の色マットを確認）
      kitaCount: 0,
    },
    {
      seat: 2,
      name: 'fuga',
      handCount: 10,
      discards: discards([
        ['honor', 2], ['man', 3], ['pin', 8], ['sou', 2], ['man', 5], ['pin', 3], ['honor', 6],
      ]),
      // チー（4-5-6筒）の例
      melds: [
        { type: 'chi', tiles: [t('pin', 4), t('pin', 5), t('pin', 6)], fromSeat: 1 },
      ],
      score: 27000,
      isDealer: false,
      seatWind: 'west',
      isRiichi: false,
      kitaCount: 0,
    },
    {
      seat: 3,
      name: 'piyo',
      handCount: 14,
      discards: discards([
        ['honor', 6], ['sou', 3], ['man', 1], ['pin', 7], ['sou', 5], ['man', 6],
      ]),
      melds: [],
      score: 30000,
      isDealer: false,
      seatWind: 'north',
      isRiichi: false,
      kitaCount: 0,
    },
  ],
};
