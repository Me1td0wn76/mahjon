// このファイルは「待機室画面」のコンポーネント。
// ルーム作成後、他のプレイヤーが揃うまで待機する画面を担当。
// 席0（=ホスト）の人だけ「ゲーム開始」ボタンが見える設計。
import React from 'react';
import './WaitingRoom.css';

// 1プレイヤー分の最小情報
interface Player {
  name: string;
  seat: number;
}

interface Props {
  roomName: string;
  maxPlayers: number;
  players: Player[];
  mySeat: number;                                            // 自分の席（ホスト判定に使う）
  onStartGame: () => void;
  onLeave?: () => void;                                      // 部屋を抜けてロビーへ戻る
}

// 席番号 → 風の漢字に対応する配列
const SEAT_WINDS = ['東', '南', '西', '北'];

export const WaitingRoom: React.FC<Props> = ({
  roomName,
  maxPlayers,
  players,
  mySeat,
  onStartGame,
  onLeave,
}) => {
  // 満席かどうかを計算
  const isFull = players.length >= maxPlayers;

  return (
    <div className="waiting-wrap">
      <div className="waiting-box">
        <h2 className="waiting-title">{roomName}</h2>
        <p className="waiting-subtitle">{maxPlayers}人麻雀 — プレイヤーを待っています</p>

        <div className="player-slots">
          {/* Array.from({length: N}) で長さNの空配列を作って map で席を描画 */}
          {Array.from({ length: maxPlayers }).map((_, i) => {
            // この席番号のプレイヤーが存在するか探す
            const player = players.find(p => p.seat === i);
            return (
              <div key={i} className={`player-slot ${player ? 'occupied' : 'empty'}`}>
                <span className="slot-wind">{SEAT_WINDS[i]}</span>
                {player ? (
                  <span className="slot-name">
                    {player.name}
                    {/* 自分の席なら「(あなた)」を付与 */}
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

        {/* === ホスト（席0）のみ表示するボタン === */}
        {mySeat === 0 && (
          <button
            className="btn-start"
            onClick={onStartGame}
            disabled={!isFull}
          >
            {isFull ? 'ゲーム開始！' : `あと${maxPlayers - players.length}人待っています`}
          </button>
        )}

        {/* ホスト以外には案内文を表示 */}
        {mySeat !== 0 && (
          <div className="waiting-host">部屋の作成者がゲームを開始するまでお待ちください</div>
        )}

        {/* 部屋を抜けてロビーに戻る */}
        {onLeave && (
          <button className="btn-leave" onClick={onLeave}>
            退室する
          </button>
        )}
      </div>
    </div>
  );
};
