import { BufferAttribute, BufferGeometry } from 'three';
import type { Vec3 } from './mesh';

// Signed-distance sculpting for the carved parts of the set (the knight's
// head and mane). A shape is a function of a point, negative inside; it is
// built from a few primitives blended with smooth unions, then meshed by
// surface nets: one vertex per grid cell the surface crosses, relaxed onto
// the surface, with normals from the field's gradient, so the result shades
// smoothly at a modest triangle count.

export type Sdf = ((x: number, y: number, z: number) => number) & {
  /**
   * A sphere round the shape, for skipping it when far away: the value is
   * never below s * (distance to c - r).
   */
  bound?: { c: Vec3; r: number; s: number };
};

const withBound = (f: Sdf, c: Vec3, r: number, s = 1): Sdf => {
  f.bound = { c, r, s };
  return f;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Polynomial smooth minimum: a union that fillets the join with radius ~k. */
const smin = (a: number, b: number, k: number) => {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
};

/** Smooth maximum: a filleted intersection (or, with -b, a carve). */
export const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);

/** Ellipsoid (a close bound, exact on the surface). */
export const ellipsoid = (c: Vec3, r: Vec3): Sdf => {
  const [cx, cy, cz] = c;
  const [rx, ry, rz] = r;
  const rmin = Math.min(rx, ry, rz);
  return withBound(
    (x, y, z) => {
      const px = (x - cx) / rx;
      const py = (y - cy) / ry;
      const pz = (z - cz) / rz;
      const k0 = Math.sqrt(px * px + py * py + pz * pz);
      const qx = px / rx;
      const qy = py / ry;
      const qz = pz / rz;
      const k1 = Math.sqrt(qx * qx + qy * qy + qz * qz);
      return k1 === 0 ? -rmin : (k0 * (k0 - 1)) / k1;
    },
    c,
    Math.max(rx, ry, rz),
    rmin / Math.max(rx, ry, rz),
  );
};

/**
 * A cone with rounded ends from a (radius ra) to b (radius rb): a tapered
 * capsule. `squash` scales it across (z), for a flattened limb.
 */
export const roundCone = (a: Vec3, b: Vec3, ra: number, rb: number, squash = 1): Sdf => {
  const [ax, ay, az] = a;
  const bax = b[0] - ax;
  const bay = b[1] - ay;
  const baz = b[2] - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = ra - rb;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const scale = Math.min(1, squash);
  const len = Math.sqrt(l2);
  return withBound(
    (x, y, z0) => {
      const pax = x - ax;
      const pay = y - ay;
      const paz = (z0 - az) / squash;
      const yy = pax * bax + pay * bay + paz * baz;
      const zz = yy - l2;
      const qx = pax * l2 - bax * yy;
      const qy = pay * l2 - bay * yy;
      const qz = paz * l2 - baz * yy;
      const x2 = qx * qx + qy * qy + qz * qz;
      const y2 = yy * yy * l2;
      const z2 = zz * zz * l2;
      const k = Math.sign(rr) * rr * rr * x2;
      let d: number;
      if (Math.sign(zz) * a2 * z2 > k) d = Math.sqrt(x2 + z2) * il2 - rb;
      else if (Math.sign(yy) * a2 * y2 < k) d = Math.sqrt(x2 + y2) * il2 - ra;
      else d = (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - ra;
      return d * scale;
    },
    [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
    len / 2 + Math.max(ra, rb),
    scale,
  );
};

/** Half-space below the plane through `p` with outward normal `n` (unit). */
export const halfSpace =
  (p: Vec3, n: Vec3): Sdf =>
  (x, y, z) =>
    (x - p[0]) * n[0] + (y - p[1]) * n[1] + (z - p[2]) * n[2];

/** Mirrors a shape across z = 0 (a pair of ears, eyes, nostrils). */
export const mirrorZ = (f: Sdf): Sdf => {
  const g: Sdf = (x, y, z) => f(x, y, Math.abs(z));
  if (f.bound) {
    const { c, r, s } = f.bound;
    g.bound = { c: [c[0], c[1], 0], r: r + Math.abs(c[2]), s };
  }
  return g;
};

/**
 * Smooth union of several shapes, all with the same fillet. A shape whose
 * bound puts it beyond the fillet's reach is skipped (it cannot change the
 * result), which keeps a union of many parts cheap to evaluate.
 */
export const unite = (k: number, ...fs: Sdf[]): Sdf => {
  const n = fs.length;
  const bx = fs.map((f) => f.bound?.c[0] ?? 0);
  const by = fs.map((f) => f.bound?.c[1] ?? 0);
  const bz = fs.map((f) => f.bound?.c[2] ?? 0);
  const br = fs.map((f) => f.bound?.r ?? Infinity);
  const bs = fs.map((f) => f.bound?.s ?? 0);
  const g: Sdf = (x, y, z) => {
    let d = Infinity;
    for (let i = 0; i < n; i++) {
      if (br[i] !== Infinity) {
        const dx = x - bx[i];
        const dy = y - by[i];
        const dz = z - bz[i];
        const lower = bs[i] * (Math.sqrt(dx * dx + dy * dy + dz * dz) - br[i]);
        if (lower >= d + k) continue;
      }
      d = smin(d, fs[i](x, y, z), k);
    }
    return d;
  };
  if (fs.every((f) => f.bound)) {
    // A sphere round all the parts' spheres
    const c: Vec3 = [
      bx.reduce((a, v) => a + v, 0) / n,
      by.reduce((a, v) => a + v, 0) / n,
      bz.reduce((a, v) => a + v, 0) / n,
    ];
    const r = Math.max(
      ...fs.map((_, i) => Math.hypot(bx[i] - c[0], by[i] - c[1], bz[i] - c[2]) + br[i]),
    );
    g.bound = { c, r, s: Math.min(...bs) };
  }
  return g;
};

/** Carves `cut` out of `f` with a fillet of k. */
export const carve =
  (f: Sdf, cut: Sdf, k: number): Sdf =>
  (x, y, z) =>
    smax(f(x, y, z), -cut(x, y, z), k);

/** A 2D field: signed distance to a closed outline, negative inside. */
type Field2 = (x: number, y: number) => number;

/** Exact signed distance from (x, y) to a closed polygon. */
const polygonDistance = (poly: readonly (readonly [number, number])[], x: number, y: number) => {
  let d = Infinity;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const ex = xj - xi;
    const ey = yj - yi;
    const wx = x - xi;
    const wy = y - yi;
    const h = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey || 1), 0, 1);
    const bx = wx - ex * h;
    const by = wy - ey * h;
    d = Math.min(d, bx * bx + by * by);
    if (yi > y !== yj > y && x < xi + ((y - yi) * ex) / ey) inside = !inside;
  }
  return (inside ? -1 : 1) * Math.sqrt(d);
};

