// このファイルは「役判定と点数計算」を担当します。
// 簡略ルールとして、主要な役だけを判定し、飜数 → 点数テーブルで支払額を決めます。
// 符計算は省略（30符固定相当）。本格的な麻雀点数計算ではありません。
import { Tile, Meld, Wind, Suit } from '../types.js';
import { compareTiles, tilesEqual } from './tiles.js';

// 判定された1つの役
export interface Yaku {
  name: string;        // 表示名（例: "立直"）
  han: number;         // 飜数
}

// 役判定の結果と支払い情報をまとめた型
export interface ScoringResult {
  yakuList: Yaku[];
  totalHan: number;
  basePoint: number;       // ベース支払い額（親なら×6、子ロン×4、子ツモ親×2子×1）
}

// リーチ周りの追加役やドラ表示牌など、状況依存の入力をまとめたオプション
export interface ScoreOptions {
  isIppatsu?: boolean;            // 一発（リーチ後1巡以内・鳴き無しで和了）
  isDoubleRiichi?: boolean;       // ダブル立直（第1打でのリーチ）
  isRinshan?: boolean;            // 嶺上開花（カンの補充ツモで和了）
  doraIndicators?: Tile[];        // ドラ表示牌
  uraDoraIndicators?: Tile[];     // 裏ドラ表示牌（リーチ和了時のみ参照）
}

/**
 * ドラ表示牌から「実際のドラ牌」を求める。
 * 数牌は次の数字（9→1）、風牌は東南西北を循環（北→東）、
 * 三元牌は白發中を循環（中→白）。
 */
function doraTileFromIndicator(ind: Tile): { suit: Suit; value: number } {
  if (ind.suit === 'honor') {
    // 1-4=風牌(東南西北), 5-7=三元牌(白發中)
    if (ind.value <= 4) return { suit: 'honor', value: ind.value === 4 ? 1 : ind.value + 1 };
    return { suit: 'honor', value: ind.value === 7 ? 5 : ind.value + 1 };
  }
  return { suit: ind.suit, value: ind.value === 9 ? 1 : ind.value + 1 };
}

/** 手牌（鳴き含む）の中に、表示牌が示すドラが何枚あるかを数える。 */
function countDora(tiles: Tile[], indicators: Tile[]): number {
  let count = 0;
  for (const ind of indicators) {
    const d = doraTileFromIndicator(ind);
    for (const t of tiles) {
      if (t.suit === d.suit && t.value === d.value) count++;
    }
  }
  return count;
}

/**
 * 手牌を「面子の組み合わせ」に分解する。複数の組み方があり得るので、
 * 最も高い役になる組み合わせを探すために使う。
 * 返り値の各要素は「面子の配列（順子・刻子・対子の集合）」。
 */
interface MeldDecomp {
  type: 'sequence' | 'triplet' | 'pair';
  tiles: Tile[];
}

/**
 * 通常形（4面子1雀頭）に分解できるすべての組み方を列挙する。
 * 役判定では「平和」「三色同順」などの形を見るので、組み方を全て試したい。
 */
function decompose(tiles: Tile[]): MeldDecomp[][] {
  const results: MeldDecomp[][] = [];
  const sorted = [...tiles].sort(compareTiles);

  // 雀頭候補を順に試して、残りを面子に分解
  const tried = new Set<string>();
  for (let i = 0; i < sorted.length - 1; i++) {
    const key = `${sorted[i].suit}_${sorted[i].value}`;
    if (tried.has(key)) continue;
    if (tilesEqual(sorted[i], sorted[i + 1])) {
      tried.add(key);
      const pair: MeldDecomp = { type: 'pair', tiles: [sorted[i], sorted[i + 1]] };
      const rest = [...sorted.slice(0, i), ...sorted.slice(i + 2)];
      const meldComps = decomposeMelds(rest);
      for (const mc of meldComps) {
        results.push([pair, ...mc]);
      }
    }
  }
  return results;
}

/**
 * 牌の集合を「順子・刻子の組み合わせ」に分解する全パターンを返す。
 */
