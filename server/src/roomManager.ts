import { MahjongGame } from './game/MahjongGame.js';
import { RoomInfo, ClaimRequest, RoundResult } from './types.js';

interface RoomPlayer {
  socketId: string;
  name: string;
  seat: number;
}

interface Room {
  id: string;
  name: string;
  maxPlayers: 3 | 4;
  players: RoomPlayer[];
  status: 'waiting' | 'playing';
  game?: MahjongGame;
}

type EmitFn = (socketId: string, event: string, ...args: unknown[]) => void;

let emitFn: EmitFn = () => {};

export function setEmitFn(fn: EmitFn): void {
  emitFn = fn;
}

const rooms = new Map<string, Room>();

function genId(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export function getRoomList(): RoomInfo[] {
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

export function joinRoom(
  socketId: string,
  playerName: string,
  roomId: string
): { success: boolean; seat?: number; error?: string } {
  const room = rooms.get(roomId);
  if (!room) return { success: false, error: 'ルームが見つかりません' };
  if (room.status === 'playing') return { success: false, error: 'ゲームが既に始まっています' };
  if (room.players.length >= room.maxPlayers) return { success: false, error: 'ルームが満員です' };
  if (room.players.some(p => p.name === playerName)) {
    return { success: false, error: 'その名前は既に使われています' };
  }

  const seat = room.players.length;
  room.players.push({ socketId, name: playerName, seat });
  return { success: true, seat };
}

export function getRoomBySocketId(socketId: string): Room | undefined {
  return Array.from(rooms.values()).find(r => r.players.some(p => p.socketId === socketId));
}

function broadcastGameUpdate(room: Room): void {
  if (!room.game) return;
  for (const p of room.players) {
    const view = room.game.getViewForPlayer(p.socketId);
    if (view) emitFn(p.socketId, 'game-update', view);
  }
}

export function startGame(socketId: string): boolean {
  const room = getRoomBySocketId(socketId);
  if (!room || room.status !== 'waiting') return false;
  if (room.players.length < 2) return false;

  room.status = 'playing';
  room.game = new MahjongGame(
    room.maxPlayers,
    room.players,
    () => {
      broadcastGameUpdate(room);
    },
    (result: RoundResult) => {
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
      const player = room.players.find(p => p.seat === seat);
      if (!player) return;
      const view = room.game!.getViewWithClaims(player.socketId, available, chiCombos);
      if (view) emitFn(player.socketId, 'game-update', view);
    }
  );

  room.game.startRound();
  return true;
}

export function handleDiscard(socketId: string, tileId: string): void {
  getRoomBySocketId(socketId)?.game?.handleDiscard(socketId, tileId);
}

export function handleClaim(socketId: string, claim: ClaimRequest): void {
  getRoomBySocketId(socketId)?.game?.handleClaim(socketId, claim);
}

export function handleTsumo(socketId: string): void {
  getRoomBySocketId(socketId)?.game?.handleTsumo(socketId);
}

export function handleReadyNext(socketId: string): void {
  getRoomBySocketId(socketId)?.game?.handleReadyNext(socketId);
}

export function handleDisconnect(socketId: string): void {
  const room = getRoomBySocketId(socketId);
  if (!room) return;
  if (room.status === 'waiting') {
    room.players = room.players.filter(p => p.socketId !== socketId);
    if (room.players.length === 0) {
      rooms.delete(room.id);
    } else {
      room.players.forEach((p, i) => {
        p.seat = i;
      });
    }
    // Notify remaining players
    for (const p of room.players) {
      emitFn(p.socketId, 'room-update', {
        players: room.players.map(pl => ({ name: pl.name, seat: pl.seat })),
        maxPlayers: room.maxPlayers,
        roomName: room.name,
      });
    }
  }
}

export function getRoomPlayers(socketId: string): { name: string; seat: number }[] {
  const room = getRoomBySocketId(socketId);
  return room?.players.map(p => ({ name: p.name, seat: p.seat })) ?? [];
}
