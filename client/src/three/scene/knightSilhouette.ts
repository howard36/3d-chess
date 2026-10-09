import { CHEEK, EAR, halfWidth, KNIGHT_OUTLINE, KNIGHT_SEAT, roundOver } from '../pieces/knight';
import { SCALE as HEAD_SCALE } from '../pieces/knight';
import { smoothLoop } from '../pieces/profile';
import { KNIGHT_COLLAR_TOP, knightBaseRight, simplify } from './sculptures';

// The garden's knights, outlined as statues are: from wherever the camera
// stands, the tube traces the knight's real silhouette seen from there. A
// knight is not the same from every side (it looks one way), so its drawing
// cannot simply turn to face the viewer as a turned piece's does; it stands
// fixed in the world, facing its twin, and walking round it the outline
// changes as a statue's would, continuously: its profile from the side,
// narrowing through three-quarters to its head and two ears seen from the
// front, and the other profile beyond, never flipping.
//
// The silhouette comes from the knight the set carves (pieces/knight.ts):
// its side profile given thickness (flat sides rounding over at the
// outline), its cheek plates and its two ears, cut in horizontal slices.
// From a camera at the height of the sculpture each slice shows as a span
// across the screen (its extent along the screen's right, a few dot
// products), and the outline round the spans of every slice, found on a
// fine grid (marching squares on each row's signed distance to its spans,
// exact where an edge crosses a row), is the silhouette. It is joined to
// the turned base, bent smooth as a tube would be, and comes back as a
// drawing in the plane facing the camera (neonStrokes' mode 0, x across).
// Each knight is redrawn only as the camera moves round it; a frame at rest
// costs nothing. Pure (no WebGL), in piece units.

type P2 = [number, number];

/** The slices' spacing (piece units) and the columns' across the screen. */
const ROW = 0.005;
const COL = 0.005;
/** Half the grid's width across the screen (piece units): wider than the knight from any side. */
const HALF = 0.34;
/** The grid's value above the knight's top: a span's distance, for where the cap falls. */
const EMPTY = 0.03;

/** A part of one slice: points across it (x along the knight's facing, z its half-thickness ≥ 0). */
interface Part {
  x: Float64Array;
  z: Float64Array;
}
/** An ear's slice: a disc (x, ±z its centre, r its radius; x is squeezed by the head's scale). */
interface Disc {
  x: number;
  z: number;
  r: number;
}
interface Slice {
  y: number;
  parts: Part[];
  ears: Disc | null;
}

/** Piece units to the profile's own (the head is drawn scaled about its seat, in profile only). */
const toProfileY = (y: number) => KNIGHT_SEAT + (y - KNIGHT_SEAT) / HEAD_SCALE;

/**
 * Distance from a point to the nearest of some segments ([ax, ay, bx, by]
 * each, flat), or `limit` if none is nearer.
 */
