import { PieceType } from '../engine/pieces';
import type { BoardLayout, Vec3 } from './designs/types';

// The path a moving piece takes, shared by the glide (moveAnimation.tsx) and
// the last-move line (kit/markerGeometry.ts), so both trace exactly the same
// curve.
//
// Every move runs in a straight line from the source square to the
// destination, whatever its level change. A knight is the one exception the
// player can choose: with knight moves set to 'arc' it jumps over an arc of
// constant height instead (a knight is the only piece that leaps).

/** How a knight travels: straight like every other piece, or over an arc. */
export type KnightMoves = 'straight' | 'arc';

/**
 * Height of a knight's arc above the straight line between its squares, in
 * cell pitches: the same for every knight move, whether it stays on its
 * level or changes one or two levels.
 */
export const KNIGHT_ARC_PITCHES = 0.6;

/** Distance between neighbouring cell centres on a level. */
export const cellPitch = (layout: BoardLayout): number => {
  const a = layout.toWorld({ x: 0, y: 0, z: 0 }, 'white');
  const b = layout.toWorld({ x: 1, y: 0, z: 0 }, 'white');
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
};

/** World height of a knight's arc on this layout. */
export const knightArcHeight = (layout: BoardLayout): number =>
  KNIGHT_ARC_PITCHES * cellPitch(layout);

/**
 * The arc of a move (world units above the straight line, at its middle): a
 * knight's arc when the piece that moved is a knight (not a pawn promoting
 * to one) and knights arc, else 0 (a straight line).
 */
export const moveArc = (
  layout: BoardLayout,
  piece: PieceType | null | undefined,
  promotion: PieceType | null | undefined,
  knightMoves: KnightMoves,
): number =>
  knightMoves === 'arc' && piece === PieceType.Knight && !promotion ? knightArcHeight(layout) : 0;

/**
 * The point `e` of the way along a move from `from` to `to` (0 at the
 * source, 1 at the destination): on the straight line between them, raised
 * by a parabola peaking `arc` above the line's midpoint. With `arc` 0 it is
 * the straight line itself.
 */
export const movePoint = (from: Vec3, to: Vec3, e: number, arc = 0): Vec3 => [
  from[0] + (to[0] - from[0]) * e,
  from[1] + (to[1] - from[1]) * e + arc * 4 * e * (1 - e),
  from[2] + (to[2] - from[2]) * e,
];
