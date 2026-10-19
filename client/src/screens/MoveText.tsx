import type { CSSProperties } from 'react';
import { PieceType } from '../engine/pieces';
import { notationSquares } from '../game/notation';
import type { MoveNotation } from '../game/notation';
import { GLYPHS, INK } from './glyphs';

/**
 * A piece's icon in the record: its silhouette, one path in the text's
 * colour. What a pawn became stands among the signs as a letter does, with
 * none of the gap the moving piece's leaves before its squares (index.css).
 */
const Icon = ({ type, promotion }: { type: PieceType; promotion?: boolean }) => {
  const [left, top, right, lift] = INK[type];
  const width = +(right - left).toFixed(2);
  const height = +(21 - top).toFixed(2);
  return (
    <svg
      className="hud-icon"
      viewBox={`${left} ${top} ${width} ${height}`}
      // Drawn at its box's foot: the box may be up to a pixel taller (index.css)
      preserveAspectRatio="xMidYMax meet"
      style={{ '--aspect': +(width / height).toFixed(4), '--lift': lift } as CSSProperties}
      data-piece={type}
      data-promotion={promotion || undefined}
      aria-hidden
    >
      <path d={GLYPHS[type]} />
    </svg>
  );
};

/**
 * A move as the record writes it (game/notation.ts): the piece's icon, the
 * squares, the icon of what a pawn became, and "+" or "#". Drawn only: what
 * it says is given in words where it stands (notationWords).
 */
export const MoveText = ({ notation }: { notation: MoveNotation }) => (
  <>
    <Icon type={notation.piece} />
    {notationSquares(notation)}
    {notation.promotion && (
      <>
        =<Icon type={notation.promotion} promotion />
      </>
    )}
    {notation.check}
  </>
);
