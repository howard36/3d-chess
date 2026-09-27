import type { Piece } from '../engine';

// What the pointer is on, worked out from the pointer's ray rather than from
// r3f's pointer events on the cells' click boxes. A click box stands up from
// its floor, so a ray aimed at the middle of a square usually passes through
// the box of the square in front of it first; the floor squares themselves
// have no such overlap. Pure, so it can be tested without WebGL.

type Vec3 = [number, number, number];

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

/**
 * The cell the pointer is on:
 * - a piece under the pointer wins over the empty floor around it, even a
 *   floor nearer the camera (a piece seen through a platform is still what
 *   the player points at);
 * - but a legal destination nearer than that piece wins, as a click there
 *   would play the move;
 * - otherwise the nearest floor square the ray crosses (the first platform
 *   under the pointer).
 *
 * `half` is half a square's side; `pieceHit` the nearest piece the ray hits.
 */
export const resolveHover = (
  ray: HoverRay,
  floors: FloorSquare[],
  half: [number, number],
  pieceHit: { key: string; distance: number } | null,
  destinations: ReadonlySet<string>,
): string | null => {
  const [ox, oy, oz] = ray.origin;
  const [dx, dy, dz] = ray.direction;
  let nearest: { key: string; t: number } | null = null;
  let nearestDestination: { key: string; t: number } | null = null;
  if (Math.abs(dy) > 1e-9) {
    for (const { key, floor } of floors) {
      const t = (floor[1] - oy) / dy;
      if (t <= 0) continue;
      if (Math.abs(ox + dx * t - floor[0]) > half[0]) continue;
      if (Math.abs(oz + dz * t - floor[2]) > half[1]) continue;
      if (!nearest || t < nearest.t) nearest = { key, t };
      if (destinations.has(key) && (!nearestDestination || t < nearestDestination.t)) {
        nearestDestination = { key, t };
      }
    }
  }
  if (pieceHit && (!nearestDestination || pieceHit.distance <= nearestDestination.t)) {
    return pieceHit.key;
  }
  return nearestDestination?.key ?? nearest?.key ?? null;
};

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The two parts of the HUD readout: the cell ("Cc4") and what stands there, if anything. */
export const readoutParts = (zxy: string, piece: Piece | null) => ({
  cell: zxy,
  piece: piece ? `${capitalise(piece.color)} ${piece.type}` : null,
});

/** The HUD readout of a hovered cell: "Cc4 · White Bishop", or "Cc4" when empty. */
export const readoutText = (zxy: string, piece: Piece | null): string => {
  const parts = readoutParts(zxy, piece);
  return parts.piece ? `${parts.cell} · ${parts.piece}` : parts.cell;
};
