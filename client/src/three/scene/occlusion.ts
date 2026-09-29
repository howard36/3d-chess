import { BufferAttribute, MathUtils } from 'three';
import type { BufferGeometry } from 'three';
import { PieceType } from '../../engine/pieces';
import { PIECE_PARTS, loadBakedKnight, partsGeometry, pieceSet } from '../pieces';
import type { PiecePart, PieceParts, PieceSet } from '../pieces';

// The game's copy of the Staunton set: the same shapes, with two
// numbers baked into every vertex's uv, so one small shader can paint and
// shade a whole piece in a single draw:
//
//   uv.x  how open the surface is to the light round it (1 open, 0 shut in):
//         ambient occlusion, baked once per piece. The rook's hollow and the
//         gaps of its battlements, the bishop's cut, the grooves of the
//         unicorn's twist, the knight's eye and mane, the coves under every
//         collar darken, so a piece shows its form, and the charcoal army
//         its features, in light and shadow.
//   uv.y  the part (0 body, 1 collar, 2 accent, 3 the floor of the rook's
//         well, 4 foot band), so the shader gives each its own finish. The
//         well's floor shares triangles with the rest of the rook's accent,
//         so its id is the accent's next: a blend of the two is one or the
//         other, never a third part.
//
// The occlusion is measured against a voxel copy of the piece (a grid of
// cells about a hundredth of a unit, filled by casting vertical rays through
// its closed shells) and the floor it stands on: from each vertex, rays over
// the hemisphere round its normal, a short way out, and the share that meet
// the solid. Each piece is baked the first time it is drawn, in a few
// milliseconds. The shared set is never touched (clone first).

/** The part a vertex belongs to, as the shader reads it from uv.y. */
export const PART_ID: Record<PiecePart, number> = { body: 0, collar: 1, accent: 2, foot: 4 };
/**
 * The floor of the rook's well, told apart from its sills (the rest of its
 * accent): seen from above it is most of the piece, so it keeps to its
 * army's own value rather than the accent's.
 */
export const WELL_ID = 3;
/** Inside this radius the rook's accent is its well's floor. */
const WELL_RADIUS = 0.1;

// The grid: x and z across the widest base, y from just under the floor to
// over the king's cross
const CELL = 0.0095;
const X0 = -0.3;
const NX = Math.ceil(0.6 / CELL);
const Y0 = -0.03;
const NY = Math.ceil(0.95 / CELL);
// Rays run a little off the cell centres, so none grazes a vertex or runs
// down the axis every turned shell shares
const JX = 0.137;
const JZ = 0.291;

