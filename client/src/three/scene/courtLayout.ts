import { BufferAttribute, BufferGeometry } from 'three';
import { TOWER_SHADE } from './mask';
import { GROUND_Y } from './palette';

/**
 * GLSL for a vertex shader: `float shadeOfClip(vec4
 * clip)`, the tower's shade (mask.ts's TOWER_SHADE, the same function) at a
 * vertex, from its clip position, 0 behind the camera. The court is faint
 * and its meshes fine enough that the shade between vertices is as good as
 * the shade per pixel, and a vertex is far cheaper (software rendering pays
 * for every pixel of the court whenever the camera moves). Needs
 * shadeUniforms().
 */
export const SHADE_AT_VERTEX = `${TOWER_SHADE.replace(
  'float towerShade() {',
  'float towerShadeAt(vec2 p) {',
).replace(/\n\s*vec2 p = gl_FragCoord[^\n]*\n\s*p\.x \*= uShadeViewport\.z;/, '')}
  float shadeOfClip(vec4 clip) {
    if (clip.w <= 0.0) return 0.0;
    vec2 p = clip.xy / clip.w;
    p.x *= uShadeViewport.z;
    return towerShadeAt(p);
  }`;

// The court's plan (court.tsx): where its slabs meet, where the inlay's
// rings and spokes run, where the stepping stones lie and where the moss
// grows. Plain numbers, in the garden's frame before it turns for Black
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
  vec4 slabOf(vec2 p) {
    float k = floor(p.y / ${SLAB.row.toFixed(1)});
    float c = floor(p.x / ${SLAB.cell.toFixed(1)});
    float a = c;
    for (int i = 0; i < 4; i++) {
      if (jointBefore(a, k)) break;
      a -= 1.0;
    }
    float b = c + 1.0;
    for (int i = 0; i < 4; i++) {
      if (jointBefore(b, k)) break;
      b += 1.0;
    }
    return vec4(a, b - 1.0, k, 0.0);
  }`;

/** The inlay: its rings' radii, and the spokes between them. */
export const INLAY = {
  inner: 10,
  outer: 14.5,
  /** The outer ring is broken where the colossal board's centre lines would run on (half a gap, world units). */
  gap: 1.9,
  /** The star (spokes alone) reaches from here to there, fading at both ends. */
  star: [7.5, 19] as const,
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
 * The stepping stones: from near the tower's foot out to the colossal
 * board's edge along -x, each a knight's jump from the last (two along, one
 * across), through the inlay ring's gate (the gap where the board's centre
 * line would run) and on along that line between the two knights (a4, a5),
 * which face each other across the path.
 */
export const STONES: [number, number][] = Array.from({ length: 7 }, (_, i) => [
  -9.5 - 4 * i,
  i % 2 ? 1 : -1,
]);

/** A small seeded random number generator (mulberry32). */
const rng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** One point of moss: where (x, y, z), how big (CSS px) and how bright. */
export interface Moss {
  at: [number, number, number];
  size: number;
  bright: number;
}

/** Inside a stepping stone, or near the inlay's lines: moss keeps off them. */
const clearOf = (x: number, z: number) => {
  for (const [sx, sz] of STONES)
    if (Math.abs(x - sx) < STONE_HALF + 0.3 && Math.abs(z - sz) < STONE_HALF + 0.3) return false;
  const r = Math.hypot(x, z);
  return Math.abs(r - INLAY.inner) > 0.35 && Math.abs(r - INLAY.outer) > 0.35;
};

/**
 * The glow-moss: clusters along the slabs' joints, mostly toward the court's
 * rim, each a short run of points in one joint (never a joint's whole
 * length, so the moss never draws the paving's grid), a few lifted a hand
 * above the stone (seed heads: they show their depth when the view turns).
 */
export const mossPoints = (seed = 17): Moss[] => mossPlan(seed).points;

/** A patch of moss: its middle (x, z), its length along its joint and which way that runs. */
export interface MossPatch {
  at: [number, number];
  along: [number, number];
  spread: number;
}

/** The moss's patches and points (mossPoints). */
export const mossPlan = (seed = 17) => {
  const random = rng(seed);
  const out: Moss[] = [];
  const patches: MossPatch[] = [];
  let clusters = 0;
  for (let tries = 0; clusters < 34 && tries < 400; tries++) {
    // Denser toward the rim, thin near the tower
    const r = 6.5 + 19.5 * Math.sqrt(random());
    const a = random() * Math.PI * 2;
    const x0 = Math.cos(a) * r;
    const z0 = Math.sin(a) * r;
    // Snap to the nearest joint: a row's edge (along x) or a cut (along z)
    const k = Math.floor(z0 / SLAB.row);
    const c = Math.round(x0 / SLAB.cell);
    const alongRow = random() < 0.5;
    let line: [number, number];
    let dir: [number, number];
    if (alongRow) {
      line = [x0, Math.round(z0 / SLAB.row) * SLAB.row];
      dir = [1, 0];
    } else {
      if (!jointBefore(c, k)) continue;
      line = [c * SLAB.cell, z0];
      dir = [0, 1];
    }
    clusters++;
    const n = 4 + Math.floor(random() * 7);
    const spread = 0.5 + random() * 1.1;
    patches.push({ at: line, along: dir, spread });
    for (let i = 0; i < n; i++) {
      const t = (random() + random() - 1) * spread;
      const off = (random() - 0.5) * 0.5 * (1 - Math.abs(t) / (spread * 1.2));
      const x = line[0] + dir[0] * t + dir[1] * off;
      const z = line[1] + dir[1] * t + dir[0] * off;
      if (!clearOf(x, z)) continue;
      const lifted = random() < 0.18;
      out.push({
        at: [x, GROUND_Y + (lifted ? 0.12 + random() * 0.3 : 0.015 + random() * 0.04), z],
        size: lifted ? 3.6 + random() * 1.2 : 2.8 + random() * 1.6,
        bright: (lifted ? 0.5 : 0.25) + random() ** 2 * 0.75,
      });
    }
  }
  return { points: out, patches };
};

/** The moss as points: position, size and brightness each. */
export const mossGeometry = (points = mossPoints()) => {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(points.flatMap((p) => p.at)), 3));
  g.setAttribute('aSize', new BufferAttribute(new Float32Array(points.map((p) => p.size)), 1));
  g.setAttribute('aBright', new BufferAttribute(new Float32Array(points.map((p) => p.bright)), 1));
  return g;
};

/** How far a moss patch's glow reaches, in its own units (it is e^-4.8 there). */
const GLOW_REACH = 2.2;
/** The glow round a patch: its half-size along its joint (with the patch's spread) and across. */
export const glowSize = (spread: number): [number, number] => [spread + 0.7, 0.6];

/**
 * The court's small marks on the stone, each a quad lying on the ground
 * with its own coordinates (court.tsx draws them in one pass, so only their
 * own pixels pay for them): the moss's glow round each patch (kind 0, the
 * coordinates in units of its size) and the stepping stones (kind 1, the
 * coordinates in world units from the stone's middle).
 */
export const decalGeometry = ({ moss, stones }: { moss: boolean; stones: boolean }) => {
  const pos: number[] = [];
  const local: number[] = [];
  const kind: number[] = [];
  const index: number[] = [];
  const quad = (
    [cx, cz]: [number, number],
    [ax, az]: [number, number],
    half: [number, number],
    scale: [number, number],
    k: number,
  ) => {
    const base = kind.length;
    for (const [u, v] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const du = u * half[0];
      const dv = v * half[1];
      // along (ax, az), and across it
      pos.push(cx + ax * du - az * dv, GROUND_Y, cz + az * du + ax * dv);
      local.push(du / scale[0], dv / scale[1]);
      kind.push(k);
    }
    index.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  if (moss)
    for (const { at, along, spread } of mossPlan().patches) {
      const size = glowSize(spread);
      quad(at, along, [size[0] * GLOW_REACH, size[1] * GLOW_REACH], size, 0);
    }
  if (stones) {
    const half = STONE_HALF + 0.25;
    for (const at of STONES) quad(at, [1, 0], [half, half], [1, 1], 1);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aLocal', new BufferAttribute(new Float32Array(local), 2));
  g.setAttribute('aKind', new BufferAttribute(new Float32Array(kind), 1));
  g.setIndex(index);
  return g;
};
