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
  getWaitingTiles,
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
// rotate は牌の回転角（度）。本物の麻雀卓のように各家の河を内側へ向けるために使う。
//   0=自家（そのまま）, 180=対面（上下反転）, -90=上家（左）, 90=下家（右）
// 90/-90 のときは牌を横倒しにするので、外側の span を横長サイズにして重なりを防ぐ。
const River: React.FC<{
  tiles: Tile[];
  orientation: 'h' | 'v';
  rotate?: 0 | 90 | -90 | 180;
  lastSeat?: boolean;
  accent?: string;
}> = ({ tiles, orientation, rotate = 0, lastSeat, accent }) => (
  <div
    className={`river river-${orientation}${rotate ? ` river-rot${rotate}` : ''}`}
    // プレイヤーごとの色マットにして「誰の河か」を一目で分かるようにする
    style={accent ? { boxShadow: `inset 0 0 0 2px ${accent}88` } : undefined}
  >
    {tiles.map((t, i) => (
      // 回転は内側の牌に掛け、外側の span はレイアウト用の枠として使う。
      // （CSS の transform はレイアウト上の大きさを変えないため、枠で場所を確保する）
      <span className="river-tile" key={t.id}>
        <TileComponent
          tile={t}
          small
          highlight={lastSeat && i === tiles.length - 1}
        />
      </span>
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

/* ── wait helper (beginner aid: shows winning tiles on hover) ──────────── */

// Bootstrap Icons の question-circle（https://icons.getbootstrap.jp/icons/question-circle/）
const QuestionCircleIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="18"
    height="18"
    fill="currentColor"
    viewBox="0 0 16 16"
    aria-hidden="true"
  >
    <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16" />
    <path d="M5.255 5.786a.237.237 0 0 0 .241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.755 2.286zm1.557 5.763c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94z" />
  </svg>
);

// 待ち牌（アガリ牌）をホバーで表示する初心者向けヘルパー。
// 待ちが無いときは状況に応じた案内文（note）を表示する。
const WaitHelp: React.FC<{ waits: Tile[]; note: string }> = ({ waits, note }) => (
  <div className="wait-help">
    <button type="button" className="wait-help-btn" aria-label="待ち牌（アガリ牌）を表示">
      <QuestionCircleIcon />
    </button>
    <div className="wait-tooltip" role="tooltip">
      {waits.length > 0 ? (
        <>
          <div className="wait-tooltip-title">待ち（アガリ牌）</div>
          <div className="wait-tiles">
            {waits.map(t => (
              <TileComponent key={t.id} tile={t} small />
            ))}
          </div>
        </>
      ) : (
        <div className="wait-tooltip-note">{note}</div>
      )}
    </div>
  </div>
);

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
    {/* アバター＋情報の行 */}
    <div className="panel-main">
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
    {/* 鳴いた面子は名前の下にまとめて表示する */}
    {player.melds.length > 0 && (
      <div className="panel-melds">
        <MeldRow melds={player.melds} />
      </div>
    )}
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
  onClaim: (type: 'chi' | 'pon' | 'kan' | 'ron' | 'skip', chiTiles?: [string, string]) => void;
  onTsumo: () => void;
  // 以下は省略可能（preview モードでも使えるように）
  onRiichi?: (tileId: string) => void;
  onAnkan?: (tileId: string) => void;
  onKakan?: (tileId: string) => void;
  onKita?: () => void;
  onKyushuhai?: () => void;
  onLeave?: () => void;                 // 対局から退出してロビーへ戻る
}

export const GameBoard: React.FC<Props> = ({
  gameView,
  onDiscard,
  onClaim,
  onTsumo,
  onRiichi,
  onAnkan,
  onKakan,
  onKita,
  onKyushuhai,
  onLeave,
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
    ankanOptions,
    kakanOptions,
    drawnTileId,
  } = gameView;

  const pc = players.length;
  // 自分のプレイヤー情報。再接続直後などで mySeat が一時的にズレても落ちないよう、
  // 見つからなければ players[0] にフォールバックする（`!` で断言せず安全側に倒す）。
  const me = players.find(p => p.seat === mySeat) ?? players[0];

  // 選択中の牌・カン候補の牌は「現在の手牌に存在するもの」だけを参照する。
  // game-update で手牌が更新されると、古い selectedId / option が指す牌が消えていることがあり、
  // それを getTileName / TileComponent に渡すと tile.suit 参照で undefined エラーになるため。
  const selectedTile = selectedId ? myHand.find(t => t.id === selectedId) : undefined;
  const validAnkanOptions = (ankanOptions ?? []).filter(id => myHand.some(t => t.id === id));
  const validKakanOptions = (kakanOptions ?? []).filter(id => myHand.some(t => t.id === id));

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

  // ツモ牌（山/嶺上/北抜きで引いた牌）を手牌から分離し、一番右に離して表示する。
  // サーバーは手牌をソートして送るので、引いた牌は drawnTileId で特定する。
  // 鳴き(ポン/チー)の後など、ツモ牌が無いときは drawnTileId は未設定。
  const drawnTile = drawnTileId ? myHand.find(t => t.id === drawnTileId) : undefined;
  // 並べ替え済みの「手牌本体」（ツモ牌を除いた分）
  const baseHand = drawnTile ? myHand.filter(t => t.id !== drawnTile.id) : myHand;

  // 待ち牌（アガリ牌）の計算。
  // 自分の手番で牌を選んでいる時は「その牌を切った後の待ち」を、
  // それ以外（13枚の待ち形）は現在の待ちを表示する。
  const handForWait =
    isMyTurn && selectedId ? myHand.filter(t => t.id !== selectedId) : myHand;
  const waitingTiles = getWaitingTiles(handForWait, me?.melds ?? []);
  // 待ちが無いときの案内文（状況で出し分け）
  let waitNote = '';
  if (waitingTiles.length === 0) {
    if (isMyTurn && selectedId) waitNote = 'この牌を切るとテンパイになりません';
    else if (isMyTurn) waitNote = '捨てる牌を選ぶと、その時の待ち牌を表示します';
    else waitNote = 'テンパイしていません（ノーテン）';
  }
  // ヘルパーアイコンを出すか（テンパイ時、または自分の手番で案内を出したい時）
  const showWaitHelp = waitingTiles.length > 0 || isMyTurn;

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
        {/* 相手の手牌（裏向き）。鳴いた面子は各プレイヤーパネルにまとめて表示する */}
        <FaceDownWall count={player.handCount} orientation={wallOrient} />
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
        {/* 対局から退出してロビーへ戻る。確認ダイアログで誤操作を防ぐ。 */}
        {onLeave && (
          <button
            className="btn-leave-game"
            onClick={() => {
              if (window.confirm('対局から退出してロビーに戻りますか？')) onLeave();
            }}
          >
            退出
          </button>
        )}
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
                rotate={180}
                lastSeat={lastDiscard?.seat === topPlayer.seat}
                accent={AVATAR_COLORS[topPlayer.seat % 4]}
              />
              {topPlayer.isRiichi && <div className="riichi-stick"></div>}
            </div>
          )}
          {leftPlayer && (
            <div className="river-slot slot-left">
              <River
                tiles={leftPlayer.discards}
                orientation="v"
                rotate={90}
                lastSeat={lastDiscard?.seat === leftPlayer.seat}
                accent={AVATAR_COLORS[leftPlayer.seat % 4]}
              />
              {leftPlayer.isRiichi && <div className="riichi-stick"></div>}
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
              {rightPlayer.isRiichi && <div className="riichi-stick"></div>}
              <River
                tiles={rightPlayer.discards}
                orientation="v"
                rotate={-90}
                lastSeat={lastDiscard?.seat === rightPlayer.seat}
                accent={AVATAR_COLORS[rightPlayer.seat % 4]}
              />
            </div>
          )}
          <div className="river-slot slot-bottom">
            {me.isRiichi && <div className="riichi-stick"></div>}
            <River
              tiles={me.discards}
              orientation="h"
              lastSeat={lastDiscard?.seat === mySeat}
              accent={AVATAR_COLORS[mySeat % 4]}
            />
          </div>
        </div>
      </div>

      {/* ── 画面下部: 自分の手牌・アクション（鳴き面子は自分のパネルに表示） ── */}
      <div className="my-area">
        <div className="my-hand">
          {/* 手牌本体（ソート済み・ツモ牌を除く） */}
          {baseHand.map(tile => (
            <TileComponent
              key={tile.id}
              tile={tile}
              selected={selectedId === tile.id}
              // 自分の番じゃない時は onClick を渡さない＝クリック不可
              onClick={isMyTurn ? () => handleTileClick(tile.id) : undefined}
            />
          ))}
          {/* ツモ牌は少し離して一番右に表示する */}
          {drawnTile && (
            <>
              <span className="hand-gap" />
              <TileComponent
                tile={drawnTile}
                selected={selectedId === drawnTile.id}
                onClick={isMyTurn ? () => handleTileClick(drawnTile.id) : undefined}
              />
            </>
          )}
          {/* 手牌の右に「待ち牌」ヘルパー（？アイコン、ホバーでアガリ牌を表示） */}
          {showWaitHelp && <WaitHelp waits={waitingTiles} note={waitNote} />}
        </div>

        {/* ── アクションパネル: 状況に応じてボタンを切り替える ── */}
        <div className="action-panel">
          {isMyTurn && (
            <div className="action-row">
              {selectedTile && !riichiMode && (
                <button
                  className="btn-action discard"
                  onClick={() => {
                    onDiscard(selectedTile.id);
                    setSelectedId(null);
                  }}
                >
                  {getTileName(selectedTile)} を捨てる
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
              {/* 暗槓ボタン（同じ牌4枚） */}
              {onAnkan && !riichiMode && validAnkanOptions.map(tileId => (
                <button
                  key={`ankan-${tileId}`}
                  className="btn-action kan"
                  onClick={() => onAnkan(tileId)}
                >
                  暗槓 {getTileName(myHand.find(t => t.id === tileId))}
                </button>
              ))}
              {/* 加槓ボタン（ポンに足す） */}
              {onKakan && !riichiMode && validKakanOptions.map(tileId => (
                <button
                  key={`kakan-${tileId}`}
                  className="btn-action kan"
                  onClick={() => onKakan(tileId)}
                >
                  加槓 {getTileName(myHand.find(t => t.id === tileId))}
                </button>
              ))}
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
              {availableClaims?.includes('kan') && (
                <button className="btn-action kan" onClick={() => onClaim('kan')}>
                  カン
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
