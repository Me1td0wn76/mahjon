// このファイルは Socket.IO クライアントの接続管理とイベントハンドリングを
// まとめた「カスタムフック」です。React の useState/useEffect/useRef/useCallback を組み合わせて、
// 「サーバーとの通信状態」と「操作する関数」を再利用しやすい形にしています。
import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
// `type` キーワード付きインポートは「型としてのみ使う」ことを明示。バンドルサイズを減らせる。
import type { GameView, RoomInfo, RoundResult } from '../types/mahjong';

// Vite の環境変数。`VITE_` 接頭辞付きの変数だけがクライアントに公開される。
// 設定が無ければデフォルトで localhost:3001 に接続。
const SOCKET_URL = (import.meta as { env: Record<string, string> }).env.VITE_SOCKET_URL ?? 'http://localhost:3001';

/**
 * フックの公開する状態の型。
 * UI で必要な情報を1つのオブジェクトにまとめる。
 */
export interface SocketState {
  connected: boolean;                                        // サーバー接続中か
  rooms: RoomInfo[];                                         // ロビーで取得した部屋一覧
  gameView: GameView | null;                                 // ゲーム中の自分視点ビュー
  roundResult: RoundResult | null;                           // 局終了時の結果
  roomInfo: {                                                // 待機室の情報
    players: { name: string; seat: number }[];
    maxPlayers: number;
    roomName: string;
  } | null;
  joinedRoomId: string | null;                               // 入っているルームID
  mySeat: number | null;                                     // 自分の席番号
  error: string | null;                                      // エラーメッセージ
}

/**
 * useSocket フック本体。
 * 接続管理と各イベントの送受信処理をひとまとめにする。
 * このフックを呼ぶと「状態」と「サーバーへ操作を送る関数群」が返ってくる。
 */
export function useSocket() {
  // useRef は「描画を引き起こさない変数」を作る。socket インスタンスのように
  // レンダリング間で持ち越したいオブジェクトを置くのに向いている。
  const socketRef = useRef<Socket | null>(null);

  // useState で React に「再レンダーが必要な状態」を保持。
  // ジェネリクス <SocketState> で型を明示している。
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

  // useEffect: 「初回マウント時に1回だけ実行したい処理」を書く。
  // 第2引数の [] が空配列 = 依存が無いので1回だけ実行 → 接続初期化に最適。
  useEffect(() => {
    // websocket を優先しつつ polling にフォールバック
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    // setState の引数に関数を渡すと「前の状態」を受け取れる。
    // 状態の一部だけ更新する時は `{ ...s, ... }` で展開してから上書きするのが定石。
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
      // ゲーム開始時は前回の局結果をクリア
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

    // クリーンアップ関数: コンポーネントがアンマウントされたら接続を切る
    return () => {
      socket.disconnect();
    };
  }, []);

  // useCallback: 関数を「依存が変わるまで使い回す」ためのフック。
  // 子コンポーネントに渡したときの不要な再レンダリングを防ぐ目的がある。

  /** 現在のルーム一覧を取得 */
  const getRooms = useCallback(() => {
    // emit の第2引数（最後）にコールバックを渡すと、サーバーから ack で結果を受け取れる
    socketRef.current?.emit('get-rooms', (rooms: RoomInfo[]) => {
      setState(s => ({ ...s, rooms }));
    });
  }, []);

  /** ルームを新規作成。password を渡すとプライベートルームになる。 */
  const createRoom = useCallback(
    (name: string, maxPlayers: 3 | 4, playerName: string, password?: string) =>
      new Promise<{ success: boolean; roomId?: string; error?: string }>(resolve => {
        socketRef.current?.emit('create-room', { name, maxPlayers, playerName, password }, (result: { success: boolean; roomId?: string; error?: string }) => {
          if (result.success && result.roomId) {
            setState(s => ({ ...s, joinedRoomId: result.roomId!, mySeat: 0 }));
          }
          resolve(result);
        });
      }),
    []
  );

  /** 既存ルームに参加。プライベートルームなら password が必須。 */
  const joinRoom = useCallback(
    (roomId: string, playerName: string, password?: string) =>
      new Promise<{ success: boolean; seat?: number; error?: string }>(resolve => {
        socketRef.current?.emit('join-room', { roomId, playerName, password }, (result: { success: boolean; seat?: number; error?: string }) => {
          if (result.success) {
            setState(s => ({ ...s, joinedRoomId: roomId, mySeat: result.seat ?? null }));
          }
          resolve(result);
        });
      }),
    []
  );

  /** ゲーム開始（ホストのみ意味がある） */
  const startGame = useCallback(() => {
    socketRef.current?.emit('start-game');
  }, []);

  /** 牌を捨てる */
  const discardTile = useCallback((tileId: string) => {
    socketRef.current?.emit('discard-tile', tileId);
  }, []);

  /** 鳴きを宣言（チー/ポン/ロン/スキップ） */
  const claimAction = useCallback(
    (type: 'chi' | 'pon' | 'ron' | 'skip', chiTiles?: [string, string]) => {
      socketRef.current?.emit('claim', { type, chiTiles });
    },
    []
  );

  /** ツモを宣言 */
  const declareTsumo = useCallback(() => {
    socketRef.current?.emit('declare-tsumo');
  }, []);

  /** リーチ宣言（同時に捨てる牌を指定） */
  const declareRiichi = useCallback((tileId: string) => {
    socketRef.current?.emit('declare-riichi', tileId);
  }, []);

  /** 北抜き（三麻専用） */
  const declareKita = useCallback(() => {
    socketRef.current?.emit('declare-kita');
  }, []);

  /** 九種九牌で流局宣言 */
  const declareKyushuhai = useCallback(() => {
    socketRef.current?.emit('declare-kyushuhai');
  }, []);

  /** 局終了後「次の局へ」 */
  const readyNext = useCallback(() => {
    socketRef.current?.emit('ready-next');
    // モーダルを閉じるためにローカルでもクリア
    setState(s => ({ ...s, roundResult: null }));
  }, []);

  /** エラーメッセージを消す */
  const clearError = useCallback(() => {
    setState(s => ({ ...s, error: null }));
  }, []);

  // フックの戻り値。state（読み取り用）と関数群（操作用）をまとめる慣習。
  return {
    state,
    getRooms,
    createRoom,
    joinRoom,
    startGame,
    discardTile,
    claimAction,
    declareTsumo,
    declareRiichi,
    declareKita,
    declareKyushuhai,
    readyNext,
    clearError,
  };
}