/**
 * The signed distance to a closed outline, sampled once on a grid over the
 * box and read back bilinearly (exact outside the box): cheap enough to
 * evaluate a few hundred thousand times while meshing.
 */
export const outlineField = (
  poly: readonly (readonly [number, number])[],
  { min, max, step }: { min: [number, number]; max: [number, number]; step: number },
): Field2 => {
  const nx = Math.ceil((max[0] - min[0]) / step) + 1;
  const ny = Math.ceil((max[1] - min[1]) / step) + 1;
  const grid = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      grid[j * nx + i] = polygonDistance(poly, min[0] + i * step, min[1] + j * step);
    }
  }
  return (x, y) => {
    const fx = (x - min[0]) / step;
    const fy = (y - min[1]) / step;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= nx - 1 || j >= ny - 1) return polygonDistance(poly, x, y);
    const tx = fx - i;
    const ty = fy - j;
    const o = j * nx + i;
    const a = grid[o] + (grid[o + 1] - grid[o]) * tx;
    const b = grid[o + nx] + (grid[o + nx + 1] - grid[o + nx]) * tx;
    return a + (b - a) * ty;
  };
};

/**
 * An outline in the x-y plane given thickness across z, as carved from a
 * board: flat sides `halfWidth(x, y)` from the middle, rounding over to the
 * outline within `round(x, y)` of it (an elliptical edge, like a carver's
 * roundover: broad and soft on a chest, tight on an ear). An approximate
 * distance, never far above the true one.
 */
export const carvedSlab = (
  side: Field2,
  halfWidth: (x: number, y: number) => number,
  round: number | ((x: number, y: number) => number),
): Sdf => {
  const roundAt = typeof round === 'number' ? () => round : round;
  return (x, y, z) => {
    const w = halfWidth(x, y);
    const r = roundAt(x, y);
    const u = Math.max(r + side(x, y), 0) / r;
    const v = Math.abs(z) / w;
    return (Math.sqrt(u * u + v * v) - 1) * Math.min(r, w);
  };
};

/**
 * An ellipsoid with radii r along the orthonormal axes a, b, n (a lock of
 * a mane, lying in any direction).
 */
