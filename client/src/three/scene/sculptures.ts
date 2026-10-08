import { PieceType } from '../../engine/pieces';
import { FOOT_HEIGHT, PROFILES, sampleProfile } from '../pieces';
import type { Profile } from '../pieces';
import { KNIGHT_OUTLINE, KNIGHT_SEAT } from '../pieces/knight';
import { smoothLoop } from '../pieces/profile';

// The garden's sculptures as line drawings: every piece of the shared
// Staunton set reduced to the outline a neon tube would trace, in piece
// units (base at y = 0, height up to about 0.87), from the set's own turned
// profiles, so a colossal king is the king on the board. A turned piece is
// the outer envelope of its profiles, mirrored about its axis; the details
// that name a piece are drawn in as a light artist would bend them: the
// rook's battlement, the knight's head (its sculpted outline, ear pricked),
// the bishop's cut, the unicorn's spiral, the queen's coronet and pearl, the
// king's cross. Rings of the base and the collar are drawn in 3D round the
// axis, so the flat outline stands on a real footprint. Pure geometry, so it
// can be tested without WebGL.

type P2 = [number, number];

interface Outline {
  points: P2[];
  closed: boolean;
  /** Bent smooth, as a neon tube is (a silhouette); false keeps it as drawn (a detail). */
  smooth?: boolean;
}

interface SculptureDrawing {
  /** Curves in the drawing plane (x across, y up), turned to face the viewer. */
  outlines: Outline[];
  /** Horizontal rings round the axis: radius and height. */
  rings: { radius: number; y: number }[];
  /** Height of the drawing (piece units). */
  top: number;
}

const EPS = 1e-7;

/** Index of the last element matching `test`, or -1. */
const lastIndex = <T>(xs: readonly T[], test: (x: T) => boolean) => {
  for (let k = xs.length - 1; k >= 0; k--) if (test(xs[k])) return k;
  return -1;
};

/** Every segment of the profiles' polylines. */
const segmentsOf = (profiles: readonly (readonly P2[])[]): [P2, P2][] =>
  profiles.flatMap((pts) => pts.slice(1).map((b, i): [P2, P2] => [pts[i], b]));

/** The widest radius of any segment at height y (horizontal segments excluded). */
const radiusAt = (segments: [P2, P2][], y: number) => {
  let r = 0;
  for (const [a, b] of segments) {
    const lo = Math.min(a[1], b[1]);
    const hi = Math.max(a[1], b[1]);
    if (hi - lo < 1e-9 || y < lo || y > hi) continue;
    const t = (y - a[1]) / (b[1] - a[1]);
    r = Math.max(r, a[0] + (b[0] - a[0]) * t);
  }
  return r;
};

/**
 * Ramer–Douglas–Peucker: drops points within `tolerance` of the line
 * through their neighbours.
 */
const simplify = (pts: P2[], tolerance: number): P2[] => {
  if (pts.length < 3) return pts.slice();
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const [ax, ay] = pts[i];
    const [bx, by] = pts[j];
    const len = Math.hypot(bx - ax, by - ay) || 1e-9;
    let worst = -1;
    let at = -1;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((bx - ax) * (ay - pts[k][1]) - (ax - pts[k][0]) * (by - ay)) / len;
      if (d > worst) {
        worst = d;
        at = k;
      }
    }
    if (worst > tolerance && at > 0) {
      keep[at] = true;
      stack.push([i, at], [at, j]);
    }
  }
  return pts.filter((_, k) => keep[k]);
};

/**
 * The right half of a turned piece's silhouette: the outer envelope of its
 * profiles, from the foot's rim (r, 0) up to where it meets the axis at the
 * top, or up to `cap` (still off the axis) when given. Where the envelope
 * steps (a ledge, the top of a collar) the step is kept square.
 */
