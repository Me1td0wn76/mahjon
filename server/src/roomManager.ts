// このファイルは「ルーム（部屋）」の管理を担当します。
// パスワード付き（プライベート）ルーム、リーチ・北抜き・九種九牌の取り次ぎなどを行います。
import { MahjongGame } from './game/MahjongGame.js';
import { RoomInfo, ClaimRequest, RoundResult, ChatMessage } from './types.js';

// ルームに参加している1人分の情報。
interface RoomPlayer {
  socketId: string;        // その人の接続ID（Socket.IO が割り振る／リロードで変わる）
  name: string;            // プレイヤー名
  seat: number;            // 席番号（0始まり）
  // リロードしても「同じ人」だと特定するための安定したID。
  // socketId は再接続で変わるが、token はブラウザに保存され変わらない。
  token?: string;
  // 現在オンライン接続中か。切断で false、再接続(rejoin)で true に戻す。
  // 対局中は席を残して再接続を待つが、全員が false になったら部屋を消す判断に使う。
  connected: boolean;
}

// 1つのルームの情報。
interface Room {
  id: string;
  name: string;
  maxPlayers: 3 | 4;
  players: RoomPlayer[];
  status: 'waiting' | 'playing';
  // 対局が始まると麻雀ゲーム本体を持つ。開始前は存在しないので省略可能(`?`)。
  game?: MahjongGame;
  password?: string;                                 // パスワード（プライベートルーム用）
}

// 「特定の人へイベントを送る関数」の型。index.ts から実物を注入してもらう（依存性の注入）。
// `...args: unknown[]` は「型が事前にわからない引数を何個でも受け取る」という意味。
type EmitFn = (socketId: string, event: string, ...args: unknown[]) => void;

// 初期値は「何もしない関数」。注入される前に呼ばれてもエラーにならないようにするため。
let emitFn: EmitFn = () => {};

// index.ts から本物の送信関数を受け取って差し替える。
export function setEmitFn(fn: EmitFn): void {
  emitFn = fn;
}

// 全ルームを「ルームID → ルーム」で保持する。Map は配列より、IDでの取り出し・削除が速くて分かりやすい。
const rooms = new Map<string, Room>();

