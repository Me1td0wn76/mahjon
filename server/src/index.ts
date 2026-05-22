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

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const httpServer = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
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
    const result = createRoom(socket.id, data.playerName, data.name, data.maxPlayers);
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

  socket.on('start-game', () => {
    const ok = startGame(socket.id);
    if (!ok) socket.emit('error', 'ゲームを開始できません（最低2名必要です）');
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