const envelope = (profiles: readonly (readonly P2[])[], cap?: number): P2[] => {
  const segments = segmentsOf(profiles);
  const ys = new Set<number>();
  for (const [a, b] of segments) {
    ys.add(a[1]);
    ys.add(b[1]);
  }
  let heights = [...ys].sort((p, q) => p - q);
  if (cap !== undefined) heights = [...heights.filter((y) => y < cap), cap];
  // Dense enough between breakpoints that a curve keeps its shape
  const dense: number[] = [];
  heights.forEach((y, k) => {
    if (k > 0) {
      const prev = heights[k - 1];
      const n = Math.floor((y - prev) / 0.006);
      for (let j = 1; j <= n; j++) dense.push(prev + ((y - prev) * j) / (n + 1));
    }
    dense.push(y);
  });
  const out: P2[] = [];
  for (const y of dense) {
    const below = radiusAt(segments, y - EPS);
    const above = cap !== undefined && y >= cap ? below : radiusAt(segments, y + EPS);
    if (Math.abs(below - above) > 1e-4) out.push([below, y], [above, y]);
    else out.push([Math.max(below, above), y]);
  }
  // Nothing below the foot, and nothing past the top but the axis
  while (out.length > 1 && out[0][0] < 1e-4) out.shift();
  const last = lastIndex(out, ([r]) => r > 1e-4);
  const trimmed = out.slice(0, Math.min(out.length, last + 2));
  return simplify(trimmed, 0.0008);
};

