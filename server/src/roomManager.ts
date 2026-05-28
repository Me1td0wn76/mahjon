// このファイルは「ルーム（部屋）」の管理を担当します。
// ルームの作成・参加・退出、ゲームの開始、ゲーム中の操作の受け流しなどを行います。
// MahjongGame は1つのゲーム進行を担うクラスで、ルームごとに1個のインスタンスを持ちます。
import { MahjongGame } from './game/MahjongGame.js';
import { RoomInfo, ClaimRequest, RoundResult } from './types.js';

// ルームに所属するプレイヤーの最小情報
interface RoomPlayer {
  socketId: string;
  name: string;
  seat: number;
}

// 1部屋の構造
interface Room {
  id: string;
  name: string;
  maxPlayers: 3 | 4;
  players: RoomPlayer[];
  status: 'waiting' | 'playing';
  game?: MahjongGame;                                // `?` は省略可能。ゲーム開始までは undefined
}

// クライアントにイベントを送るための関数型。
// 「socketId, イベント名, ...任意の引数」を受け取って何かする想定。
type EmitFn = (socketId: string, event: string, ...args: unknown[]) => void;

// 初期値は「何もしない関数」。実際の送信関数は index.ts から setEmitFn で注入する仕組み。
// この設計で roomManager.ts は Socket.IO に直接依存せず、テストもしやすくなる。
let emitFn: EmitFn = () => {};

/** index.ts などから「実際の送信関数」を注入するためのセッター。 */
export function setEmitFn(fn: EmitFn): void {
  emitFn = fn;
}

// 全ルームを保存するマップ。Map はキーで素早く取り出せるオブジェクト。
const rooms = new Map<string, Room>();

/**
 * ランダムなルームIDを生成（6文字の大文字英数字）。
 * 36進数文字列からランダムな部分を切り出している。
 */