// ルームIDを生成する。乱数を36進数(0-9,a-z)の文字列にして6文字だけ切り出し、大文字化している。
// 例: "A1B2C3"。短くて入力しやすいIDが欲しいだけなので、厳密な一意性までは保証していない。
function genId(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

/**
 * 待機中ルーム一覧を返す（パスワード自体は隠して、有無だけ伝える）。
 */
export function getRoomList(): RoomInfo[] {
  // Map の値を配列にしてから、メソッドチェーンで絞り込み＆形を整える。
  return Array.from(rooms.values())
    .filter(r => r.status === 'waiting')   // まだ始まっていない＝参加できる部屋だけ残す
    .map(r => ({                           // クライアントに見せてよい形に詰め替える
      id: r.id,
      name: r.name,
      maxPlayers: r.maxPlayers,
      currentPlayers: r.players.length,
      status: r.status,
      // `!!` は値を真偽値に変換する書き方。password があれば true、無ければ false。
      // パスワードそのものは送らず「鍵付きか否か」だけ伝えることで漏洩を防ぐ。
      isPrivate: !!r.password,
    }));
}

/**
 * 新しいルームを作る。パスワード省略可。
 */
export function createRoom(
  socketId: string,
  playerName: string,
  roomName: string,
  maxPlayers: 3 | 4,
  password?: string,
  token?: string
): { success: boolean; roomId?: string; error?: string } {
  const roomId = genId();
  // Map に新しいルームを登録する。作った本人は seat: 0（最初の席）で参加扱い。
  rooms.set(roomId, {
    id: roomId,
    name: roomName,
    maxPlayers,
    players: [{ socketId, name: playerName, seat: 0, token, connected: true }],
    status: 'waiting',
    // パスワードが「空白だけ」や未入力なら undefined（＝鍵なし）にそろえる。
    // .trim() で前後の空白を除き、空文字を誤って有効なパスワードにしないため。
    password: password && password.trim() ? password.trim() : undefined,
  });
  return { success: true, roomId };
}

/**
 * 既存ルームへの参加。パスワード付きならパスワード必須。
 */
export function joinRoom(
  socketId: string,
  playerName: string,
  roomId: string,
  password?: string,
  token?: string
): { success: boolean; seat?: number; error?: string } {
  const room = rooms.get(roomId);
  // 参加できない条件を先にひとつずつ弾く（早期リターン）。
  // こうすると「ここまで来たら参加できる」と後続が読みやすくなる。
  if (!room) return { success: false, error: 'ルームが見つかりません' };
  if (room.status === 'playing') return { success: false, error: 'ゲームが既に始まっています' };
  if (room.players.length >= room.maxPlayers) return { success: false, error: 'ルームが満員です' };
  // some は「条件に合う要素が1つでもあれば true」。同名プレイヤーがいれば弾く。
  if (room.players.some(p => p.name === playerName)) {
    return { success: false, error: 'その名前は既に使われています' };
  }
  // パスワード照合（rooms 側に password がある場合のみ厳格チェック）
  if (room.password) {
    if (!password || password.trim() !== room.password) {
      return { success: false, error: 'パスワードが正しくありません' };
    }
  }

  // 新しい席番号は「今の人数」。0,1,2... と詰めて割り当たる。
  const seat = room.players.length;
  room.players.push({ socketId, name: playerName, seat, token, connected: true });
  return { success: true, seat };
}

/**
 * リロード後の再接続。token で本人を特定し、socketId を新しいものに張り替える。
 * 対局中（game あり）でも席に戻れるよう、ゲーム側の socketId も更新する。
 */
export function rejoinRoom(
  socketId: string,
  roomId: string,
  playerName: string,
  token: string
): { success: boolean; seat?: number; error?: string; inGame?: boolean } {
  const room = rooms.get(roomId);
  if (!room) return { success: false, error: 'ルームが見つかりません' };

  // まず token で本人を探す。token が一致すれば、同じ人がリロードしたと判断できる。
  // token が無い古いセッション向けに、名前一致もフォールバックとして許容する。
  const player =
    room.players.find(p => p.token && p.token === token) ??
    room.players.find(p => p.name === playerName);
  if (!player) return { success: false, error: '元の席が見つかりません' };

  // 接続IDを新しいものへ張り替え、オンライン状態に戻す（room 側とゲーム側の両方）。
  player.socketId = socketId;
  player.connected = true;
  if (!player.token) player.token = token;
  if (room.game) {
    room.game.reassignSocket(player.seat, socketId);
  }
  return { success: true, seat: player.seat, inGame: room.status === 'playing' };
}

/**
 * 明示的に部屋を抜ける。待機中なら disconnect と同じ後始末を行う。
 */
export function leaveRoom(socketId: string): void {
  handleDisconnect(socketId);
}

// 接続IDから、その人が入っているルームを探す。
// 戻り値の型 `Room | undefined` は「見つかればRoom、無ければundefined」を意味する。
// find は条件に合う最初の要素を返し、無ければ undefined を返す。
export function getRoomBySocketId(socketId: string): Room | undefined {
  return Array.from(rooms.values()).find(r => r.players.some(p => p.socketId === socketId));
}

// ルーム内の全員に、各自専用のゲーム状態（手牌が違う）を送る。
function broadcastGameUpdate(room: Room): void {
  if (!room.game) return;                 // ゲーム未開始なら何もしない
  for (const p of room.players) {
    // getViewForPlayer は「その人が見てよい情報だけ」を作る。人ごとに手牌が違うので個別送信。
    const view = room.game.getViewForPlayer(p.socketId);
    if (view) emitFn(p.socketId, 'game-update', view);
  }
}

export function startGame(socketId: string): boolean {
  const room = getRoomBySocketId(socketId);
  if (!room || room.status !== 'waiting') return false;
  // 麻雀は全席（3人 or 4人）が埋まって初めて成立する。
  // 席数(maxPlayers)に満たない状態で始めると、配牌ループが存在しない席を
  // 参照してクラッシュするため、満員になるまで開始させない。
  if (room.players.length !== room.maxPlayers) return false;

  room.status = 'playing';
  // 麻雀ゲーム本体を作る。MahjongGame は通信方法を知らないので、
  // 「状態が変わったら何をするか」を3つのコールバック関数で受け取る形にしている（疎結合）。
  room.game = new MahjongGame(
    room.maxPlayers,
    room.players,
    // (1) 局面が更新されたとき: 全員に最新状態を配信する
    () => {
      broadcastGameUpdate(room);
    },
    // (2) 局が終わったとき: 結果を全員へ送る
    (result: RoundResult) => {
      // ロン和了なら、和了者基準で次局へ進める。
      // `room.game!` の `!` は「ここでは必ず存在する」と TS に断言する書き方（非nullアサーション）。
      // 直前で room.game を代入済みなので安全だが、TS には省略可能(`?`)に見えるため明示する。
      if (!result.isDraw && result.winner !== undefined) {
        room.game!.advanceAfterRon(result.winner);
      }
      for (const p of room.players) {
        emitFn(p.socketId, 'round-end', result);
      }
    },
    // (3) 誰かが鳴き／ロンを宣言できる状況になったとき: その人だけに選択肢付きの状態を送る
    (
      seat: number,
      _deadline: number,                                 // 使わない引数なので `_` 始まり
      available: Array<'chi' | 'pon' | 'kan' | 'ron'>,
      chiCombos: [string, string][]
    ) => {
      const player = room.players.find(p => p.seat === seat);
      if (!player) return;
      const view = room.game!.getViewWithClaims(player.socketId, available, chiCombos);
      if (view) emitFn(player.socketId, 'game-update', view);
    }
  );

  room.game.startRound();        // 最初の局を開始
  return true;
}

// --- ゲーム中操作の取り次ぎ ---
// 以下はどれも「その人のルームのゲームへ操作を渡すだけ」の薄い関数。
// `?.`（オプショナルチェーン）は「左が null/undefined なら、その先を呼ばず undefined を返す」記法。
// `getRoomBySocketId(...)?.game?.handleDiscard(...)` は
// 「ルームがあって、かつゲームが始まっていれば handleDiscard を呼ぶ」を1行で安全に書いている。
// ルームやゲームが無い不正なタイミングの操作でもクラッシュしない。

export function handleDiscard(socketId: string, tileId: string): void {
  getRoomBySocketId(socketId)?.game?.handleDiscard(socketId, tileId);
}

export function handleClaim(socketId: string, claim: ClaimRequest): void {
  getRoomBySocketId(socketId)?.game?.handleClaim(socketId, claim);
}

export function handleTsumo(socketId: string): void {
  getRoomBySocketId(socketId)?.game?.handleTsumo(socketId);
}

export function handleRiichi(socketId: string, tileId: string): void {
  getRoomBySocketId(socketId)?.game?.handleRiichi(socketId, tileId);
}

export function handleAnkan(socketId: string, tileId: string): void {
  getRoomBySocketId(socketId)?.game?.handleAnkan(socketId, tileId);
}

export function handleKakan(socketId: string, tileId: string): void {
  getRoomBySocketId(socketId)?.game?.handleKakan(socketId, tileId);
}

export function handleKita(socketId: string): void {
  getRoomBySocketId(socketId)?.game?.handleKita(socketId);
}

export function handleKyushuhai(socketId: string): void {
  getRoomBySocketId(socketId)?.game?.handleKyushuhai(socketId);
}

export function handleReadyNext(socketId: string): void {
  getRoomBySocketId(socketId)?.game?.handleReadyNext(socketId);
}

/**
 * チャット送信。送信者の入っている部屋の全員に同じメッセージを配信する。
 * 文字数は上限を設けて、極端に長い文字列でのいたずらを防ぐ。
 */
export function handleChat(socketId: string, text: string): void {
  const room = getRoomBySocketId(socketId);
  if (!room) return;
  const sender = room.players.find(p => p.socketId === socketId);
  if (!sender) return;

  // 前後の空白を除き、空なら無視。長すぎる場合は200文字に切り詰める。
  const trimmed = text.trim().slice(0, 200);
  if (!trimmed) return;

  const msg: ChatMessage = {
    seat: sender.seat,
    name: sender.name,
    text: trimmed,
    ts: Date.now(),
  };
  // 部屋の全員へ配信。
  for (const p of room.players) {
    emitFn(p.socketId, 'chat-message', msg);
  }
}

// 切断時の後始末。待機中と対局中で扱いを分ける。
export function handleDisconnect(socketId: string): void {
  const room = getRoomBySocketId(socketId);
  if (!room) return;

  if (room.status === 'waiting') {
    // 待機中: 抜けた本人を players から取り除く（filter は条件に合う要素だけ残した新配列を返す）。
    room.players = room.players.filter(p => p.socketId !== socketId);
    if (room.players.length === 0) {
      // 誰もいなくなったルームは残しても無駄なので削除する。
      rooms.delete(room.id);
      return;
    }
    // 席番号に欠番ができないよう、残った人を前から 0,1,2... と振り直す。
    room.players.forEach((p, i) => {
      p.seat = i;
    });
    // 残ったメンバーに「メンバーが変わった」最新状態を通知する。
    for (const p of room.players) {
      emitFn(p.socketId, 'room-update', {
        players: room.players.map(pl => ({ name: pl.name, seat: pl.seat })),
        maxPlayers: room.maxPlayers,
        roomName: room.name,
      });
    }
    return;
  }

  // 対局中: 席はそのまま残し「切断中(connected=false)」にして再接続を待つ。
  // ただし全員が切断したら、その部屋に戻れても意味がないので部屋ごと削除する
  //（=次にその部屋へ自動復帰してしまう問題を防ぐ）。
  const player = room.players.find(p => p.socketId === socketId);
  if (player) player.connected = false;

  if (room.players.every(p => !p.connected)) {
    rooms.delete(room.id);
  }
}

// あるルームの参加者一覧（名前と席だけ）を返す。
// `room?....` でルームが無ければ式全体が undefined になり、`?? []` で空配列に置き換える。
// これで「ルームが無い場合は空配列」を1行で安全に返せる。
export function getRoomPlayers(socketId: string): { name: string; seat: number }[] {
  const room = getRoomBySocketId(socketId);
  return room?.players.map(p => ({ name: p.name, seat: p.seat })) ?? [];
}