/** Corner-cutting (Chaikin): bends a polyline's corners the way a neon tube bends. */
const bend = (pts: P2[], iterations = 2, closed = false): P2[] => {
  let cur = pts;
  for (let it = 0; it < iterations; it++) {
    const next: P2[] = closed ? [] : [cur[0]];
    const n = cur.length;
    const count = closed ? n : n - 1;
    for (let k = 0; k < count; k++) {
      const a = cur[k];
      const b = cur[(k + 1) % n];
      next.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      next.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    if (!closed) next.push(cur[n - 1]);
    cur = next;
  }
  return cur;
};

const TOL = 0.003;
const sample = (p: Profile) => sampleProfile(p, TOL);
/** The foot band, as the envelope sees it: a short cylinder. */
const foot = (type: PieceType): P2[] => [
  [PROFILES.radius[type], 0],
  [PROFILES.radius[type], FOOT_HEIGHT],
];

/** Both sides of a turned silhouette from its right half: up the left, down the right. */
const mirrored = (right: P2[], middle: P2[] = []): P2[] => {
  const left = right.map(([r, y]): P2 => [-r, y]);
  const closesOnAxis = right[right.length - 1][0] < 1e-4;
  const up = closesOnAxis ? left.slice(0, -1) : left;
  return [...up, ...middle, ...right.slice().reverse()];
};

/** The collar's widest point, where its ring is drawn. */
const collarRing = (profile: Profile) => {
  const pts = sample(profile);
  const widest = pts.reduce((a, p) => (p[0] > a[0] ? p : a));
  return { radius: widest[0], y: widest[1] };
};

const baseRing = (type: PieceType) => ({ radius: PROFILES.radius[type], y: 0.002 });

// The unicorn's horn (as the set turns it): a tapering cone from the socket
const HORN = { bottom: 0.49, top: 0.79, radius: 0.058, taper: 1.1, turns: 3 };
const hornRadius = (t: number) => HORN.radius * (1 - t) ** HORN.taper;
const hornY = (t: number) => HORN.bottom + (HORN.top - HORN.bottom) * t;

const drawings: Partial<Record<PieceType, SculptureDrawing>> = {};

const build = (type: PieceType): SculptureDrawing => {
  const P = PROFILES;
  switch (type) {
    case PieceType.Pawn: {
      const right = envelope([foot(type), sample(P.pawn.body), sample(P.pawn.collar)]);
      return {
        outlines: [{ points: mirrored(right), closed: false, smooth: true }],
        rings: [baseRing(type), collarRing(P.pawn.collar)],
        top: 0.52,
      };
    }
    case PieceType.Rook: {
      const drum = 0.532;
      const right = envelope([foot(type), sample(P.rook.body), sample(P.rook.collar)], drum);
      const w = right[right.length - 1][0];
      // The battlement as seen from the side: three merlons and two crenels
      const hi = 0.6;
      const lo = 0.55;
      const m = [0.125, 0.045];
      const battlement: P2[] = [
        [-w, hi],
        [-m[0], hi],
        [-m[0], lo],
        [-m[1], lo],
        [-m[1], hi],
        [m[1], hi],
        [m[1], lo],
        [m[0], lo],
        [m[0], hi],
        [w, hi],
      ];
      return {
        outlines: [{ points: mirrored(right, battlement), closed: false, smooth: true }],
        rings: [baseRing(type), collarRing(P.rook.collar)],
        top: hi,
      };
    }
    case PieceType.Knight: {
      const collarTop = 0.17;
      const right = envelope(
        [foot(type), sample(P.knight.body), sample(P.knight.collar)],
        collarTop,
      );
      // The sculpted head's side profile, its ear pricked up above the poll
      // (the set carves the ears as cones, so the outline has none)
      const outline = KNIGHT_OUTLINE.flatMap((p): P2[] =>
        p[0] === 0.04 && p[1] === 0.697
          ? [
              [0.05, 0.694],
              [0.068, 0.736],
              [0.064, 0.774],
            ]
          : p[0] === 0.002 && p[1] === 0.704
            ? [
                [0.046, 0.772],
                [0.03, 0.735],
                [0.006, 0.708],
              ]
            : [[p[0], p[1]]],
      );
      const head = smoothLoop(outline, 6).map(
        ([x, y]): P2 => [x * 0.92, KNIGHT_SEAT + (y - KNIGHT_SEAT) * 0.92],
      );
      const first = head.findIndex(([, y]) => y >= collarTop);
      const last = lastIndex(head, ([, y]) => y >= collarTop);
      // From the withers over the head and down the chest
      const neck = head.slice(first, last + 1).reverse();
      return {
        outlines: [{ points: mirrored(right, neck), closed: false, smooth: true }],
        rings: [baseRing(type), collarRing(P.knight.collar)],
        top: 0.74,
      };
    }
    case PieceType.Bishop: {
      const b = P.bishop;
      const right = envelope([
        foot(type),
        sample(b.body),
        sample(b.collar),
        sample(b.bead),
        sample(b.mitre),
        sample(b.finial),
      ]);
      return {
        outlines: [
          { points: mirrored(right), closed: false, smooth: true },
          // The cut across the mitre
          {
            points: [
              [0.07, 0.628],
              [-0.042, 0.55],
            ],
            closed: false,
          },
        ],
        rings: [baseRing(type), collarRing(b.collar)],
        top: 0.745,
      };
    }
    case PieceType.Unicorn: {
      const u = P.unicorn;
      const horn: P2[] = Array.from({ length: 13 }, (_, k): P2 => {
        const t = k / 12;
        return [hornRadius(t), hornY(t)];
      });
      const right = envelope([
        foot(type),
        sample(u.body),
        sample(u.collar),
        sample(u.socket),
        horn,
      ]);
      // The spiral round the horn: the half of each turn that faces the viewer
      const spiral = Array.from({ length: HORN.turns - 1 }, (_, k) => {
        const pts: P2[] = [];
        for (let j = 0; j <= 16; j++) {
          const theta = Math.PI * (2 * k + j / 16);
          const t = theta / (2 * Math.PI * HORN.turns);
          pts.push([hornRadius(t) * Math.cos(theta), hornY(t) + 0.012]);
        }
        return { points: pts, closed: false };
      });
      return {
        outlines: [{ points: mirrored(right), closed: false, smooth: true }, ...spiral],
        rings: [baseRing(type), collarRing(u.collar)],
        top: HORN.top,
      };
    }
    case PieceType.Queen: {
      const q = P.queen;
      const rim = 0.688;
      const right = envelope([foot(type), sample(q.body), sample(q.collar), sample(q.crown)], rim);
      const w = right[right.length - 1][0];
      // The coronet from the side: five points rising from the rim
      const tip = 0.742;
      const notch = 0.698;
      const xs = [-1, -0.5, 0, 0.5, 1].map((k) => k * (w + 0.012));
      const coronet: P2[] = [];
      xs.forEach((x, k) => {
        const half = (xs[1] - xs[0]) / 2;
        const t = tip - (k === 0 || k === 4 ? 0.004 : 0);
        if (k > 0) coronet.push([x - half, notch]);
        // Each point drawn in to its tip, so it stays a point once bent
        if (k > 0) coronet.push([x - half * 0.3, t - 0.012]);
        coronet.push([x, t]);
        if (k < 4) coronet.push([x + half * 0.3, t - 0.012]);
      });
      const pearl = Array.from({ length: 24 }, (_, k): P2 => {
        const a = (k / 24) * Math.PI * 2;
        return [Math.cos(a) * 0.03, 0.795 + Math.sin(a) * 0.03];
      });
      return {
        outlines: [
          // The body smooth up each side to the rim; the coronet's points kept sharp
          {
            points: right.map(([r, y]): P2 => [-r, y]).reverse(),
            closed: false,
            smooth: true,
          },
          { points: bend([[-w, rim], ...coronet, [w, rim]], 1), closed: false },
          { points: right.slice(), closed: false, smooth: true },
          { points: pearl, closed: true },
        ],
        rings: [baseRing(type), collarRing(q.collar)],
        top: 0.825,
      };
    }
    case PieceType.King:
    default: {
      const k = P.king;
      const right = envelope([
        foot(PieceType.King),
        sample(k.body),
        sample(k.collar),
        sample(k.crown),
        sample(k.cap),
      ]);
      // The cross standing on the cap's bead, bent from two straight tubes
      const cross: Outline[] = [
        {
          points: [
            [0, 0.758],
            [0, 0.868],
          ],
          closed: false,
        },
        {
          points: [
            [-0.05, 0.818],
            [0.05, 0.818],
          ],
          closed: false,
        },
      ];
      return {
        outlines: [{ points: mirrored(right), closed: false, smooth: true }, ...cross],
        rings: [baseRing(PieceType.King), collarRing(k.collar)],
        top: 0.868,
      };
    }
  }
};

/**
 * The line drawing of a piece (cached). A silhouette loses the details
 * finer than a tube can follow (the beads and fillets of the turning), is
 * bent smooth as a neon tube would be, and is thinned where it runs straight.
 */
export const sculptureOf = (type: PieceType): SculptureDrawing => {
  let d = drawings[type];
  if (!d) {
    const built = build(type);
    d = {
      ...built,
      outlines: built.outlines.map((o) => ({
        points: o.smooth ? simplify(bend(simplify(o.points, 0.0035), 3), 0.0004) : o.points,
        closed: o.closed,
      })),
    };
    drawings[type] = d;
  }
  return d;
};

// --- Detail: the inner tube, more rings, a twin that differs -----------------------

/** The main silhouette as one curve: up the left side, over the top, down the right. */
const silhouetteOf = (type: PieceType): P2[] => {
  const { outlines } = sculptureOf(type);
  if (type === PieceType.Queen) {
    // Drawn as the left side (down), the coronet, and the right side (up)
    return [
      ...outlines[0].points.slice().reverse(),
      ...outlines[1].points,
      ...outlines[2].points.slice().reverse(),
    ];
  }
  return outlines[0].points;
};

/** Distance from a point to a polyline. */
const distanceTo = (pts: readonly P2[], [px, py]: P2) => {
  let d = Infinity;
  for (let k = 1; k < pts.length; k++) {
    const [ax, ay] = pts[k - 1];
    const ex = pts[k][0] - ax;
    const ey = pts[k][1] - ay;
    const t = Math.min(
      Math.max(((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey || 1), 0),
      1,
    );
    d = Math.min(d, Math.hypot(px - ax - ex * t, py - ay - ey * t));
  }
  return d;
};

/** Whether a point lies inside a closed polygon (even-odd). */
const inside = (poly: readonly P2[], [px, py]: P2) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi || 1e-12) + xi) c = !c;
  }
  return c;
};

