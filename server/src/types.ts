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
  // 赤ドラ（赤5）かどうか。各色の5に1枚だけ存在し、持っていると1枚につき1飜加算される。
  // 通常の5と「種類・数字」は同じなので、面子判定や待ち判定では普通の5として扱う。
  red?: boolean;
}

// 鳴き（チー・ポン・カン）の情報をまとめた型
export interface Meld {
  // どの鳴きか。'minkan'=明槓（他家からのカン）、'ankan'=暗槓（自分だけで作るカン）
  type: 'chi' | 'pon' | 'minkan' | 'ankan';
  tiles: Tile[];      // その鳴きを構成する牌の一覧
  // どの席から鳴いたか。`?` を付けると「省略可能（あってもなくてもよい）」になる。
  // 暗槓のように相手から取らない鳴きでは存在しないため、必須にしていない。
  fromSeat?: number;
}

// ゲームの「現在の局面（フェーズ）」。`|` でつないだ型は「このどれか1つ」を意味する（ユニオン型）。
// 文字列をそのまま型にすることで、決まった値しか入れられなくなり打ち間違いを防げる。
export type GamePhase =
  | 'dealing'        // 配牌中
  | 'draw'           // 牌を引く番
  | 'discard'        // 牌を捨てる番
  | 'claiming'       // 他家が鳴き／ロンを宣言できる待ち
  | 'kyushuCheck'    // 九種九牌の宣言可能フェーズ（配牌直後）
  | 'roundEnd'       // 局の終了（結果表示）
  | 'gameOver';      // ゲーム全体の終了

// 風（席の位置）の型
export type Wind = 'east' | 'south' | 'west' | 'north';

// WINDS は席順（東→南→西→北）を順番どおりに並べた配列。
// `as const` ではなく型注釈 `: Wind[]` を付けて、Wind 以外が混ざらないようにしている。
// 「次の席」を求めるときなど、順番が決まっているのを利用してインデックスで回せる。
export const WINDS: Wind[] = ['east', 'south', 'west', 'north'];

// クライアント側から鳴きを宣言する時に送るデータの型
export interface ClaimRequest {
  // 'skip' は「鳴かずに見送る」。鳴ける場面で何も選ばない人を待たないために必要。
  type: 'chi' | 'pon' | 'kan' | 'ron' | 'skip';
  // チーのときだけ「手牌のどの2枚を使うか」を指定する。
  // `[string, string]` はタプル型で、「ちょうど2要素の配列」を表す（チーは2枚使うため）。
  chiTiles?: [string, string];
}

// 1つの役の表示用情報
export interface YakuInfo {
  name: string;     // 役の名前（例: "立直", "平和"）
  han: number;      // その役の飜数
}

// 各プレイヤーの「公開できる情報」だけをまとめた型。
// 手牌の中身（myHand）はここに入れず、他人に見せてよい情報だけに絞っているのがポイント。
// こうすることで、サーバーが誤って相手の手牌を全員に送ってしまう事故を構造的に防げる。
export interface PlayerView {
  seat: number;            // 席番号（0始まり）
  name: string;            // プレイヤー名
  handCount: number;       // 手牌の「枚数」だけ。中身は見せない
  discards: Tile[];        // 捨て牌（河）。これは全員に公開される情報
  melds: Meld[];           // 鳴いてさらした牌
  score: number;           // 現在の点数
  isDealer: boolean;       // 親かどうか
  seatWind: Wind;          // 自風（その席の風）
  isRiichi: boolean;       // リーチ中かどうか
  kitaCount: number;       // 三麻の北抜き枚数（4麻では常に0）
}

// ゲーム全体の状態のうち「自分が見ていい部分」をまとめた型
export interface GameView {
  phase: GamePhase;        // 今どの局面か
  round: Wind;             // 場風（東場・南場など）
  roundNumber: number;     // 局数（東1局なら1）
  honbaCount: number;      // 本場の数（連荘・流局で積まれる）
  riichiSticks: number;    // 場に出ている供託リーチ棒の数
  dealer: number;          // 親の席番号
  currentTurn: number;     // 今が手番の席番号
  wallCount: number;       // 山に残っている牌の数
  doraIndicators: Tile[];  // ドラ表示牌（公開されている表ドラの目印）
  // 直前の捨て牌。鳴きやロンの判定に使う。まだ無い場面もあるので省略可能(`?`)。
  lastDiscard?: { tile: Tile; seat: number };
  players: PlayerView[];   // 全プレイヤーの公開情報
  myHand: Tile[];          // 自分の手牌（このビューを受け取る本人の分だけ）
  mySeat: number;          // 自分の席番号
  drawnTileId?: string;    // ツモ牌のID（手牌の一番右に分けて表示する用。無いときは省略）
  availableClaims?: Array<'chi' | 'pon' | 'kan' | 'ron'>;
  chiCombinations?: [string, string][];
  canRiichi?: boolean;                               // 自分がリーチ宣言可能か
  canKita?: boolean;                                 // 三麻で北抜き可能か
  canKyushuhai?: boolean;                            // 九種九牌の宣言可能か
  ankanOptions?: string[];                           // 暗槓できる牌のID（代表牌1枚／カン）
  kakanOptions?: string[];                           // 加槓できる手牌のID
}

