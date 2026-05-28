// このファイルは「ロビー画面」のコンポーネント。
// ルームの作成タブと、既存ルームへの参加タブを切り替えて表示する。
// プライベートルーム（パスワード付き）にも対応。
import React, { useState, useEffect } from 'react';
import type { RoomInfo } from '../types/mahjong';
import './Lobby.css';

// 親コンポーネント（App.tsx）から渡される props の型
interface Props {
  rooms: RoomInfo[];                                                    // 表示するルーム一覧
  onGetRooms: () => void;                                               // ルーム再取得
  onCreateRoom: (name: string, maxPlayers: 3 | 4, playerName: string, password?: string) => void;
  onJoinRoom: (roomId: string, playerName: string, password?: string) => void;
  error: string | null;                                                 // サーバーエラーの表示
  connected: boolean;                                                   // 接続状態
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
  // パスワード関連 state
  const [createPassword, setCreatePassword] = useState('');
  // 参加時のパスワードを部屋ごとに保持する
  const [joinPasswords, setJoinPasswords] = useState<Record<string, string>>({});

  useEffect(() => {
    if (connected) onGetRooms();
  }, [connected]);

  const handleCreate = () => {
    if (!playerName.trim() || !roomName.trim()) return;
    onCreateRoom(
      roomName.trim(),
      maxPlayers,
      playerName.trim(),
      createPassword.trim() || undefined
    );
  };

  // 個別の部屋カードからパスワードを取り出して参加処理を呼ぶ
  const handleJoin = (room: RoomInfo) => {
    const pw = joinPasswords[room.id]?.trim();
    onJoinRoom(room.id, playerName.trim(), pw || undefined);
  };

  return (
    <div className="lobby-wrap">
      <div className="lobby">
        <h1 className="lobby-title"> 麻雀オンライン</h1>

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

            {/* パスワード入力（空ならパブリックルームとして作成） */}
            <div className="form-group">
              <label>パスワード（任意）</label>
              <input
                type="password"
                value={createPassword}
                onChange={e => setCreatePassword(e.target.value)}
                placeholder="空欄なら誰でも参加可能"
                maxLength={20}
                disabled={!connected}
              />
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
                      <span className="room-name">
                        {room.name}
                        {/* プライベートルームには鍵アイコンを表示 */}
                        {room.isPrivate && <span className="room-private"> 🔒</span>}
                      </span>
                      <span className="room-badge">{room.maxPlayers}人麻雀</span>
                      <span className="room-count">
                        {room.currentPlayers}/{room.maxPlayers}人
                      </span>
                    </div>
                    {/* プライベートルームの場合のみパスワード入力欄を表示 */}
                    {room.isPrivate && (
                      <input
                        type="password"
                        className="room-password-input"
                        placeholder="パスワード"
                        value={joinPasswords[room.id] ?? ''}
                        onChange={e =>
                          setJoinPasswords(s => ({ ...s, [room.id]: e.target.value }))
                        }
                        maxLength={20}
                      />
                    )}
                    <button
                      className="btn-join"
                      onClick={() => handleJoin(room)}
                      disabled={
                        !playerName.trim() ||
                        // プライベートルームでパスワード未入力なら押せない
                        (room.isPrivate && !joinPasswords[room.id]?.trim())
                      }
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
