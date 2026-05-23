import React from 'react';
import { type RoundResult, type PlayerView, WIND_LABEL } from '../types/mahjong';
import { TileComponent } from './TileComponent';
import './RoundResult.css';

interface Props {
  result: RoundResult;
  players: PlayerView[];
  mySeat: number;
  onReady: () => void;
}

export const RoundResultModal: React.FC<Props> = ({ result, players, mySeat, onReady }) => {
  const winner = result.winner !== undefined ? players.find(p => p.seat === result.winner) : null;

  return (
    <div className="result-overlay">
      <div className="result-modal">
        {result.isDraw ? (
          <>
            <h2 className="result-title draw">流局</h2>
            <p className="result-sub">壁牌が尽きました</p>
          </>
        ) : (
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
          </>
        )}

        <div className="score-table">
          <h3 className="score-title">スコア変動</h3>
          {players.map(p => {
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
                  className={`score-delta ${delta > 0 ? 'plus' : delta < 0 ? 'minus' : 'zero'}`}
                >
                  {delta > 0 ? `+${delta.toLocaleString()}` : delta.toLocaleString()}
                </span>
                <span className="score-new">{newScore.toLocaleString()}</span>
              </div>
            );
          })}
        </div>

        <button className="btn-ready" onClick={onReady}>
          次の局へ
        </button>
      </div>
    </div>
  );
};
