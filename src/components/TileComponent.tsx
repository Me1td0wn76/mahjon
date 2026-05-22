import React from 'react';
import type { Tile } from '../types/mahjong';
import { HONOR_NAMES, SUIT_CHARS } from '../types/mahjong';
import './TileComponent.css';

interface Props {
  tile: Tile;
  selected?: boolean;
  onClick?: () => void;
  faceDown?: boolean;
  small?: boolean;
  dimmed?: boolean;
}

function honorClass(value: number): string {
  if (value <= 4) return 'tile-wind';
  if (value === 5) return 'tile-haku';
  if (value === 6) return 'tile-hatsu';
  return 'tile-chun';
}

export const TileComponent: React.FC<Props> = ({
  tile,
  selected,
  onClick,
  faceDown,
  small,
  dimmed,
}) => {
  const cls = [
    'tile',
    faceDown ? 'tile-face-down' : `tile-${tile.suit}`,
    tile.suit === 'honor' && !faceDown ? honorClass(tile.value) : '',
    selected ? 'tile-selected' : '',
    small ? 'tile-small' : '',
    dimmed ? 'tile-dimmed' : '',
    onClick ? 'tile-clickable' : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (faceDown) {
    return <div className={cls} onClick={onClick} />;
  }

  return (
    <div className={cls} onClick={onClick}>
      {tile.suit === 'honor' ? (
        <span className="tile-char">{HONOR_NAMES[tile.value - 1]}</span>
      ) : (
        <>
          <span className="tile-num">{tile.value}</span>
          <span className="tile-suit-char">{SUIT_CHARS[tile.suit]}</span>
        </>
      )}
    </div>
  );
};
