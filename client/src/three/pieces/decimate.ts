import { BufferAttribute, BufferGeometry } from 'three';
import type { Sdf } from './sdf';

// Quadric-error edge collapse (Garland & Heckbert) for the sculpted parts:
// surface nets spend triangles evenly, this takes them back where the
// surface is flat and keeps them where it turns (ears, nostrils, the jaw).
// Each collapsed vertex is pulled back onto the shape's surface, and normals
// are taken from the shape's gradient afterwards, so shading stays smooth.
// Flat typed arrays throughout: it runs once per set, at load.

/**
 * Collapses edges of a closed, indexed mesh until it has at most `target`
 * triangles (or nothing more can go without folding a face over). Moved
 * vertices are projected onto `f`'s surface; normals come from its gradient.
 */
export const decimate = (geometry: BufferGeometry, target: number, f: Sdf): BufferGeometry => {
  const src = geometry.getAttribute('position');
  const nv = src.count;
  const pos = new Float64Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    pos[i * 3] = src.getX(i);
    pos[i * 3 + 1] = src.getY(i);
    pos[i * 3 + 2] = src.getZ(i);
  }
  const idx = geometry.index!;
  const nf = idx.count / 3;
  if (nf <= target) return geometry;
  const faces = new Int32Array(nf * 3);
  for (let t = 0; t < idx.count; t++) faces[t] = idx.getX(t);
  const faceAlive = new Uint8Array(nf).fill(1);
  let alive = nf;

  // Faces round each vertex
  const vertFaces: number[][] = Array.from({ length: nv }, () => []);
  for (let k = 0; k < nf; k++) for (let i = 0; i < 3; i++) vertFaces[faces[k * 3 + i]].push(k);
  const version = new Int32Array(nv);
  const removed = new Uint8Array(nv);

  // Quadrics: symmetric 4x4 as xx xy xz xw yy yz yw zz zw ww
  const Q = new Float64Array(nv * 10);
  const plane = new Float64Array(10);
  for (let k = 0; k < nf; k++) {
    const a = faces[k * 3] * 3;
    const b = faces[k * 3 + 1] * 3;
    const c = faces[k * 3 + 2] * 3;
    const ux = pos[b] - pos[a];
    const uy = pos[b + 1] - pos[a + 1];
    const uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a];
    const vy = pos[c + 1] - pos[a + 1];
    const vz = pos[c + 2] - pos[a + 2];
    let x = uy * vz - uz * vy;
    let y = uz * vx - ux * vz;
    let z = ux * vy - uy * vx;
    const len = Math.sqrt(x * x + y * y + z * z);
    if (len < 1e-14) continue;
    x /= len;
    y /= len;
    z /= len;
    const d = -(x * pos[a] + y * pos[a + 1] + z * pos[a + 2]);
    const w = len / 2;
    plane.set([x * x, x * y, x * z, x * d, y * y, y * z, y * d, z * z, z * d, d * d]);
    for (let i = 0; i < 3; i++) {
      const o = faces[k * 3 + i] * 10;
      for (let j = 0; j < 10; j++) Q[o + j] += w * plane[j];
    }
  }

  // The heap of candidate collapses, as parallel arrays
  const hCost: number[] = [];
  const hA: number[] = [];
  const hB: number[] = [];
  const hVa: number[] = [];
  const hVb: number[] = [];
  const hP: number[] = [];
  const heap: number[] = [];
  const less = (i: number, j: number) => hCost[heap[i]] < hCost[heap[j]];
  const swap = (i: number, j: number) => {
    const t = heap[i];
    heap[i] = heap[j];
    heap[j] = t;
  };
  const push = (cost: number, a: number, b: number, x: number, y: number, z: number) => {
    const id = hCost.length;
    hCost.push(cost);
    hA.push(a);
    hB.push(b);
    hVa.push(version[a]);
    hVb.push(version[b]);
    hP.push(x, y, z);
    heap.push(id);
    let k = heap.length - 1;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (!less(k, parent)) break;
      swap(k, parent);
      k = parent;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && less(l, m)) m = l;
        if (r < heap.length && less(r, m)) m = r;
        if (m === k) break;
        swap(m, k);
        k = m;
      }
    }
    return top;
  };

  const q = new Float64Array(10);
  const consider = (a: number, b: number) => {
    for (let j = 0; j < 10; j++) q[j] = Q[a * 10 + j] + Q[b * 10 + j];
    const mx = (pos[a * 3] + pos[b * 3]) / 2;
    const my = (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2;
    const mz = (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2;
    let x = mx;
    let y = my;
    let z = mz;
    // The quadric's minimum, unless it is (nearly) singular or far off
    const A = q[0];
    const B = q[1];
    const C = q[2];
    const E = q[4];
    const F = q[5];
    const I = q[7];
    const det = A * (E * I - F * F) - B * (B * I - F * C) + C * (B * F - E * C);
    if (Math.abs(det) > 1e-12) {
      const r0 = -q[3];
      const r1 = -q[6];
      const r2 = -q[8];
      const ox = (r0 * (E * I - F * F) - B * (r1 * I - F * r2) + C * (r1 * F - E * r2)) / det;
      const oy = (A * (r1 * I - F * r2) - r0 * (B * I - F * C) + C * (B * r2 - r1 * C)) / det;
      const oz = (A * (E * r2 - r1 * F) - B * (B * r2 - r1 * C) + r0 * (B * F - E * C)) / det;
      const span2 =
        (pos[a * 3] - pos[b * 3]) ** 2 +
        (pos[a * 3 + 1] - pos[b * 3 + 1]) ** 2 +
        (pos[a * 3 + 2] - pos[b * 3 + 2]) ** 2;
      if ((ox - mx) ** 2 + (oy - my) ** 2 + (oz - mz) ** 2 <= span2) {
        x = ox;
        y = oy;
        z = oz;
      }
    }
    const cost =
      q[0] * x * x +
      2 * q[1] * x * y +
      2 * q[2] * x * z +
      2 * q[3] * x +
      q[4] * y * y +
      2 * q[5] * y * z +
      2 * q[6] * y +
      q[7] * z * z +
      2 * q[8] * z +
      q[9];
    push(cost, a, b, x, y, z);
  };

  /** Vertices sharing a face with v, into `out`. */
  const neighbours = (v: number, out: number[]) => {
    out.length = 0;
    for (const fk of vertFaces[v]) {
      for (let i = 0; i < 3; i++) {
        const w = faces[fk * 3 + i];
        if (w !== v && !out.includes(w)) out.push(w);
      }
    }
    return out;
  };
  const ringA: number[] = [];
  const ringB: number[] = [];
  for (let v = 0; v < nv; v++) for (const w of neighbours(v, ringA)) if (v < w) consider(v, w);

  /** Would moving a and b to p fold over a surviving face round v? */
  const folds = (v: number, a: number, b: number, px: number, py: number, pz: number) => {
    for (const fk of vertFaces[v]) {
      const o = fk * 3;
      let hasA = false;
      let hasB = false;
      for (let i = 0; i < 3; i++) {
        if (faces[o + i] === a) hasA = true;
        if (faces[o + i] === b) hasB = true;
      }
      if (hasA && hasB) continue;
      // Corners before and after the move
      const c0 = faces[o] * 3;
      const c1 = faces[o + 1] * 3;
      const c2 = faces[o + 2] * 3;
      const at = (c: number, j: number, moved: boolean) =>
        moved ? (j === 0 ? px : j === 1 ? py : pz) : pos[c + j];
      const m0 = faces[o] === a || faces[o] === b;
      const m1 = faces[o + 1] === a || faces[o + 1] === b;
      const m2 = faces[o + 2] === a || faces[o + 2] === b;
      const ux0 = pos[c1] - pos[c0];
      const uy0 = pos[c1 + 1] - pos[c0 + 1];
      const uz0 = pos[c1 + 2] - pos[c0 + 2];
      const vx0 = pos[c2] - pos[c0];
      const vy0 = pos[c2 + 1] - pos[c0 + 1];
      const vz0 = pos[c2 + 2] - pos[c0 + 2];
      const ux1 = at(c1, 0, m1) - at(c0, 0, m0);
      const uy1 = at(c1, 1, m1) - at(c0, 1, m0);
      const uz1 = at(c1, 2, m1) - at(c0, 2, m0);
      const vx1 = at(c2, 0, m2) - at(c0, 0, m0);
      const vy1 = at(c2, 1, m2) - at(c0, 1, m0);
      const vz1 = at(c2, 2, m2) - at(c0, 2, m0);
      const nx0 = uy0 * vz0 - uz0 * vy0;
      const ny0 = uz0 * vx0 - ux0 * vz0;
      const nz0 = ux0 * vy0 - uy0 * vx0;
      const nx1 = uy1 * vz1 - uz1 * vy1;
      const ny1 = uz1 * vx1 - ux1 * vz1;
      const nz1 = ux1 * vy1 - uy1 * vx1;
      const l0 = Math.sqrt(nx0 * nx0 + ny0 * ny0 + nz0 * nz0);
      const l1 = Math.sqrt(nx1 * nx1 + ny1 * ny1 + nz1 * nz1);
      if (l1 < 1e-14) return true;
      if (nx0 * nx1 + ny0 * ny1 + nz0 * nz1 < 0.3 * l0 * l1) return true;
    }
    return false;
  };

  const e = 1e-4;
  while (alive > target && heap.length) {
    const id = pop();
    const a = hA[id];
    const b = hB[id];
    if (removed[a] || removed[b] || version[a] !== hVa[id] || version[b] !== hVb[id]) continue;
    // Link condition: an edge between two faces shares exactly two neighbours
    neighbours(a, ringA);
    neighbours(b, ringB);
    let common = 0;
    for (const w of ringA) if (ringB.includes(w)) common++;
    if (common !== 2) continue;
    // One Newton step back onto the surface (the optimum is already close)
    let x = hP[id * 3];
    let y = hP[id * 3 + 1];
    let z = hP[id * 3 + 2];
    const d = f(x, y, z);
    const gx = (f(x + e, y, z) - f(x - e, y, z)) / (2 * e);
    const gy = (f(x, y + e, z) - f(x, y - e, z)) / (2 * e);
    const gz = (f(x, y, z + e) - f(x, y, z - e)) / (2 * e);
    const g2 = gx * gx + gy * gy + gz * gz;
    if (g2 > 1e-12) {
      x -= (d * gx) / g2;
      y -= (d * gy) / g2;
      z -= (d * gz) / g2;
    }
    if (folds(a, a, b, x, y, z) || folds(b, a, b, x, y, z)) continue;
    // Collapse b into a
    pos[a * 3] = x;
    pos[a * 3 + 1] = y;
    pos[a * 3 + 2] = z;
    for (let j = 0; j < 10; j++) Q[a * 10 + j] += Q[b * 10 + j];
    for (const fk of vertFaces[b]) {
      const o = fk * 3;
      if (faces[o] === a || faces[o + 1] === a || faces[o + 2] === a) {
        faceAlive[fk] = 0;
        alive--;
        for (let i = 0; i < 3; i++) {
          const w = faces[o + i];
          if (w === b) continue;
          const list = vertFaces[w];
          list.splice(list.indexOf(fk), 1);
        }
      } else {
        for (let i = 0; i < 3; i++) if (faces[o + i] === b) faces[o + i] = a;
        vertFaces[a].push(fk);
      }
    }
    vertFaces[b] = [];
    removed[b] = 1;
    // Only a's quadric changed: requeue its edges (b's are dropped on pop)
    version[a]++;
    for (const w of neighbours(a, ringA)) consider(a, w);
  }

  // Compact, and shade by the field's gradient
  const remap = new Int32Array(nv).fill(-1);
  const position: number[] = [];
  const index: number[] = [];
  for (let k = 0; k < nf; k++) {
    if (!faceAlive[k]) continue;
    for (let i = 0; i < 3; i++) {
      const v = faces[k * 3 + i];
      if (remap[v] < 0) {
        remap[v] = position.length / 3;
        position.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
      }
      index.push(remap[v]);
    }
  }
  const count = position.length / 3;
  const normal = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  for (let v = 0; v < count; v++) {
    const x = position[v * 3];
    const y = position[v * 3 + 1];
    const z = position[v * 3 + 2];
    const gx = f(x + e, y, z) - f(x - e, y, z);
    const gy = f(x, y + e, z) - f(x, y - e, z);
    const gz = f(x, y, z + e) - f(x, y, z - e);
    const len = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    normal[v * 3] = gx / len;
    normal[v * 3 + 1] = gy / len;
    normal[v * 3 + 2] = gz / len;
    uv[v * 2] = x + z;
    uv[v * 2 + 1] = y;
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  out.setAttribute('normal', new BufferAttribute(normal, 3));
  out.setAttribute('uv', new BufferAttribute(uv, 2));
  out.setIndex(index);
  return out;
};