function decomposeMelds(tiles: Tile[]): MeldDecomp[][] {
  if (tiles.length === 0) return [[]];
  if (tiles.length % 3 !== 0) return [];

  const sorted = [...tiles].sort(compareTiles);
  const first = sorted[0];
  const rest = sorted.slice(1);
  const out: MeldDecomp[][] = [];

  // 刻子パターン
  const t1 = rest.findIndex(t => tilesEqual(t, first));
  if (t1 !== -1) {
    const rest2 = [...rest];
    rest2.splice(t1, 1);
    const t2 = rest2.findIndex(t => tilesEqual(t, first));
    if (t2 !== -1) {
      const triplet: MeldDecomp = {
        type: 'triplet',
        tiles: [first, rest[t1], rest2[t2]],
      };
      const rest3 = [...rest2];
      rest3.splice(t2, 1);
      for (const subs of decomposeMelds(rest3)) {
        out.push([triplet, ...subs]);
      }
    }
  }

  // 順子パターン
  if (first.suit !== 'honor' && first.value <= 7) {
    const n1 = rest.findIndex(t => t.suit === first.suit && t.value === first.value + 1);
    if (n1 !== -1) {
      const rest2 = [...rest];
      rest2.splice(n1, 1);
      const n2 = rest2.findIndex(t => t.suit === first.suit && t.value === first.value + 2);
      if (n2 !== -1) {
        const sequence: MeldDecomp = {
          type: 'sequence',
          tiles: [first, rest[n1], rest2[n2]],
        };
        const rest3 = [...rest2];
        rest3.splice(n2, 1);
        for (const subs of decomposeMelds(rest3)) {
          out.push([sequence, ...subs]);
        }
      }
    }
  }

  return out;
}

/**
 * 七対子の判定。14枚全てが2枚ずつ7組ならOK。
 */
function isChiitoitsu(tiles: Tile[]): boolean {
  if (tiles.length !== 14) return false;
  const sorted = [...tiles].sort(compareTiles);
  for (let i = 0; i < sorted.length; i += 2) {
    if (!tilesEqual(sorted[i], sorted[i + 1])) return false;
  }
  return true;
}

/** 么九牌（1・9・字牌）かどうか */
function isYaochuhai(tile: Tile): boolean {
  return tile.suit === 'honor' || tile.value === 1 || tile.value === 9;
}

/** 役牌（自風・場風・三元牌）かどうか */
function isYakuhai(tile: Tile, seatWind: Wind, roundWind: Wind): boolean {
  if (tile.suit !== 'honor') return false;
  // 白(5)・発(6)・中(7) は常に役牌
  if (tile.value >= 5) return true;
  // 風牌: 自風 or 場風と一致するか
  const winds: Wind[] = ['east', 'south', 'west', 'north'];
  const w = winds[tile.value - 1];
  return w === seatWind || w === roundWind;
}

/**
 * 与えられた1つの分解パターンに対して役を判定し、飜の合計を返す。
 */
