export type Coord = { x: number; y: number; z: number };

// UI constants for levels, files, and ranks
export const LEVELS = ['A', 'B', 'C', 'D', 'E']; // z
export const FILES = ['a', 'b', 'c', 'd', 'e']; // x
export const RANKS = ['1', '2', '3', '4', '5']; // y

/**
 * Converts a Coord to a string in ZXY format (e.g., 'Aa1').
 * LEVEL (A-E) + FILE (a-e) + RANK (1-5)
 */
export function toZXY(c: Coord): string {
  if (
    c.z < 0 ||
    c.z >= LEVELS.length ||
    c.x < 0 ||
    c.x >= FILES.length ||
    c.y < 0 ||
    c.y >= RANKS.length
  ) {
    throw new Error(`Invalid coordinate: ${JSON.stringify(c)}`);
  }
  return LEVELS[c.z] + FILES[c.x] + RANKS[c.y];
}

/**
 * Converts a ZXY string (e.g., 'Aa1') to a Coord.
 */
export function fromZXY(s: string): Coord {
  if (!/^([A-E])([a-e])([1-5])$/.test(s)) {
    throw new Error(`Invalid ZXY string: ${s}`);
  }
  const z = LEVELS.indexOf(s[0]);
  const x = FILES.indexOf(s[1]);
  const y = RANKS.indexOf(s[2]);
  if (z === -1 || x === -1 || y === -1) {
    throw new Error(`Invalid ZXY string: ${s}`);
  }
  return { x, y, z };
}
