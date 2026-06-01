// このファイルは対局画面の右下に表示するチャットUI。
// 折りたたみ可能なパネルで、メッセージ一覧と入力欄を持つ。
import React, { useState, useRef, useEffect } from 'react';
import type { ChatMessage } from '../types/mahjong';
import './Chat.css';

interface Props {
  messages: ChatMessage[];   // 表示するメッセージ履歴
  mySeat: number;            // 自分の席（自分の発言を右寄せ・色分けするため）
  onSend: (text: string) => void;
}

// 席番号ごとのアクセントカラー（GameBoard のアバター色と揃える）
const SEAT_COLORS = ['#c0556a', '#3f7cc0', '#4fa06a', '#b88a3a'];

export const Chat: React.FC<Props> = ({ messages, mySeat, onSend }) => {
  // パネルの開閉状態。初期は閉じておき、邪魔にならないようにする。
  const [open, setOpen] = useState(false);
  // 入力中のテキスト。
  const [text, setText] = useState('');
  // 未読件数（閉じている間に届いた数）。
  const [unread, setUnread] = useState(0);
  // メッセージ末尾へ自動スクロールするための参照。
  const endRef = useRef<HTMLDivElement | null>(null);
  // 直前のメッセージ件数を覚えておき、増分を未読として数える。
  const prevCountRef = useRef(messages.length);

  // メッセージが増えたとき: 開いていれば末尾へスクロール、閉じていれば未読を加算。
  useEffect(() => {
    const diff = messages.length - prevCountRef.current;
    prevCountRef.current = messages.length;
    if (diff <= 0) return;
    if (open) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else {
      setUnread(u => u + diff);
    }
  }, [messages.length, open]);

  // パネルを開いたら未読をリセットし、最新までスクロール。
  useEffect(() => {
    if (open) {
      setUnread(0);
      endRef.current?.scrollIntoView();
    }
  }, [open]);

  // 送信処理。空文字は送らない。
  const handleSend = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
  };

  // 閉じているときは、未読バッジ付きの起動ボタンだけ表示。
  if (!open) {
    return (
      <button className="chat-fab" onClick={() => setOpen(true)} aria-label="チャットを開く">
        💬
        {unread > 0 && <span className="chat-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>
    );
  }

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <span className="chat-title">チャット</span>
        <button className="chat-close" onClick={() => setOpen(false)} aria-label="閉じる">
          ×
        </button>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">まだメッセージはありません</div>
        )}
        {messages.map((m, i) => {
          const mine = m.seat === mySeat;
          return (
            <div key={`${m.ts}-${i}`} className={`chat-msg ${mine ? 'mine' : ''}`}>
              {!mine && (
                <span className="chat-msg-name" style={{ color: SEAT_COLORS[m.seat % 4] }}>
                  {m.name}
                </span>
              )}
              <span className="chat-msg-text">{m.text}</span>
            </div>
          );
        })}
        {/* スクロール先のアンカー */}
        <div ref={endRef} />
      </div>

      <div className="chat-input-row">
        <input
          className="chat-input"
          type="text"
          value={text}
          maxLength={200}
          placeholder="メッセージを入力..."
          onChange={e => setText(e.target.value)}
          // Enter で送信（IME変換中のEnterは無視する）。
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <button className="chat-send" onClick={handleSend} disabled={!text.trim()}>
          送信
        </button>
      </div>
    </div>
  );
};