function evaluateDecomp(
  decomp: MeldDecomp[],
  openMelds: Meld[],
  isTsumo: boolean,
  isRiichi: boolean,
  seatWind: Wind,
  roundWind: Wind,
  allTiles: Tile[],
  isIppatsu: boolean,
  isDoubleRiichi: boolean,
  isRinshan: boolean
): Yaku[] {
  const yaku: Yaku[] = [];
  // 暗槓は門前を崩さない。チー・ポン・明槓があるときだけ「非門前」とする。
  const isClosed = openMelds.every(m => m.type === 'ankan');

  // 鳴いた面子もまとめて考慮
  const allMelds: MeldDecomp[] = [...decomp];
  for (const m of openMelds) {
    if (m.type === 'chi') {
      allMelds.push({ type: 'sequence', tiles: m.tiles });
    } else {
      allMelds.push({ type: 'triplet', tiles: m.tiles });
    }
  }

  // 立直 / ダブル立直（両者は複合せず、ダブル立直を優先）
  if (isDoubleRiichi) yaku.push({ name: 'ダブル立直', han: 2 });
  else if (isRiichi) yaku.push({ name: '立直', han: 1 });
  // 一発（リーチが前提）
  if (isIppatsu) yaku.push({ name: '一発', han: 1 });
  // 嶺上開花（カンの補充ツモで和了）
  if (isRinshan) yaku.push({ name: '嶺上開花', han: 1 });
  // 門前清自摸和
  if (isClosed && isTsumo) yaku.push({ name: '門前清自摸和', han: 1 });

  // 役牌（白・発・中・自風・場風）
  for (const m of allMelds) {
    if (m.type === 'triplet') {
      const t = m.tiles[0];
      if (isYakuhai(t, seatWind, roundWind)) {
        let name = '';
        if (t.suit === 'honor') {
          if (t.value === 5) name = '白';
          else if (t.value === 6) name = '發';
          else if (t.value === 7) name = '中';
          else {
            const winds = ['東', '南', '西', '北'];
            name = winds[t.value - 1];
          }
        }
        yaku.push({ name: `役牌(${name})`, han: 1 });
      }
    }
  }

  // タンヤオ（全て中張牌＝2-8の数牌）
  if (allTiles.every(t => t.suit !== 'honor' && t.value >= 2 && t.value <= 8)) {
    yaku.push({ name: '断么九', han: 1 });
  }

  // 平和（門前・全順子・雀頭が役牌でない・ツモは含めずシンプル）
  if (isClosed) {
    const seqs = decomp.filter(m => m.type === 'sequence');
    const trips = decomp.filter(m => m.type === 'triplet');
    const pair = decomp.find(m => m.type === 'pair');
    if (seqs.length === 4 && trips.length === 0 && pair) {
      const head = pair.tiles[0];
      if (!isYakuhai(head, seatWind, roundWind)) {
        yaku.push({ name: '平和', han: 1 });
      }
    }
  }

  // 対々和（全て刻子）
  const allTriplets = allMelds.filter(m => m.type === 'triplet').length;
  if (allTriplets === 4) {
    yaku.push({ name: '対々和', han: 2 });
  }

  // 三色同順（同じ数で3種類の数牌の順子）
  const sequences = allMelds.filter(m => m.type === 'sequence');
  for (const seq of sequences) {
    const v = seq.tiles[0].value;
    const suits = sequences
      .filter(s => s.tiles[0].value === v)
      .map(s => s.tiles[0].suit);
    if (
      suits.includes('man') &&
      suits.includes('pin') &&
      suits.includes('sou')
    ) {
      yaku.push({ name: '三色同順', han: isClosed ? 2 : 1 });
      break;
    }
  }

  // 一気通貫（同じ種類で 1-9 まで連続する3順子）
  for (const suit of ['man', 'pin', 'sou'] as const) {
    const vals = sequences
      .filter(s => s.tiles[0].suit === suit)
      .map(s => s.tiles[0].value);
    if (vals.includes(1) && vals.includes(4) && vals.includes(7)) {
      yaku.push({ name: '一気通貫', han: isClosed ? 2 : 1 });
      break;
    }
  }

  // 混老頭（么九牌のみ）
  if (allTiles.every(isYaochuhai)) {
    yaku.push({ name: '混老頭', han: 2 });
  }

  return yaku;
}

/**
 * メインの役判定関数。最も高い飜数になる分解パターンを採用する。
 * @param hand 自分の手牌（和了牌を除く）
 * @param winTile 和了牌
 * @param openMelds 鳴いた面子
 * @param isTsumo ツモ和了か
 * @param isRiichi 立直しているか
 * @param seatWind 自風
 * @param roundWind 場風
 * @param kitaCount 三麻の北抜き枚数
 */
