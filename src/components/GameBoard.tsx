import React, { useState, useCallback } from 'react';
import {
  type GameView,
  type PlayerView,
  type Tile,
  type Meld,
  type Wind,
  getTileName,
  canTsumoCheck,
  WIND_LABEL,
} from '../types/mahjong';
import { TileComponent } from './TileComponent';
import './GameBoard.css';

/* ── helpers ───────────────────────────────────────────────────────────── */

type Position = 'self' | 'shimocha' | 'toimen' | 'kamicha';

const POSITION_LABEL: Record<Position, string> = {
  self: '自家',
  shimocha: '下家',
  toimen: '対面',
  kamicha: '上家',
};

const AVATAR_COLORS = ['#c0556a', '#3f7cc0', '#4fa06a', '#b88a3a'];

function startingScore(playerCount: number): number {
  return playerCount === 3 ? 35000 : 25000;
}

/* ── face-down opponent hand (wall of tile backs) ──────────────────────── */

const FaceDownWall: React.FC<{ count: number; orientation: 'h' | 'v' }> = ({
  count,
  orientation,
}) => (
  <div className={`wall wall-${orientation}`}>
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="wall-tile" />
    ))}
  </div>
);

/* ── river (discard pile) ──────────────────────────────────────────────── */

const River: React.FC<{
  tiles: Tile[];
  orientation: 'h' | 'v';
  lastSeat?: boolean;
}> = ({ tiles, orientation, lastSeat }) => (
  <div className={`river river-${orientation}`}>
    {tiles.map((t, i) => (
      <TileComponent
        key={t.id}
        tile={t}
        small
        selected={lastSeat && i === tiles.length - 1}
      />
    ))}
  </div>
);

/* ── melds ─────────────────────────────────────────────────────────────── */

