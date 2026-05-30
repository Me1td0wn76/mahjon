// このファイルは「局終了時に表示する結果モーダル」。
// 流局・ツモ・ロンの3パターンと、各プレイヤーのスコア変動を表示する。
import React from 'react';
import { type RoundResult, type PlayerView, WIND_LABEL } from '../types/mahjong';
import { TileComponent } from './TileComponent';
import './RoundResult.css';

interface Props {
  result: RoundResult;
  players: PlayerView[];
  mySeat: number;
  onReady: () => void;                                       // 「次の局へ」のコールバック
}

// 飜数の表示ラベル。役満（13の倍数）は「役満／ダブル役満…」と表記する。
function hanLabel(han: number): string {
  if (han >= 13 && han % 13 === 0) {
    const mult = han / 13;
    if (mult === 1) return '役満';
    if (mult === 2) return 'ダブル役満';
    if (mult === 3) return 'トリプル役満';
    return `${mult}倍役満`;
  }
  return `${han}飜`;
}

export const RoundResultModal: React.FC<Props> = ({ result, players, mySeat, onReady }) => {
  // 勝者の情報を取り出す。result.winner は席番号（undefined なら流局）。
  const winner = result.winner !== undefined ? players.find(p => p.seat === result.winner) : null;

  return (
    // overlay は背景を暗くするためのフルスクリーン要素、modal は中央のカード
    <div className="result-overlay">
      <div className="result-modal">
        {result.isDraw ? (
          // === 流局表示 ===
          <>
            <h2 className="result-title draw">
              {result.isKyushuhai ? '九種九牌' : '流局'}
            </h2>
            <p className="result-sub">
              {result.isKyushuhai ? '配牌時に么九牌が9種類以上' : '壁牌が尽きました'}
            </p>
          </>
        ) : (
          // === 和了表示 ===
          <>
            <h2 className={`result-title ${result.winType}`}>
              {result.winType === 'tsumo' ? 'ツモ和了！' : 'ロン！'}
            </h2>
            {winner && (
              <p className="result-winner">
                <span className={`wind-badge-inline wind-${winner.seatWind}`}>
                  {WIND_LABEL[winner.seatWind]}
                </span>
                {winner.name} の勝利
              </p>
            )}
            {result.winTile && (
              <div className="result-win-tile">
                <span className="win-tile-label">和了牌:</span>
                <TileComponent tile={result.winTile} />
              </div>
            )}
            {/* 手牌があれば全部並べる */}
            {result.handTiles && result.handTiles.length > 0 && (
              <div className="result-hand">
                <span className="result-hand-label">和了手牌:</span>
                <div className="result-tiles">
                  {result.handTiles.map((t, i) => (
                    <TileComponent key={i} tile={t} small />
                  ))}
                </div>
              </div>
            )}
            {/* 成立した役と合計飜数の表示 */}
            {result.yakuList && result.yakuList.length > 0 && (
              <div className="result-yaku">
                <h3 className="yaku-title">
                  役{' '}
                  <span className="yaku-total">
                    {hanLabel(result.totalHan ?? 0)}
                    {result.fu ? ` ${result.fu}符` : ''}
                  </span>
                </h3>
                <ul className="yaku-list">
                  {result.yakuList.map((y, i) => (
                    <li key={i} className="yaku-item">
                      <span className="yaku-name">{y.name}</span>
                      <span className="yaku-han">{hanLabel(y.han)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* ドラ・裏ドラ表示牌（裏ドラはリーチ和了時のみサーバーから届く） */}
            {((result.doraIndicators && result.doraIndicators.length > 0) ||
              (result.uraDoraIndicators && result.uraDoraIndicators.length > 0)) && (
              <div className="result-dora">
                {result.doraIndicators && result.doraIndicators.length > 0 && (
                  <div className="result-dora-row">
                    <span className="result-dora-label">ドラ表示:</span>
                    <div className="result-tiles">
                      {result.doraIndicators.map((t, i) => (
                        <TileComponent key={i} tile={t} small />
                      ))}
                    </div>
                  </div>
                )}
                {result.uraDoraIndicators && result.uraDoraIndicators.length > 0 && (
                  <div className="result-dora-row">
                    <span className="result-dora-label">裏ドラ表示:</span>
                    <div className="result-tiles">
                      {result.uraDoraIndicators.map((t, i) => (
                        <TileComponent key={i} tile={t} small />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* === スコア変動テーブル === */}
        <div className="score-table">
          <h3 className="score-title">スコア変動</h3>
          {players.map(p => {
            // `??` で undefined の時のデフォルト値を指定
            const delta = result.scoreDelta[p.seat] ?? 0;
            const newScore = result.newScores[p.seat] ?? p.score;
            const isMe = p.seat === mySeat;
            return (
              <div key={p.seat} className={`score-row ${isMe ? 'score-me' : ''}`}>
                <span className="score-name">
                  {p.name}
                  {isMe && ' (あなた)'}
                </span>
                <span
                  // 増減で色（クラス）を切り替え
                  className={`score-delta ${delta > 0 ? 'plus' : delta < 0 ? 'minus' : 'zero'}`}
                >
                  {/* toLocaleString() で 25000 → "25,000" のようにカンマ区切り表示 */}
                  {delta > 0 ? `+${delta.toLocaleString()}` : delta.toLocaleString()}
                </span>
                <span className="score-new">{newScore.toLocaleString()}</span>
              </div>
            );
          })}
        </div>

        {/* 全員がこのボタンを押すと次の局に進む */}
        <button className="btn-ready" onClick={onReady}>
          次の局へ
        </button>
      </div>
    </div>
  );
};