export function calculateScore(
  hand: Tile[],
  winTile: Tile,
  openMelds: Meld[],
  isTsumo: boolean,
  isRiichi: boolean,
  seatWind: Wind,
  roundWind: Wind,
  kitaCount: number,
  opts: ScoreOptions = {}
): ScoringResult {
  const { isIppatsu = false, isDoubleRiichi = false, isRinshan = false } = opts;
  const fullClosed = [...hand, winTile];
  let bestYaku: Yaku[] = [];
  let bestHan = 0;

  // 七対子チェック
  if (openMelds.length === 0 && isChiitoitsu(fullClosed)) {
    const yaku: Yaku[] = [{ name: '七対子', han: 2 }];
    if (isDoubleRiichi) yaku.push({ name: 'ダブル立直', han: 2 });
    else if (isRiichi) yaku.push({ name: '立直', han: 1 });
    if (isIppatsu) yaku.push({ name: '一発', han: 1 });
    if (isTsumo) yaku.push({ name: '門前清自摸和', han: 1 });
    // タンヤオも七対子と複合可
    if (fullClosed.every(t => t.suit !== 'honor' && t.value >= 2 && t.value <= 8)) {
      yaku.push({ name: '断么九', han: 1 });
    }
    bestYaku = yaku;
    bestHan = yaku.reduce((s, y) => s + y.han, 0);
  }

  // 通常形
  const decomps = decompose(fullClosed);
  for (const dc of decomps) {
    const yaku = evaluateDecomp(
      dc,
      openMelds,
      isTsumo,
      isRiichi,
      seatWind,
      roundWind,
      [...fullClosed, ...openMelds.flatMap(m => m.tiles)],
      isIppatsu,
      isDoubleRiichi,
      isRinshan
    );
    const han = yaku.reduce((s, y) => s + y.han, 0);
    if (han > bestHan) {
      bestHan = han;
      bestYaku = yaku;
    }
  }

  // ここまでで成立した「本来の役」が1つでもあるか。
  // ドラ・裏ドラ・北抜きドラはそれ自体では和了役にならないため、
  // 役が無い手にドラだけ乗せて和了扱いにしないようゲートする。
  const hasYaku = bestHan > 0;

  // 北抜きドラ（三麻専用）
  if (hasYaku && kitaCount > 0) {
    bestYaku.push({ name: `抜きドラ(北×${kitaCount})`, han: kitaCount });
    bestHan += kitaCount;
  }

  // ドラ・裏ドラ（役が成立している時のみ加算）
  if (hasYaku) {
    const allFinalTiles = [...fullClosed, ...openMelds.flatMap(m => m.tiles)];
    const doraCount = countDora(allFinalTiles, opts.doraIndicators ?? []);
    if (doraCount > 0) {
      bestYaku.push({ name: 'ドラ', han: doraCount });
      bestHan += doraCount;
    }
    // 裏ドラはリーチ和了時のみ
    if (isRiichi) {
      const uraCount = countDora(allFinalTiles, opts.uraDoraIndicators ?? []);
      if (uraCount > 0) {
        bestYaku.push({ name: '裏ドラ', han: uraCount });
        bestHan += uraCount;
      }
    }
  }

  // 飜数から基本点を決定（簡易テーブル）
  // 役なしの場合は和了不可だが、ここでは0飜として返す（呼び出し側で判定）
  const basePoint = hanToBasePoint(bestHan);
  return { yakuList: bestYaku, totalHan: bestHan, basePoint };
}

/**
 * 飜数を基本点に変換する簡易テーブル。
 * 通常は30符基準。ここでは符を固定して飜だけ見ます。
 */
function hanToBasePoint(han: number): number {
  if (han <= 0) return 0;
  if (han === 1) return 400;
  if (han === 2) return 700;
  if (han === 3) return 1300;
  if (han === 4) return 2000;
  if (han === 5) return 2000;          // 満貫
  if (han <= 7) return 3000;           // 跳満
  if (han <= 10) return 4000;          // 倍満
  if (han <= 12) return 6000;          // 三倍満
  return 8000;                         // 役満
}

/**
 * 基本点から、ロン時の支払額（敗者→勝者）を計算する。
 * 1の位を100点単位に切り上げる。
 */
export function calcRonPayment(basePoint: number, winnerIsDealer: boolean): number {
  const raw = basePoint * (winnerIsDealer ? 6 : 4);
  return Math.ceil(raw / 100) * 100;
}

/**
 * 基本点から、ツモ時の各支払い額を返す。
 * @returns { fromDealer, fromNonDealer } - 各支払い額。winner が親なら fromDealer は使わない。
 */
export function calcTsumoPayment(
  basePoint: number,
  winnerIsDealer: boolean
): { fromDealer: number; fromNonDealer: number } {
  if (winnerIsDealer) {
    const each = Math.ceil((basePoint * 2) / 100) * 100;
    return { fromDealer: 0, fromNonDealer: each };
  } else {
    const fromDealer = Math.ceil((basePoint * 2) / 100) * 100;
    const fromNonDealer = Math.ceil(basePoint / 100) * 100;
    return { fromDealer, fromNonDealer };
  }
}
