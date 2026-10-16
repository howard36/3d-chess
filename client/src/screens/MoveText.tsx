import { PieceType } from '../engine/pieces';
import { notationSquares } from '../game/notation';
import type { MoveNotation } from '../game/notation';
import { GLYPHS } from './glyphs';

// Each silhouette's ink on its 24-unit grid (left, top, right; every one
// stands on y = 21), as the browser measures GLYPHS: the icon is cut to it,
// so it stands on the baseline as tall as the capitals, its gap to the
// letters the same for every piece.
const INK: Record<PieceType, readonly [number, number, number]> = {
  [PieceType.King]: [6, 1.8, 18],
  [PieceType.Queen]: [6, 2.4, 18],
  [PieceType.Rook]: [6.4, 5.4, 17.6],
  [PieceType.Bishop]: [6.4, 3.5, 17.6],
  [PieceType.Knight]: [6.09, 3.8, 19],
  [PieceType.Unicorn]: [6.4, 2.5, 17.6],
  [PieceType.Pawn]: [8, 6.6, 16],
};

/** A piece's icon in the record: its silhouette, one path in the text's colour. */
const Icon = ({ type }: { type: PieceType }) => {
  const [left, top, right] = INK[type];
  const width = +(right - left).toFixed(2);
  const height = +(21 - top).toFixed(2);
  return (
    <svg
      className="hud-icon"
      viewBox={`${left} ${top} ${width} ${height}`}
      style={{ aspectRatio: `${width} / ${height}` }}
      data-piece={type}
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
        =<Icon type={notation.promotion} />
      </>
    )}
    {notation.check}
  </>
);
