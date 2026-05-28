// このファイルは麻雀の「対局画面」を描画する大きめのコンポーネント。
// 自分・上家・対面・下家のそれぞれを画面の上下左右に配置し、
// 中央のスコアボード、各人の捨て牌（河）、自分の手牌、アクションボタンを表示する。
//
// 重要なポイント:
//   - 「席番号(seat)」は絶対位置（東=0, 南=1, ...）。
//   - 一方「下家/対面/上家」は自分から見た相対位置で、ここで計算する。
//   - GameBoard は表示と入力受付に専念し、ゲームロジックはサーバーに任せる。
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

// 自分から見た相対位置の型。
// self=自分、shimocha=下家(右)、toimen=対面(上)、kamicha=上家(左)
type Position = 'self' | 'shimocha' | 'toimen' | 'kamicha';

// 位置 → 表示用ラベルのマッピング
const POSITION_LABEL: Record<Position, string> = {
  self: '自家',
  shimocha: '下家',
  toimen: '対面',
  kamicha: '上家',
};

// プレイヤーアバターの背景色（席番号で選ぶ）
const AVATAR_COLORS = ['#c0556a', '#3f7cc0', '#4fa06a', '#b88a3a'];

// プレイヤー数に応じた持ち点の起点（点差表示用）
function startingScore(playerCount: number): number {
  return playerCount === 3 ? 35000 : 25000;
}

/* ── face-down opponent hand (wall of tile backs) ──────────────────────── */

// 相手の手牌（裏向き）を、横向き(h) か 縦向き(v) で並べる小コンポーネント
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

// プレイヤーの「河（捨て牌の列）」を描画する
// lastSeat が true のときは最後の捨て牌をハイライト表示
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

// 鳴いた面子の表示行。melds が空なら何も描かない。
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

// プレイヤー情報パネル（顔・順位・点差・席風・名前）
const PlayerPanel: React.FC<{
  player: PlayerView;
  position: Position;
  rank: number;
  delta: number;
  active: boolean;                                           // この席が現在の手番か
  color: string;
}> = ({ player, position, rank, delta, active, color }) => (
  <div className={`player-panel pos-${position} ${active ? 'active' : ''}`}>
    <div className="avatar" style={{ background: color }}>
      {player.name.slice(0, 1)}
    </div>
    <div className="panel-info">
      <div className="panel-rank">
        {/* delta/1000 |0 は「1000で割って小数切捨て」。ビット演算子 |0 は Math.floor の高速版 */}
        {rank}位 <span className="panel-delta">({delta >= 0 ? '+' : ''}{delta / 1000 | 0})</span>
      </div>
      <div className="panel-pos">{POSITION_LABEL[position]}</div>
      <div className="panel-name">
        {player.name}
        {player.isDealer && <span className="dealer-tag">親</span>}
        {/* リーチ中バッジ */}
        {player.isRiichi && <span className="riichi-tag">立直</span>}
        {/* 三麻の北抜き枚数表示 */}
        {player.kitaCount > 0 && (
          <span className="kita-tag">北×{player.kitaCount}</span>
        )}
      </div>
    </div>
  </div>
);

/* ── center scoreboard ─────────────────────────────────────────────────── */

// 中央スコアボードの1セル（風＋点数）
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

// GameBoard 本体の props。親(App)から状態と操作関数を受け取る。
interface Props {
  gameView: GameView;
  onDiscard: (tileId: string) => void;
  onClaim: (type: 'chi' | 'pon' | 'ron' | 'skip', chiTiles?: [string, string]) => void;
  onTsumo: () => void;
  // 以下は省略可能（preview モードでも使えるように）
  onRiichi?: (tileId: string) => void;
  onKita?: () => void;
  onKyushuhai?: () => void;
}

