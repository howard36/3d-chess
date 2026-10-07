// What the pointer is on, worked out from the pointer's ray rather than from
// r3f's pointer events on the cells' click boxes. A click box stands up from
// its floor, so a ray aimed at the middle of a square usually passes through
// the box of the square in front of it first; the floor squares themselves
// have no such overlap. Pure, so it can be tested without WebGL.

import type { Vec3 } from './types';

export interface HoverRay {
  origin: Vec3;
  /** Unit direction. */
  direction: Vec3;
}

export interface FloorSquare {
  key: string;
  /** Centre of the cell's floor. */
  floor: Vec3;
}

/** What the pointer is on: a cell, and whether a piece or a mark there takes it, or only its floor. */
export interface HoverHit {
  key: string;
  on: 'piece' | 'mark' | 'floor';
}

/**
 * The cell the pointer is on:
 * - a piece under the pointer wins over the empty floor around it, even a
 *   floor nearer the camera (a piece seen through a platform is still what
 *   the player points at);
 * - but a legal destination's mark nearer than that piece wins, as a click
 *   there would play the move. Only the mark's circle counts (its radius in
 *   `destinations`): a ray through its square's empty corners goes on to a
 *   mark beneath;
 * - otherwise the nearest floor square the ray crosses (the first platform
 *   under the pointer), a mark's square included.
 *
 * `half` is half a square's side; `pieceHit` the nearest piece the ray hits.
 */
export const resolveHover = (
  ray: HoverRay,
  floors: FloorSquare[],
  half: [number, number],
  pieceHit: { key: string; distance: number } | null,
  destinations: ReadonlyMap<string, number>,
): HoverHit | null => {
  const [ox, oy, oz] = ray.origin;
  const [dx, dy, dz] = ray.direction;
  let nearest: { key: string; t: number } | null = null;
  let nearestDestination: { key: string; t: number } | null = null;
  if (Math.abs(dy) > 1e-9) {
    for (const { key, floor } of floors) {
      const t = (floor[1] - oy) / dy;
      if (t <= 0) continue;
      const ax = ox + dx * t - floor[0];
      const az = oz + dz * t - floor[2];
      if (Math.abs(ax) > half[0] || Math.abs(az) > half[1]) continue;
      if (!nearest || t < nearest.t) nearest = { key, t };
      const reach = destinations.get(key);
      if (
        reach !== undefined &&
        Math.hypot(ax, az) <= reach &&
        (!nearestDestination || t < nearestDestination.t)
      ) {
        nearestDestination = { key, t };
      }
    }
  }
  if (pieceHit && (!nearestDestination || pieceHit.distance <= nearestDestination.t)) {
    return { key: pieceHit.key, on: 'piece' };
  }
  if (nearestDestination) return { key: nearestDestination.key, on: 'mark' };
  return nearest && { key: nearest.key, on: 'floor' };
};
