// このファイルは「牌（はい）」を作ったり並べ替えたりする補助関数をまとめています。
// 型定義は ../types.ts からインポートします。
// import に `.js` 拡張子が付いているのは Node.js の ESM ルールのためで、
// TS が JS にコンパイルされたあとの参照先を指定しているからです（TSファイルが対応します）。
import { Tile, Suit } from '../types.js';

/**
 * 麻雀の全牌（136枚 or 三麻なら108枚）を作る関数。
 * @param playerCount プレイヤー数（3 または 4 のみ）
 * @returns 全ての牌が入った配列
 */
export function createTileset(playerCount: 3 | 4): Tile[] {
  const tiles: Tile[] = []; // 空の配列にどんどん追加していく

  // --- 数牌（マンズ・ピンズ・ソウズ）を作成 ---
  // `as Suit[]` は型アサーション。文字列配列を Suit 型配列として扱うようTSに伝えています。
  for (const suit of ['man', 'pin', 'sou'] as Suit[]) {
    for (let value = 1; value <= 9; value++) {
      // 三人麻雀のルール: 萬子の2〜8は使わない（1と9のみ使用）
      if (playerCount === 3 && suit === 'man' && value >= 2 && value <= 8) continue;
      // 同じ牌は4枚ずつ（東西南北とは関係ない単なる枚数）
      for (let copy = 0; copy < 4; copy++) {
        // テンプレート文字列でID生成 (例: "man_5_0", "man_5_1", ...)
        tiles.push({ id: `${suit}_${value}_${copy}`, suit, value });
      }
    }
  }

  // --- 字牌を作成 ---
  // 1-4: 風牌(東南西北)、5-7: 三元牌(白発中)
  for (let value = 1; value <= 7; value++) {
    for (let copy = 0; copy < 4; copy++) {
      tiles.push({ id: `honor_${value}_${copy}`, suit: 'honor', value });
    }
  }

  return tiles;
}

/**
 * 牌の配列をシャッフル（ランダムに並べ替え）する関数。
 * 「Fisher-Yates シャッフル」と呼ばれる、偏りの少ない有名なアルゴリズム。
 */
export function shuffleTiles(tiles: Tile[]): Tile[] {
  // 引数の配列を直接書き換えないようにスプレッド構文(...)でコピー
  const arr = [...tiles];
  // 後ろから前へ走査して、ランダムな位置の要素と入れ替える
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    // [a, b] = [b, a] という記法で2つの値を一度に交換（分割代入）
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * 牌の並び順を決める比較関数。Array.sort() に渡して使います。
 * - 返り値が負: a は b より前に来る
 * - 返り値が正: a は b より後に来る
 * - 0: 順序を変えない
 */
export function compareTiles(a: Tile, b: Tile): number {
  // Record<キー型, 値型> は「マップ型のオブジェクト」を表す型。
  // 種類ごとに並び順の数値を割り当てています。
  const order: Record<string, number> = { man: 0, pin: 1, sou: 2, honor: 3 };
  // まずは種類ごとに比較
  if (order[a.suit] !== order[b.suit]) return order[a.suit] - order[b.suit];
  // 同じ種類なら数字で比較
  return a.value - b.value;
}

/**
 * 手牌を見やすい順に並べる関数。
 * 元の配列を破壊しないように、まずコピー[...hand]してから sort しています。
 */
export function sortHand(hand: Tile[]): Tile[] {
  return [...hand].sort(compareTiles);
}

/**
 * 2つの牌が「同じ種類かつ同じ値」かを判定。
 * id は無視するので、別コピー同士でも一致と見なせます（例: "man_5_0" と "man_5_2"）。
 */
export function tilesEqual(a: Tile, b: Tile): boolean {
  return a.suit === b.suit && a.value === b.value;
}

/**
 * 牌を日本語表記に変換（"5万"、"東" など）。デバッグや表示に使います。
 */
export function getTileName(tile: Tile): string {
  if (tile.suit === 'honor') {
    // value(1-7) を配列のインデックス(0-6)に変換するため -1
    return ['東', '南', '西', '北', '白', '発', '中'][tile.value - 1];
  }
  const suitChar: Record<string, string> = { man: '万', pin: '筒', sou: '索' };
  return `${tile.value}${suitChar[tile.suit]}`;
}
