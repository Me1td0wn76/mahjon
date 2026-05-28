// このファイルは、サーバーとクライアントでやり取りする「データの形（型）」を定義しています。
// TypeScript では事前に型を決めておくことで、「ここには文字列が来るはず」「ここには数字が来るはず」
// といったルールをコンパイラがチェックしてくれます。バグを早く発見できるので便利です。

// --- 牌（はい）の種類 ---
// 'man'=萬子(マンズ), 'pin'=筒子(ピンズ), 'sou'=索子(ソウズ), 'honor'=字牌(ジハイ)
// `|` は「これらの値のいずれか」を意味する Union 型（リテラル型の組み合わせ）です。
export type Suit = 'man' | 'pin' | 'sou' | 'honor';

// 1枚の牌を表すオブジェクトの構造
// interface は「オブジェクトの形」を定義するTSの機能です。
export interface Tile {
  id: string;       // 同じ牌でも個別に判別するためのユニークID (例: "man_5_2")
  suit: Suit;       // 牌の種類（上の Suit 型のいずれか）
  value: number;    // 数字。数牌は1-9、字牌は1-7（1-4=東南西北、5=白 6=発 7=中）
}

// 鳴き（チー・ポン・カン）の情報をまとめた型
export interface Meld {
  type: 'chi' | 'pon' | 'minkan' | 'ankan'; // 鳴きの種類
  tiles: Tile[];                            // 鳴いた3枚または4枚の牌
  fromSeat?: number;                        // どの席（プレイヤー）から鳴いたか（`?`は省略可能）
}

// ゲームの「現在の局面（フェーズ）」
// 何かが起きるたびにこの状態を切り替えてゲーム進行を管理します。
export type GamePhase =
  | 'dealing'    // 配牌中
  | 'draw'       // ツモる前
  | 'discard'    // 捨て牌を選ぶ番
  | 'claiming'   // 他家が鳴くかどうか判断中
  | 'roundEnd'   // 局が終了
  | 'gameOver';  // 半荘終了

// 風（席の位置）の型
export type Wind = 'east' | 'south' | 'west' | 'north';

// 配列の中身を順序付きで保持。座席番号 0,1,2,3 → 東南西北 と対応させる時に便利。
export const WINDS: Wind[] = ['east', 'south', 'west', 'north'];

// クライアント側から鳴きを宣言する時に送るデータの型
export interface ClaimRequest {
  type: 'chi' | 'pon' | 'ron' | 'skip';  // 鳴きの種類、'skip' は鳴かない選択
  chiTiles?: [string, string];           // チーの時に使う、手牌2枚の牌ID（順序固定なのでタプル型）
}

// 各プレイヤーの「公開できる情報」だけをまとめた型
// 他人の手牌（中身）は見えないので、handCount（枚数）だけ送る、というのがポイントです。
export interface PlayerView {
  seat: number;       // 席番号（0〜3）
  name: string;       // プレイヤー名
  handCount: number;  // 手牌の枚数（中身は秘密）
  discards: Tile[];   // 捨て牌の一覧（公開情報）
  melds: Meld[];      // 鳴いた面子（公開情報）
  score: number;      // 現在の点数
  isDealer: boolean;  // 親（東家）かどうか
  seatWind: Wind;     // 自家の風
}

// ゲーム全体の状態のうち「自分が見ていい部分」をまとめた型
// サーバーが各プレイヤーごとに違う内容を作って送ります（自分の手牌は自分だけ見える）。
export interface GameView {
  phase: GamePhase;
  round: Wind;                                       // 場風（東場・南場など）
  roundNumber: number;                               // 局数
  honbaCount: number;                                // 本場（連荘カウント）
  dealer: number;                                    // 親の席番号
  currentTurn: number;                               // 今手番のプレイヤーの席番号
  wallCount: number;                                 // 残り山牌の枚数
  doraIndicators: Tile[];                            // ドラ表示牌
  lastDiscard?: { tile: Tile; seat: number };        // 直前に捨てられた牌（存在しない場合あり）
  players: PlayerView[];                             // 全プレイヤーの公開情報
  myHand: Tile[];                                    // 自分の手牌（自分にだけ見える）
  mySeat: number;                                    // 自分の席番号
  availableClaims?: Array<'chi' | 'pon' | 'ron'>;    // 鳴ける選択肢があれば入る
  chiCombinations?: [string, string][];              // チー可能な組み合わせ一覧
}

// 1局終了時の結果情報
export interface RoundResult {
  isDraw: boolean;                       // 流局かどうか
  winner?: number;                       // 和了者の席番号
  losers?: number[];                     // 放銃者など（ロン時）
  winTile?: Tile;                        // 和了牌
  winType?: 'tsumo' | 'ron';             // ツモ or ロン
  handTiles?: Tile[];                    // 和了時の手牌
  melds?: Meld[];                        // 和了時の鳴き
  scoreDelta: Record<number, number>;    // 各席の点数増減（席番号 → 増減点）
  newScores: Record<number, number>;     // 各席の新しい点数
}

// ルーム一覧で表示する情報
export interface RoomInfo {
  id: string;
  name: string;
  maxPlayers: 3 | 4;                       // 3人麻雀か4人麻雀かを限定するリテラル型
  currentPlayers: number;
  status: 'waiting' | 'playing';
}

// --- Socket.IO のイベント型定義 ---
// Socket.IO を型付きで使うために、サーバー→クライアント、クライアント→サーバー
// それぞれのイベント名と引数の形を定義します。これでイベント名の打ち間違いなどを防げます。

// サーバーからクライアントに送るイベント一覧
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

// クライアントからサーバーに送るイベント一覧
// callback を引数にとるイベントは、サーバーからの応答を受け取れる仕組みです（acknowledgement）。
export interface ClientToServerEvents {
  'get-rooms': (callback: (rooms: RoomInfo[]) => void) => void;
  'create-room': (
    data: { name: string; maxPlayers: 3 | 4; playerName: string },
    callback: (result: { success: boolean; roomId?: string; error?: string }) => void
  ) => void;
  'join-room': (
    data: { roomId: string; playerName: string },
    callback: (result: { success: boolean; seat?: number; error?: string }) => void
  ) => void;
  'start-game': () => void;
  'discard-tile': (tileId: string) => void;
  claim: (claim: ClaimRequest) => void;
  'declare-tsumo': () => void;
  'ready-next': () => void;
}
