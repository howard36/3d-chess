import { BufferAttribute, BufferGeometry } from 'three';
import { flatPolygon } from './mesh';
import type { Vec3 } from './mesh';

// A saw cut through a convex turned shell: the bishop's mitre. The slot is
// the slab between two parallel planes, stopped at a floor; the shell's
// triangles inside it are clipped away and the cut faces (both walls and
// the floor) are built from the shell's own cross-sections, so they meet the
// clipped surface edge for edge. The cut faces come back separately, so the
// cut can be painted in its own colour.

interface V {
  p: Vec3;
  n: Vec3;
  uv: [number, number];
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const lerpV = (a: V, b: V, t: number): V => {
  const n = [0, 1, 2].map((i) => a.n[i] + (b.n[i] - a.n[i]) * t) as Vec3;
  const len = Math.hypot(...n) || 1;
  return {
    p: [0, 1, 2].map((i) => a.p[i] + (b.p[i] - a.p[i]) * t) as Vec3,
    n: [n[0] / len, n[1] / len, n[2] / len],
    uv: [a.uv[0] + (b.uv[0] - a.uv[0]) * t, a.uv[1] + (b.uv[1] - a.uv[1]) * t],
  };
};

/** A plane: points with dot(n, p) = d. */
interface Plane {
  n: Vec3;
  d: number;
}
const side = (pl: Plane, p: Vec3) => dot(pl.n, p) - pl.d;

/** Splits a convex polygon by a plane into its parts below and above. */
const split = (poly: V[], pl: Plane): [V[], V[]] => {
  const below: V[] = [];
  const above: V[] = [];
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k];
    const b = poly[(k + 1) % poly.length];
    const da = side(pl, a.p);
    const db = side(pl, b.p);
    if (da <= 0) below.push(a);
    if (da >= 0) above.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const m = lerpV(a, b, da / (da - db));
      below.push(m);
      above.push(m);
    }
  }
  return [below, above];
};

/** Where a plane crosses the shell: every edge crossing, as points. */
const section = (tris: V[][], pl: Plane): Vec3[] => {
  const pts: Vec3[] = [];
  for (const tri of tris) {
    for (let k = 0; k < 3; k++) {
      const a = tri[k].p;
      const b = tri[(k + 1) % 3].p;
      const da = side(pl, a);
      const db = side(pl, b);
      if (Math.abs(da) < 1e-12) pts.push(a);
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
        const t = da / (da - db);
        pts.push([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as Vec3);
      }
    }
  }
  return pts;
};

type P2 = [number, number];

/**
 * Convex hull, counter-clockwise (Andrew's monotone chain), keeping points
 * that lie along an edge: the shell's clipped surface has a vertex at each
 * of them, and the cut face must too, or the two would not meet edge for
 * edge.
 */
