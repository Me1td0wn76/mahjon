// このファイルはクライアント側で使う麻雀の型と補助関数を定義しています。
// サーバー側 (server/src/types.ts) と内容は近いですが、
// クライアント独自の処理（描画用ヘルパ、和了判定の簡易版）もここに集めています。

// 牌の種類: 萬子・筒子・索子・字牌
export type Suit = 'man' | 'pin' | 'sou' | 'honor';

// 1枚の牌（中身は server 側と同じ構造）
export interface Tile {
  id: string;
  suit: Suit;
  value: number;
}

// 鳴き面子（チー・ポン・カン）
export interface Meld {
  type: 'chi' | 'pon' | 'minkan' | 'ankan';
  tiles: Tile[];
  fromSeat?: number;                                         // どの席から鳴いたか
}

// ゲームの局面
export type GamePhase =
  | 'dealing'
  | 'draw'
  | 'discard'
  | 'claiming'
  | 'kyushuCheck'
  | 'roundEnd'
  | 'gameOver';

// 風（東南西北）
export type Wind = 'east' | 'south' | 'west' | 'north';

// 他プレイヤーの公開情報（手牌の中身は含まない）
export interface PlayerView {
  seat: number;
  name: string;
  handCount: number;
  discards: Tile[];
  melds: Meld[];
  score: number;
  isDealer: boolean;
  seatWind: Wind;
  isRiichi: boolean;                                         // リーチ中
  kitaCount: number;                                         // 三麻の北抜き枚数
}

// 1つの役の表示用情報
export interface YakuInfo {
  name: string;
  han: number;
}

// クライアントが受け取る「自分視点のゲーム状態」
export interface GameView {
  phase: GamePhase;
  round: Wind;
  roundNumber: number;
  honbaCount: number;
  riichiSticks: number;                                      // 場に出ている供託リーチ棒
  dealer: number;
  currentTurn: number;
  wallCount: number;
  doraIndicators: Tile[];
  lastDiscard?: { tile: Tile; seat: number };
  players: PlayerView[];
  myHand: Tile[];
  mySeat: number;
  availableClaims?: Array<'chi' | 'pon' | 'kan' | 'ron'>;    // 鳴きの選択肢（あれば）
  chiCombinations?: [string, string][];                      // チーの可能パターン
  canRiichi?: boolean;                                       // リーチ可能か
  canKita?: boolean;                                         // 北抜き可能か（三麻）
  canKyushuhai?: boolean;                                    // 九種九牌宣言可能か
  ankanOptions?: string[];                                   // 暗槓できる牌のID（代表牌1枚／カン）
  kakanOptions?: string[];                                   // 加槓できる手牌のID
}

// 局の結果
export interface RoundResult {
  isDraw: boolean;
  isKyushuhai?: boolean;                                     // 九種九牌流局か
  winner?: number;
  losers?: number[];
  winTile?: Tile;
  winType?: 'tsumo' | 'ron';
  handTiles?: Tile[];
  melds?: Meld[];
  yakuList?: YakuInfo[];                                     // 成立役の一覧
  totalHan?: number;                                         // 合計飜
  fu?: number;                                               // 符
  doraIndicators?: Tile[];                                   // ドラ表示牌
  uraDoraIndicators?: Tile[];                                // 裏ドラ表示牌（リーチ和了時のみ）
  scoreDelta: Record<number, number>;
  newScores: Record<number, number>;
}

// ロビーで表示するルーム情報
export interface RoomInfo {
  id: string;
  name: string;
  maxPlayers: 3 | 4;
  currentPlayers: number;
  status: 'waiting' | 'playing';
  isPrivate: boolean;                                        // パスワード付き（プライベート）か
}

// 風 → 表示用の日本語マッピング
// `const` を付けて変更不可な定数として宣言。
export const WIND_LABEL: Record<Wind, string> = {
  east: '東',
  south: '南',
  west: '西',
  north: '北',
};

// 字牌の表示文字。インデックス0が「東」、6が「中」。
export const HONOR_NAMES = ['東', '南', '西', '北', '白', '発', '中'];
// 種類 → 表示文字
export const SUIT_CHARS: Record<string, string> = { man: '萬', pin: '筒', sou: '索' };

/**
 * 1枚の牌を日本語ラベルに変換するヘルパ。UI 表示用。
 */
export function getTileName(tile: Tile): string {
  if (tile.suit === 'honor') return HONOR_NAMES[tile.value - 1];
  return `${tile.value}${SUIT_CHARS[tile.suit]}`;
}

/**
 * クライアント側で「今ツモ和了できるか？」をチェックする関数。
 * UI 上で「ツモ和了！」ボタンを出すかどうかを判断するために使う。
 * 手牌の各牌について、それを和了牌と仮定したときに和了形になるか試す。
 */
export function canTsumoCheck(hand: Tile[], melds: Meld[]): boolean {
  for (const tile of hand) {
    const rest = hand.filter(t => t.id !== tile.id);
    if (isWinningHandClient(rest, melds, tile)) return true;
  }
  return false;
}

/**
 * 和了形判定（クライアント簡易版）。サーバー側 winCheck.ts と同じロジック。
 * クライアントでも判定するのは「ボタンの出し分け」のため。最終判定はサーバーが行う。
 */
function isWinningHandClient(closedHand: Tile[], openMelds: Meld[], winTile: Tile): boolean {
  const full = [...closedHand, winTile];
  const needed = 4 - openMelds.length;
  // 「面子分(N*3) + 雀頭(2)」になっているかが基本条件
  if (full.length !== needed * 3 + 2) return false;

  // === 七対子チェック（鳴きなし & 14枚）===
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

  // === 通常形（4面子1雀頭）チェック ===
  const sorted = [...full].sort(compareTiles);
  const tried = new Set<string>();
  for (let i = 0; i < sorted.length - 1; i++) {
    const key = `${sorted[i].suit}_${sorted[i].value}`;
    if (tried.has(key)) continue;
    if (sorted[i].suit === sorted[i + 1].suit && sorted[i].value === sorted[i + 1].value) {
      tried.add(key);
      // 雀頭2枚を除いた残りで面子が組めるか試す
      const rest = [...sorted.slice(0, i), ...sorted.slice(i + 2)];
      if (canFormMeldsClient(rest)) return true;
    }
  }
  return false;
}

/**
 * 牌のリストが「面子3枚組×N」に分解できるかを再帰的に判定。
 * （サーバー版と同じアルゴリズム）
 */
function canFormMeldsClient(tiles: Tile[]): boolean {
  if (tiles.length === 0) return true;
  if (tiles.length % 3 !== 0) return false;
  const sorted = [...tiles].sort(compareTiles);
  const first = sorted[0];
  const rest = sorted.slice(1);

  // 刻子（同じ牌3枚）として外せるか
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

  // 順子（数3つ連続）として外せるか
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

/**
 * 牌をソートするための比較関数。Array.sort に渡す。
 */
function compareTiles(a: Tile, b: Tile): number {
  const o: Record<string, number> = { man: 0, pin: 1, sou: 2, honor: 3 };
  if (o[a.suit] !== o[b.suit]) return o[a.suit] - o[b.suit];
  return a.value - b.value;
}