const distanceTo = (segs: readonly number[], px: number, py: number, limit: number) => {
  let d2 = limit * limit;
  for (let i = 0; i < segs.length; i += 4) {
    const ax = segs[i];
    const ay = segs[i + 1];
    const ex = segs[i + 2] - ax;
    const ey = segs[i + 3] - ay;
    const t = Math.min(
      Math.max(((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey || 1), 0),
      1,
    );
    const dx = px - ax - ex * t;
    const dy = py - ay - ey * t;
    d2 = Math.min(d2, dx * dx + dy * dy);
  }
  return Math.sqrt(d2);
};

/** How far in from the outline the head's sides can round over, at most (knight.ts's roundOver). */
const ROUND_MAX = 0.06;

/**
 * The head's half-thickness at a point of its profile inside the outline
 * (profile units), as knight.ts carves it: its flat sides rounding over
 * toward the outline (`near`: the outline's segments near the point), and
 * its cheek plates standing out of them.
 */
const thicknessAt = (near: readonly number[], px: number, py: number) => {
  const r = roundOver(px, py);
  const u = Math.max(r - distanceTo(near, px, py, r), 0) / r;
  let z = u >= 1 ? 0 : halfWidth(px, py) * Math.sqrt(1 - u * u);
  const cx = (px - CHEEK.at[0]) / CHEEK.radii[0];
  const cy = (py - CHEEK.at[1]) / CHEEK.radii[1];
  const q = 1 - cx * cx - cy * cy;
  if (q > 0) z = Math.max(z, CHEEK.at[2] + CHEEK.radii[2] * Math.sqrt(q));
  return z;
};

/** The outline's segments, flat ([ax, ay, bx, by] each), in profile units. */
const outlineSegments = () => {
  const loop = smoothLoop(KNIGHT_OUTLINE, 4);
  return loop.flatMap((b, i) => {
    const a = loop[(i + loop.length - 1) % loop.length];
    return [a[0], a[1], b[0], b[1]];
  });
};

type P3 = [number, number, number];

/**
 * The knight's eyes, fixed on the sides of its head (x along its facing,
 * y up, z across; piece units) where the set carves them: a small ring on
 * each side, lit only from that side; a knight that winks has a lid on its
 * near (+z) side instead.
 */
export const knightEyes = (winks: boolean) => {
  // Where knight.ts finds the eye on its head, in profile units
  const [ex, ey] = [0.118, 0.6];
  const z = thicknessAt(outlineSegments(), ex, ey) + 0.004;
  const [cx, cy] = [ex * HEAD_SCALE, KNIGHT_SEAT + (ey - KNIGHT_SEAT) * HEAD_SCALE];
  return [1, -1].map((side) => {
    const normal: P3 = [0, 0, side];
    if (winks && side > 0) {
      const points = Array.from({ length: 9 }, (_, k): P3 => {
        const t = (k / 8) * 2 - 1;
        return [cx + t * 0.02, cy - 0.008 * (1 - t * t), z * side];
      });
      return { points, normals: points.map(() => normal), closed: false };
    }
    const points = Array.from({ length: 16 }, (_, k): P3 => {
      const a = (k / 16) * Math.PI * 2;
      return [cx + Math.cos(a) * 0.014, cy + Math.sin(a) * 0.014, z * side];
    });
    return { points, normals: points.map(() => normal), closed: true };
  });
};

/** The knight's slices, from the collar's top up past its ears (built once). */
let slices: Slice[] | null = null;
export const knightSlices = (): Slice[] => (slices ??= buildSlices());
export const buildSlices = (): Slice[] => {
  const loop = smoothLoop(KNIGHT_OUTLINE, 4);
  const out: Slice[] = [];
  const earTop = EAR.to[1] + EAR.r1;
  const top = KNIGHT_SEAT + (earTop - KNIGHT_SEAT) * HEAD_SCALE;
  for (let y = KNIGHT_COLLAR_TOP; y <= top + 1e-9; y += ROW) {
    const py = toProfileY(y);
    // Where the row crosses the profile: its spans along x
    const xs: number[] = [];
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const [ax, ay] = loop[j];
      const [bx, by] = loop[i];
      if (ay > py !== by > py) xs.push(ax + ((bx - ax) * (py - ay)) / (by - ay));
    }
    xs.sort((a, b) => a - b);
    // The outline's segments near enough the row to round its sides over
    const near: number[] = [];
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const [ax, ay] = loop[j];
      const [bx, by] = loop[i];
      if (Math.min(ay, by) - ROUND_MAX <= py && Math.max(ay, by) + ROUND_MAX >= py) {
        near.push(ax, ay, bx, by);
      }
    }
    const parts: Part[] = [];
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const [x0, x1] = [xs[k], xs[k + 1]];
      const n = 10;
      const x = new Float64Array(n + 1);
      const z = new Float64Array(n + 1);
      for (let i = 0; i <= n; i++) {
        // Denser toward the ends, where the sides round over
        const px = x0 + ((x1 - x0) * (1 - Math.cos((Math.PI * i) / n))) / 2;
        x[i] = px * HEAD_SCALE;
        z[i] = thicknessAt(near, px, py);
      }
      parts.push({ x, z });
    }
    // The ears, a round cone each, the tip's cap above
    let ears: Disc | null = null;
    const [a, b] = [EAR.from, EAR.to];
    if (py >= a[1] - 0.02) {
      const t = Math.min(Math.max((py - a[1]) / (b[1] - a[1]), 0), 1);
      let r = EAR.r0 + (EAR.r1 - EAR.r0) * t;
      if (py > b[1]) r = Math.sqrt(Math.max(EAR.r1 * EAR.r1 - (py - b[1]) ** 2, 0));
      if (r > 1e-4) {
        ears = {
          x: (a[0] + (b[0] - a[0]) * t) * HEAD_SCALE,
          z: a[2] + (b[2] - a[2]) * t,
          r,
        };
      }
    }
    out.push({ y, parts, ears });
  }

  return out;
};

/**
 * Each slice's spans across the screen, for a view whose screen-right is
 * c along the knight's facing and s across it (c² + s² = 1), merged where
 * they overlap: [from, to, from, to, ...] per slice.
 */
