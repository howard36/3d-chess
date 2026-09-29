import { BufferAttribute, BufferGeometry } from 'three';

// Low-level mesh building for the piece set: a parametric grid surface with
// smooth, seam-free normals (lathes, sweeps, the horn's ridge), flat
// polygons, and the merge that turns a piece's shells into one geometry per
// part. Every geometry built here carries position, normal and uv, so any of
// them can be merged with any other.

export type Vec3 = [number, number, number];

export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

interface GridSurface {
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
  const canonOf = new Int32Array(count);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i <= cols; i++) canonOf[j * stride + i] = canon(i, j);
  }
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3;
    const b = index[t + 1] * 3;
    const c = index[t + 2] * 3;
    const ux = position[b] - position[a];
    const uy = position[b + 1] - position[a + 1];
    const uz = position[b + 2] - position[a + 2];
    const vx = position[c] - position[a];
    const vy = position[c + 1] - position[a + 1];
    const vz = position[c + 2] - position[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (let q = 0; q < 3; q++) {
      const o = canonOf[index[t + q]] * 3;
      acc[o] += nx;
      acc[o + 1] += ny;
      acc[o + 2] += nz;
    }
  }
  const normal = new Float32Array(count * 3);
  for (let v = 0; v < count; v++) {
    const o = canonOf[v] * 3;
    let x = acc[o];
    let y = acc[o + 1];
    let z = acc[o + 2];
    const len = Math.sqrt(x * x + y * y + z * z);
    if (len === 0) {
      x = 0;
      y = 1;
      z = 0;
    } else {
      x /= len;
      y /= len;
      z /= len;
    }
    normal[v * 3] = x;
    normal[v * 3 + 1] = y;
    normal[v * 3 + 2] = z;
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

/**
 * Merges shells into one indexed geometry: position, normal and uv only
 * (planar uvs where a shell has none), with bounds computed. The shells'
 * own vertices are kept as they are (no welding): each builder already
 * shares what should be shared and keeps apart what should not (seams for
 * uvs, hard edges), and welding every piece at load would cost more than
 * the rest of the build.
 */
export const mergeShells = (shells: BufferGeometry[]): BufferGeometry => {
  let vertices = 0;
  let indices = 0;
  for (const g of shells) {
    const n = g.getAttribute('position').count;
    vertices += n;
    indices += g.index ? g.index.count : n;
  }
  const position = new Float32Array(vertices * 3);
  const normal = new Float32Array(vertices * 3);
  const uv = new Float32Array(vertices * 2);
  const index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  let v = 0;
  let k = 0;
  for (const shell of shells) {
    let g = shell;
    if (!g.getAttribute('normal')) {
      g = g.clone();
      g.computeVertexNormals();
    }
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const t = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      const o = (v + i) * 3;
      position[o] = p.getX(i);
      position[o + 1] = p.getY(i);
      position[o + 2] = p.getZ(i);
      normal[o] = n.getX(i);
      normal[o + 1] = n.getY(i);
      normal[o + 2] = n.getZ(i);
      uv[(v + i) * 2] = t ? t.getX(i) : p.getX(i) + p.getZ(i);
      uv[(v + i) * 2 + 1] = t ? t.getY(i) : p.getY(i);
    }
    if (g.index) {
      const src = g.index;
      for (let i = 0; i < src.count; i++) index[k++] = src.getX(i) + v;
    } else {
      for (let i = 0; i < p.count; i++) index[k++] = i + v;
    }
    if (g !== shell) g.dispose();
    v += p.count;
  }
  const merged = new BufferGeometry();
  merged.setAttribute('position', new BufferAttribute(position, 3));
  merged.setAttribute('normal', new BufferAttribute(normal, 3));
  merged.setAttribute('uv', new BufferAttribute(uv, 2));
  merged.setIndex(new BufferAttribute(index, 1));
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
};

/** Triangles in a geometry (indexed or not). */
export const triangleCount = (g: BufferGeometry): number =>
  (g.index ? g.index.count : g.getAttribute('position').count) / 3;
