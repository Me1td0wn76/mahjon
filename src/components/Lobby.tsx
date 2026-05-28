// このファイルは「ロビー画面」のコンポーネント。
// ルームの作成タブと、既存ルームへの参加タブを切り替えて表示する。
import React, { useState, useEffect } from 'react';
import type { RoomInfo } from '../types/mahjong';
import './Lobby.css';

// 親コンポーネント（App.tsx）から渡される props の型
interface Props {
  rooms: RoomInfo[];                                                    // 表示するルーム一覧
  onGetRooms: () => void;                                               // ルーム再取得
  onCreateRoom: (name: string, maxPlayers: 3 | 4, playerName: string) => void;
  onJoinRoom: (roomId: string, playerName: string) => void;
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
  // 入力中のプレイヤー名・ルーム名・人数選択を useState で保持
  const [playerName, setPlayerName] = useState('');
  const [roomName, setRoomName] = useState('');
  // ジェネリクスでリテラル型を指定: 3 か 4 しか入らない
  const [maxPlayers, setMaxPlayers] = useState<3 | 4>(4);
  // 現在のタブ
  const [tab, setTab] = useState<'create' | 'join'>('create');

  // サーバーに接続できた瞬間にルーム一覧を取得する
  useEffect(() => {
    if (connected) onGetRooms();
  }, [connected]);

  // 「ルーム作成」ボタンが押された時の処理
  // trim() で前後の空白を除去し、必須項目が空ならキャンセル
  const handleCreate = () => {
    if (!playerName.trim() || !roomName.trim()) return;
    onCreateRoom(roomName.trim(), maxPlayers, playerName.trim());
  };

  return (
    <div className="lobby-wrap">
      <div className="lobby">
        <h1 className="lobby-title"> 麻雀オンライン</h1>

        {/* 接続状態の表示。テンプレート文字列でクラス名を動的に切り替え */}
        <div className={`lobby-status ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? '● サーバー接続中' : '● 接続中...'}
        </div>

        {/* プレイヤー名入力 */}
        <div className="form-group">
          <label>プレイヤー名</label>
          <input
            value={playerName}
            // onChange で値の変化を state に反映（制御コンポーネントの典型パターン）
            onChange={e => setPlayerName(e.target.value)}
            placeholder="名前を入力してください"
            maxLength={12}
            disabled={!connected}
          />
        </div>

        {/* エラーメッセージ（あるときだけ表示） */}
        {error && <div className="lobby-error">⚠ {error}</div>}

        {/* タブ切り替えボタン */}
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
              onGetRooms();                                  // 参加タブを開くたびに一覧を更新
            }}
          >
            ルーム参加
          </button>
        </div>

        {/* === 作成タブの内容 === */}
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
              // 接続中 & 名前/ルーム名が両方入力されているときだけ押せる
              disabled={!connected || !playerName.trim() || !roomName.trim()}
            >
              ルームを作成
            </button>
          </div>
        )}

        {/* === 参加タブの内容 === */}
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
                {/* 配列を map で繰り返し描画。key は React の差分計算用の必須属性 */}
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