/**
 * The second, quieter tube a light artist bends just inside a sculpture's
 * outline (piece units, `offset` inside it): the silhouette's form without
 * its small beads and fillets, drawn in by `offset`, and left out wherever
 * the piece is too narrow for two tubes side by side (it breaks into runs
 * there, so it never crosses itself or the outline). Starts a little above
 * the base, so the foot keeps its single line.
 */
/** Where the inner tube stops, below a detail it would only clutter (the mitre's cut, the horn). */
const INNER_TOP: Partial<Record<PieceType, number>> = {
  [PieceType.Bishop]: 0.5,
  [PieceType.Unicorn]: 0.48,
  [PieceType.Rook]: 0.53,
};

export const innerOutlinesOf = (type: PieceType, offset = 0.036): P2[][] => {
  const outline = silhouetteOf(type);
  // Its broad form: the details smoothed away
  const form = simplify(bend(simplify(outline, 0.009), 3), 0.0006);
  // Closed through the base, to tell inside from out
  const poly = [...outline, [outline[0][0], 0] as P2];
  const n = form.length;
  const runs: P2[][] = [];
  let run: P2[] = [];
  for (let k = 0; k < n; k++) {
    const prev = form[Math.max(k - 1, 0)];
    const next = form[Math.min(k + 1, n - 1)];
    const tx = next[0] - prev[0];
    const ty = next[1] - prev[1];
    const l = Math.hypot(tx, ty) || 1;
    // Clockwise (up the left, down the right): inside is to the right
    const p: P2 = [form[k][0] + (ty / l) * offset, form[k][1] - (tx / l) * offset];
    const ok =
      p[1] > offset * 1.6 &&
      p[1] < (INNER_TOP[type] ?? 1) &&
      inside(poly, p) &&
      distanceTo(outline, p) > offset * 0.82;
    if (ok) run.push(p);
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  const length = (r: P2[]) =>
    r.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - r[i][0], q[1] - r[i][1]), 0);
  return runs.filter((r) => r.length >= 3 && length(r) > 0.06).map((r) => bend(r, 1));
};

