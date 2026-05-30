// このファイルは「和了（あがり）判定」のロジックを担当しています。
// 麻雀の和了形は基本的に「4面子1雀頭」または「七対子」「国士無双」（このコードでは七対子まで実装）。
// 再帰的に手牌を分解して面子（メンツ：3枚組）として成立するかを試す方式です。
import { Tile, Meld } from '../types.js';
import { tilesEqual, compareTiles } from './tiles.js';

/**
 * 与えられた牌だけで「面子（順子or刻子）×N」が組めるかを再帰的に判定する。
 * 内部用なので export していません。
 *
 * 考え方:
 *   - 牌が空なら成功（基底ケース）
 *   - 3の倍数でなければ面子に分けられないので失敗
 *   - 一番小さい牌を「刻子の一部」または「順子の一部」とみなして再帰探索
 */
function canFormMelds(tiles: Tile[]): boolean {
  if (tiles.length === 0) return true;            // すべて面子に分けられた
  if (tiles.length % 3 !== 0) return false;       // 3で割り切れないと面子にならない

  // ソートしておくと「一番小さい牌」を起点に決定的に探索できる
  const sorted = [...tiles].sort(compareTiles);
  const first = sorted[0];
  const rest = sorted.slice(1);                   // 先頭を除いた残り

  // === パターン1: 刻子（同じ牌×3）を作れるか ===
  const t1 = rest.findIndex(t => tilesEqual(t, first));
  if (t1 !== -1) {
    const rest2 = [...rest];
    rest2.splice(t1, 1);                          // 同じ牌を1枚抜く
    const t2 = rest2.findIndex(t => tilesEqual(t, first));
    if (t2 !== -1) {
      const rest3 = [...rest2];
      rest3.splice(t2, 1);                        // もう1枚抜く（合計3枚で刻子完成）
      if (canFormMelds(rest3)) return true;       // 残りも面子にできれば成功
    }
  }

  // === パターン2: 順子（連続する数3つ）を作れるか ===
  // 字牌は順子にできない & 8以上から始まる順子は存在しない
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

  return false;                                   // どのパターンでも面子化できなかった
}

/**
 * 七対子（ちーといつ）の判定。
 * 14枚すべてが「2枚ずつ7組」になっているかを確認。
 */
function isChiitoitsu(tiles: Tile[]): boolean {
  if (tiles.length !== 14) return false;
  const sorted = [...tiles].sort(compareTiles);
  // 2枚ずつペアになっているかを2刻みでチェック
  for (let i = 0; i < sorted.length; i += 2) {
    if (!tilesEqual(sorted[i], sorted[i + 1])) return false;
  }
  return true;
}

/**
 * 通常形（4面子1雀頭）の和了判定。
 * 雀頭（同じ牌2枚）の候補を1つずつ試して、残りで面子4組が作れるかを調べる。
 */
function isStandardWin(fullClosedHand: Tile[], openMeldCount: number): boolean {
  // 鳴いている面子の数を踏まえて必要な面子数を計算
  const needed = 4 - openMeldCount;
  // 「面子分(needed × 3)」+「雀頭(2)」と一致しなければ和了形になり得ない
  if (fullClosedHand.length !== needed * 3 + 2) return false;

  const sorted = [...fullClosedHand].sort(compareTiles);
  // 同じ種類の雀頭を何度も試さないようにメモする集合
  const tried = new Set<string>();

  // 隣同士が同じ牌＝雀頭候補
  for (let i = 0; i < sorted.length - 1; i++) {
    const key = `${sorted[i].suit}_${sorted[i].value}`;
    if (tried.has(key)) continue;
    if (tilesEqual(sorted[i], sorted[i + 1])) {
      tried.add(key);
      // この2枚を雀頭として除外した「残り」で面子が作れるか試す
      const rest = [...sorted.slice(0, i), ...sorted.slice(i + 2)];
      if (canFormMelds(rest)) return true;
    }
  }

  return false;
}

/** 和了判定の結果を返す型。 */
export interface WinResult {
  isWin: boolean;
  isChiitoitsu?: boolean;
}

/**
 * 「和了できるか？」のメイン関数。
 * @param closedHand 自分の手牌（鳴いてない部分）
 * @param openMelds 鳴いた面子
 * @param winTile 和了候補となる牌（ツモ牌 or 他家の捨て牌）
 */
export function checkWin(closedHand: Tile[], openMelds: Meld[], winTile: Tile): WinResult {
  // winTile を加えた完全な手牌を作って判定
  const full = [...closedHand, winTile];
  // 七対子は門前（鳴き0）のときだけ成立
  if (openMelds.length === 0 && isChiitoitsu(full)) {
    return { isWin: true, isChiitoitsu: true };
  }
  if (isStandardWin(full, openMelds.length)) {
    return { isWin: true };
  }
  return { isWin: false };
}

/**
 * 待ち牌（あと1枚で和了できる牌）の集合を `"suit_value"` の文字列キーで返す。
 * すべての牌の種類を1枚ずつ「もしこの牌が来たら？」と試して、和了できる種類を集める。
 */
export function waitingTileKeys(closedHand: Tile[], openMelds: Meld[]): Set<string> {
  const keys = new Set<string>();
  const testTiles: { suit: Tile['suit']; value: number }[] = [];
  for (const suit of ['man', 'pin', 'sou'] as const) {
    for (let v = 1; v <= 9; v++) testTiles.push({ suit, value: v });
  }
  for (let v = 1; v <= 7; v++) testTiles.push({ suit: 'honor', value: v });

  for (const tt of testTiles) {
    if (checkWin(closedHand, openMelds, { id: 'test', suit: tt.suit, value: tt.value }).isWin) {
      keys.add(`${tt.suit}_${tt.value}`);
    }
  }
  return keys;
}

/**
 * テンパイ判定（あと1枚で和了できる状態か）。
 * 流局時の罰符計算などで使います。
 */
export function isTenpai(closedHand: Tile[], openMelds: Meld[]): boolean {
  return waitingTileKeys(closedHand, openMelds).size > 0;
}

/**
 * 他家の捨て牌に対して「チー」できる組み合わせを列挙する。
 * チーは「直前の上家の捨て牌」と自分の手牌2枚で順子を作る鳴き。
 * @returns 各組み合わせを [手牌1のid, 手牌2のid] のタプルで返す
 */
export function getChiCombinations(hand: Tile[], discard: Tile): [string, string][] {
  if (discard.suit === 'honor') return [];        // 字牌はチー不可

  const combos: [string, string][] = [];
  const v = discard.value;
  const s = discard.suit;

  // 捨て牌を含めて作れる順子は最大3通り: 「捨て牌が右」「真ん中」「左」
  const pairs: [number, number][] = [];
  if (v >= 3) pairs.push([v - 2, v - 1]);          // 例: 捨て=5 のとき [3,4]
  if (v >= 2 && v <= 8) pairs.push([v - 1, v + 1]); // 例: [4,6]
  if (v <= 7) pairs.push([v + 1, v + 2]);          // 例: [6,7]

  for (const [a, b] of pairs) {
    // それぞれの数字を持つ牌が手元にあるか探す
    const tA = hand.find(t => t.suit === s && t.value === a);
    const tB = hand.find(t => t.suit === s && t.value === b);
    // 「同じ id でない」は別の牌を2枚見つけられた、というガード
    if (tA && tB && tA.id !== tB.id) {
      combos.push([tA.id, tB.id]);
    }
  }
  return combos;
}
