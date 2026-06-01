// このファイルはサーバーのエントリーポイント。
// 新規イベント（リーチ・北抜き・九種九牌）と、パスワード付きルームに対応。
// import でほかのファイルやライブラリの機能を読み込む。
// `import express from ...` のように名前を付けると、そのライブラリの「既定の機能」をその名前で使える。
import express from 'express';
// `import type { ... }` は「型（=データの形の定義）だけ」を読み込む書き方。
// 型は実行時には存在せず TypeScript のチェック専用なので、type を付けると
// コンパイル後の JS から消え、無駄な読み込みを避けられる。
import type { CorsOptions } from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
// `import { a, b }` は、そのファイルが公開している複数の機能を名前を指定して取り出す書き方。
// ここではゲームのルーム管理ロジックを別ファイル（roomManager）に分け、index.ts は
// 「通信の受け口」に専念させている（役割を分けると見通しが良くなるため）。
import {
  setEmitFn,
  getRoomList,
  createRoom,
  joinRoom,
  rejoinRoom,
  leaveRoom,
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
  handleChat,
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

// 環境変数の文字列を「配列」に変換する処理。メソッドを数珠つなぎ（メソッドチェーン）にしている。
// process.env.ALLOWED_ORIGINS は未設定だと undefined になり得るので、
// `?? ''`（null合体演算子）で「undefined/null なら空文字を使う」と保証してから処理する。
// .split(',')      → カンマ区切りの文字列を配列に分割
// .map(s => s.trim()) → 各要素の前後の空白を除去（"a, b" のような空白入りに対応するため）
// .filter(Boolean) → 空文字など「偽」と評価される要素を取り除く（末尾カンマ等での空要素対策）
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// 三項演算子 `条件 ? A : B` で許可リストを決める。
// 環境変数で1件でも指定されていればそれを使い、無ければ開発用のローカルホストを使う。
// こうすると「本番では環境変数で明示、開発では設定不要」を両立できる。
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

// express() で Web サーバー本体（アプリ）を作る。
const app = express();
// app.use(...) は「すべてのリクエストが通る共通処理（ミドルウェア）」を登録する。
// 登録した順に上から実行されるので、CORS チェック→JSON 解析、の順になる。
// 全エンドポイントに allowlist 方式の CORS を適用
app.use(cors(corsOptions));
// 受け取ったリクエストの body が JSON のとき、自動で JS オブジェクトに変換してくれる。
app.use(express.json());

// 死活監視（ヘルスチェック）用のエンドポイント。
// 外部の監視サービスやデプロイ先が「サーバーが生きているか」を確認するために使う。
// 第1引数の `_req` は使わない引数。先頭に `_` を付けて「意図的に未使用」と示す慣習。
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Socket.IO は素の HTTP サーバーの上で動くため、express アプリを包んだ
// HTTP サーバーを別途作り、これを Socket.IO と共有する。
const httpServer = createServer(app);

// Socket.IO サーバーを作る。`<ClientToServerEvents, ServerToClientEvents>` は
// ジェネリクス（型引数）で、「クライアント→サーバー」「サーバー→クライアント」で
// やり取りできるイベント名と引数の型をあらかじめ指定するもの。
// こうしておくと、存在しないイベント名やまちがった引数を書いたときに
// コンパイル時点で気づける（実行して初めてバグる、を防げる）。
// Socket.IO にも同じ allowlist を適用
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: effectiveOrigins,
    methods: ['GET', 'POST'],
    credentials: false,
  },
});

// roomManager 側のロジックから「特定プレイヤーへメッセージを送る手段」が必要になる。
// だが roomManager に Socket.IO 本体を持たせると依存関係が複雑になるので、
// 「送信する関数」だけを外から注入する（依存性の注入）。これで roomManager は
// 通信の実装を知らずに済み、テストや差し替えがしやすくなる。
setEmitFn((socketId, event, ...args) => {
  // io.to(socketId) で「その1人だけ」に宛先を絞り、emit でイベントを送る。
  // `...args` は残余引数で、イベントごとに数の違う引数をまとめて受け取り、そのまま渡す。
  // event の型は厳密だが emit 側の型と噛み合わないため、ここだけ any で型チェックを回避している。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  io.to(socketId).emit(event as any, ...args);
});

