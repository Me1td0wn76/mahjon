// このファイルはサーバーのエントリーポイント（起動の起点）です。
// Express で HTTP サーバーを立てつつ、Socket.IO でリアルタイム通信を受け付けます。
// クライアントから来たイベント（'create-room' など）を roomManager の関数に振り分けるのが役目。
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import {
  setEmitFn,
  getRoomList,
  createRoom,
  joinRoom,
  startGame,
  handleDiscard,
  handleClaim,
  handleTsumo,
  handleReadyNext,
  handleDisconnect,
  getRoomPlayers,
  getRoomBySocketId,
} from './roomManager.js';
import { ClientToServerEvents, ServerToClientEvents } from './types.js';

// Express アプリを作成。ミドルウェアを使ってリクエストを処理する仕組み。
const app = express();
app.use(cors());                                             // CORS（クロスオリジン）の許可
app.use(express.json());                                     // JSON ボディを自動で解析

// ヘルスチェック用のエンドポイント。動作確認に便利。
// `_req` の先頭アンダースコアは「使わない引数」の慣習。
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Express を載せた HTTP サーバーを作成。Socket.IO はこれをラップする。
const httpServer = createServer(app);

// Socket.IO サーバーを生成。型パラメータでイベントの型を渡すと、
// `socket.emit('xxx', ...)` のイベント名や引数の型をTSがチェックしてくれる。
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// roomManager に「実際に送信する関数」を注入。
// roomManager 内では emitFn を呼ぶだけで、socket.io への依存をここに閉じ込めている。
setEmitFn((socketId, event, ...args) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  io.to(socketId).emit(event as any, ...args);
});

// クライアントが接続した時の処理。各イベントのリスナを登録する。
io.on('connection', socket => {
  console.log(`[+] Connected: ${socket.id}`);

  // 'get-rooms': ルーム一覧をリクエスト
  // callback 関数を引数に取って結果を返す「ack付きemit」のパターン
  socket.on('get-rooms', callback => {
    callback(getRoomList());
  });

  // 'create-room': 新しいルームを作る
  socket.on('create-room', (data, callback) => {
    const result = createRoom(socket.id, data.playerName, data.name, data.maxPlayers);
    if (result.success && result.roomId) {
      socket.join(result.roomId);                            // socket をルームに紐付け
      // 同じルームの全員に最新のメンバー情報を通知
      io.to(result.roomId).emit('room-update', {
        players: getRoomPlayers(socket.id),
        maxPlayers: data.maxPlayers,
        roomName: data.name,
      });
    }
    callback(result);                                        // 作成結果を呼び出し元に返す
  });

  // 'join-room': 既存ルームに参加
  socket.on('join-room', (data, callback) => {
    const result = joinRoom(socket.id, data.playerName, data.roomId);
    if (result.success) {
      socket.join(data.roomId);
      const room = getRoomBySocketId(socket.id);
      if (room) {
        io.to(data.roomId).emit('room-update', {
          players: getRoomPlayers(socket.id),
          maxPlayers: room.maxPlayers,
          roomName: room.name,
        });
      }
    }
    callback(result);
  });

  // 'start-game': ゲーム開始
  socket.on('start-game', () => {
    const ok = startGame(socket.id);
    // 失敗時はそのクライアントだけにエラーを送信
    if (!ok) socket.emit('error', 'ゲームを開始できません（最低2名必要です）');
  });

  // 'discard-tile': 牌を捨てた
  socket.on('discard-tile', tileId => {
    handleDiscard(socket.id, tileId);
  });

  // 'claim': 鳴き宣言（チー/ポン/ロン/スキップ）
  socket.on('claim', claim => {
    handleClaim(socket.id, claim);
  });

  // 'declare-tsumo': ツモ宣言
  socket.on('declare-tsumo', () => {
    handleTsumo(socket.id);
  });

  // 'ready-next': 局終了後の「次へ」ボタン
  socket.on('ready-next', () => {
    handleReadyNext(socket.id);
  });

  // 切断時の後始末
  socket.on('disconnect', () => {
    console.log(`[-] Disconnected: ${socket.id}`);
    handleDisconnect(socket.id);
  });
});

// 環境変数 PORT があればそれを使い、無ければ 3001 を使う。
// `??` は左が null/undefined のときだけ右を使う演算子（null合体演算子）。
const PORT = Number(process.env.PORT ?? 3001);
httpServer.listen(PORT, () => {
  console.log(`🀄 Mahjong server running on http://localhost:${PORT}`);
});