/** Every triangle of `geometries` as vertical-ray crossings, filled into a solid grid. */
const voxelize = (geometries: BufferGeometry[]): Uint8Array => {
  // Each crossing: its column, its height and whether the ray enters or
  // leaves there, in the order found
  const column: number[] = [];
  const height: number[] = [];
  const step: number[] = [];
  for (const g of geometries) {
    const p = g.getAttribute('position');
    const index = g.index;
    const triangles = (index ? index.count : p.count) / 3;
    for (let t = 0; t < triangles; t++) {
      const i0 = index ? index.getX(t * 3) : t * 3;
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      const ax = p.getX(i0);
      const ay = p.getY(i0);
      const az = p.getZ(i0);
      const bx = p.getX(i1);
      const by = p.getY(i1);
      const bz = p.getZ(i1);
      const cx = p.getX(i2);
      const cy = p.getY(i2);
      const cz = p.getZ(i2);
      // The face's upward share (its winding is outward): a ray going up
      // enters the solid through a face turned down, and leaves through one
      // turned up
      const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      if (Math.abs(ny) < 1e-14) continue;
      const enter = ny < 0 ? 1 : -1;
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-14) continue;
      const iFrom = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - X0) / CELL - JX));
      const iTo = Math.min(NX - 1, Math.floor((Math.max(ax, bx, cx) - X0) / CELL - JX));
      const kFrom = Math.max(0, Math.ceil((Math.min(az, bz, cz) - X0) / CELL - JZ));
      const kTo = Math.min(NX - 1, Math.floor((Math.max(az, bz, cz) - X0) / CELL - JZ));
      for (let i = iFrom; i <= iTo; i++) {
        const px = X0 + (i + JX) * CELL;
        for (let k = kFrom; k <= kTo; k++) {
          const pz = X0 + (k + JZ) * CELL;
          const w0 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d;
          const w1 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          column.push(k * NX + i);
          height.push(w0 * ay + w1 * by + w2 * cy);
          step.push(enter);
        }
      }
    }
  }
  // Group the crossings by column, keeping the order found within each
  const columns = NX * NX;
  const start = new Int32Array(columns + 1);
  for (const c of column) start[c + 1]++;
  for (let c = 0; c < columns; c++) start[c + 1] += start[c];
  const order = new Int32Array(column.length);
  const fill = start.slice(0, columns);
  for (let n = 0; n < column.length; n++) order[fill[column[n]]++] = n;

  const solid = new Uint8Array(NX * NX * NY);
  // The floor under the piece is solid too: it shuts in the foot
  const floorTop = Math.floor(-Y0 / CELL - 0.5);
  for (let c = 0; c < columns; c++) {
    for (let j = 0; j <= floorTop; j++) solid[j * NX * NX + c] = 1;
    if (start[c] === start[c + 1]) continue;
    // Up the column, crossings at the same height in the order found
    // (an insertion sort: a column holds a handful of crossings)
    const list = order.subarray(start[c], start[c + 1]);
    for (let m = 1; m < list.length; m++) {
      const n = list[m];
      let at = m;
      while (at > 0 && height[list[at - 1]] > height[n]) {
        list[at] = list[at - 1];
        at--;
      }
      list[at] = n;
    }
    // Inside wherever more shells have been entered than left (shells may
    // overlap: the collars sit round the stems)
    let winding = 0;
    let from = Y0;
    for (const n of list) {
      const y = height[n];
      if (winding > 0) {
        const j0 = Math.max(0, Math.ceil((from - Y0) / CELL - 0.5));
        const j1 = Math.min(NY - 1, Math.floor((y - Y0) / CELL - 0.5));
        for (let j = j0; j <= j1; j++) solid[j * NX * NX + c] = 1;
      }
      winding += step[n];
      from = y;
    }
  }
  return solid;
};

// Directions spread evenly over the sphere (a Fibonacci lattice); each vertex
// uses those on its side
const DIRECTIONS = (() => {
  const n = 80;
  const out: [number, number, number][] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) / n) * 2;
    const r = Math.sqrt(1 - y * y);
    out.push([Math.cos(golden * i) * r, y, Math.sin(golden * i) * r]);
  }
  return out;
})();
// How far each ray looks (piece units): crevices, not the whole piece
const STEPS = [1.3, 2.3, 3.6, 5.2, 7.2, 9.6, 12.5, 16].map((s) => s * CELL);
const REACH = STEPS[STEPS.length - 1];

/** How much darker a face turned straight in toward the axis is. */
const INWARD_SHADE = 0.4;

/** DIRECTIONS flattened (x, y, z each), for the loop below. */
const DIRS = Float64Array.from(DIRECTIONS.flat());