function genId(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

/**
 * 現在の「待機中ルーム」だけを抽出して一覧情報を返す。
 * クライアントのロビーで表示するための整形済みデータ。
 */
export function getRoomList(): RoomInfo[] {
  // Map.values() で全Roomを取り出し、Array.from で配列化
  return Array.from(rooms.values())
    .filter(r => r.status === 'waiting')
    .map(r => ({
      id: r.id,
      name: r.name,
      maxPlayers: r.maxPlayers,
      currentPlayers: r.players.length,
      status: r.status,
    }));
}

/**
 * 新しいルームを作る。作成者は自動的に座席0（親）になる。
 */
export function createRoom(
  socketId: string,
  playerName: string,
  roomName: string,
  maxPlayers: 3 | 4
): { success: boolean; roomId?: string; error?: string } {
  const roomId = genId();
  rooms.set(roomId, {
    id: roomId,
    name: roomName,
    maxPlayers,
    players: [{ socketId, name: playerName, seat: 0 }],
    status: 'waiting',
  });
  return { success: true, roomId };
}

/**
 * 既存ルームへの参加処理。各種バリデーションを行ってから席を割り当てる。
 */
export function joinRoom(
  socketId: string,
  playerName: string,
  roomId: string
): { success: boolean; seat?: number; error?: string } {
  const room = rooms.get(roomId);
  if (!room) return { success: false, error: 'ルームが見つかりません' };
  if (room.status === 'playing') return { success: false, error: 'ゲームが既に始まっています' };
  if (room.players.length >= room.maxPlayers) return { success: false, error: 'ルームが満員です' };
  // some: 配列に1つでも条件に合う要素があるか
  if (room.players.some(p => p.name === playerName)) {
    return { success: false, error: 'その名前は既に使われています' };
  }

  // 席番号は現在の人数と同じ（先着順）
  const seat = room.players.length;
  room.players.push({ socketId, name: playerName, seat });
  return { success: true, seat };
}

/**
 * 指定のソケットIDが入っているルームを探す。
 * 切断や操作のたびに「どの部屋の誰か」を特定するために使う。
 */
export function getRoomBySocketId(socketId: string): Room | undefined {
  return Array.from(rooms.values()).find(r => r.players.some(p => p.socketId === socketId));
}

/**
 * 1つのルームに参加している全プレイヤーへ、それぞれの視点のゲーム状態を送る。
 * 自分の手牌は自分にだけ見えるよう、プレイヤーごとに view を生成して送り分ける。
 */
function broadcastGameUpdate(room: Room): void {
  if (!room.game) return;
  for (const p of room.players) {
    const view = room.game.getViewForPlayer(p.socketId);
    if (view) emitFn(p.socketId, 'game-update', view);
  }
}

/**
 * ゲーム開始処理。最低2名いれば開始可能。
 * MahjongGame のコールバックに「全員に通知する関数」を渡して連携を構築する。
 */
export function startGame(socketId: string): boolean {
  const room = getRoomBySocketId(socketId);
  if (!room || room.status !== 'waiting') return false;
  if (room.players.length < 2) return false;

  room.status = 'playing';
  // new MahjongGame(...) で1局を進めるインスタンスを生成。
  // 3つのコールバックでイベント駆動的に通信する仕組み。
  room.game = new MahjongGame(
    room.maxPlayers,
    room.players,
    () => {
      // 状態変更時: 全員にゲームビューを再送
      broadcastGameUpdate(room);
    },
    (result: RoundResult) => {
      // 局終了時: ロンなら親移動の判定、その後全員に結果を送る
      if (!result.isDraw && result.winner !== undefined) {
        room.game!.advanceAfterRon(result.winner);
      }
      for (const p of room.players) {
        emitFn(p.socketId, 'round-end', result);
      }
    },
    (
      seat: number,
      deadline: number,
      available: Array<'chi' | 'pon' | 'ron'>,
      chiCombos: [string, string][]
    ) => {
      // 鳴きチャンス通知: 該当プレイヤーにだけ availableClaims 付きビューを送る
      const player = room.players.find(p => p.seat === seat);
      if (!player) return;
      const view = room.game!.getViewWithClaims(player.socketId, available, chiCombos);
      if (view) emitFn(player.socketId, 'game-update', view);
    }
  );

  room.game.startRound();
  return true;
}

// --- 以下、ゲーム中操作の受け流し（バリデーションは MahjongGame 側） ---

/** クライアントが牌を捨てた時 */
export function handleDiscard(socketId: string, tileId: string): void {
  // `?.` はオプショナルチェイン: 左側が null/undefined なら何もしない
  getRoomBySocketId(socketId)?.game?.handleDiscard(socketId, tileId);
}

/** クライアントが鳴きを宣言した時 */
export function handleClaim(socketId: string, claim: ClaimRequest): void {
  getRoomBySocketId(socketId)?.game?.handleClaim(socketId, claim);
}

/** クライアントがツモを宣言した時 */
export function handleTsumo(socketId: string): void {
  getRoomBySocketId(socketId)?.game?.handleTsumo(socketId);
}

/** 局終了後の「次の局へ進む」ボタンを押した時 */
export function handleReadyNext(socketId: string): void {
  getRoomBySocketId(socketId)?.game?.handleReadyNext(socketId);
}

/**
 * 接続が切れた時の後始末。
 * 待機中ルームなら席を詰めて、空になった部屋を消す。
 * ゲーム中の切断処理は今のところ何もしていない（簡略実装）。
 */
export function handleDisconnect(socketId: string): void {
  const room = getRoomBySocketId(socketId);
  if (!room) return;
  if (room.status === 'waiting') {
    // 退出者を除いたリストに置き換え
    room.players = room.players.filter(p => p.socketId !== socketId);
    if (room.players.length === 0) {
      rooms.delete(room.id);                                 // 誰もいなくなった部屋は削除
    } else {
      // 席番号を 0,1,2,... に振り直す
      room.players.forEach((p, i) => {
        p.seat = i;
      });
    }
    // 残っているプレイヤーに最新の部屋情報を通知
    for (const p of room.players) {
      emitFn(p.socketId, 'room-update', {
        players: room.players.map(pl => ({ name: pl.name, seat: pl.seat })),
        maxPlayers: room.maxPlayers,
        roomName: room.name,
      });
    }
  }
}

/**
 * 自分の所属ルームのプレイヤー一覧を返す（外部に公開する用にフィルタした形）。
 * `?? []` は左が null/undefined の時に右の値を使う「null合体演算子」。
 */
export function getRoomPlayers(socketId: string): { name: string; seat: number }[] {
  const room = getRoomBySocketId(socketId);
  return room?.players.map(p => ({ name: p.name, seat: p.seat })) ?? [];
}
