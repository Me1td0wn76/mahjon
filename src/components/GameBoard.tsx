import React, { useState, useCallback } from 'react';
import { type GameView, type PlayerView, type Tile, type Meld, getTileName, canTsumoCheck, WIND_LABEL } from '../types/mahjong';
import { TileComponent } from './TileComponent';
import './GameBoard.css';

/* ── tiny sub-components ───────────────────────────────────────────────── */

const DiscardPile: React.FC<{
  tiles: Tile[];
  highlight?: boolean;
  horizontal?: boolean;
}> = ({ tiles, highlight, horizontal }) => (
  <div className={`discard-pile ${horizontal ? 'discard-h' : 'discard-v'}`}>
    {tiles.map((t, i) => (
      <TileComponent
        key={t.id}
        tile={t}
        small
        dimmed={highlight && i < tiles.length - 1}
      />
    ))}
  </div>
);

const MeldRow: React.FC<{ melds: Meld[] }> = ({ melds }) => (
  <div className="meld-row">
    {melds.map((meld, i) => (
      <div key={i} className="meld-group">
        {meld.tiles.map(t => (
          <TileComponent key={t.id} tile={t} small />
        ))}
      </div>
    ))}
  </div>
);

const OpponentPlayer: React.FC<{
  player: PlayerView;
  isCurrentTurn: boolean;
  position: 'top' | 'left' | 'right';
  lastDiscardSeat?: number;
}> = ({ player, isCurrentTurn, position, lastDiscardSeat }) => {
  const windLabel = WIND_LABEL[player.seatWind];
  const faceDownCount = player.handCount;

  return (
    <div className={`opponent opponent-${position} ${isCurrentTurn ? 'active-turn' : ''}`}>
      <div className="opponent-header">
        <span className={`wind-badge wind-${player.seatWind}`}>{windLabel}</span>
        <span className="opp-name">{player.name}</span>
        {player.isDealer && <span className="dealer-badge">親</span>}
        <span className="opp-score">{player.score.toLocaleString()}</span>
        {isCurrentTurn && <span className="turn-indicator">▶</span>}
      </div>

      <div className="opp-hand-row">
        {Array.from({ length: faceDownCount }).map((_, i) => (
          <TileComponent key={i} tile={{ id: '', suit: 'man', value: 1 }} faceDown small />
        ))}
      </div>

      <MeldRow melds={player.melds} />

      <DiscardPile
        tiles={player.discards}
        highlight={lastDiscardSeat === player.seat}
        horizontal
      />
    </div>
  );
};

/* ── ChiSelector ─────────────────────────────────────────────────────── */
const ChiSelector: React.FC<{
  combos: [string, string][];
  myHand: Tile[];
  discardTile: Tile;
  onSelect: (chiTiles: [string, string]) => void;
  onCancel: () => void;
}> = ({ combos, myHand, discardTile, onSelect, onCancel }) => (
  <div className="chi-selector">
    <p className="chi-label">チーの組み合わせを選択</p>
    {combos.map(([id1, id2]) => {
      const t1 = myHand.find(t => t.id === id1);
      const t2 = myHand.find(t => t.id === id2);
      if (!t1 || !t2) return null;
      const seq = [t1, t2, discardTile].sort((a, b) => a.value - b.value);
      return (
        <button
          key={`${id1}-${id2}`}
          className="chi-combo-btn"
          onClick={() => onSelect([id1, id2])}
        >
          {seq.map((t, i) => (
            <TileComponent key={i} tile={t} small />
          ))}
        </button>
      );
    })}
    <button className="btn-action skip" onClick={onCancel}>
      キャンセル
    </button>
  </div>
);

/* ── main GameBoard ─────────────────────────────────────────────────── */

interface Props {
  gameView: GameView;
  onDiscard: (tileId: string) => void;
  onClaim: (type: 'chi' | 'pon' | 'ron' | 'skip', chiTiles?: [string, string]) => void;
  onTsumo: () => void;
}

