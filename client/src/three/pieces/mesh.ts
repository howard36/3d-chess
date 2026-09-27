import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Low-level mesh building for the piece set: a parametric grid surface with
// smooth, seam-free normals (lathes, sweeps, the horn's ridge), flat
// polygons, and the merge that turns a piece's shells into one geometry per
// part. Every geometry built here carries position, normal and uv, so any of
// them can be merged with any other.

export type Vec3 = [number, number, number];

export interface GridSurface {
  /** Quads along u (columns of vertices: `cols + 1`). */
  cols: number;
  /** Rows of vertices along v (quads: `rows - 1`). */
  rows: number;
  /** Position of vertex (i, j), i in 0..cols, j in 0..rows - 1. */
  point: (i: number, j: number) => Vec3;
  /** Column `cols` coincides with column 0 (a full revolution). */
  wrapU?: boolean;
  /** Row `rows - 1` coincides with row 0 (a closed sweep, e.g. a tube). */
  wrapV?: boolean;
  /** Rows that collapse to a point (a lathe's poles): one shared normal each. */
  poleRows?: number[];
  /** Texture coordinates; defaults to (i / cols, j / (rows - 1)). */
  uv?: (i: number, j: number) => [number, number];
  /** Wind the other way (normals point along dv × du instead of du × dv). */
  flip?: boolean;
}

/**
 * A grid of quads over (u, v) with area-weighted vertex normals. Seams
 * (wrapU / wrapV) keep separate vertices for their texture coordinates but
 * share normals, so they never show; two consecutive identical rows make a
 * hard edge (the zero-area quads between them add nothing to either side).
 * Faces are wound so their normal is dv × du: outward for a lathe whose
 * profile runs bottom to top with u turning from +x toward +z.
 */
export const gridSurface = ({
  cols,
  rows,
  point,
  wrapU = false,
  wrapV = false,
  poleRows = [],
  uv,
  flip = false,
}: GridSurface): BufferGeometry => {
  const stride = cols + 1;
  const count = stride * rows;
  const position = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const k = j * stride + i;
      position.set(point(i, j), k * 3);
      uvs.set(uv ? uv(i, j) : [i / cols, j / Math.max(1, rows - 1)], k * 2);
    }
  }
  // Canonical vertex per (wrapped) grid position, for the shared normals
  const poles = new Set(poleRows);
  const canon = (i: number, j: number) => {
    const jj = wrapV && j === rows - 1 ? 0 : j;
    if (poles.has(jj)) return jj * stride;
    const ii = wrapU && i === cols ? 0 : i;
    return jj * stride + ii;
  };
  const index: number[] = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * stride + i;
      const b = a + 1;
      const d = a + stride;
      const c = d + 1;
      if (flip) index.push(a, b, d, b, c, d);
      else index.push(a, d, b, b, d, c);
    }
  }
  const acc = new Float32Array(count * 3);
  const pa = new Vector3();
  const pb = new Vector3();
  const pc = new Vector3();
  const e1 = new Vector3();
  const e2 = new Vector3();
  const canonOf = new Int32Array(count);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i <= cols; i++) canonOf[j * stride + i] = canon(i, j);
  }
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
    pa.fromArray(position, a * 3);
    pb.fromArray(position, b * 3);
    pc.fromArray(position, c * 3);
    e1.subVectors(pb, pa);
    e2.subVectors(pc, pa);
    e1.cross(e2);
    for (const v of [a, b, c]) {
      const o = canonOf[v] * 3;
      acc[o] += e1.x;
      acc[o + 1] += e1.y;
      acc[o + 2] += e1.z;
    }
  }
  const normal = new Float32Array(count * 3);
  const n = new Vector3();
  for (let k = 0; k < count; k++) {
    n.fromArray(acc, canonOf[k] * 3);
    if (n.lengthSq() === 0) n.set(0, 1, 0);
    n.normalize().toArray(normal, k * 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(position, 3));
  g.setAttribute('normal', new BufferAttribute(normal, 3));
  g.setAttribute('uv', new BufferAttribute(uvs, 2));
  g.setIndex(index);
  return g;
};

/**
 * A flat convex polygon (vertices counter-clockwise seen from `normal`'s
 * side), fanned from its first vertex, with planar texture coordinates.
 */
export const flatPolygon = (points: Vec3[], normal: Vec3): BufferGeometry => {
  const count = points.length;
  const position = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  points.forEach((p, k) => {
    position.set(p, k * 3);
    normals.set(normal, k * 3);
    uvs.set([p[0] + p[2], p[1]], k * 2);
  });
  const index: number[] = [];
  for (let k = 1; k < count - 1; k++) index.push(0, k, k + 1);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(position, 3));
  g.setAttribute('normal', new BufferAttribute(normals, 3));
  g.setAttribute('uv', new BufferAttribute(uvs, 2));
  g.setIndex(index);
  return g;
};

/** Keeps only position, normal and uv (adding planar uvs if missing), indexed. */
const normalise = (g: BufferGeometry): BufferGeometry => {
  const c = g.clone();
  for (const name of Object.keys(c.attributes)) {
    if (!['position', 'normal', 'uv'].includes(name)) c.deleteAttribute(name);
  }
  if (!c.getAttribute('normal')) c.computeVertexNormals();
  if (!c.getAttribute('uv')) {
    const p = c.getAttribute('position');
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) uv.set([p.getX(i) + p.getZ(i), p.getY(i)], i * 2);
    c.setAttribute('uv', new BufferAttribute(uv, 2));
  }
  if (!c.index) c.setIndex([...Array(c.getAttribute('position').count).keys()]);
  c.morphAttributes = {} as BufferGeometry['morphAttributes'];
  return c;
};

/**
 * Merges shells into one indexed geometry (welding identical vertices, which
 * keeps hard edges hard: their normals differ), with bounds computed.
 */
export const mergeShells = (shells: BufferGeometry[]): BufferGeometry => {
  const parts = shells.map(normalise);
  const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts);
  if (parts.length > 1) parts.forEach((p) => p.dispose());
  if (!merged) throw new Error('mergeShells: incompatible shells');
  const welded = mergeVertices(merged, 1e-6);
  if (welded !== merged) merged.dispose();
  welded.computeBoundingBox();
  welded.computeBoundingSphere();
  return welded;
};

/** Triangles in a geometry (indexed or not). */
export const triangleCount = (g: BufferGeometry): number =>
  (g.index ? g.index.count : g.getAttribute('position').count) / 3;
