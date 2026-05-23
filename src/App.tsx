import { useState } from "react";
import { useSocket } from "./hooks/useSocket";
import { Lobby } from "./components/Lobby";
import { WaitingRoom } from "./components/WaitingRoom";
import { GameBoard } from "./components/GameBoard";
import { RoundResultModal } from "./components/RoundResult";
import { previewGameView } from "./components/boardPreviewData";
import "./App.css";

type Screen = "lobby" | "waiting" | "game";

// Dev-only: `?preview` renders the board with mock data (no live game needed).
const isPreview =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("preview");

export default function App() {
  if (isPreview) {
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

function Game() {
  const {
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
  } = useSocket();

  const [screen, setScreen] = useState<Screen>("lobby");

  if (state.joinedRoomId && screen === "lobby") setScreen("waiting");
  if (state.gameView && screen === "waiting") setScreen("game");

  return (
    <div className="app">
      {screen === "lobby" && (
        <Lobby
          rooms={state.rooms}
          onGetRooms={getRooms}
          onCreateRoom={async (name, maxPlayers, playerName) => {
            clearError();
            await createRoom(name, maxPlayers, playerName);
          }}
          onJoinRoom={async (roomId, playerName) => {
            clearError();
            await joinRoom(roomId, playerName);
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
          mySeat={state.mySeat ?? 0}
          onStartGame={startGame}
        />
      )}

      {screen === "game" && state.gameView && (
        <>
          <GameBoard
            gameView={state.gameView}
            onDiscard={discardTile}
            onClaim={claimAction}
            onTsumo={declareTsumo}
          />
          {state.roundResult && (
            <RoundResultModal
              result={state.roundResult}
              players={state.gameView.players}
              mySeat={state.gameView.mySeat}
              onReady={readyNext}
            />
          )}
        </>
      )}

      {!state.connected && screen !== "lobby" && (
        <div className="disconnected-banner">
          サーバーとの接続が切れました...
        </div>
      )}
    </div>
  );
}