// 'connection' は「新しいクライアントが接続してきた」ときに発火するイベント。
// 引数の socket は、その接続1本を表すオブジェクト。socket.id で接続ごとに一意な ID が取れる。
// 以降の socket.on(...) は、すべて「この接続が送ってくるイベント」の受け口の登録。
io.on('connection', socket => {
  console.log(`[+] Connected: ${socket.id}`);

  // socket.on('イベント名', コールバック) で、クライアントからの特定イベントを待ち受ける。
  // 第2引数が callback の場合、クライアント側へ結果を返すための関数（acknowledgement）。
  // ここでは現在のルーム一覧を取得して、そのまま呼び出し元へ返している。
  socket.on('get-rooms', callback => {
    callback(getRoomList());
  });

  // ルーム作成。data に作成に必要な情報、callback で成否を返す。
  socket.on('create-room', (data, callback) => {
    const result = createRoom(
      socket.id,
      data.playerName,
      data.name,
      data.maxPlayers,
      data.password,
      data.token
    );
    // 作成に成功し roomId が確定したときだけ、後続の入室・通知を行う。
    // （&& は左が真のときだけ右を評価するので、roomId が無いのに使ってしまう事故を防げる）
    if (result.success && result.roomId) {
      // socket.join(roomId) で、この接続を「ルーム」というグループに入れる。
      // 以降 io.to(roomId).emit(...) で、そのグループの全員へ一斉送信できる。
      socket.join(result.roomId);
      // 同じルームの全員に「メンバーが変わったよ」と最新状態を配信する。
      io.to(result.roomId).emit('room-update', {
        players: getRoomPlayers(socket.id),
        maxPlayers: data.maxPlayers,
        roomName: data.name,
      });
    }
    // 成功でも失敗でも、結果は必ずクライアントへ返す。
    callback(result);
  });

  // 既存ルームへの入室。パスワード付きルームにも対応するため password を受け取る。
  socket.on('join-room', (data, callback) => {
    const result = joinRoom(socket.id, data.playerName, data.roomId, data.password, data.token);
    if (result.success) {
      socket.join(data.roomId);
      // 通知には maxPlayers などルームの情報が必要なので、ルーム本体を取り直す。
      const room = getRoomBySocketId(socket.id);
      // room が見つからない可能性（型上は undefined になり得る）があるため、
      // if で存在を確認してから中身にアクセスする。これで実行時エラーを防ぐ。
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

  // リロード後の再接続。token で本人を特定して席へ戻し、現在の状態を送り直す。
  socket.on('rejoin', (data, callback) => {
    const result = rejoinRoom(socket.id, data.roomId, data.playerName, data.token);
    if (result.success) {
      socket.join(data.roomId);
      const room = getRoomBySocketId(socket.id);
      if (room?.game) {
        // 対局中: 復帰した本人に現在の盤面を送る。
        const view = room.game.getViewForPlayer(socket.id);
        if (view) io.to(socket.id).emit('game-update', view);
      } else if (room) {
        // 待機中: ルーム情報を送る。
        io.to(data.roomId).emit('room-update', {
          players: getRoomPlayers(socket.id),
          maxPlayers: room.maxPlayers,
          roomName: room.name,
        });
      }
    }
    callback({ success: result.success, seat: result.seat, error: result.error });
  });

  // 明示的に部屋を抜ける。
  socket.on('leave-room', () => {
    const room = getRoomBySocketId(socket.id);
    leaveRoom(socket.id);
    if (room) socket.leave(room.id);
  });

  // ゲーム開始要求。startGame は開始できたかを真偽値で返す。
  socket.on('start-game', () => {
    const ok = startGame(socket.id);
    // 開始できなかったとき（人数不足など）だけ、本人にエラーを通知する。
    if (!ok) socket.emit('error', 'ゲームを開始できません（全員が揃ってから開始してください）');
  });

  // ここから下は麻雀の各操作。受け取った内容を roomManager の対応する関数へ橋渡しするだけ。
  // index.ts は「通信の受け口」、実際のゲーム処理は roomManager、と責務を分けている。
  // 牌を捨てる。どの牌かは tileId で受け取る。
  socket.on('discard-tile', tileId => {
    handleDiscard(socket.id, tileId);
  });

  // ポン・チー・カン・ロンなど他家の捨て牌に対する宣言（鳴き）。内容は claim に入る。
  socket.on('claim', claim => {
    handleClaim(socket.id, claim);
  });

  // ツモ和了の宣言。
  socket.on('declare-tsumo', () => {
    handleTsumo(socket.id);
  });

  // リーチ宣言。同時に捨てる牌（tileId）も受け取る。
  socket.on('declare-riichi', tileId => {
    handleRiichi(socket.id, tileId);
  });

  // 暗カン（自分の手牌だけで作るカン）。対象の牌を tileId で受け取る。
  socket.on('declare-ankan', tileId => {
    handleAnkan(socket.id, tileId);
  });

  // 加カン（既存のポンに同じ牌を足すカン）。
  socket.on('declare-kakan', tileId => {
    handleKakan(socket.id, tileId);
  });

  // 北抜き（三人麻雀などで北を抜く操作）。
  socket.on('declare-kita', () => {
    handleKita(socket.id);
  });

  // 九種九牌（配牌時の特殊な流局宣言）。
  socket.on('declare-kyushuhai', () => {
    handleKyushuhai(socket.id);
  });

  // 局の結果表示後、「次へ進む準備ができた」の合図。全員揃ったら次局へ進む。
  socket.on('ready-next', () => {
    handleReadyNext(socket.id);
  });

  // チャット送信。本人の部屋の全員へ配信される。
  socket.on('chat-send', text => {
    handleChat(socket.id, text);
  });

  // 切断時（ブラウザを閉じた・回線が切れた等）に自動で発火する特別なイベント。
  // 抜けた人の後始末（ルームからの除去など）を roomManager に任せる。
  socket.on('disconnect', () => {
    console.log(`[-] Disconnected: ${socket.id}`);
    handleDisconnect(socket.id);
  });
});

// 待ち受けポート番号を決める。環境変数 PORT があればそれを、無ければ 3001 を使う。
// 環境変数は文字列で渡ってくるので、Number(...) で数値に変換している（listen は数値を期待するため）。
const PORT = Number(process.env.PORT ?? 3001);
// 指定ポートで接続を待ち始める。起動完了後に第2引数のコールバックが1回呼ばれる。
httpServer.listen(PORT, () => {
  console.log(`Mahjong server running on http://localhost:${PORT}`);
});
