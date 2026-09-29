import type { Vec3 } from './types';

/**
 * The point `e` of the way along a move from `from` to `to` (0 at the
 * source, 1 at the destination). Every move runs in a straight line,
 * whatever its level change.
 */
export const movePoint = (from: Vec3, to: Vec3, e: number): Vec3 => [
  from[0] + (to[0] - from[0]) * e,
  from[1] + (to[1] - from[1]) * e,
  from[2] + (to[2] - from[2]) * e,
];
