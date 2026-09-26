import { BufferAttribute, BufferGeometry, Color } from 'three';
import { PieceType } from '../../../engine/pieces';
import type { PieceColor } from '../types';

// The Arcade's pieces are voxel models: 8-bit chess sprites given depth.
// Round pieces are "turned" from a stack of square layers (so they read the
// same from every side); the knight and unicorn are side-view sprites
// extruded three voxels deep. Each model is meshed once into a single
// geometry of its outside faces, coloured per voxel.

/** Edge of one voxel, world units. */
export const VOXEL = 0.068;

/**
 * Palette keys: a main, b base/shade, c highlight, d trim, e eye, h horn,
 * r rainbow (picked by height).
 */
type Key = 'a' | 'b' | 'c' | 'd' | 'e' | 'h' | 'r';
export type Palette = Record<Exclude<Key, 'r'>, string>;

export const PALETTES: Record<PieceColor, Palette> = {
  white: { a: '#ffe7a0', b: '#e8963a', c: '#ffffff', d: '#ff6a2b', e: '#2a1440', h: '#2ee6ff' },
  black: { a: '#c35cff', b: '#6c22c2', c: '#f1c9ff', d: '#ff45c0', e: '#ffffff', h: '#2ee6ff' },
};
const RAINBOW = ['#ff3b3b', '#ff9a2e', '#ffe23d', '#39ff88', '#2ea8ff', '#b04cff'];

type Shape = 'round' | 'square' | 'crown' | 'bar';
/** One layer of a turned piece: half-width in voxels, paint, outline. */
type Layer = [number, Key, Shape?];

// Bottom to top.
const TURNED: Partial<Record<PieceType, Layer[]>> = {
  [PieceType.Pawn]: [
    [4, 'b'],
    [3, 'a'],
    [2, 'a'],
    [1, 'a'],
    [2, 'd'],
    [2, 'a'],
    [2, 'a'],
    [1, 'c'],
  ],
  [PieceType.Rook]: [
    [4, 'b'],
    [3, 'a'],
    [3, 'a'],
    [2, 'a'],
    [2, 'a'],
    [3, 'd'],
    [4, 'a', 'square'],
    [4, 'a', 'crown'],
    [4, 'c', 'crown'],
  ],
  [PieceType.Bishop]: [
    [4, 'b'],
    [3, 'a'],
    [2, 'a'],
    [1, 'a'],
    [2, 'd'],
    [1, 'a'],
    [2, 'a'],
    [3, 'a'],
    [2, 'a'],
    [1, 'a'],
    [0, 'd'],
  ],
  [PieceType.Queen]: [
    [4, 'b'],
    [3, 'a'],
    [3, 'a'],
    [2, 'a'],
    [2, 'a'],
    [1, 'a'],
    [1, 'a'],
    [2, 'd'],
    [2, 'a'],
    [3, 'a'],
    [3, 'd', 'crown'],
    [0, 'c'],
  ],
  [PieceType.King]: [
    [4, 'b'],
    [3, 'a'],
    [3, 'a'],
    [2, 'a'],
    [2, 'a'],
    [2, 'a'],
    [1, 'a'],
    [2, 'd'],
    [3, 'a'],
    [3, 'a'],
    [0, 'd'],
    [1, 'd', 'bar'],
    [0, 'd'],
  ],
};

// Side views looking along +x, top row first, x = -4 … 4 left to right.
// They stand on the same two-layer base as the turned pieces.
const KNIGHT = [
  '...aa....',
  '..aaaa...',
  '.daaeaa..',
  '.daaaaaa.',
  '.daaaaaaa',
  '.daaa.aaa',
  '.daaa....',
  '..daaa...',
  '..aaaaa..',
];
const UNICORN = [
  '......h..',
  '.....h...',
  '...aah...',
  '..aaaa...',
  '.raaeaa..',
  '.raaaaaa.',
  '.raaaaaaa',
  '.raaa.aaa',
  '.raaa....',
  '..raaa...',
  '..aaaaa..',
];
const BASE: Layer[] = [
  [4, 'b'],
  [3, 'a'],
];

type Voxels = Map<string, Key>;
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

const inShape = (dx: number, dz: number, hw: number, shape: Shape) => {
  const ax = Math.abs(dx);
  const az = Math.abs(dz);
  if (ax > hw || az > hw) return false;
  switch (shape) {
    case 'square':
      return true;
    case 'round':
      // Trim the corners of wider layers so they read as round
      return hw < 2 || ax !== hw || az !== hw;
    case 'crown':
      // Alternate merlons round the rim, over a filled middle
      return Math.max(ax, az) < hw - 1 || (Math.max(ax, az) === hw && (ax + az) % 2 === 0);
    case 'bar':
      return az === 0;
  }
};

const turn = (layers: Layer[], out: Voxels = new Map(), from = 0) => {
  layers.forEach(([hw, k, shape = 'round'], i) => {
    for (let dx = -hw; dx <= hw; dx++)
      for (let dz = -hw; dz <= hw; dz++)
        if (inShape(dx, dz, hw, shape)) out.set(key(dx, from + i, dz), k);
  });
  return out;
};