// 1局終了時の結果情報。
// 和了か流局かで「埋まるフィールド」が変わるため、共通の isDraw 以外は省略可能(`?`)にしている。
export interface RoundResult {
  isDraw: boolean;                                   // 流局かどうか
  isKyushuhai?: boolean;                             // 九種九牌による流局か
  winner?: number;                                   // 和了した席（流局なら無し）
  losers?: number[];                                 // 失点した席（放銃者やツモられた側）
  winTile?: Tile;                                    // 和了牌
  winType?: 'tsumo' | 'ron';                         // ツモかロンか
  handTiles?: Tile[];                                // 和了者の手牌（結果表示用に公開）
  melds?: Meld[];                                    // 和了者の鳴き
  yakuList?: YakuInfo[];                             // 成立した役
  totalHan?: number;                                 // 合計飜数
  fu?: number;                                       // 符
  doraIndicators?: Tile[];                           // ドラ表示牌
  uraDoraIndicators?: Tile[];                        // 裏ドラ表示牌（リーチ和了時のみ公開）
  // Record<number, number> は「キーが number、値が number のオブジェクト」を表す型。
  // ここでは「席番号 → 点数」の対応表として使う。{ 0: -8000, 1: +8000, ... } のような形。
  scoreDelta: Record<number, number>;                // この局での増減
  newScores: Record<number, number>;                // 精算後の各席の合計点
}

// ルーム一覧で表示する情報
export interface RoomInfo {
  id: string;                                        // ルームの一意なID
  name: string;                                      // ルーム名
  maxPlayers: 3 | 4;                                 // 3人麻雀か4人麻雀か（3か4だけ許可）
  currentPlayers: number;                            // 現在の参加人数
  status: 'waiting' | 'playing';                     // 待機中か対局中か
  isPrivate: boolean;                                // パスワード付き（プライベート）か
}

// --- Socket.IO のイベント型定義 ---
// 下の各行は「イベント名: そのイベントで呼ばれる関数の形」という対応を書いている。
// 例えば `error: (message: string) => void` は「error イベントは文字列を1つ受け取る関数」という意味。
// `=> void` は「戻り値を使わない（返さない）」こと。
// この型を Socket.IO に渡しておくと、emit/on のイベント名や引数を間違えたときに即わかる。

// サーバー → クライアント へ送るイベント一覧
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
  // チャットメッセージの配信（同じ部屋の全員へ）。
  'chat-message': (msg: ChatMessage) => void;
  error: (message: string) => void;
}

// 1件のチャットメッセージ。
export interface ChatMessage {
  seat: number;        // 発言者の席番号
  name: string;        // 発言者名
  text: string;        // 本文
  ts: number;          // 送信時刻（ミリ秒）。表示順や key に使う
}

// クライアント → サーバー へ送るイベント一覧。
// callback を引数に取るものは、サーバーが処理結果を呼び出し元へ返す（応答する）ためのもの。
export interface ClientToServerEvents {
  'get-rooms': (callback: (rooms: RoomInfo[]) => void) => void;
  'create-room': (
    data: { name: string; maxPlayers: 3 | 4; playerName: string; password?: string; token?: string },
    callback: (result: { success: boolean; roomId?: string; error?: string }) => void
  ) => void;
  'join-room': (
    data: { roomId: string; playerName: string; password?: string; token?: string },
    callback: (result: { success: boolean; seat?: number; error?: string }) => void
  ) => void;
  // リロード後の再接続。token で「同じ人」を特定して席に戻す。
  rejoin: (
    data: { roomId: string; playerName: string; token: string },
    callback: (result: { success: boolean; seat?: number; error?: string }) => void
  ) => void;
  // 部屋から明示的に抜ける。
  'leave-room': () => void;
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
  'chat-send': (text: string) => void;              // チャット送信
}