const MeldRow: React.FC<{ melds: Meld[] }> = ({ melds }) => {
  if (!melds.length) return null;
  return (
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
};

/* ── player info panel (avatar + rank + position + name) ───────────────── */

const PlayerPanel: React.FC<{
  player: PlayerView;
  position: Position;
  rank: number;
  delta: number;
  active: boolean;
  color: string;
}> = ({ player, position, rank, delta, active, color }) => (
  <div className={`player-panel pos-${position} ${active ? 'active' : ''}`}>
    <div className="avatar" style={{ background: color }}>
      {player.name.slice(0, 1)}
    </div>
    <div className="panel-info">
      <div className="panel-rank">
        {rank}位 <span className="panel-delta">({delta >= 0 ? '+' : ''}{delta / 1000 | 0})</span>
      </div>
      <div className="panel-pos">{POSITION_LABEL[position]}</div>
      <div className="panel-name">
        {player.name}
        {player.isDealer && <span className="dealer-tag">親</span>}
      </div>
    </div>
  </div>
);

/* ── center scoreboard ─────────────────────────────────────────────────── */

const ScoreCell: React.FC<{ wind: Wind; score: number; active: boolean }> = ({
  wind,
  score,
  active,
}) => (
  <div className={`score-cell ${active ? 'active' : ''}`}>
    <span className={`wind-mark wind-${wind}`}>{WIND_LABEL[wind]}</span>
    <span className="score-val">{score.toLocaleString()}</span>
  </div>
);

/* ── main GameBoard ─────────────────────────────────────────────────────── */

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

  const pc = players.length;
  const me = players.find(p => p.seat === mySeat)!;

  // Relative seat positions (turn order goes seat+1, seat+2, ...)
  const rightSeat = (mySeat + 1) % pc; // 下家
  const topSeat = pc === 4 ? (mySeat + 2) % pc : -1; // 対面
  const leftSeat = (mySeat + (pc - 1)) % pc; // 上家

  const rightPlayer = players.find(p => p.seat === rightSeat);
  const topPlayer = topSeat >= 0 ? players.find(p => p.seat === topSeat) : null;
  const leftPlayer = players.find(p => p.seat === leftSeat);

  // Ranking & point delta
  const start = startingScore(pc);
  const ranking = [...players].sort((a, b) => b.score - a.score).map(p => p.seat);
  const rankOf = (seat: number) => ranking.indexOf(seat) + 1;
  const deltaOf = (seat: number) => (players.find(p => p.seat === seat)!.score - start);

  const isMyTurn = currentTurn === mySeat && phase === 'discard';
  const isClaiming = phase === 'claiming' && !!availableClaims?.length;
  const canTsumo = isMyTurn && canTsumoCheck(myHand, me?.melds ?? []);

  // Detect freshly drawn tile (separate it visually on my turn)
  const drawnSeparated = isMyTurn && myHand.length % 3 === 2;

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

  const renderOpponentArea = (
    player: PlayerView | null | undefined,
    position: Position,
    wallOrient: 'h' | 'v'
  ) => {
    if (!player) return null;
    return (
      <div className={`opp-area opp-${position}`}>
        <FaceDownWall count={player.handCount} orientation={wallOrient} />
        <MeldRow melds={player.melds} />
      </div>
    );
  };

  return (
    <div className={`game-board players-${pc}`}>
      {/* ── top-left HUD: round + dora ── */}
      <div className="hud">
        <div className="hud-dora">
          <span className="hud-dora-label">ドラ表示牌</span>
          <div className="hud-dora-tiles">
            {doraIndicators.map((t, i) => (
              <TileComponent key={i} tile={t} small />
            ))}
          </div>
        </div>
        <div className="hud-round">
          <span className="round-text">
            {WIND_LABEL[round]}{roundNumber}局
          </span>
          {honbaCount > 0 && <span className="honba-text">{honbaCount}本場</span>}
        </div>
      </div>

      {/* ── player panels (corners) ── */}
      {leftPlayer && (
        <PlayerPanel
          player={leftPlayer}
          position="kamicha"
          rank={rankOf(leftPlayer.seat)}
          delta={deltaOf(leftPlayer.seat)}
          active={currentTurn === leftPlayer.seat}
          color={AVATAR_COLORS[leftPlayer.seat % 4]}
        />
      )}
      {topPlayer && (
        <PlayerPanel
          player={topPlayer}
          position="toimen"
          rank={rankOf(topPlayer.seat)}
          delta={deltaOf(topPlayer.seat)}
          active={currentTurn === topPlayer.seat}
          color={AVATAR_COLORS[topPlayer.seat % 4]}
        />
      )}
      {rightPlayer && (
        <PlayerPanel
          player={rightPlayer}
          position="shimocha"
          rank={rankOf(rightPlayer.seat)}
          delta={deltaOf(rightPlayer.seat)}
          active={currentTurn === rightPlayer.seat}
          color={AVATAR_COLORS[rightPlayer.seat % 4]}
        />
      )}
      {me && (
        <PlayerPanel
          player={me}
          position="self"
          rank={rankOf(me.seat)}
          delta={deltaOf(me.seat)}
          active={isMyTurn}
          color={AVATAR_COLORS[me.seat % 4]}
        />
      )}

      {/* ── table ── */}
      <div className="table">
        {/* opponent hands at edges */}
        <div className="edge edge-top">
          {renderOpponentArea(topPlayer, 'toimen', 'h')}
        </div>
        <div className="edge edge-left">
          {renderOpponentArea(leftPlayer, 'kamicha', 'v')}
        </div>
        <div className="edge edge-right">
          {renderOpponentArea(rightPlayer, 'shimocha', 'v')}
        </div>

        {/* center: rivers around scoreboard */}
        <div className="center">
          {topPlayer && (
            <div className="river-slot slot-top">
              <River
                tiles={topPlayer.discards}
                orientation="h"
                lastSeat={lastDiscard?.seat === topPlayer.seat}
              />
            </div>
          )}
          {leftPlayer && (
            <div className="river-slot slot-left">
              <River
                tiles={leftPlayer.discards}
                orientation="v"
                lastSeat={lastDiscard?.seat === leftPlayer.seat}
              />
            </div>
          )}

          <div className="scoreboard">
            {topPlayer && (
              <div className="sb-slot sb-top">
                <ScoreCell
                  wind={topPlayer.seatWind}
                  score={topPlayer.score}
                  active={currentTurn === topPlayer.seat}
                />
              </div>
            )}
            {leftPlayer && (
              <div className="sb-slot sb-left">
                <ScoreCell
                  wind={leftPlayer.seatWind}
                  score={leftPlayer.score}
                  active={currentTurn === leftPlayer.seat}
                />
              </div>
            )}
            <div className="sb-center">
              <span className="sb-wall-label">残り</span>
              <span className="sb-wall-num">{wallCount}</span>
            </div>
            {rightPlayer && (
              <div className="sb-slot sb-right">
                <ScoreCell
                  wind={rightPlayer.seatWind}
                  score={rightPlayer.score}
                  active={currentTurn === rightPlayer.seat}
                />
              </div>
            )}
            <div className="sb-slot sb-bottom">
              <ScoreCell wind={me.seatWind} score={me.score} active={isMyTurn} />
            </div>
          </div>

          {rightPlayer && (
            <div className="river-slot slot-right">
              <River
                tiles={rightPlayer.discards}
                orientation="v"
                lastSeat={lastDiscard?.seat === rightPlayer.seat}
              />
            </div>
          )}
          <div className="river-slot slot-bottom">
            <River
              tiles={me.discards}
              orientation="h"
              lastSeat={lastDiscard?.seat === mySeat}
            />
          </div>
        </div>
      </div>

      {/* ── my area: melds + hand + actions ── */}
      <div className="my-area">
        <MeldRow melds={me?.melds ?? []} />

        <div className="my-hand">
          {myHand.map((tile, i) => (
            <React.Fragment key={tile.id}>
              {drawnSeparated && i === myHand.length - 1 && <span className="hand-gap" />}
              <TileComponent
                tile={tile}
                selected={selectedId === tile.id}
                onClick={isMyTurn ? () => handleTileClick(tile.id) : undefined}
              />
            </React.Fragment>
          ))}
        </div>

        {/* action panel */}
        <div className="action-panel">
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

          {isClaiming && showChiSelect && chiCombinations && lastDiscard && (
            <div className="chi-selector">
              <p className="chi-label">チーの組み合わせを選択</p>
              {chiCombinations.map(([id1, id2]) => {
                const t1 = myHand.find(t => t.id === id1);
                const t2 = myHand.find(t => t.id === id2);
                if (!t1 || !t2) return null;
                const seq = [t1, t2, lastDiscard.tile].sort((a, b) => a.value - b.value);
                return (
                  <button
                    key={`${id1}-${id2}`}
                    className="chi-combo-btn"
                    onClick={() => handleChiSelect([id1, id2])}
                  >
                    {seq.map((t, i) => (
                      <TileComponent key={i} tile={t} small />
                    ))}
                  </button>
                );
              })}
              <button
                className="btn-action skip"
                onClick={() => {
                  setShowChiSelect(false);
                  onClaim('skip');
                }}
              >
                キャンセル
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
