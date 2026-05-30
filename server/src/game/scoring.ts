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
  fu: number;              // 符（七対子は25符固定、平和は20/30符）
  basePoint: number;       // ベース支払い額（親なら×6、子ロン×4、子ツモ親×2子×1）
}

// リーチ周りの追加役やドラ表示牌など、状況依存の入力をまとめたオプション
export interface ScoreOptions {
  isIppatsu?: boolean;            // 一発（リーチ後1巡以内・鳴き無しで和了）
  isDoubleRiichi?: boolean;       // ダブル立直（第1打でのリーチ）
  isRinshan?: boolean;            // 嶺上開花（カンの補充ツモで和了）
  isChankan?: boolean;            // 槍槓（他家の加槓を横取りロン）
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

// ====== 符計算のためのヘルパー ======

/**
 * 和了牌が順子のどこに入ったかを見て「両面待ち」かどうかを判定する。
 * 両面でなければ嵌張（中）か辺張（端）。平和成立や待ち符の判定に使う。
 */
function isRyanmenWait(seqTiles: Tile[], winTile: Tile): boolean {
  const [a, b, c] = seqTiles.map(t => t.value).sort((x, y) => x - y);
  if (winTile.value === b) return false;            // 嵌張（中央待ち）
  if (winTile.value === c && a === 1) return false; // 123 の辺張（3待ち）
  if (winTile.value === a && c === 9) return false; // 789 の辺張（7待ち）
  return true;                                       // 両面
}

/** 雀頭の符（役牌の雀頭は2符、ダブル風は4符）。 */
function pairFu(tile: Tile, seatWind: Wind, roundWind: Wind): number {
  if (tile.suit !== 'honor') return 0;
  if (tile.value >= 5) return 2;                     // 三元牌
  const winds: Wind[] = ['east', 'south', 'west', 'north'];
  const w = winds[tile.value - 1];
  let fu = 0;
  if (w === seatWind) fu += 2;
  if (w === roundWind) fu += 2;                      // 自風かつ場風（連風牌）なら4符
  return fu;
}

/** 刻子・槓子の符。open=明刻/明槓, kan=槓子。 */
function tripletFu(tile: Tile, open: boolean, kan: boolean): number {
  const terminal = isYaochuhai(tile);
  if (kan) return open ? (terminal ? 16 : 8) : (terminal ? 32 : 16);
  return open ? (terminal ? 4 : 2) : (terminal ? 8 : 4);
}

/**
 * 1つの和了形（雀頭＋面子の分解）に対する符を計算する。
 * 平和は20符（ツモ）/30符（ロン）で固定。七対子は呼び出し側で25符固定。
 */
function computeFu(
  decomp: MeldDecomp[],
  openMelds: Meld[],
  winTile: Tile,
  isTsumo: boolean,
  isClosed: boolean,
  isPinfu: boolean,
  seatWind: Wind,
  roundWind: Wind
): number {
  if (isPinfu) return isTsumo ? 20 : 30;

  let fu = 20;                                       // 副底
  if (isTsumo) fu += 2;                              // ツモ符
  else if (isClosed) fu += 10;                       // 門前加符（門前ロン）

  // 雀頭
  const pair = decomp.find(m => m.type === 'pair');
  if (pair) fu += pairFu(pair.tiles[0], seatWind, roundWind);

  // 手の内の刻子は一旦すべて暗刻として加算
  for (const m of decomp) {
    if (m.type === 'triplet') fu += tripletFu(m.tiles[0], false, false);
  }
  // 鳴いた面子（チーは0符）
  for (const m of openMelds) {
    if (m.type === 'pon') fu += tripletFu(m.tiles[0], true, false);
    else if (m.type === 'minkan') fu += tripletFu(m.tiles[0], true, true);
    else if (m.type === 'ankan') fu += tripletFu(m.tiles[0], false, true);
  }

  // 待ち符＋ロン時の刻子の明刻化。和了牌が属し得るグループごとに評価し、最大を採用（高点法）。
  let bestExtra = 0;
  for (const g of decomp) {
    if (!g.tiles.some(t => tilesEqual(t, winTile))) continue;
    let extra = 0;
    if (g.type === 'pair') {
      extra = 2;                                     // 単騎待ち
    } else if (g.type === 'sequence') {
      extra = isRyanmenWait(g.tiles, winTile) ? 0 : 2;  // 嵌張・辺張は2符
    } else if (g.type === 'triplet' && !isTsumo) {
      // シャンポンのロンは明刻扱い（暗刻として加えた分との差を戻す＝マイナス）
      extra = tripletFu(g.tiles[0], true, false) - tripletFu(g.tiles[0], false, false);
    }
    if (extra > bestExtra) bestExtra = extra;
  }
  fu += bestExtra;

  return Math.ceil(fu / 10) * 10;                    // 10符単位で切り上げ
}

/**
 * 符と飜から基本点を求める。基本点 = 符 × 2^(2+飜)。
 * 満貫(2000)で頭打ちし、5飜以上は固定テーブル。
 */
function fuHanToBasePoint(fu: number, han: number): number {
  if (han <= 0) return 0;
  if (han >= 13) return 8000;          // 役満
  if (han >= 11) return 6000;          // 三倍満
  if (han >= 8) return 4000;           // 倍満
  if (han >= 6) return 3000;           // 跳満
  if (han >= 5) return 2000;           // 満貫
  const base = fu * Math.pow(2, 2 + han);
  return Math.min(base, 2000);         // 4飜以下でも2000を超えたら満貫
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
  isRinshan: boolean,
  isChankan: boolean,
  winTile: Tile
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
  // 槍槓（他家の加槓を横取り）
  if (isChankan) yaku.push({ name: '槍槓', han: 1 });
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

  // 平和（門前・全順子・雀頭が役牌でない・両面待ち）
  if (isClosed) {
    const seqs = decomp.filter(m => m.type === 'sequence');
    const trips = decomp.filter(m => m.type === 'triplet');
    const pair = decomp.find(m => m.type === 'pair');
    if (seqs.length === 4 && trips.length === 0 && pair) {
      const head = pair.tiles[0];
      // 和了牌が順子の両面待ちで入っていること（嵌張・辺張・単騎は平和にならない）
      const ryanmen = seqs.some(
        s => s.tiles.some(t => tilesEqual(t, winTile)) && isRyanmenWait(s.tiles, winTile)
      );
      if (!isYakuhai(head, seatWind, roundWind) && ryanmen) {
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
  const {
    isIppatsu = false,
    isDoubleRiichi = false,
    isRinshan = false,
    isChankan = false,
  } = opts;
  const fullClosed = [...hand, winTile];
  const isClosed = openMelds.every(m => m.type === 'ankan');

  // ドラ・裏ドラ・北抜きの飜（分解の仕方に依存しない＝一度だけ計算）。
  // ただしこれ自体は役ではないので、本来の役がある時だけ後で加算する。
  const allFinalTiles = [...fullClosed, ...openMelds.flatMap(m => m.tiles)];
  const doraHan = countDora(allFinalTiles, opts.doraIndicators ?? []);
  const uraHan = isRiichi ? countDora(allFinalTiles, opts.uraDoraIndicators ?? []) : 0;

  // 候補の中から「点数（基本点）が最大」になる組み合わせを採用する（高点法）。
  interface Candidate { yakuList: Yaku[]; han: number; fu: number; basePoint: number }
  let best: Candidate | null = null;

  const consider = (yakuList: Yaku[], fu: number) => {
    const yakuHan = yakuList.reduce((s, y) => s + y.han, 0);
    if (yakuHan <= 0) return;                         // 役が無ければ和了不可
    const finalYaku = [...yakuList];
    let han = yakuHan;
    if (kitaCount > 0) { finalYaku.push({ name: `抜きドラ(北×${kitaCount})`, han: kitaCount }); han += kitaCount; }
    if (doraHan > 0) { finalYaku.push({ name: 'ドラ', han: doraHan }); han += doraHan; }
    if (uraHan > 0) { finalYaku.push({ name: '裏ドラ', han: uraHan }); han += uraHan; }
    const basePoint = fuHanToBasePoint(fu, han);
    const current: Candidate | null = best;
    if (!current || basePoint > current.basePoint || (basePoint === current.basePoint && han > current.han)) {
      best = { yakuList: finalYaku, han, fu, basePoint };
    }
  };

  // 七対子（25符固定）
  if (openMelds.length === 0 && isChiitoitsu(fullClosed)) {
    const yaku: Yaku[] = [{ name: '七対子', han: 2 }];
    if (isDoubleRiichi) yaku.push({ name: 'ダブル立直', han: 2 });
    else if (isRiichi) yaku.push({ name: '立直', han: 1 });
    if (isIppatsu) yaku.push({ name: '一発', han: 1 });
    if (isChankan) yaku.push({ name: '槍槓', han: 1 });
    if (isTsumo) yaku.push({ name: '門前清自摸和', han: 1 });
    if (fullClosed.every(t => t.suit !== 'honor' && t.value >= 2 && t.value <= 8)) {
      yaku.push({ name: '断么九', han: 1 });
    }
    consider(yaku, 25);
  }

  // 通常形（4面子1雀頭）。各分解について役と符を求め、最高点を採用する。
  for (const dc of decompose(fullClosed)) {
    const yaku = evaluateDecomp(
      dc, openMelds, isTsumo, isRiichi, seatWind, roundWind,
      allFinalTiles, isIppatsu, isDoubleRiichi, isRinshan, isChankan, winTile
    );
    const isPinfu = yaku.some(y => y.name === '平和');
    const fu = computeFu(dc, openMelds, winTile, isTsumo, isClosed, isPinfu, seatWind, roundWind);
    consider(yaku, fu);
  }

  const result = best as Candidate | null;
  if (!result) return { yakuList: [], totalHan: 0, fu: 0, basePoint: 0 };
  return { yakuList: result.yakuList, totalHan: result.han, fu: result.fu, basePoint: result.basePoint };
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