export const orientedEllipsoid = (c: Vec3, r: Vec3, a: Vec3, b: Vec3, n: Vec3): Sdf => {
  const e = ellipsoid([0, 0, 0], r);
  const f: Sdf = (x, y, z) => {
    const dx = x - c[0];
    const dy = y - c[1];
    const dz = z - c[2];
    return e(
      dx * a[0] + dy * a[1] + dz * a[2],
      dx * b[0] + dy * b[1] + dz * b[2],
      dx * n[0] + dy * n[1] + dz * n[2],
    );
  };
  f.bound = { c, r: Math.max(...r), s: e.bound!.s };
  return f;
};

/**
 * Scales a shape about `origin` in x and y (its profile) by s, leaving its
 * thickness across z as it is.
 */
export const scaleProfile = (f: Sdf, s: number, origin: [number, number]): Sdf => {
  const g: Sdf = (x, y, z) =>
    f(origin[0] + (x - origin[0]) / s, origin[1] + (y - origin[1]) / s, z) * Math.min(1, s);
  return g;
};

/** An ellipsoid turned by `angle` (radians) about the z axis. */
export const tiltedEllipsoid = (c: Vec3, r: Vec3, angle: number): Sdf => {
  const e = ellipsoid([0, 0, 0], r);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const f: Sdf = (x, y, z) => {
    const dx = x - c[0];
    const dy = y - c[1];
    return e(dx * cos + dy * sin, -dx * sin + dy * cos, z - c[2]);
  };
  f.bound = { c, r: Math.max(...r), s: e.bound!.s };
  return f;
};

interface NetsOptions {
  min: Vec3;
  max: Vec3;
  /** Grid spacing. */
  step: number;
  /** Relaxation passes pulling each vertex onto the surface. */
  project?: number;
  /** Shade by the field's gradient (skip it when the mesh is decimated next). */
  normals?: boolean;
}

/**
 * Meshes the zero set of `f` inside the box by (naive) surface nets. The box
 * is padded by one cell, so a shape inside it comes out closed.
 */