const extrude = (rows: string[]) => {
  const out = turn(BASE);
  const ears = rows.findIndex((row) => row.includes('a'));
  rows.forEach((row, r) => {
    const y = BASE.length + rows.length - 1 - r;
    [...row].forEach((ch, i) => {
      if (ch === '.') return;
      const x = i - 4;
      // Ears stand at the sides of the head; the horn sits in the middle
      const depths = ch === 'h' ? [0] : r === ears ? [-1, 1] : [-1, 0, 1];
      for (const z of depths) {
        const k = ch === 'e' && z === 0 ? 'a' : (ch as Key);
        out.set(key(x, y, z), k);
      }
    });
  });
  return out;
};

const modelOf = (type: PieceType): Voxels => {
  if (type === PieceType.Knight) return extrude(KNIGHT);
  if (type === PieceType.Unicorn) return extrude(UNICORN);
  return turn(TURNED[type] ?? []);
};

// The six faces of a unit cube: normal, then its four corners in
// counter-clockwise order seen from outside.
const FACES: [number[], number[][]][] = [
  [
    [1, 0, 0],
    [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1],
    ],
  ],
  [
    [-1, 0, 0],
    [
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
      [0, 0, 0],
    ],
  ],
  [
    [0, 1, 0],
    [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
  ],
  [
    [0, -1, 0],
    [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
  ],
  [
    [0, 0, 1],
    [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
  ],
  [
    [0, 0, -1],
    [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
  ],
];

/**
 * Meshes a voxel model: only faces with open air beside them, two triangles
 * each. `grow` pushes every face out (the outline shell); `paint` colours a
 * voxel, or leaves the geometry uncoloured when absent.
 */
const mesh = (voxels: Voxels, paint?: (k: Key, y: number) => string, grow = 0) => {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const c = new Color();
  for (const [id, k] of voxels) {
    const [x, y, z] = id.split(',').map(Number);
    if (paint) c.set(paint(k, y));
    for (const [n, corners] of FACES) {
      if (voxels.has(key(x + n[0], y + n[1], z + n[2]))) continue;
      const quad = corners.map(([cx, cy, cz]) => [
        (x - 0.5 + cx) * VOXEL + (cx ? grow : -grow),
        // (the shell never reaches below the floor)
        (y + cy) * VOXEL + (cy ? grow : y === 0 ? 0 : -grow),
        (z - 0.5 + cz) * VOXEL + (cz ? grow : -grow),
      ]);
      // Shading is baked in per face, like hand-painted voxel art: lit
      // from above and a little from the front, darker round the sides.
      const shade = n[1] > 0 ? 1 : n[1] < 0 ? 0.5 : n[2] !== 0 ? 0.84 : 0.7;
      for (const i of [0, 1, 2, 0, 2, 3]) {
        pos.push(...quad[i]);
        nor.push(...n);
        if (paint) col.push(c.r * shade, c.g * shade, c.b * shade);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  if (paint) g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.computeBoundingSphere();
  return g;
};

const models = new Map<PieceType, Voxels>();
const model = (type: PieceType) => {
  let m = models.get(type);
  if (!m) {
    m = modelOf(type);
    models.set(type, m);
  }
  return m;
};

const bodies = new Map<string, BufferGeometry>();
/** A piece's coloured voxel mesh for one army. */
export const bodyGeometry = (type: PieceType, color: PieceColor) => {
  const id = `${type}-${color}`;
  let g = bodies.get(id);
  if (!g) {
    const p = PALETTES[color];
    g = mesh(model(type), (k, y) => (k === 'r' ? RAINBOW[(((8 - y) % 6) + 6) % 6] : p[k]));
    bodies.set(id, g);
  }
  return g;
};

const outlines = new Map<PieceType, BufferGeometry>();
/** A slightly swollen copy of a piece, drawn inside out as its dark outline. */
export const outlineGeometry = (type: PieceType) => {
  let g = outlines.get(type);
  if (!g) {
    g = mesh(model(type), undefined, VOXEL * 0.3);
    outlines.set(type, g);
  }
  return g;
};

/** Every voxel colour of a piece, for its debris when it is blown apart. */
export const debrisColors = (type: PieceType, color: PieceColor) => {
  const p = PALETTES[color];
  const counts = new Map<string, number>();
  for (const k of model(type).values()) {
    const c = k === 'r' ? RAINBOW[0] : p[k];
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  // Weighted by how much of the piece is that colour
  return [...counts].flatMap(([c, n]) => Array<string>(Math.max(1, Math.round(n / 12))).fill(c));
};

/** Height of a piece's model, world units. */
export const heightOf = (type: PieceType) => {
  let top = 0;
  for (const id of model(type).keys()) top = Math.max(top, Number(id.split(',')[1]) + 1);
  return top * VOXEL;
};
