import React, { useState, useEffect } from 'react';
import { RoomInfo } from '../types/mahjong';
import './Lobby.css';

interface Props {
  rooms: RoomInfo[];
  onGetRooms: () => void;
  onCreateRoom: (name: string, maxPlayers: 3 | 4, playerName: string) => void;
  onJoinRoom: (roomId: string, playerName: string) => void;
  error: string | null;
  connected: boolean;
}

export const Lobby: React.FC<Props> = ({
  rooms,
  onGetRooms,
  onCreateRoom,
  onJoinRoom,
  error,
  connected,
}) => {
  const [playerName, setPlayerName] = useState('');
  const [roomName, setRoomName] = useState('');
  const [maxPlayers, setMaxPlayers] = useState<3 | 4>(4);
  const [tab, setTab] = useState<'create' | 'join'>('create');

  useEffect(() => {
    if (connected) onGetRooms();
  }, [connected]);

  const handleCreate = () => {
    if (!playerName.trim() || !roomName.trim()) return;
    onCreateRoom(roomName.trim(), maxPlayers, playerName.trim());
  };

  return (
    <div className="lobby-wrap">
      <div className="lobby">
        <h1 className="lobby-title">🀄 麻雀オンライン</h1>

        <div className={`lobby-status ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? '● サーバー接続中' : '● 接続中...'}
        </div>

        <div className="form-group">
          <label>プレイヤー名</label>
          <input
            value={playerName}
            onChange={e => setPlayerName(e.target.value)}
            placeholder="名前を入力してください"
            maxLength={12}
            disabled={!connected}
          />
        </div>

        {error && <div className="lobby-error">⚠ {error}</div>}

        <div className="tabs">
          <button
            className={tab === 'create' ? 'tab active' : 'tab'}
            onClick={() => setTab('create')}
          >
            ルーム作成
          </button>
          <button
            className={tab === 'join' ? 'tab active' : 'tab'}
            onClick={() => {
              setTab('join');
              onGetRooms();
            }}
          >
            ルーム参加
          </button>
        </div>

        {tab === 'create' && (
          <div className="tab-content">
            <div className="form-group">
              <label>ルーム名</label>
              <input
                value={roomName}
                onChange={e => setRoomName(e.target.value)}
                placeholder="ルーム名"
                maxLength={20}
                disabled={!connected}
              />
            </div>

            <div className="form-group">
              <label>人数</label>
              <div className="mode-select">
                <button
                  className={maxPlayers === 4 ? 'mode-btn active' : 'mode-btn'}
                  onClick={() => setMaxPlayers(4)}
                >
                  4人麻雀
                </button>
                <button
                  className={maxPlayers === 3 ? 'mode-btn active' : 'mode-btn'}
                  onClick={() => setMaxPlayers(3)}
                >
                  3人麻雀（三麻）
                </button>
              </div>
            </div>

            <button
              className="btn-primary"
              onClick={handleCreate}
              disabled={!connected || !playerName.trim() || !roomName.trim()}
            >
              ルームを作成
            </button>
          </div>
        )}

        {tab === 'join' && (
          <div className="tab-content">
            <div className="rooms-header">
              <span className="rooms-label">待機中のルーム</span>
              <button className="btn-refresh" onClick={onGetRooms}>
                ↻ 更新
              </button>
            </div>

            {rooms.length === 0 ? (
              <div className="no-rooms">待機中のルームがありません</div>
            ) : (
              <div className="rooms-list">
                {rooms.map(room => (
                  <div key={room.id} className="room-card">
                    <div className="room-meta">
                      <span className="room-name">{room.name}</span>
                      <span className="room-badge">{room.maxPlayers}人麻雀</span>
                      <span className="room-count">
                        {room.currentPlayers}/{room.maxPlayers}人
                      </span>
                    </div>
                    <button
                      className="btn-join"
                      onClick={() => onJoinRoom(room.id, playerName.trim())}
                      disabled={!playerName.trim()}
                    >
                      参加
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
