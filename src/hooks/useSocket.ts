// このファイルは Socket.IO クライアントの接続管理とイベントハンドリングを
// まとめた「カスタムフック」です。React の useState/useEffect/useRef/useCallback を組み合わせて、
// 「サーバーとの通信状態」と「操作する関数」を再利用しやすい形にしています。
import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
// `type` キーワード付きインポートは「型としてのみ使う」ことを明示。バンドルサイズを減らせる。
import type { GameView, RoomInfo, RoundResult, ChatMessage } from '../types/mahjong';

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
  myName: string | null;                                     // 自分のプレイヤー名（席の再計算に使う）
  error: string | null;                                      // エラーメッセージ
  reconnecting: boolean;                                     // リロード後の自動復帰を試行中か
  chatMessages: ChatMessage[];                               // 受信したチャット履歴
}

// --- セッション情報の永続化 ---
// リロードしても部屋に復帰できるよう、接続情報を localStorage に保存する。
// playerToken は「同じ人」だとサーバーに伝えるための ID（socket.id はリロードで変わるため）。
const SESSION_KEY = 'mahjong-session';

interface SavedSession {
  roomId: string;
  playerName: string;
  token: string;
}

// このブラウザ固有の playerToken を取得（無ければ生成して保存）。
function getPlayerToken(): string {
  const KEY = 'mahjong-token';
  let token = localStorage.getItem(KEY);
  if (!token) {
    // crypto.randomUUID が無い古い環境向けのフォールバックも用意。
    token =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `tk_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(KEY, token);
  }
  return token;
}

function saveSession(s: SavedSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

function loadSession(): SavedSession | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SavedSession;
  } catch {
    return null;
  }
}

function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
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
    myName: null,
    error: null,
    // 保存済みセッションがあれば、最初から「復帰中」として扱い初期画面をちらつかせない。
    reconnecting: loadSession() !== null,
    chatMessages: [],
  });

  // useEffect: 「初回マウント時に1回だけ実行したい処理」を書く。
  // 第2引数の [] が空配列 = 依存が無いので1回だけ実行 → 接続初期化に最適。
  useEffect(() => {
    // websocket を優先しつつ polling にフォールバック
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    // setState の引数に関数を渡すと「前の状態」を受け取れる。
    // 状態の一部だけ更新する時は `{ ...s, ... }` で展開してから上書きするのが定石。
    socket.on('connect', () => {
      setState(s => ({ ...s, connected: true, error: null }));
      // 接続できたら、保存済みセッションがあるか確認して自動復帰を試みる。
      // socket.id はリロードで変わるので、token で「同じ人」だとサーバーに伝える。
      const session = loadSession();
      if (session) {
        socket.emit(
          'rejoin',
          { roomId: session.roomId, playerName: session.playerName, token: session.token },
          (result: { success: boolean; seat?: number; error?: string }) => {
            if (result.success) {
              // 復帰成功。席と名前を復元（画面は gameView / roomInfo の到着で切り替わる）。
              setState(s => ({
                ...s,
                joinedRoomId: session.roomId,
                mySeat: result.seat ?? s.mySeat,
                myName: session.playerName,
                reconnecting: false,
              }));
            } else {
              // 部屋がもう無い等で復帰できないときは、保存情報を破棄してロビーへ。
              clearSession();
              setState(s => ({ ...s, reconnecting: false }));
            }
          }
        );
      } else {
        setState(s => ({ ...s, reconnecting: false }));
      }
    });
    socket.on('disconnect', () =>
      setState(s => ({ ...s, connected: false }))
    );
    socket.on('rooms', rooms =>
      setState(s => ({ ...s, rooms }))
    );
    socket.on('room-update', data =>
      // 待機室の情報を更新。あわせて、自分の名前から「今の自分の席」を計算し直す。
      // 誰かが抜けるとサーバー側で席が振り直されるため、保持していた mySeat がズレるのを防ぐ。
      setState(s => {
        const mine = s.myName
          ? data.players.find((p: { name: string; seat: number }) => p.name === s.myName)
          : undefined;
        return {
          ...s,
          roomInfo: data,
          mySeat: mine ? mine.seat : s.mySeat,
        };
      })
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
    socket.on('chat-message', (msg: ChatMessage) =>
      // 履歴に追記。増えすぎないよう直近100件だけ保持する。
      setState(s => ({ ...s, chatMessages: [...s.chatMessages, msg].slice(-100) }))
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
        const token = getPlayerToken();
        socketRef.current?.emit('create-room', { name, maxPlayers, playerName, password, token }, (result: { success: boolean; roomId?: string; error?: string }) => {
          if (result.success && result.roomId) {
            // リロード復帰用にセッションを保存する。
            saveSession({ roomId: result.roomId, playerName, token });
            setState(s => ({ ...s, joinedRoomId: result.roomId!, mySeat: 0, myName: playerName }));
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
        const token = getPlayerToken();
        socketRef.current?.emit('join-room', { roomId, playerName, password, token }, (result: { success: boolean; seat?: number; error?: string }) => {
          if (result.success) {
            saveSession({ roomId, playerName, token });
            setState(s => ({ ...s, joinedRoomId: roomId, mySeat: result.seat ?? null, myName: playerName }));
          }
          resolve(result);
        });
      }),
    []
  );

  /** 部屋を離れる（セッション破棄）。ロビーへ戻すときに使う。 */
  const leaveRoom = useCallback(() => {
    clearSession();
    socketRef.current?.emit('leave-room');
    setState(s => ({
      ...s,
      joinedRoomId: null,
      mySeat: null,
      myName: null,
      gameView: null,
      roundResult: null,
      roomInfo: null,
    }));
  }, []);

  /** ゲーム開始（ホストのみ意味がある） */
  const startGame = useCallback(() => {
    socketRef.current?.emit('start-game');
  }, []);

  /** 牌を捨てる */
  const discardTile = useCallback((tileId: string) => {
    socketRef.current?.emit('discard-tile', tileId);
  }, []);

  /** 鳴きを宣言（チー/ポン/カン/ロン/スキップ） */
  const claimAction = useCallback(
    (type: 'chi' | 'pon' | 'kan' | 'ron' | 'skip', chiTiles?: [string, string]) => {
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

  /** 暗槓（4枚のうち1枚のIDを指定） */
  const declareAnkan = useCallback((tileId: string) => {
    socketRef.current?.emit('declare-ankan', tileId);
  }, []);

  /** 加槓（ポンに足す1枚のIDを指定） */
  const declareKakan = useCallback((tileId: string) => {
    socketRef.current?.emit('declare-kakan', tileId);
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

  /** チャットを送信する */
  const sendChat = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    socketRef.current?.emit('chat-send', trimmed);
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
    leaveRoom,
    startGame,
    discardTile,
    claimAction,
    declareTsumo,
    declareRiichi,
    declareAnkan,
    declareKakan,
    declareKita,
    declareKyushuhai,
    readyNext,
    sendChat,
    clearError,
  };
}
