import { FILES } from '../engine/coords';
import type { Coord } from '../engine/coords';

export const GRID_SIZE = FILES.length;
export const SPACING = 1.1;
const HALF = (GRID_SIZE - 1) / 2;

export type Orientation = 'white' | 'black';

/** Every cell of the 5x5x5 grid, in z -> y -> x order. */
export const CELLS: Coord[] = Array.from({ length: GRID_SIZE ** 3 }, (_, i) => ({
  x: i % GRID_SIZE,
  y: Math.floor(i / GRID_SIZE) % GRID_SIZE,
  z: Math.floor(i / GRID_SIZE ** 2),
}));

/**
 * Maps a logical board coordinate to a world position.
 *
 * Screen axes, as seen from the default camera (which sits on +Z):
 *   world X = file  (a..e, left to right)
 *   world Y = rank  (the viewing player's back rank at the bottom)
 *   world Z = level (the viewing player's own levels nearest the camera)
 *
 * Viewing as Black inverts all three axes, which is the symmetry the starting
 * position is actually built on: Black's army is White's under
 * (x, y, z) -> (4 - x, 4 - y, 4 - z), files included (White's B U Q B U second
 * rank is Black's U B Q U B). Mirroring the files too is therefore what makes
 * each player see their own army laid out identically — flipping only rank and
 * level would show Black their back rank reversed.
 *
 * Inverting the files is a reflection rather than a rigid rotation, but nothing
 * observable depends on the handedness: only positions are transformed (piece
 * meshes are never mirrored, and stay upright for both players), and every move
 * vector set in pieces.ts is closed under negating a single axis, so no piece's
 * legal moves can render misleadingly.
 */
export function toWorld(
  { x, y, z }: Coord,
  orientation: Orientation,
): [number, number, number] {
  const flip = (v: number) => (orientation === 'white' ? v : GRID_SIZE - 1 - v);
  return [
    (flip(x) - HALF) * SPACING,
    (flip(y) - HALF) * SPACING,
    (HALF - flip(z)) * SPACING,
  ];
}
