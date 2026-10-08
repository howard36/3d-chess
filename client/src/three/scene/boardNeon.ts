import { BufferAttribute, BufferGeometry } from 'three';

// The neon tubes' geometry, for the garden's sculptures and everything
// drawn with their light (stage.tsx's neonMaterial): each curve becomes a
// ribbon whose vertices carry what the vertex shader needs to bend it into
// place. A curve is one of three kinds (`mode`):
//   0  a drawing, turned about the vertical to face the camera (x across,
//      y up; its front toward `toward`): a standing sculpture's outline;
//   1  fixed in 3D about its anchor (a ring, a footprint on the ground);
//   2  a drawing turned about its own `axis` to face the camera (x across,
//      y along the axis): a fallen piece's outline, lying on its side.
// Each vertex also carries the sculpture it belongs to (`sculpt`, whose
// light the tower's shade can take as a whole: gardenWhole) and its own
// share of the tube's light (`light`, 0 for a dead stretch of tube). Pure
// geometry, so it can be tested without WebGL.

export type V3 = readonly [number, number, number];

export interface NeonCurve {
  /** Where the curve hangs: a sculpture's foot on the ground. */
  at: V3;
  /** The point (x, z) a drawing faces (mode 0). */
  toward?: readonly [number, number];
  /** The curve's points, about `at` (see the modes above). */
  points: readonly V3[];
  closed: boolean;
  mode?: 0 | 1 | 2;
  /** The axis a lying drawing turns about (mode 2), a unit vector. */
  axis?: V3;
  /** Which sculpture's whole-fade it takes (index into gardenWhole). */
  sculpt?: number;
  /** The tube's light, 0–1: one value, or one per point. */
  light?: number | readonly number[];
}

/** One ribbon mesh for many tubes: one draw call. */
export const neonCurves = (curves: readonly NeonCurve[]): BufferGeometry => {
  const anchor: number[] = [];
  const toward: number[] = [];
  const local: number[] = [];
  const tangent: number[] = [];
  const side: number[] = [];
  const mode: number[] = [];
  const axis: number[] = [];
  const sculpt: number[] = [];
  const light: number[] = [];
  const index: number[] = [];
  for (const c of curves) {
    const pts = c.points;
    const n = pts.length;
    if (n < 2) continue;
    const base = side.length;
    const looks = c.toward ?? [0, 0];
    const ax = c.axis ?? [0, 1, 0];
    for (let k = 0; k < n; k++) {
      const prev = pts[c.closed ? (k - 1 + n) % n : Math.max(k - 1, 0)];
      const next = pts[c.closed ? (k + 1) % n : Math.min(k + 1, n - 1)];
      const t = [next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]];
      const l = Math.hypot(t[0], t[1], t[2]) || 1;
      const lit = typeof c.light === 'number' ? c.light : (c.light?.[k] ?? 1);
      for (const s of [-1, 1]) {
        anchor.push(...c.at);
        toward.push(...looks);
        local.push(...pts[k]);
        tangent.push(t[0] / l, t[1] / l, t[2] / l);
        side.push(s);
        mode.push(c.mode ?? 0);
        axis.push(...ax);
        sculpt.push(c.sculpt ?? 0);
        light.push(lit);
      }
    }
    const segments = c.closed ? n : n - 1;
    for (let k = 0; k < segments; k++) {
      const a = base + 2 * k;
      const b = base + 2 * ((k + 1) % n);
      index.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new BufferGeometry();
  const set = (name: string, values: number[], size: number) =>
    g.setAttribute(name, new BufferAttribute(new Float32Array(values), size));
  set('position', local, 3);
  set('aAnchor', anchor, 3);
  set('aToward', toward, 2);
  set('aTangent', tangent, 3);
  set('aSide', side, 1);
  set('aMode', mode, 1);
  set('aAxis', axis, 3);
  set('aSculpt', sculpt, 1);
  set('aLight', light, 1);
  g.setIndex(index);
  return g;
};

/** A horizontal ring of `n` points (mode 1), radius `r` at height `y`. */
export const ringPoints = (r: number, y: number, n = 24): V3[] =>
  Array.from({ length: n }, (_, k): V3 => {
    const a = (k / n) * Math.PI * 2;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  });