/** Ambient occlusion at each vertex of `g` against `solid`: 1 open, 0 shut in. */
const occlusionOf = (g: BufferGeometry, solid: Uint8Array): Float32Array => {
  const p = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const out = new Float32Array(p.count);
  for (let v = 0; v < p.count; v++) {
    let nx = nrm.getX(v);
    let ny = nrm.getY(v);
    let nz = nrm.getZ(v);
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    // Start just off the surface, clear of its own cells
    const ox = p.getX(v) + nx * CELL * 0.75;
    const oy = p.getY(v) + ny * CELL * 0.75;
    const oz = p.getZ(v) + nz * CELL * 0.75;
    let shut = 0;
    let total = 0;
    for (let d = 0; d < DIRS.length; d += 3) {
      const dx = DIRS[d];
      const dy = DIRS[d + 1];
      const dz = DIRS[d + 2];
      const c = dx * nx + dy * ny + dz * nz;
      // Near-tangent rays would meet the surface's own staircase of cells
      if (c < 0.22) continue;
      total += c;
      for (let k = 0; k < STEPS.length; k++) {
        const s = STEPS[k];
        // The cell the step lands in: off the grid's sides or top is open,
        // below it (the floor) shut
        const i = Math.floor((ox + dx * s - X0) / CELL - JX + 0.5);
        const kz = Math.floor((oz + dz * s - X0) / CELL - JZ + 0.5);
        const j = Math.floor((oy + dy * s - Y0) / CELL);
        if (i < 0 || kz < 0 || i >= NX || kz >= NX || j >= NY) continue;
        if (j < 0 || solid[(j * NX + kz) * NX + i] === 1) {
          // Nearer walls shut in more
          shut += c * (1 - 0.45 * (s / REACH));
          break;
        }
      }
    }
    const open = total > 0 ? 1 - shut / total : 1;
    // A face turned in toward the piece's axis looks into a hollow (the
    // rook's well, the inside of the queen's coronet, a wall of the
    // bishop's cut): seen through a gap it should read as the dark inside,
    // not a lit outside, so it takes a share of shade of its own
    const px = p.getX(v);
    const pz = p.getZ(v);
    const radial = Math.hypot(px, pz);
    const inward =
      radial > 1e-4
        ? Math.max(0, -(nx * px + nz * pz) / radial) * MathUtils.smoothstep(radial, 0.015, 0.05)
        : 0;
    out[v] = open * (1 - INWARD_SHADE * inward);
  }
  return out;
};

/** A piece's parts, cloned, each vertex's uv holding its occlusion and part. */
const bake = (type: PieceType, parts: PieceParts): PieceParts => {
  const present = PIECE_PARTS.filter((part) => parts[part]);
  const solid = voxelize(present.map((part) => parts[part]!));
  const out = {} as PieceParts;
  for (const part of present) {
    const source = parts[part]!;
    const g = source.clone();
    const ao = occlusionOf(source, solid);
    const p = source.getAttribute('position');
    const well = type === PieceType.Rook && part === 'accent';
    const uv = new Float32Array(ao.length * 2);
    for (let i = 0; i < ao.length; i++) {
      uv[i * 2] = ao[i];
      uv[i * 2 + 1] =
        well && Math.hypot(p.getX(i), p.getZ(i)) < WELL_RADIUS ? WELL_ID : PART_ID[part];
    }
    g.setAttribute('uv', new BufferAttribute(uv, 2));
    if (!g.boundingBox) g.computeBoundingBox();
    (out as Record<PiecePart, BufferGeometry>)[part] = g;
  }
  return out;
};

let set: PieceSet | null = null;

/** The set as drawn: the medium set with occlusion and parts baked in, each piece on first use. */
export const bakedSet = (): PieceSet => {
  if (set) return set;
  const source = pieceSet();
  const built = {} as PieceSet;
  for (const type of Object.values(PieceType)) {
    let parts: PieceParts | undefined;
    Object.defineProperty(built, type, {
      enumerable: true,
      get: () => (parts ??= bake(type, source[type])),
    });
  }
  set = built;
  return built;
};

/** The whole piece (every part) as one geometry, uv baked as above. Shared: never edit it. */
export const wholePiece = (type: PieceType): BufferGeometry =>
  partsGeometry(bakedSet(), type, PIECE_PARTS)!;

/**
 * Bakes the set's pieces while the browser is idle, one piece per idle
 * moment, so the first board does not wait for them; the knight last, once
 * its precomputed meshes have loaded (loadBakedKnight). Does nothing where
 * there is no idle callback (tests): each piece is then baked when first drawn.
 */
export const preloadBakedSet = () => {
  if (typeof window === 'undefined' || typeof window.requestIdleCallback !== 'function') return;
  const built = bakedSet();
  const pending = Object.values(PieceType).filter((t) => t !== PieceType.Knight);
  const next = () => {
    const type = pending.shift();
    if (!type) {
      void loadBakedKnight().then(() =>
        window.requestIdleCallback(() => void built[PieceType.Knight], { timeout: 4000 }),
      );
      return;
    }
    void built[type];
    window.requestIdleCallback(next, { timeout: 4000 });
  };
  window.requestIdleCallback(next, { timeout: 4000 });
};