const hull = (pts: P2[]): P2[] => {
  const seen = new Set<string>();
  const s = pts
    .filter((p) => {
      const key = `${p[0].toFixed(9)},${p[1].toFixed(9)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  // The sine of the turn at a: positions are single precision, so points
  // along one edge can bend a hair either way; only a real turn counts
  const turn = (o: P2, a: P2, b: P2) => {
    const ax = a[0] - o[0];
    const ay = a[1] - o[1];
    const bx = b[0] - a[0];
    const by = b[1] - a[1];
    return (ax * by - ay * bx) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1);
  };
  const lower: P2[] = [];
  for (const p of s) {
    while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], p) < -1e-5)
      lower.pop();
    lower.push(p);
  }
  const upper: P2[] = [];
  for (const p of s.reverse()) {
    while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], p) < -1e-5)
      upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
};

/** Keeps the part of a 2D polygon where a·p >= c. */
const clip2 = (poly: P2[], a: P2, c: number): P2[] => {
  const out: P2[] = [];
  for (let k = 0; k < poly.length; k++) {
    const p = poly[k];
    const q = poly[(k + 1) % poly.length];
    const dp = a[0] * p[0] + a[1] * p[1] - c;
    const dq = a[0] * q[0] + a[1] * q[1] - c;
    if (dp >= 0) out.push(p);
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
      const t = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
};

/**
 * A flat face of the cut: the shell's section by `plane`, kept where each of
 * `keep` (planes whose positive side stays) allows, facing `normal`.
 */
const cutFace = (tris: V[][], plane: Plane, normal: Vec3, keep: Plane[]): BufferGeometry | null => {
  const pts = section(tris, plane);
  if (pts.length < 3) return null;
  // A basis in the plane with e1 x e2 = normal, so a CCW hull faces `normal`
  const helper: Vec3 = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = cross(helper, normal);
  const l1 = Math.hypot(...e1);
  const u: Vec3 = [e1[0] / l1, e1[1] / l1, e1[2] / l1];
  const v = cross(normal, u);
  // A point on the plane (its normal is a unit vector)
  const origin: Vec3 = [plane.n[0] * plane.d, plane.n[1] * plane.d, plane.n[2] * plane.d];
  const to2 = (p: Vec3): P2 => [dot(p, u), dot(p, v)];
  let poly = hull(pts.map(to2));
  for (const k of keep) {
    // dot(k.n, p) - k.d >= 0 with p = origin-free (a, b) coordinates in the plane
    const a: P2 = [dot(k.n, u), dot(k.n, v)];
    const c = k.d - dot(k.n, origin);
    poly = clip2(poly, a, c);
  }
  if (poly.length < 3) return null;
  const lift = ([a, b]: P2): Vec3 => [
    origin[0] + u[0] * a + v[0] * b,
    origin[1] + u[1] * a + v[1] * b,
    origin[2] + u[2] * a + v[2] * b,
  ];
  return flatPolygon(poly.map(lift), normal);
};

export interface Slot {
  /** A point on the slot's middle plane. */
  at: Vec3;
  /** Unit normal of the slot's walls. */
  normal: Vec3;
  /** Width between the walls. */
  width: number;
  /** Unit direction, in the slot's plane, pointing out of the cut's mouth. */
  mouth: Vec3;
  /** The floor: how far from `at`, along -mouth, the cut stops. */
  depth: number;
}

/**
 * Cuts `slot` into a closed convex shell (indexed). Returns the remaining
 * shell and the cut's faces (walls and floor), both unindexed.
 */
export const cutSlot = (
  shell: BufferGeometry,
  { at, normal: n, width, mouth: m, depth }: Slot,
): { body: BufferGeometry; cut: BufferGeometry[] } => {
  const pos = shell.getAttribute('position');
  const nor = shell.getAttribute('normal');
  const uvs = shell.getAttribute('uv');
  const index = shell.index!;
  const vert = (i: number): V => ({
    p: [pos.getX(i), pos.getY(i), pos.getZ(i)],
    n: [nor.getX(i), nor.getY(i), nor.getZ(i)],
    uv: [uvs.getX(i), uvs.getY(i)],
  });
  const tris: V[][] = [];
  for (let t = 0; t < index.count; t += 3) {
    tris.push([vert(index.getX(t)), vert(index.getX(t + 1)), vert(index.getX(t + 2))]);
  }
  const mid = dot(n, at);
  const lower: Plane = { n, d: mid - width / 2 };
  const upper: Plane = { n, d: mid + width / 2 };
  const floor: Plane = { n: m, d: dot(m, at) - depth };

  // Clip: a piece is removed when it lies above `lower`, below `upper` and
  // beyond the floor
  const kept: V[] = [];
  for (const tri of tris) {
    let pieces: V[][] = [tri];
    for (const pl of [lower, upper, floor]) {
      pieces = pieces.flatMap((poly) => split(poly, pl).filter((q) => q.length >= 3));
    }
    for (const poly of pieces) {
      const c = [0, 1, 2].map((i) => poly.reduce((s, v) => s + v.p[i], 0) / poly.length) as Vec3;
      const inside = side(lower, c) > 0 && side(upper, c) < 0 && side(floor, c) > 0;
      if (inside) continue;
      for (let k = 1; k < poly.length - 1; k++) kept.push(poly[0], poly[k], poly[k + 1]);
    }
  }
  const body = new BufferGeometry();
  body.setAttribute('position', new BufferAttribute(new Float32Array(kept.flatMap((v) => v.p)), 3));
  body.setAttribute('normal', new BufferAttribute(new Float32Array(kept.flatMap((v) => v.n)), 3));
  body.setAttribute('uv', new BufferAttribute(new Float32Array(kept.flatMap((v) => v.uv)), 2));

  const neg = (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]];
  const cut = [
    // The wall under the slot faces up into it, the one over it faces down
    cutFace(tris, lower, n, [floor]),
    cutFace(tris, upper, neg(n), [floor]),
    cutFace(tris, floor, m, [lower, { n: neg(n), d: -upper.d }]),
  ].filter((g): g is BufferGeometry => g !== null);
  return { body, cut };
};
