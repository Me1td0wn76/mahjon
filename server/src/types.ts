// このファイルは、サーバーとクライアントでやり取りする「データの形（型）」を定義しています。
// TypeScript では事前に型を決めておくことで、「ここには文字列が来るはず」「ここには数字が来るはず」
// といったルールをコンパイラがチェックしてくれます。バグを早く発見できるので便利です。

// --- 牌（はい）の種類 ---
// 'man'=萬子(マンズ), 'pin'=筒子(ピンズ), 'sou'=索子(ソウズ), 'honor'=字牌(ジハイ)
export type Suit = 'man' | 'pin' | 'sou' | 'honor';

// 1枚の牌を表すオブジェクトの構造
export interface Tile {
  id: string;       // 同じ牌でも個別に判別するためのユニークID (例: "man_5_2")
  suit: Suit;       // 牌の種類（上の Suit 型のいずれか）
  value: number;    // 数字。数牌は1-9、字牌は1-7（1-4=東南西北、5=白 6=発 7=中）
}

// 鳴き（チー・ポン・カン）の情報をまとめた型
export interface Meld {
  type: 'chi' | 'pon' | 'minkan' | 'ankan';
  tiles: Tile[];
  fromSeat?: number;
}

// ゲームの「現在の局面（フェーズ）」
export type GamePhase =
  | 'dealing'
  | 'draw'
  | 'discard'
  | 'claiming'
  | 'kyushuCheck'    // 九種九牌の宣言可能フェーズ（配牌直後）
  | 'roundEnd'
  | 'gameOver';

// 風（席の位置）の型
export type Wind = 'east' | 'south' | 'west' | 'north';

// 配列の中身を順序付きで保持
export const WINDS: Wind[] = ['east', 'south', 'west', 'north'];

// クライアント側から鳴きを宣言する時に送るデータの型
export interface ClaimRequest {
  type: 'chi' | 'pon' | 'kan' | 'ron' | 'skip';
  chiTiles?: [string, string];
}

// 1つの役の表示用情報
export interface YakuInfo {
  name: string;
  han: number;
}

// 各プレイヤーの「公開できる情報」だけをまとめた型
export interface PlayerView {
  seat: number;
  name: string;
  handCount: number;
  discards: Tile[];
  melds: Meld[];
  score: number;
  isDealer: boolean;
  seatWind: Wind;
  isRiichi: boolean;       // リーチ中かどうか
  kitaCount: number;       // 三麻の北抜き枚数（4麻では常に0）
}

// ゲーム全体の状態のうち「自分が見ていい部分」をまとめた型
export interface GameView {
  phase: GamePhase;
  round: Wind;
  roundNumber: number;
  honbaCount: number;
  riichiSticks: number;                              // 場に出ている供託リーチ棒の数
  dealer: number;
  currentTurn: number;
  wallCount: number;
  doraIndicators: Tile[];
  lastDiscard?: { tile: Tile; seat: number };
  players: PlayerView[];
  myHand: Tile[];
  mySeat: number;
  availableClaims?: Array<'chi' | 'pon' | 'kan' | 'ron'>;
  chiCombinations?: [string, string][];
  canRiichi?: boolean;                               // 自分がリーチ宣言可能か
  canKita?: boolean;                                 // 三麻で北抜き可能か
  canKyushuhai?: boolean;                            // 九種九牌の宣言可能か
  ankanOptions?: string[];                           // 暗槓できる牌のID（代表牌1枚／カン）
  kakanOptions?: string[];                           // 加槓できる手牌のID
}

// 1局終了時の結果情報
export interface RoundResult {
  isDraw: boolean;
  isKyushuhai?: boolean;                             // 九種九牌による流局か
  winner?: number;
  losers?: number[];
  winTile?: Tile;
  winType?: 'tsumo' | 'ron';
  handTiles?: Tile[];
  melds?: Meld[];
  yakuList?: YakuInfo[];                             // 成立した役
  totalHan?: number;                                 // 合計飜数
  fu?: number;                                       // 符
  doraIndicators?: Tile[];                           // ドラ表示牌
  uraDoraIndicators?: Tile[];                        // 裏ドラ表示牌（リーチ和了時のみ公開）
  scoreDelta: Record<number, number>;
  newScores: Record<number, number>;
}

// ルーム一覧で表示する情報
export interface RoomInfo {
  id: string;
  name: string;
  maxPlayers: 3 | 4;
  currentPlayers: number;
  status: 'waiting' | 'playing';
  isPrivate: boolean;                                // パスワード付き（プライベート）か
}

// --- Socket.IO のイベント型定義 ---

export interface ServerToClientEvents {
  rooms: (rooms: RoomInfo[]) => void;
  'room-joined': (data: { roomId: string; seat: number; playerName: string }) => void;
  'room-update': (data: {
    players: { name: string; seat: number }[];
    maxPlayers: number;
    roomName: string;
  }) => void;
  'game-start': (view: GameView) => void;
  'game-update': (view: GameView) => void;
  'round-end': (result: RoundResult) => void;
  error: (message: string) => void;
}

export interface ClientToServerEvents {
  'get-rooms': (callback: (rooms: RoomInfo[]) => void) => void;
  'create-room': (
    data: { name: string; maxPlayers: 3 | 4; playerName: string; password?: string },
    callback: (result: { success: boolean; roomId?: string; error?: string }) => void
  ) => void;
  'join-room': (
    data: { roomId: string; playerName: string; password?: string },
    callback: (result: { success: boolean; seat?: number; error?: string }) => void
  ) => void;
  'start-game': () => void;
  'discard-tile': (tileId: string) => void;
  claim: (claim: ClaimRequest) => void;
  'declare-tsumo': () => void;
  'declare-riichi': (tileId: string) => void;        // リーチ宣言（同時に捨て牌を指定）
  'declare-ankan': (tileId: string) => void;         // 暗槓（4枚のうち1枚のID）
  'declare-kakan': (tileId: string) => void;         // 加槓（ポンに足す1枚のID）
  'declare-kita': () => void;                        // 三麻の北抜き
  'declare-kyushuhai': () => void;                   // 九種九牌で流局宣言
  'ready-next': () => void;
}
