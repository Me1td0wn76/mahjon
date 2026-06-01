// このファイルは画面全体のルーティング（画面遷移）を管理する React コンポーネント。
// 「ロビー → 待機室 → ゲーム画面」の3つの画面を状態に応じて切り替える。
import { useSocket } from "./hooks/useSocket";
import { Lobby } from "./components/Lobby";
import { WaitingRoom } from "./components/WaitingRoom";
import { GameBoard } from "./components/GameBoard";
import { Chat } from "./components/Chat";
import { RoundResultModal } from "./components/RoundResult";
import { previewGameView } from "./components/boardPreviewData";
import "./App.css";

// 現在の画面状態。これも Union 型で「3つのうちのどれか」しか入らない。
type Screen = "lobby" | "waiting" | "game";

// 開発時にレイアウト確認するための特殊モード。URLに ?preview を付けるとモック描画する。
// `typeof window !== "undefined"` は SSR（サーバー側描画）で window が無い時用のガード。
const isPreview =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("preview");

// `export default` でこのコンポーネントが「このモジュールの主役」となる。
// `App` はトップレベルの関数コンポーネント。返り値が JSX（画面の見た目）。
export default function App() {
  if (isPreview) {
    // モックデータでゲーム画面だけ描画。onXxx は何もしない空関数。
    return (
      <div className="app">
        <GameBoard
          gameView={previewGameView}
          onDiscard={() => {}}
          onClaim={() => {}}
          onTsumo={() => {}}
        />
      </div>
    );
  }
  return <Game />;
}

/**
 * 通信状態とゲーム状態を保持して、画面を切り替える本体コンポーネント。
 */
function Game() {
  // カスタムフック useSocket から、状態と操作関数をまとめて取得（分割代入）。
  const {
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
  } = useSocket();

  // 表示する画面は「状態から計算するだけ」にする（派生値）。
  // 以前はレンダリング中に setScreen を呼んでいたが、再接続の途中で
  // gameView だけ先に届き joinedRoomId がまだ null、という瞬間に
  // 「game にする」「lobby に戻す」が交互に発火して無限再レンダリング
  // （React error #301）になっていた。状態から一意に導出すれば起きない。
  //   - gameView があればゲーム画面（再接続で対局中に復帰した場合も含む）
  //   - 部屋に居れば待機室
  //   - どちらでもなければロビー
  const screen: Screen = state.gameView
    ? "game"
    : state.joinedRoomId
      ? "waiting"
      : "lobby";

  // リロード直後の自動復帰中はローディングを出して、ロビー画面のちらつきを防ぐ。
  if (state.reconnecting) {
    return (
      <div className="app">
        <div className="reconnecting-screen">
          <div className="reconnecting-spinner" />
          <p>対局に復帰しています...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {/* 条件付きレンダリング: && の左が true の時だけ右をレンダリング */}
      {screen === "lobby" && (
        <Lobby
          rooms={state.rooms}
          onGetRooms={getRooms}
          // ボタン押下時の処理。エラーをクリアしてからAPI呼び出し。
          onCreateRoom={async (name, maxPlayers, playerName, password) => {
            clearError();
            await createRoom(name, maxPlayers, playerName, password);
          }}
          onJoinRoom={async (roomId, playerName, password) => {
            clearError();
            await joinRoom(roomId, playerName, password);
          }}
          error={state.error}
          connected={state.connected}
        />
      )}

      {screen === "waiting" && state.roomInfo && (
        <WaitingRoom
          roomName={state.roomInfo.roomName}
          maxPlayers={state.roomInfo.maxPlayers}
          players={state.roomInfo.players}
          // `??` は左が null/undefined なら右の値（フォールバック）
          mySeat={state.mySeat ?? 0}
          onStartGame={startGame}
          onLeave={leaveRoom}
        />
      )}

      {screen === "game" && state.gameView && (
        // <> ... </> は React.Fragment の短縮構文。複数要素を1つにまとめるための入れ物。
        <>
          <GameBoard
            gameView={state.gameView}
            onDiscard={discardTile}
            onClaim={claimAction}
            onTsumo={declareTsumo}
            onRiichi={declareRiichi}
            onAnkan={declareAnkan}
            onKakan={declareKakan}
            onKita={declareKita}
            onKyushuhai={declareKyushuhai}
            onLeave={leaveRoom}
          />
          {/* 局終了時のモーダル（あるときだけ表示） */}
          {state.roundResult && (
            <RoundResultModal
              result={state.roundResult}
              players={state.gameView.players}
              mySeat={state.gameView.mySeat}
              onReady={readyNext}
            />
          )}
          {/* 右下の対局中チャット */}
          <Chat
            messages={state.chatMessages}
            mySeat={state.gameView.mySeat}
            onSend={sendChat}
          />
        </>
      )}

      {/* 接続が切れたときに上から被せるバナー */}
      {!state.connected && screen !== "lobby" && (
        <div className="disconnected-banner">
          サーバーとの接続が切れました...
        </div>
      )}
    </div>
  );
}
