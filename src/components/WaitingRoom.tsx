import React from 'react';
import './WaitingRoom.css';

interface Player {
  name: string;
  seat: number;
}

interface Props {
  roomName: string;
  maxPlayers: number;
  players: Player[];
  mySeat: number;
  onStartGame: () => void;
}

const SEAT_WINDS = ['東', '南', '西', '北'];

export const WaitingRoom: React.FC<Props> = ({
  roomName,
  maxPlayers,
  players,
  mySeat,
  onStartGame,
}) => {
  const isFull = players.length >= maxPlayers;

  return (
    <div className="waiting-wrap">
      <div className="waiting-box">
        <h2 className="waiting-title">🀄 {roomName}</h2>
        <p className="waiting-subtitle">{maxPlayers}人麻雀 — プレイヤーを待っています</p>

        <div className="player-slots">
          {Array.from({ length: maxPlayers }).map((_, i) => {
            const player = players.find(p => p.seat === i);
            return (
              <div key={i} className={`player-slot ${player ? 'occupied' : 'empty'}`}>
                <span className="slot-wind">{SEAT_WINDS[i]}</span>
                {player ? (
                  <span className="slot-name">
                    {player.name}
                    {player.seat === mySeat && <span className="me-tag"> (あなた)</span>}
                  </span>
                ) : (
                  <span className="slot-waiting">待機中...</span>
                )}
              </div>
            );
          })}
        </div>

        <div className="waiting-info">
          {isFull ? (
            <span className="ready-text">全員揃いました！ゲームを開始できます</span>
          ) : (
            <span className="waiting-count">
              {players.length} / {maxPlayers} 人参加済み
            </span>
          )}
        </div>

        {mySeat === 0 && (
          <button
            className="btn-start"
            onClick={onStartGame}
            disabled={players.length < 2}
          >
            {players.length < 2 ? '最低2名必要です' : 'ゲーム開始！'}
          </button>
        )}

        {mySeat !== 0 && (
          <div className="waiting-host">部屋の作成者がゲームを開始するまでお待ちください</div>
        )}
      </div>
    </div>
  );
};
