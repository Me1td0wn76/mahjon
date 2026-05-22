import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type { GameView, RoomInfo, RoundResult } from '../types/mahjong';

const SOCKET_URL = (import.meta as { env: Record<string, string> }).env.VITE_SOCKET_URL ?? 'http://localhost:3001';

export interface SocketState {
  connected: boolean;
  rooms: RoomInfo[];
  gameView: GameView | null;
  roundResult: RoundResult | null;
  roomInfo: {
    players: { name: string; seat: number }[];
    maxPlayers: number;
    roomName: string;
  } | null;
  joinedRoomId: string | null;
  mySeat: number | null;
  error: string | null;
}

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [state, setState] = useState<SocketState>({
    connected: false,
    rooms: [],
    gameView: null,
    roundResult: null,
    roomInfo: null,
    joinedRoomId: null,
    mySeat: null,
    error: null,
  });

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () =>
      setState(s => ({ ...s, connected: true, error: null }))
    );
    socket.on('disconnect', () =>
      setState(s => ({ ...s, connected: false }))
    );
    socket.on('rooms', rooms =>
      setState(s => ({ ...s, rooms }))
    );
    socket.on('room-update', data =>
      setState(s => ({ ...s, roomInfo: data }))
    );
    socket.on('game-start', view =>
      setState(s => ({ ...s, gameView: view, roundResult: null }))
    );
    socket.on('game-update', view =>
      setState(s => ({ ...s, gameView: view }))
    );
    socket.on('round-end', result =>
      setState(s => ({ ...s, roundResult: result }))
    );
    socket.on('error', msg =>
      setState(s => ({ ...s, error: msg }))
    );

    return () => {
      socket.disconnect();
    };
  }, []);

  const getRooms = useCallback(() => {
    socketRef.current?.emit('get-rooms', (rooms: RoomInfo[]) => {
      setState(s => ({ ...s, rooms }));
    });
  }, []);

  const createRoom = useCallback(
    (name: string, maxPlayers: 3 | 4, playerName: string) =>
      new Promise<{ success: boolean; roomId?: string; error?: string }>(resolve => {
        socketRef.current?.emit('create-room', { name, maxPlayers, playerName }, (result: { success: boolean; roomId?: string; error?: string }) => {
          if (result.success && result.roomId) {
            setState(s => ({ ...s, joinedRoomId: result.roomId!, mySeat: 0 }));
          }
          resolve(result);
        });
      }),
    []
  );

  const joinRoom = useCallback(
    (roomId: string, playerName: string) =>
      new Promise<{ success: boolean; seat?: number; error?: string }>(resolve => {
        socketRef.current?.emit('join-room', { roomId, playerName }, (result: { success: boolean; seat?: number; error?: string }) => {
          if (result.success) {
            setState(s => ({ ...s, joinedRoomId: roomId, mySeat: result.seat ?? null }));
          }
          resolve(result);
        });
      }),
    []
  );

  const startGame = useCallback(() => {
    socketRef.current?.emit('start-game');
  }, []);

  const discardTile = useCallback((tileId: string) => {
    socketRef.current?.emit('discard-tile', tileId);
  }, []);

  const claimAction = useCallback(
    (type: 'chi' | 'pon' | 'ron' | 'skip', chiTiles?: [string, string]) => {
      socketRef.current?.emit('claim', { type, chiTiles });
    },
    []
  );

  const declareTsumo = useCallback(() => {
    socketRef.current?.emit('declare-tsumo');
  }, []);

  const readyNext = useCallback(() => {
    socketRef.current?.emit('ready-next');
    setState(s => ({ ...s, roundResult: null }));
  }, []);

  const clearError = useCallback(() => {
    setState(s => ({ ...s, error: null }));
  }, []);

  return {
    state,
    getRooms,
    createRoom,
    joinRoom,
    startGame,
    discardTile,
    claimAction,
    declareTsumo,
    readyNext,
    clearError,
  };
}
