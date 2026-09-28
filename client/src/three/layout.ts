import { FILES } from '../engine/coords';
import type { Coord } from '../engine/coords';

export const GRID_SIZE = FILES.length;

/** The seat the board is drawn for: each player sees their own army nearest. */
export type Orientation = 'white' | 'black';

/**
 * Every cell of the 5x5x5 grid, in y -> z -> x order: rank by rank, each
 * rank's levels bottom to top, each level's files left to right.
 */
export const CELLS: Coord[] = Array.from({ length: GRID_SIZE ** 3 }, (_, i) => ({
  x: i % GRID_SIZE,
  z: Math.floor(i / GRID_SIZE) % GRID_SIZE,
  y: Math.floor(i / GRID_SIZE ** 2),
}));