export const GameBoard: React.FC<Props> = ({
  gameView,
  onDiscard,
  onClaim,
  onTsumo,
  onRiichi,
  onKita,
  onKyushuhai,
}) => {
  // 牌のクリック1回目で「選択中」にし、2回目で確定して捨てる。
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // チーの組み合わせが2つ以上ある時、選択UIを出す
  const [showChiSelect, setShowChiSelect] = useState(false);
  // リーチ宣言モード（true の時、牌クリックでリーチ＋打牌になる）
  const [riichiMode, setRiichiMode] = useState(false);

  // gameView の中身を分割代入で取り出す
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
    riichiSticks,
    canRiichi,
    canKita,
    canKyushuhai,
  } = gameView;

  const pc = players.length;
  // 自分のプレイヤー情報。`!` は「絶対 undefined ではない」と教えるアサーション
  const me = players.find(p => p.seat === mySeat)!;

  // 自分の席を基準に、相対位置の席番号を計算する
  // 手番の進行順は seat+1, seat+2, ... なので
  const rightSeat = (mySeat + 1) % pc;                       // 下家（次の手番の人）
  const topSeat = pc === 4 ? (mySeat + 2) % pc : -1;         // 対面（3人麻雀では存在しない）
  const leftSeat = (mySeat + (pc - 1)) % pc;                 // 上家（前の手番の人）

  // 各位置のプレイヤー情報。topSeat=-1 のときは null。
  const rightPlayer = players.find(p => p.seat === rightSeat);
  const topPlayer = topSeat >= 0 ? players.find(p => p.seat === topSeat) : null;
  const leftPlayer = players.find(p => p.seat === leftSeat);

  // 順位と起点との点差を計算
  const start = startingScore(pc);
  // 点数の多い順に並べて、席番号の配列を作る
  const ranking = [...players].sort((a, b) => b.score - a.score).map(p => p.seat);
  // 席 → 順位（1始まり）
  const rankOf = (seat: number) => ranking.indexOf(seat) + 1;
  // 席 → 持ち点と初期点の差
  const deltaOf = (seat: number) => (players.find(p => p.seat === seat)!.score - start);

  // よく使う判定をまとめておく
  const isMyTurn = currentTurn === mySeat && phase === 'discard';
  // claiming フェーズ中で、自分に鳴ける選択肢がある時だけアクション欄を表示
  const isClaiming = phase === 'claiming' && !!availableClaims?.length;
  // ツモ可能か（クライアント側の簡易判定。最終判定はサーバー）
  const canTsumo = isMyTurn && canTsumoCheck(myHand, me?.melds ?? []);

  // 手牌が「面子の倍数+2」（=ツモった直後の14枚）の時、最後の1枚を見やすく離す
  const drawnSeparated = isMyTurn && myHand.length % 3 === 2;

  // 牌をクリックした時の処理。1回目で選択、2回目で打牌確定。
  // リーチモード中ならクリックでリーチ宣言＋その牌の打牌。
  const handleTileClick = useCallback(
    (tileId: string) => {
      if (!isMyTurn) return;
      if (riichiMode && onRiichi) {
        // リーチモード時は確認なしでその牌を選んでリーチ宣言（1クリック）
        onRiichi(tileId);
        setRiichiMode(false);
        setSelectedId(null);
        return;
      }
      if (selectedId === tileId) {
        onDiscard(tileId);                                   // 2回目 → 捨てる
        setSelectedId(null);
      } else {
        setSelectedId(tileId);                               // 1回目 → 選択中
      }
    },
    [isMyTurn, selectedId, onDiscard, riichiMode, onRiichi]
  );

  // チーの組み合わせを選んだ後の処理
  const handleChiSelect = (chiTiles: [string, string]) => {
    setShowChiSelect(false);
    onClaim('chi', chiTiles);
  };

  // 相手プレイヤーの描画ヘルパ（裏向き手牌＋鳴いた面子）
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
      {/* ── 画面左上のHUD: 局表示 + ドラ表示牌 ── */}
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
          {/* 場に出ているリーチ棒の本数（供託） */}
          {riichiSticks > 0 && (
            <span className="riichi-sticks">供託 {riichiSticks}本</span>
          )}
        </div>
      </div>

      {/* ── プレイヤーパネル（画面の四隅に配置） ── */}
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

      {/* ── 卓全体（テーブル）の描画 ── */}
      <div className="table">
        {/* 卓の縁(edge)に対戦相手の手牌(裏向き)＋鳴いた面子を配置 */}
        <div className="edge edge-top">
          {renderOpponentArea(topPlayer, 'toimen', 'h')}
        </div>
        <div className="edge edge-left">
          {renderOpponentArea(leftPlayer, 'kamicha', 'v')}
        </div>
        <div className="edge edge-right">
          {renderOpponentArea(rightPlayer, 'shimocha', 'v')}
        </div>

        {/* 卓の中央: 河（捨て牌）とスコアボード */}
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

          {/* スコアボード（4方向の風と点数＋残り山牌数） */}
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

      {/* ── 画面下部: 自分の鳴き面子・手牌・アクション ── */}
      <div className="my-area">
        <MeldRow melds={me?.melds ?? []} />

        <div className="my-hand">
          {myHand.map((tile, i) => (
            // React.Fragment は <></> と同じ。key を持たせたい時にこの長い形を使う。
            <React.Fragment key={tile.id}>
              {/* ツモ牌だけ少し離して見せる視覚的工夫 */}
              {drawnSeparated && i === myHand.length - 1 && <span className="hand-gap" />}
              <TileComponent
                tile={tile}
                selected={selectedId === tile.id}
                // 自分の番じゃない時は onClick を渡さない＝クリック不可
                onClick={isMyTurn ? () => handleTileClick(tile.id) : undefined}
              />
            </React.Fragment>
          ))}
        </div>

        {/* ── アクションパネル: 状況に応じてボタンを切り替える ── */}
        <div className="action-panel">
          {isMyTurn && (
            <div className="action-row">
              {selectedId && !riichiMode && (
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
              {/* リーチボタン: テンパイ & 門前 & 残り山4枚以上のとき表示 */}
              {canRiichi && onRiichi && !riichiMode && (
                <button
                  className="btn-action riichi"
                  onClick={() => setRiichiMode(true)}
                >
                  リーチ
                </button>
              )}
              {/* リーチモード中の案内 + キャンセル */}
              {riichiMode && (
                <>
                  <span className="action-hint">捨てる牌をクリックでリーチ宣言</span>
                  <button
                    className="btn-action skip"
                    onClick={() => setRiichiMode(false)}
                  >
                    キャンセル
                  </button>
                </>
              )}
              {/* 三麻の北抜きボタン */}
              {canKita && onKita && !riichiMode && (
                <button className="btn-action kita" onClick={onKita}>
                  北抜き
                </button>
              )}
              {/* 九種九牌の流局宣言 */}
              {canKyushuhai && onKyushuhai && !riichiMode && (
                <button className="btn-action kyushu" onClick={onKyushuhai}>
                  九種九牌
                </button>
              )}
              {!selectedId && !canTsumo && !riichiMode && (
                <span className="action-hint">捨てる牌をクリック（2回目で決定）</span>
              )}
            </div>
          )}

          {/* 鳴きフェーズで自分に選択肢がある時のボタン群 */}
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
                    // チーの組み合わせが1通りなら即確定、複数あれば選択UIへ
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

          {/* チーの組み合わせ選択UI（候補が複数ある場合のみ） */}
          {isClaiming && showChiSelect && chiCombinations && lastDiscard && (
            <div className="chi-selector">
              <p className="chi-label">チーの組み合わせを選択</p>
              {chiCombinations.map(([id1, id2]) => {
                const t1 = myHand.find(t => t.id === id1);
                const t2 = myHand.find(t => t.id === id2);
                if (!t1 || !t2) return null;
                // 表示用に小さい順に並べる
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
