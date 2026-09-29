import type { Vec3 } from './types';

// The path a moving piece takes, shared by the glide (moveAnimation.tsx) and
// the last-move line (scene/markerGeometry.ts), so both trace exactly the same
// curve.
//
// Every move runs in a straight line from the source square to the
// destination, whatever its level change.

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
