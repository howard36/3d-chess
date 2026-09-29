import type { BufferGeometry } from 'three';
import { gridSurface } from './mesh';

// Turned profiles. A profile is a list of [radius, height] nodes from the
// bottom of a shell to its top, both ends on the axis (radius 0) for a closed
// shell. A smooth centripetal Catmull-Rom curve runs through the nodes; a
// node marked 'corner' breaks the curve there (a hard edge, like the sharp
// arris of a turned fillet). The curve is then thinned to the tolerance of
// the requested quality, so gentle stretches cost few rings.

export type ProfileNode =
  | readonly [r: number, y: number]
  | readonly [r: number, y: number, 'corner'];
export type Profile = readonly ProfileNode[];
type P2 = [number, number];

/** Points of a circular arc (for beads and coves), `steps` segments, both ends included. */
export const arc = (
  cr: number,
  cy: number,
  radius: number,
  fromDeg: number,
  toDeg: number,
  steps = 4,
): ProfileNode[] =>
  Array.from({ length: steps + 1 }, (_, k) => {
    const a = ((fromDeg + ((toDeg - fromDeg) * k) / steps) * Math.PI) / 180;
    return [cr + radius * Math.cos(a), cy + radius * Math.sin(a)] as const;
  });

/** Marks a node as a hard corner. */
export const corner = ([r, y]: ProfileNode): ProfileNode => [r, y, 'corner'];

const catmullRom = (p0: P2, p1: P2, p2: P2, p3: P2, steps: number): P2[] => {
  // Centripetal parameterisation (alpha = 0.5): no cusps or overshoot loops
  const knot = (a: P2, b: P2) => Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]) ** 0.5, 1e-6);
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const lerp = (a: P2, b: P2, ta: number, tb: number, t: number): P2 => {
    const u = (t - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  };
  const out: P2[] = [];
  for (let s = 1; s <= steps; s++) {
    const t = t1 + ((t2 - t1) * s) / steps;
    const a1 = lerp(p0, p1, t0, t1, t);
    const a2 = lerp(p1, p2, t1, t2, t);
    const a3 = lerp(p2, p3, t2, t3, t);
    const b1 = lerp(a1, a2, t0, t2, t);
    const b2 = lerp(a2, a3, t1, t3, t);
    out.push(lerp(b1, b2, t1, t2, t));
  }
  return out;
};

const simplify = (pts: P2[], tol: number): P2[] => {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const len = Math.hypot(bx - ax, by - ay) || 1e-12;
    let worst = -1;
    let worstD = 0;
    for (let k = a + 1; k < b; k++) {
      const d = Math.abs((bx - ax) * (ay - pts[k][1]) - (ax - pts[k][0]) * (by - ay)) / len;
      if (d > worstD) {
        worstD = d;
        worst = k;
      }
    }
    if (worst >= 0 && worstD > tol) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return pts.filter((_, k) => keep[k]);
};

/**
 * The profile's curve as a polyline, thinned to `tolerance`. A corner appears
 * twice in a row (a hard edge once turned).
 */
export const sampleProfile = (profile: Profile, tolerance: number): P2[] => {
  const runs: P2[][] = [[]];
  profile.forEach((node, k) => {
    const p: P2 = [node[0], node[1]];
    runs[runs.length - 1].push(p);
    if (node[2] === 'corner' && k > 0 && k < profile.length - 1) runs.push([p]);
  });
  const out: P2[] = [];
  for (const run of runs) {
    let pts: P2[] = run;
    if (run.length > 2) {
      const n = run.length;
      const ext = (a: P2, b: P2): P2 => [2 * a[0] - b[0], 2 * a[1] - b[1]];
      const dense: P2[] = [run[0]];
      for (let k = 0; k < n - 1; k++) {
        const p0 = k === 0 ? ext(run[0], run[1]) : run[k - 1];
        const p3 = k === n - 2 ? ext(run[n - 1], run[n - 2]) : run[k + 2];
        dense.push(...catmullRom(p0, run[k], run[k + 1], p3, 16));
      }
      pts = simplify(dense, tolerance);
    }
    // Nothing turns inside the axis
    out.push(...pts.map(([r, y]): P2 => [Math.max(0, r), y]));
  }
  return out;
};

/**
 * A closed smooth curve through `points` (centripetal Catmull-Rom), as a
 * polyline of `steps` segments per span: an outline to extrude or carve.
 */
export const smoothLoop = (points: readonly (readonly [number, number])[], steps = 8): P2[] => {
  const n = points.length;
  const at = (k: number): P2 => {
    const p = points[((k % n) + n) % n];
    return [p[0], p[1]];
  };
  const out: P2[] = [];
  for (let k = 0; k < n; k++)
    out.push(...catmullRom(at(k - 1), at(k), at(k + 1), at(k + 2), steps));
  return out;
};

export interface RevolveOptions {
  /** Sides around. */
  segments: number;
  /** Angle of the first side (radians). */
  phase?: number;
  /** Turn only part of the way round (radians); open at both ends. */
  sweep?: number;
  /**
   * Reshapes each vertex: gets the angle, the profile row and its [r, y],
   * returns the [r, y] to use (a crown's points, a slimmer stem).
   */
  modulate?: (theta: number, row: number, r: number, y: number) => [number, number];
}

/**
 * Turns a sampled profile (see sampleProfile) about the y axis: x = r cos θ,
 * z = r sin θ. Rows on the axis become poles with one shared normal.
 */
export const revolve = (
  points: readonly (readonly [number, number])[],
  { segments, phase = 0, sweep, modulate }: RevolveOptions,
): BufferGeometry => {
  const full = sweep === undefined;
  const span = sweep ?? Math.PI * 2;
  const poleRows = full ? points.flatMap(([r], j) => (r < 1e-9 && !modulate ? [j] : [])) : [];
  return gridSurface({
    cols: segments,
    rows: points.length,
    wrapU: full,
    poleRows,
    point: (i, j) => {
      const theta = phase + (span * i) / segments;
      const [r0, y0] = points[j];
      const [r, y] = modulate ? modulate(theta, j, r0, y0) : [r0, y0];
      return [r * Math.cos(theta), y, r * Math.sin(theta)];
    },
  });
};