export const GameBoard: React.FC<Props> = ({ gameView, onDiscard, onClaim, onTsumo }) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showChiSelect, setShowChiSelect] = useState(false);

  const {
    phase,
    currentTurn,
    mySeat,
    myHand,
    players,
    wallCount,
    doraIndicators,
    lastDiscard,
    round,
    roundNumber,
    honbaCount,
    availableClaims,
    chiCombinations,
  } = gameView;

  const me = players.find(p => p.seat === mySeat)!;
  const pc = players.length;

  // Relative positions
  const leftSeat = (mySeat + 1) % pc;
  const topSeat = pc >= 4 ? (mySeat + 2) % pc : -1;
  const rightSeat = pc >= 4 ? (mySeat + 3) % pc : (mySeat + 2) % pc;

  const leftPlayer = players.find(p => p.seat === leftSeat);
  const topPlayer = topSeat >= 0 ? players.find(p => p.seat === topSeat) : null;
  const rightPlayer = players.find(p => p.seat === rightSeat);

  const isMyTurn = currentTurn === mySeat && phase === 'discard';
  const isClaiming = phase === 'claiming' && !!availableClaims?.length;
  const canTsumo = isMyTurn && canTsumoCheck(myHand, me?.melds ?? []);

  const handleTileClick = useCallback(
    (tileId: string) => {
      if (!isMyTurn) return;
      if (selectedId === tileId) {
        onDiscard(tileId);
        setSelectedId(null);
      } else {
        setSelectedId(tileId);
      }
    },
    [isMyTurn, selectedId, onDiscard]
  );

  const handleChiSelect = (chiTiles: [string, string]) => {
    setShowChiSelect(false);
    onClaim('chi', chiTiles);
  };

  return (
    <div className="game-board">
      {/* ── Header ── */}
      <header className="board-header">
        <div className="header-info">
          <span className="round-label">
            {WIND_LABEL[round]}{roundNumber}局
          </span>
          {honbaCount > 0 && <span className="honba">{honbaCount}本場</span>}
        </div>
        <div className="header-dora">
          <span className="dora-label">ドラ</span>
          {doraIndicators.map((t, i) => (
            <TileComponent key={i} tile={t} small />
          ))}
        </div>
        <div className="header-wall">
          <span className="wall-count">残り {wallCount}</span>
        </div>
      </header>

      {/* ── Table ── */}
      <div className={`table-area players-${pc}`}>
        {/* Top opponent (4-player) */}
        {topPlayer && (
          <div className="area-top">
            <OpponentPlayer
              player={topPlayer}
              isCurrentTurn={currentTurn === topPlayer.seat}
              position="top"
              lastDiscardSeat={lastDiscard?.seat}
            />
          </div>
        )}

        {/* Left opponent */}
        <div className="area-left">
          {leftPlayer && (
            <OpponentPlayer
              player={leftPlayer}
              isCurrentTurn={currentTurn === leftPlayer.seat}
              position="left"
              lastDiscardSeat={lastDiscard?.seat}
            />
          )}
        </div>

        {/* Center */}
        <div className="area-center">
          <div className="center-content">
            {lastDiscard && (
              <div className="last-discard-area">
                <span className="last-discard-label">
                  {players.find(p => p.seat === lastDiscard.seat)?.name}の捨て牌
                </span>
                <TileComponent tile={lastDiscard.tile} />
              </div>
            )}
            <div className="center-wall">
              <span>🀫</span>
              <span className="wall-num">{wallCount}</span>
            </div>
          </div>
        </div>

        {/* Right opponent */}
        <div className="area-right">
          {rightPlayer && (
            <OpponentPlayer
              player={rightPlayer}
              isCurrentTurn={currentTurn === rightPlayer.seat}
              position="right"
              lastDiscardSeat={lastDiscard?.seat}
            />
          )}
        </div>
      </div>

      {/* ── My area ── */}
      <div className="my-area">
        {/* My discards */}
        <div className="my-discards">
          <MeldRow melds={me?.melds ?? []} />
          <DiscardPile
            tiles={me?.discards ?? []}
            highlight={lastDiscard?.seat === mySeat}
            horizontal
          />
        </div>

        {/* My info bar */}
        <div className="my-info-bar">
          <span className={`wind-badge wind-${me?.seatWind}`}>
            {me ? WIND_LABEL[me.seatWind] : ''}
          </span>
          <span className="my-name">{me?.name}</span>
          {me?.isDealer && <span className="dealer-badge">親</span>}
          <span className="my-score">{me?.score.toLocaleString()}</span>
          {isMyTurn && <span className="my-turn-label">あなたの番です</span>}
        </div>

        {/* My hand */}
        <div className="my-hand">
          {myHand.map(tile => (
            <TileComponent
              key={tile.id}
              tile={tile}
              selected={selectedId === tile.id}
              onClick={isMyTurn ? () => handleTileClick(tile.id) : undefined}
            />
          ))}
        </div>

        {/* Action panel */}
        <div className="action-panel">
          {/* Discard turn actions */}
          {isMyTurn && (
            <div className="action-row">
              {selectedId && (
                <button
                  className="btn-action discard"
                  onClick={() => {
                    onDiscard(selectedId);
                    setSelectedId(null);
                  }}
                >
                  {getTileName(myHand.find(t => t.id === selectedId)!)} を捨てる
                </button>
              )}
              {canTsumo && (
                <button className="btn-action tsumo" onClick={onTsumo}>
                  ツモ和了！
                </button>
              )}
              {!selectedId && !canTsumo && (
                <span className="action-hint">捨てる牌をクリック（2回目で決定）</span>
              )}
            </div>
          )}

          {/* Claim window */}
          {isClaiming && !showChiSelect && (
            <div className="action-row claim-row">
              <span className="claim-label">アクションを選択:</span>
              {availableClaims?.includes('ron') && (
                <button className="btn-action ron" onClick={() => onClaim('ron')}>
                  ロン！
                </button>
              )}
              {availableClaims?.includes('pon') && (
                <button className="btn-action pon" onClick={() => onClaim('pon')}>
                  ポン
                </button>
              )}
              {availableClaims?.includes('chi') && (
                <button
                  className="btn-action chi"
                  onClick={() =>
                    chiCombinations && chiCombinations.length === 1
                      ? handleChiSelect(chiCombinations[0])
                      : setShowChiSelect(true)
                  }
                >
                  チー
                </button>
              )}
              <button className="btn-action skip" onClick={() => onClaim('skip')}>
                スキップ
              </button>
            </div>
          )}

          {/* Chi combination selector */}
          {isClaiming && showChiSelect && chiCombinations && lastDiscard && (
            <ChiSelector
              combos={chiCombinations}
              myHand={myHand}
              discardTile={lastDiscard.tile}
              onSelect={handleChiSelect}
              onCancel={() => {
                setShowChiSelect(false);
                onClaim('skip');
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};