/** The silhouette's half-width at a height (piece units). */
const widthAt = (type: PieceType, y: number) => {
  const pts = silhouetteOf(type);
  let w = 0;
  for (let k = 1; k < pts.length; k++) {
    const [a, b] = [pts[k - 1], pts[k]];
    if ((a[1] - y) * (b[1] - y) > 0 || a[1] === b[1]) continue;
    const t = (y - a[1]) / (b[1] - a[1]);
    w = Math.max(w, Math.abs(a[0] + (b[0] - a[0]) * t));
  }
  return w;
};

/**
 * Rings beyond the base and collar, where the turning has them: a second
 * ring at the top of the foot for every piece, and one round the crown's
 * rim, the battlement's foot, the bead under the mitre, the horn's socket
 * or the pawn's head.
 */
export const moreRingsOf = (type: PieceType): { radius: number; y: number }[] => {
  const heights: Partial<Record<PieceType, number[]>> = {
    [PieceType.King]: [0.667],
    [PieceType.Queen]: [0.684],
    [PieceType.Rook]: [0.548],
    [PieceType.Bishop]: [0.437],
    [PieceType.Unicorn]: [0.497],
    [PieceType.Pawn]: [0.42],
  };
  return [0.075, ...(heights[type] ?? [])].map((y) => ({ radius: widthAt(type, y), y }));
};

/**
 * The knights' eyes, in the head's drawing (piece units): a small ring, or,
 * for the one twin that differs from its pair, a wink (a short lid).
 */
export const knightEyeOf = (winks: boolean): Outline => {
  const [cx, cy] = [0.004, 0.612];
  if (winks) {
    return {
      points: Array.from({ length: 7 }, (_, k): P2 => {
        const t = (k / 6) * 2 - 1;
        return [cx + t * 0.02, cy - 0.008 * (1 - t * t)];
      }),
      closed: false,
    };
  }
  return {
    points: Array.from({ length: 12 }, (_, k): P2 => {
      const a = (k / 12) * Math.PI * 2;
      return [cx + Math.cos(a) * 0.014, cy + Math.sin(a) * 0.014];
    }),
    closed: true,
  };
};