const spansFor = (rows: readonly Slice[], c: number, s: number): number[][] => {
  const as = Math.abs(s);
  const earR = Math.hypot(c * HEAD_SCALE, s);
  const spans: number[] = [];
  return rows.map(({ parts, ears }) => {
    spans.length = 0;
    for (const { x, z } of parts) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < x.length; i++) {
        const m = x[i] * c;
        const w = z[i] * as;
        if (m - w < lo) lo = m - w;
        if (m + w > hi) hi = m + w;
      }
      spans.push(lo, hi);
    }
    if (ears) {
      for (const side of [-1, 1]) {
        const m = ears.x * c + side * ears.z * s;
        spans.push(m - ears.r * earR, m + ears.r * earR);
      }
    }
    // Sorted by their starts (a handful: insertion), then merged
    for (let i = 2; i < spans.length; i += 2) {
      for (let j = i; j > 0 && spans[j - 2] > spans[j]; j -= 2) {
        [spans[j - 2], spans[j]] = [spans[j], spans[j - 2]];
        [spans[j - 1], spans[j + 1]] = [spans[j + 1], spans[j - 1]];
      }
    }
    const merged: number[] = [];
    for (let i = 0; i < spans.length; i += 2) {
      const n = merged.length;
      if (n && spans[i] <= merged[n - 1]) merged[n - 1] = Math.max(merged[n - 1], spans[i + 1]);
      else merged.push(spans[i], spans[i + 1]);
    }
    return merged;
  });
};

const COLS = Math.round((2 * HALF) / COL) + 1;
const colX = (j: number) => -HALF + j * COL;

/** A row's signed distance to its spans at each column (negative inside), into `out`. */
const fillRow = (spans: readonly number[], out: Float64Array, offset: number) => {
  if (!spans.length) {
    out.fill(EMPTY, offset, offset + COLS);
    return;
  }
  let k = 0;
  for (let j = 0; j < COLS; j++) {
    const x = colX(j);
    // The span ending at or after x (spans are sorted, apart)
    while (k + 2 < spans.length && spans[k + 1] < x) k += 2;
    const lo = spans[k];
    const hi = spans[k + 1];
    let d: number;
    if (x >= lo && x <= hi) d = -Math.min(x - lo, hi - x);
    else {
      d = x < lo ? lo - x : x - hi;
      if (k >= 2 && x < lo) d = Math.min(d, x - spans[k - 1]);
      d = Math.min(d, EMPTY);
    }
    out[offset + j] = d;
  }
};

let grid = new Float64Array(0);

// A cell's sides, as marching squares walks them: 0 bottom, 1 right, 2 top, 3 left
const STEP_K = [-1, 0, 1, 0];
const STEP_J = [0, 1, 0, -1];

/**
 * The head's silhouette above the collar's top, for a view whose
 * screen-right is c along the knight's facing and s across it: one open
 * line from the left of the neck at the collar's top, over the head, down to
 * its right (x across the screen, y up; piece units).
 */
