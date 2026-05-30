// このファイルはサーバーのエントリーポイント。
// 新規イベント（リーチ・北抜き・九種九牌）と、パスワード付きルームに対応。
import express from 'express';
import type { CorsOptions } from 'cors';
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
  handleRiichi,
  handleAnkan,
  handleKakan,
  handleKita,
  handleKyushuhai,
  handleReadyNext,
  handleDisconnect,
  getRoomPlayers,
  getRoomBySocketId,
} from './roomManager.js';
import { ClientToServerEvents, ServerToClientEvents } from './types.js';

// --- CORS 設定 ---
// 環境変数 ALLOWED_ORIGINS にカンマ区切りで許可するオリジンを書く。
// 例: "https://me1td0wn76.github.io,https://example.com"
// 未指定の場合は dev のローカルホストのみ許可。本番では必ず指定すること。
const DEFAULT_DEV_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173',
];

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const effectiveOrigins =
  allowedOrigins.length > 0 ? allowedOrigins : DEFAULT_DEV_ORIGINS;

console.log('[CORS] Allowed origins:', effectiveOrigins);

// オリジン判定。Origin ヘッダ無し（同一オリジン・curl など）は許可。
// 許可リストに一致しない場合は接続を拒否する。
const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }
    if (effectiveOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  methods: ['GET', 'POST'],
  credentials: false,
};

const app = express();
// 全エンドポイントに allowlist 方式の CORS を適用
app.use(cors(corsOptions));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const httpServer = createServer(app);

// Socket.IO にも同じ allowlist を適用
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: effectiveOrigins,
    methods: ['GET', 'POST'],
    credentials: false,
  },
});

setEmitFn((socketId, event, ...args) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  io.to(socketId).emit(event as any, ...args);
});

io.on('connection', socket => {
  console.log(`[+] Connected: ${socket.id}`);

  socket.on('get-rooms', callback => {
    callback(getRoomList());
  });

  socket.on('create-room', (data, callback) => {
    const result = createRoom(
      socket.id,
      data.playerName,
      data.name,
      data.maxPlayers,
      data.password
    );
    if (result.success && result.roomId) {
      socket.join(result.roomId);
      io.to(result.roomId).emit('room-update', {
        players: getRoomPlayers(socket.id),
        maxPlayers: data.maxPlayers,
        roomName: data.name,
      });
    }
    callback(result);
  });

  socket.on('join-room', (data, callback) => {
    const result = joinRoom(socket.id, data.playerName, data.roomId, data.password);
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

  socket.on('start-game', () => {
    const ok = startGame(socket.id);
    if (!ok) socket.emit('error', 'ゲームを開始できません（全員が揃ってから開始してください）');
  });

  socket.on('discard-tile', tileId => {
    handleDiscard(socket.id, tileId);
  });

  socket.on('claim', claim => {
    handleClaim(socket.id, claim);
  });

  socket.on('declare-tsumo', () => {
    handleTsumo(socket.id);
  });

  socket.on('declare-riichi', tileId => {
    handleRiichi(socket.id, tileId);
  });

  socket.on('declare-ankan', tileId => {
    handleAnkan(socket.id, tileId);
  });

  socket.on('declare-kakan', tileId => {
    handleKakan(socket.id, tileId);
  });

  socket.on('declare-kita', () => {
    handleKita(socket.id);
  });

  socket.on('declare-kyushuhai', () => {
    handleKyushuhai(socket.id);
  });

  socket.on('ready-next', () => {
    handleReadyNext(socket.id);
  });

  socket.on('disconnect', () => {
    console.log(`[-] Disconnected: ${socket.id}`);
    handleDisconnect(socket.id);
  });
});

const PORT = Number(process.env.PORT ?? 3001);
httpServer.listen(PORT, () => {
  console.log(`🀄 Mahjong server running on http://localhost:${PORT}`);
});
