import { BufferAttribute, BufferGeometry } from 'three';
import { GROUND_Y } from './palette';

// The tower's shade at a vertex (mask.ts), as the court's meshes take it
export { SHADE_AT_VERTEX } from './mask';

// The court's plan (court.tsx): where its slabs meet, where the inlay's
// rings and spokes run and where the stepping stones lie. Plain numbers, in the garden's frame before it turns for Black
// (gardenTurn), shared by the shaders (as constants and uniforms) and the
// tests.

/** Where the court's detail starts (round the tower's foot) and where it has gone. */
export const COURT_SPAN = { inner: [2.5, 7.5], outer: [21, 29] } as const;

/**
 * The paving: rows `ROW` deep along z; along x each row is cut into
 * `CELL`-wide cells, with a joint before cell c of row k when
 * (2c + 3k) mod 5 < 2 (slabs of three cells and two, staggered row to row).
 * Integer arithmetic, so GLSL (COURT_SLABS) and JS agree exactly.
 */
export const SLAB = { row: 4, cell: 2 } as const;
const mod = (a: number, n: number) => ((a % n) + n) % n;
export const jointBefore = (c: number, k: number) => mod(2 * c + 3 * k, 5) < 2;

/** GLSL: `vec4 slabOf(vec2 p)`, the slab under p: its first and last cell, its row, and 0. */
export const COURT_SLABS = /* glsl */ `
  bool jointBefore(float c, float k) {
    return mod(2.0 * c + 3.0 * k, 5.0) < 1.5;
  }
  // The slab round cell c of row k: its first and last cells. The joints
  // repeat every five cells, so how far back the joint before c lies, and
  // how far on the one after it, follow from m = (2c + 3k) mod 5 alone
  // (each cell back takes 2 from m, each on adds 2): no search
  vec4 slabOf(vec2 p) {
    float k = floor(p.y / ${SLAB.row.toFixed(1)});
    float c = floor(p.x / ${SLAB.cell.toFixed(1)});
    float m = mod(2.0 * c + 3.0 * k, 5.0);
    float back = m < 1.5 ? 0.0 : m < 3.5 ? 1.0 : 2.0;
    float on = m > 2.5 ? 0.0 : m > 0.5 ? 1.0 : 2.0;
    return vec4(c - back, c + on, k, 0.0);
  }`;

/** The inlay: its rings' radii, and the spokes between them. */
export const INLAY = {
  inner: 10,
  /** Whole, midway between two stepping stones where the path crosses it (STONES). */
  outer: 15.5,
} as const;

/** The eight ways a knight jumps, as unit vectors: the inlay's spokes. */
export const KNIGHT_WAYS: [number, number][] = [
  [2, 1],
  [1, 2],
  [-1, 2],
  [-2, 1],
  [-2, -1],
  [-1, -2],
  [1, -2],
  [2, -1],
].map(([x, z]) => [x / Math.hypot(x, z), z / Math.hypot(x, z)]);

/** Half the side of a stepping stone. */
export const STONE_HALF = 0.72;
/**
 * The stepping stones: from just outside the inlay's inner ring out to the
 * colossal board's edge along -x, each a knight's jump from the last (two
 * along, one across), touching neither of the inlay's rings, and on along
 * the board's centre line between the two knights (a4, a5), which face each
 * other across the path.
 */
export const STONES: [number, number][] = Array.from({ length: 6 }, (_, i) => [
  -13.5 - 4 * i,
  i % 2 ? -1 : 1,
]);

/**
 * The stepping stones as quads lying on the ground, each with its own
 * coordinates, in world units from the stone's middle (court.tsx draws them
 * in one pass, so only their own pixels pay for them).
 */
export const stonesGeometry = () => {
  const pos: number[] = [];
  const local: number[] = [];
  const index: number[] = [];
  const half = STONE_HALF + 0.25;
  for (const [cx, cz] of STONES) {
    const base = pos.length / 3;
    for (const [u, v] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      pos.push(cx + u * half, GROUND_Y, cz + v * half);
      local.push(u * half, v * half);
    }
    index.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aLocal', new BufferAttribute(new Float32Array(local), 2));
  g.setIndex(index);
  return g;
};