export const knightHead = (c: number, s: number): P2[] => {
  const rows = knightSlices();
  const spans = spansFor(rows, c, s);
  // Grid rows: the bottom slice again below (the neck runs on down into the
  // base), then the slices, then one empty above
  const nRows = rows.length + 2;
  if (grid.length < nRows * COLS) grid = new Float64Array(nRows * COLS);
  const ys = new Float64Array(nRows);
  for (let k = 0; k < nRows; k++) {
    const sp = k === 0 ? spans[0] : k <= rows.length ? spans[k - 1] : [];
    ys[k] = rows[0].y + (k - 1) * ROW;
    fillRow(sp, grid, k * COLS);
  }
  const f = (k: number, j: number) => grid[k * COLS + j];
  const inside = (k: number, j: number) => f(k, j) < 0;
  /** Where the outline crosses a side of cell (k, j). */
  const crossing = (k: number, j: number, side: number): P2 => {
    if (side === 0 || side === 2) {
      const r = side === 0 ? k : k + 1;
      const f0 = f(r, j);
      return [colX(j) + (COL * f0) / (f0 - f(r, j + 1)), ys[r]];
    }
    const col = side === 1 ? j + 1 : j;
    const f0 = f(k, col);
    return [colX(col), ys[k] + ((ys[k + 1] - ys[k]) * f0) / (f0 - f(k + 1, col))];
  };
  /** The side the outline leaves cell (k, j) by, having come in by `entry`. */
  const exitOf = (k: number, j: number, entry: number) => {
    const c0 = inside(k, j);
    const c1 = inside(k, j + 1);
    const c2 = inside(k + 1, j + 1);
    const c3 = inside(k + 1, j);
    // Each side crosses where its two corners differ
    const crosses = [c0 !== c1, c1 !== c2, c2 !== c3, c3 !== c0];
    const count = crosses.filter(Boolean).length;
    if (count === 4) {
      // A saddle: the centre decides which corners join
      const centreIn = f(k, j) + f(k, j + 1) + f(k + 1, j) + f(k + 1, j + 1) < 0;
      // c0 and c2 joined through the centre (inside, or outside) cut off c1
      // (bottom with right) and c3 (top with left); otherwise c0 and c2 are
      // cut off (bottom with left, right with top)
      const cutOffOdd = c0 === centreIn;
      const pair = cutOffOdd ? [1, 0, 3, 2] : [3, 2, 1, 0];
      return pair[entry];
    }
    for (let side = 0; side < 4; side++) if (side !== entry && crosses[side]) return side;
    return -1;
  };
  // From the left of the neck at the collar's top (grid row 1), up and
  // round to where the outline comes back down to that row
  let j0 = -1;
  for (let j = 0; j + 1 < COLS && j0 < 0; j++) if (!inside(1, j) && inside(1, j + 1)) j0 = j;
  if (j0 < 0) return [];
  const line: P2[] = [crossing(1, j0, 0)];
  let k = 1;
  let j = j0;
  let entry = 0;
  for (let guard = 0; guard < nRows * COLS; guard++) {
    const exit = exitOf(k, j, entry);
    if (exit < 0) break;
    line.push(crossing(k, j, exit));
    if (exit === 0 && k === 1) break;
    k += STEP_K[exit];
    j += STEP_J[exit];
    entry = (exit + 2) % 4;
    if (k < 0 || k + 1 >= nRows || j < 0 || j + 1 >= COLS) break;
  }
  return line;
};

/** Even spacing along a polyline (its ends kept). */
const resample = (pts: readonly P2[], step: number): P2[] => {
  const out: P2[] = [pts[0]];
  let carry = 0;
  for (let k = 1; k < pts.length; k++) {
    const [ax, ay] = pts[k - 1];
    const [bx, by] = pts[k];
    const len = Math.hypot(bx - ax, by - ay);
    let t = step - carry;
    while (t <= len) {
      out.push([ax + ((bx - ax) * t) / len, ay + ((by - ay) * t) / len]);
      t += step;
    }
    carry = len - (t - step);
  }
  const last = pts[pts.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > step * 0.25) out.push([last[0], last[1]]);
  else out[out.length - 1] = [last[0], last[1]];
  return out;
};

/** A Gaussian along an evenly spaced open polyline (its ends held), `radius` samples each side. */
const blur = (pts: readonly P2[], sigma: number, radius: number): P2[] => {
  const w = Array.from({ length: radius + 1 }, (_, i) => Math.exp(-(i * i) / (2 * sigma * sigma)));
  const n = pts.length;
  return pts.map((_, k) => {
    // Narrower toward the ends, so they stay put
    const r = Math.min(radius, k, n - 1 - k);
    let sx = 0;
    let sy = 0;
    let sw = 0;
    for (let i = -r; i <= r; i++) {
      const q = pts[k + i];
      const wi = w[Math.abs(i)];
      sx += q[0] * wi;
      sy += q[1] * wi;
      sw += wi;
    }
    return [sx / sw, sy / sw];
  });
};

/** The spacing the outline is bent smooth at, and how far the bend reaches (in samples). */
const STEP = 0.004;
const SIGMA = 1.6;

/**
 * A knight's whole outline for a view whose screen-right is c along its
 * facing and s across it: up the left of its base, round its head's
 * silhouette and down the right, bent smooth (x across, y up; piece units).
 * The same for every view near it: it changes as continuously as the view.
 */
export const knightOutline = (c: number, s: number): P2[] => {
  const right = knightBaseRight();
  const left = right.map(([x, y]): P2 => [-x, y]);
  const head = knightHead(c, s);
  const line = resample([...left, ...head, ...right.slice().reverse()], STEP);
  const bent = blur(line, SIGMA, 5);
  // The base is bent already (and its rings fitted to it): only from its
  // collar's top up
  const [lo, hi] = [KNIGHT_COLLAR_TOP - 0.012, KNIGHT_COLLAR_TOP];
  const out = line.map(([x, y], k): P2 => {
    const t = Math.min(Math.max((y - lo) / (hi - lo), 0), 1);
    const w = t * t * (3 - 2 * t);
    return [x + (bent[k][0] - x) * w, y + (bent[k][1] - y) * w];
  });
  return simplify(out, 0.0003);
};
