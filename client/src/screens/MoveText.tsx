import type { CSSProperties } from 'react';
import { PieceType } from '../engine/pieces';
import { notationSquares } from '../game/notation';
import type { MoveNotation } from '../game/notation';
import { GLYPHS } from './glyphs';

// Each silhouette's ink on its 24-unit grid (left, top, right; every one
// stands on y = 21), as the browser measures GLYPHS: the icon is cut to it,
// so it stands on the baseline, its gap to the letters the same for every
// piece. Its height is the capitals' times its lift: a top thinner than the
// letters' stem (193 of the capitals' 1440 units) looks lower than its last
// pixel, as a point or a pearl does, so a piece whose top is thin stands
// that much taller, its weight level with the capitals. The lift is that
// thin part's shortfall, each row thinner than a stem counting for what it
// lacks, measured from the glyph's rows of ink, and is at most a tenth (the
// unicorn's horn would ask a quarter, the queen's pearl a tenth, the
// knight's ear 6%, the king's cross 2%; the rook's flat top and the pawn's
// round head next to nothing).
const INK: Record<PieceType, readonly [left: number, top: number, right: number, lift: number]> = {
  [PieceType.King]: [6, 1.8, 18, 1.02],
  [PieceType.Queen]: [6, 2.4, 18, 1.1],
  [PieceType.Rook]: [6.4, 5.4, 17.6, 1],
  [PieceType.Bishop]: [6.4, 3.5, 17.6, 1.01],
  [PieceType.Knight]: [6.09, 3.8, 19, 1.06],
  [PieceType.Unicorn]: [6.4, 2.5, 17.6, 1.1],
  [PieceType.Pawn]: [8, 6.6, 16, 1.01],
};

/** A piece's icon in the record: its silhouette, one path in the text's colour. */
const Icon = ({ type }: { type: PieceType }) => {
  const [left, top, right, lift] = INK[type];
  const width = +(right - left).toFixed(2);
  const height = +(21 - top).toFixed(2);
  return (
    <svg
      className="hud-icon"
      viewBox={`${left} ${top} ${width} ${height}`}
      style={{ aspectRatio: `${width} / ${height}`, '--lift': lift } as CSSProperties}
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