export const surfaceNets = (
  f: Sdf,
  { min, max, step: h, project = 2, normals = true }: NetsOptions,
): BufferGeometry => {
  const o = [min[0] - h, min[1] - h, min[2] - h];
  const n = [0, 1, 2].map((a) => Math.ceil((max[a] - min[a]) / h) + 3);
  const [nx, ny, nz] = n;
  const at = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  const values = new Float32Array(nx * ny * nz);
  const sample = (i: number, j: number, k: number) => {
    const edge = i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1;
    const v = f(o[0] + i * h, o[1] + j * h, o[2] + k * h);
    // The padding is always outside, so the net closes
    return edge ? Math.max(v, 1e-6) : v;
  };
  // Narrow band: sample every other node first; a node whose coarse cell is
  // far from the surface at every corner (and on one side of it) takes the
  // nearest of them, and only nodes near the surface are evaluated exactly.
  // (The shapes here are distance bounds, so a coarse value of d means no
  // surface within d.)
  const coarse = (n: number, c: number) => Math.min(c, n - 1);
  for (let k = 0; k < nz; k += 2) {
    for (let j = 0; j < ny; j += 2) {
      for (let i = 0; i < nx; i += 2) values[at(i, j, k)] = sample(i, j, k);
    }
  }
  // Last planes, where a dimension is even (so its end is not a coarse node)
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const onCoarse =
          (i % 2 === 0 || i === nx - 1) &&
          (j % 2 === 0 || j === ny - 1) &&
          (k % 2 === 0 || k === nz - 1);
        if (onCoarse && (i % 2 !== 0 || j % 2 !== 0 || k % 2 !== 0))
          values[at(i, j, k)] = sample(i, j, k);
      }
    }
  }
  const far = 4 * h;
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (i % 2 === 0 && j % 2 === 0 && k % 2 === 0) continue;
        const onCoarse =
          (i % 2 === 0 || i === nx - 1) &&
          (j % 2 === 0 || j === ny - 1) &&
          (k % 2 === 0 || k === nz - 1);
        if (onCoarse) continue;
        const i0 = i - (i % 2);
        const j0 = j - (j % 2);
        const k0 = k - (k % 2);
        let nearest = Infinity;
        let sign = 0;
        let mixed = false;
        for (let c = 0; c < 8 && !mixed; c++) {
          const v =
            values[
              at(
                coarse(nx, i0 + (c & 1) * 2),
                coarse(ny, j0 + ((c >> 1) & 1) * 2),
                coarse(nz, k0 + ((c >> 2) & 1) * 2),
              )
            ];
          const sg = v < 0 ? -1 : 1;
          if (sign === 0) sign = sg;
          if (sg !== sign || Math.abs(v) < far) mixed = true;
          nearest = Math.min(nearest, Math.abs(v));
        }
        values[at(i, j, k)] = mixed ? sample(i, j, k) : sign * (nearest - far / 2);
      }
    }
  }

  // One vertex per cell with a sign change: the mean of its edge crossings
  const cellVertex = new Int32Array(nx * ny * nz).fill(-1);
  const verts: number[] = [];
  const corners = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, 1],
  ];
  const edges = [
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7],
    [0, 2],
    [1, 3],
    [4, 6],
    [5, 7],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  const cv = new Float64Array(8);
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let inside = 0;
        for (let c = 0; c < 8; c++) {
          const [di, dj, dk] = corners[c];
          cv[c] = values[at(i + di, j + dj, k + dk)];
          if (cv[c] < 0) inside++;
        }
        if (inside === 0 || inside === 8) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let m = 0;
        for (const [a, b] of edges) {
          if (cv[a] < 0 === cv[b] < 0) continue;
          const t = cv[a] / (cv[a] - cv[b]);
          sx += corners[a][0] + (corners[b][0] - corners[a][0]) * t;
          sy += corners[a][1] + (corners[b][1] - corners[a][1]) * t;
          sz += corners[a][2] + (corners[b][2] - corners[a][2]) * t;
          m++;
        }
        cellVertex[at(i, j, k)] = verts.length / 3;
        verts.push(o[0] + (i + sx / m) * h, o[1] + (j + sy / m) * h, o[2] + (k + sz / m) * h);
      }
    }
  }

  // A quad round every grid edge the surface crosses, facing outward
  const index: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if ([a, b, c, d].some((v) => v < 0)) return;
    if (flip) [b, d] = [d, b];
    // Split along the shorter diagonal
    const dist = (p: number, q: number) =>
      (verts[p * 3] - verts[q * 3]) ** 2 +
      (verts[p * 3 + 1] - verts[q * 3 + 1]) ** 2 +
      (verts[p * 3 + 2] - verts[q * 3 + 2]) ** 2;
    if (dist(a, c) <= dist(b, d)) index.push(a, b, c, a, c, d);
    else index.push(a, b, d, b, c, d);
  };
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const v0 = values[at(i, j, k)] < 0;
        // Edge along x to (i + 1, j, k); the cells round it lie in (y, z)
        if (i < nx - 1 && v0 !== values[at(i + 1, j, k)] < 0) {
          quad(
            cellVertex[at(i, j - 1, k - 1)],
            cellVertex[at(i, j, k - 1)],
            cellVertex[at(i, j, k)],
            cellVertex[at(i, j - 1, k)],
            !v0,
          );
        }
        // Along y; the cells lie in (z, x)
        if (j < ny - 1 && v0 !== values[at(i, j + 1, k)] < 0) {
          quad(
            cellVertex[at(i - 1, j, k - 1)],
            cellVertex[at(i - 1, j, k)],
            cellVertex[at(i, j, k)],
            cellVertex[at(i, j, k - 1)],
            !v0,
          );
        }
        // Along z; the cells lie in (x, y)
        if (k < nz - 1 && v0 !== values[at(i, j, k + 1)] < 0) {
          quad(
            cellVertex[at(i - 1, j - 1, k)],
            cellVertex[at(i, j - 1, k)],
            cellVertex[at(i, j, k)],
            cellVertex[at(i - 1, j, k)],
            !v0,
          );
        }
      }
    }
  }

  // Relax every vertex onto the surface, then shade by the field's gradient
  const e = h * 0.05;
  const grad = (x: number, y: number, z: number): Vec3 => [
    f(x + e, y, z) - f(x - e, y, z),
    f(x, y + e, z) - f(x, y - e, z),
    f(x, y, z + e) - f(x, y, z - e),
  ];
  const count = verts.length / 3;
  const position = new Float32Array(verts);
  const normal = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  for (let v = 0; v < count; v++) {
    let x = position[v * 3];
    let y = position[v * 3 + 1];
    let z = position[v * 3 + 2];
    for (let pass = 0; pass < project; pass++) {
      const d = f(x, y, z);
      const g = grad(x, y, z);
      const len = Math.hypot(...g) / (2 * e);
      if (len < 1e-6) break;
      const s = clamp(d / len, -h * 0.5, h * 0.5) / len / (2 * e);
      x -= g[0] * s;
      y -= g[1] * s;
      z -= g[2] * s;
    }
    position.set([x, y, z], v * 3);
    if (normals) {
      const g = grad(x, y, z);
      const len = Math.hypot(...g) || 1;
      normal.set([g[0] / len, g[1] / len, g[2] / len], v * 3);
    }
    uv.set([x + z, y], v * 2);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('normal', new BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  geometry.setIndex(index);
  return geometry;
};
