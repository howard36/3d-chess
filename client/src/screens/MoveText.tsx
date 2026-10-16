import type { PieceType } from '../engine/pieces';
import { notationSquares } from '../game/notation';
import type { MoveNotation } from '../game/notation';
import { GLYPHS } from './glyphs';

/** A piece's icon in the record: its silhouette, one path in the text's colour. */
const Icon = ({ type }: { type: PieceType }) => (
  <svg className="hud-icon" viewBox="0 0 24 24" data-piece={type} aria-hidden>
    <path d={GLYPHS[type]} />
  </svg>
);

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
