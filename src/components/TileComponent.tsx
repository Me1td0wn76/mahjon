// このファイルは「牌1枚」を描画するための小さなReactコンポーネント。
// 同じ牌でも「裏向き」「選択中」「ハイライト」「小さい表示」などスタイルを切り替えられる。
import React from 'react';
import type { Tile } from '../types/mahjong';
import { HONOR_NAMES, SUIT_CHARS } from '../types/mahjong';
import './TileComponent.css';

// Props（コンポーネントが受け取る引数）の型定義。
// `?` 付きは省略可能。
interface Props {
  tile: Tile;
  selected?: boolean;                                        // クリックで選択中か
  onClick?: () => void;                                      // クリック時に呼ぶ関数（省略可）
  faceDown?: boolean;                                        // 裏向き（他人の手牌など）
  small?: boolean;                                           // 小サイズで表示
  dimmed?: boolean;                                          // 半透明で薄く表示
}

/**
 * 字牌の種類に応じてCSSクラス名を決める。
 * 1-4=風牌、5=白、6=発、7=中
 */
function honorClass(value: number): string {
  if (value <= 4) return 'tile-wind';
  if (value === 5) return 'tile-haku';
  if (value === 6) return 'tile-hatsu';
  return 'tile-chun';
}

// React.FC<Props> は「Props を受け取る関数コンポーネント」を表す型。
// 分割代入で props のフィールドを直接取り出している。
export const TileComponent: React.FC<Props> = ({
  tile,
  selected,
  onClick,
  faceDown,
  small,
  dimmed,
}) => {
  // 条件に応じたクラス名を配列で集めて、空文字を除いてスペースで結合。
  // CSSクラスを動的に組み立てる典型パターン。
  const cls = [
    'tile',
    faceDown ? 'tile-face-down' : `tile-${tile.suit}`,
    tile.suit === 'honor' && !faceDown ? honorClass(tile.value) : '',
    selected ? 'tile-selected' : '',
    small ? 'tile-small' : '',
    dimmed ? 'tile-dimmed' : '',
    onClick ? 'tile-clickable' : '',
  ]
    .filter(Boolean)                                         // 空文字や false を除外
    .join(' ');

  // 裏向きの時は中身を描画しない（背面パターンだけ）
  if (faceDown) {
    return <div className={cls} onClick={onClick} />;
  }

  return (
    <div className={cls} onClick={onClick}>
      {tile.suit === 'honor' ? (
        // 字牌は漢字1文字で表示
        <span className="tile-char">{HONOR_NAMES[tile.value - 1]}</span>
      ) : (
        // 数牌は数字＋種類文字（例: "5" + "万"）
        <>
          <span className="tile-num">{tile.value}</span>
          <span className="tile-suit-char">{SUIT_CHARS[tile.suit]}</span>
        </>
      )}
    </div>
  );
};
