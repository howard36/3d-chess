import { describe, expect, it } from 'vitest';
import { fitView, hudTop } from '../cameraFit';
import type { Orientation } from '../layout';
import type { Vec3 } from '../types';
import { DEG, eyeAt, viewer } from './testKit';
import {
  CORNERS,
  EDGE_HYSTERESIS,
  LABEL_SIZE,
  labelAnchors,
  letterCorner,
  LETTERS_HIGH,
  LETTERS_LOW,
} from './labelAnchors';
import type { AnchorState, LabelAnchor } from './labelAnchors';
import { FRAME as frame, layout, PIECE_SCALE } from './palette';

// Every label at every pose the orbit can reach, both seats: the camera
// turned all the way round a degree at a time, at every whole degree of
// elevation from 14° below the horizon to overhead, standing where the view
// fits the tower in a desktop window and a phone either way up (upright, the
// farthest, where everything looks smallest against the gaps between the
// levels). The labels are carried from pose to pose, as the grid carries them
// while the view turns, so their hysteresis applies. What a player reads:
//
// - the five level letters stand at one corner post, in a straight world
//   line, in order A to E along it on screen: from low down at the far end
//   of the row facing the camera, from high up where neither row runs;
// - no two labels overlap on screen (letters, files or ranks);
// - the letters never line up with the files or the ranks as one axis
//   (near a square view from 35° to 75° up, where any corner post runs
//   parallel to one row, they stand across the tower from it);
// - at the side post, no letter stands on the tower on screen (its
//   platforms, borders, rims and the tallest pieces they can hold), so none
//   is hidden behind a piece; at the opening view every letter is as large
//   as the files;
// - the letters change post only well past the tie, or past LETTERS_HIGH
//   climbing and LETTERS_LOW dipping, and never back within the band.

const rings = layout.frameRings;
// Each sweep takes a few seconds on an idle machine and several times that on
// a busy one, past vitest's 5 s default
const SWEEP = { timeout: 30_000 };
const ELEVATIONS = Array.from({ length: 105 }, (_, i) => Math.min(-14 + i, 89.9));
const SEATS: Orientation[] = ['white', 'black'];
const WINDOWS = [
  [1280, 720],
  [390, 844],
  [844, 390],
] as const;

/** The fitted distance for a window at an elevation (degrees), as FitCameraToBoard stands. */
const fitted = (width: number, height: number, elevation: number) =>
  fitView(elevation * DEG, rings, { width, height, fov: 36, topInset: hudTop(height) }).distance;

/**
 * Each glyph's ink as a share of its sprite, across and up: Manrope as the
 * grid draws it (700 for the letters, 600 for files and ranks, at 0.66 of the
 * sprite; measured with the canvas's measureText), rounded up. The sprites
 * face the camera, so on screen each is an upright box of this size.
 */
const INK: Record<string, [number, number]> = {
  A: [0.43, 0.48],
  B: [0.36, 0.48],
  C: [0.45, 0.5],
  D: [0.4, 0.48],
  E: [0.32, 0.48],
  a: [0.32, 0.39],
  b: [0.34, 0.5],
  c: [0.34, 0.39],
  d: [0.34, 0.5],
  e: [0.36, 0.38],
  1: [0.17, 0.48],
  2: [0.33, 0.49],
  3: [0.33, 0.49],
  4: [0.34, 0.48],
  5: [0.33, 0.5],
};

/** A label on screen: its glyph's box, half its width and height, in the same units. */
interface Box {
  label: LabelAnchor;
  x: number;
  y: number;
  halfX: number;
  halfY: number;
}

const boxesOf = (labels: LabelAnchor[], eye: Vec3): Box[] => {
  const see = viewer(eye);
  return labels.map((label) => {
    const { x, y, depth } = see(label.position);
    const [w, h] = INK[label.text] ?? [0.5, 0.5];
    return {
      label,
      x,
      y,
      halfX: (w * LABEL_SIZE) / (2 * depth),
      halfY: (h * LABEL_SIZE) / (2 * depth),
    };
  });
};

/** How far (CSS px, on the window's own scale) two boxes overlap: the lesser overlap across or up, 0 when apart. */
const overlap = (a: Box, b: Box, height: number) => {
  const px = height / (2 * Math.tan(18 * DEG));
  const across = a.halfX + b.halfX - Math.abs(a.x - b.x);
  const up = a.halfY + b.halfY - Math.abs(a.y - b.y);
  return Math.max(0, Math.min(across, up) * px);
};

/**
 * From within 2° of overhead in an upright phone, the one place the tower is
 * seen from far enough for it, neighbouring letters may touch: seen from
 * straight above they stand a level's depth apart, which shrinks with the
 * square of the distance while the letters shrink with the distance alone.
 * No more than this (CSS px) of their boxes' corners, where the glyphs carry
 * almost no ink.
 */
const OVERHEAD_TOUCH = 1;

/**
 * The letters read as one axis with a row of files or ranks: their lines lie
 * within 20° of each other and either one carries on the other's line (less
 * than three letters apart across), or they stand side by side a like
 * distance apart (each spans a quarter of the other's length or more across
 * the same stretch, and their spacings differ by less than half), as when the
 * letters stood in a column beside the ranks as if they labelled the same
 * rows. Null when they do not.
 */
const readsAsOneAxis = (letters: Box[], row: Box[]): string | null => {
  const [a, e] = [letters[0], letters[letters.length - 1]];
  const [r0, r1] = [row[0], row[row.length - 1]];
  const ll = Math.hypot(e.x - a.x, e.y - a.y);
  const rl = Math.hypot(r1.x - r0.x, r1.y - r0.y);
  if (ll === 0 || rl === 0) return null;
  const u = [(e.x - a.x) / ll, (e.y - a.y) / ll];
  const v = [(r1.x - r0.x) / rl, (r1.y - r0.y) / rl];
  const angle = Math.acos(Math.min(1, Math.abs(u[0] * v[0] + u[1] * v[1]))) / DEG;
  if (angle >= 20) return null;
  const along = (b: Box) => (b.x - a.x) * u[0] + (b.y - a.y) * u[1];
  const [s0, s1] = [along(r0), along(r1)].sort((p, q) => p - q);
  const shared = Math.min(s1, ll) - Math.max(s0, 0);
  const mid = { x: (r0.x + r1.x) / 2, y: (r0.y + r1.y) / 2 };
  const across = Math.abs(u[0] * (mid.y - a.y) - u[1] * (mid.x - a.x));
  const pitch = ll / (letters.length - 1) / (rl / (row.length - 1));
  if (shared > 0.25 * Math.min(ll, rl) && pitch > 2 / 3 && pitch < 1.5) {
    return `side by side, ${angle.toFixed(0)}° apart`;
  }
  if (across < 3 * 2 * a.halfY) return `in one line, ${angle.toFixed(0)}° apart`;
  return null;
};

/**
 * Near a square view (within 15° of the azimuth where two edges tie) from 35°
 * to 75° up, one row runs straight away from the camera and stands on screen
 * as a near-upright column beside the tower, and so does every corner post:
 * wherever the letters stand they are near-parallel to it. Their corner is
 * the one across the tower from it (the far one), which is the best there is.
 */
const squareView = (azimuth: number, elevation: number) => {
  const off = Math.abs(azimuth - 90 * Math.round(azimuth / 90));
  return off <= 15 && elevation >= 35 && elevation <= 75;
};

interface SweepOptions {
  /** Turning 1 (anticlockwise from above) or -1. */
  direction?: number;
  /** Each orbit reached from this elevation (degrees), climbing or dipping to it, not from nowhere. */
  from?: number;
  /** The elevations (degrees) to orbit at. */
  elevations?: readonly number[];
}

/**
 * Every pose of an orbit at each elevation, turning a degree at a time, the
 * labels carried along.
 */
function* sweep(
  orientation: Orientation,
  width: number,
  height: number,
  { direction = 1, from, elevations = ELEVATIONS }: SweepOptions = {},
) {
  for (const elevation of elevations) {
    const distance = fitted(width, height, elevation);
    let state: AnchorState | null = null;
    if (from !== undefined) {
      const eye = eyeAt(-30 * direction, from, distance);
      state = labelAnchors(layout, orientation, eye, [0, 0, 0], null).state;
    }
    // A turn and a bit, so the first poses have been reached by turning too
    for (let step = -30; step <= 360; step++) {
      const azimuth = step * direction;
      const eye = eyeAt(azimuth, elevation, distance);
      const result = labelAnchors(layout, orientation, eye, [0, 0, 0], state);
      state = result.state;
      if (step >= 0) yield { azimuth, elevation, eye, ...result };
    }
  }
}

/**
 * The poses of every orbit, and between LETTERS_LOW and LETTERS_HIGH, where
 * the letters' post depends on the way the camera came, of the orbits
 * reached by climbing and by dipping to them.
 */
function* everyPose(orientation: Orientation, width: number, height: number) {
  yield* sweep(orientation, width, height);
  const band = ELEVATIONS.filter((e) => e >= LETTERS_LOW / DEG && e <= LETTERS_HIGH / DEG);
  yield* sweep(orientation, width, height, { from: 0, elevations: band });
  yield* sweep(orientation, width, height, { from: 89.9, elevations: band });
}

const letters = (labels: LabelAnchor[]) => labels.filter((l) => l.level !== undefined);

describe('the labels at every pose', SWEEP, () => {
  for (const orientation of SEATS) {
    it(`stand the level letters up one corner post, in order, as ${orientation}`, () => {
      const bad: string[] = [];
      for (const { azimuth, elevation, eye, labels, state } of everyPose(orientation, 390, 844)) {
        const row = letters(labels);
        const where = `az ${azimuth} el ${elevation}`;
        // One corner: from low down at the far end of the row facing the
        // camera, from high up touching neither row
        const [sx, sz] = CORNERS[state.corner];
        const { edges, high, facing } = state;
        if (state.corner !== letterCorner(edges, high, facing)) bad.push(`${where}: corner`);
        const [onFiles, onRanks] = [sz === edges.files, sx === edges.ranks];
        if (onFiles && onRanks) bad.push(`${where}: where the rows meet`);
        if (high && (onFiles || onRanks)) bad.push(`${where}: on a row from high up`);
        if (!high && !(facing === 'files' ? onFiles : onRanks)) {
          bad.push(`${where}: not on the facing row`);
        }
        if (elevation >= LETTERS_HIGH / DEG && !state.high) bad.push(`${where}: low post up high`);
        if (elevation <= LETTERS_LOW / DEG && state.high) bad.push(`${where}: high post low down`);
        if (new Set(row.map((l) => l.key)).size !== 1) bad.push(`${where}: keys`);
        // In a straight world line: up the post, each just outside its own
        // platform's corner along the diagonal, at its own level
        row.forEach((l, z) => {
          const [x, y, zz] = l.position;
          if (x !== row[0].position[0] || zz !== row[0].position[2])
            bad.push(`${where}: off the post`);
          if (Math.sign(x) !== sx || Math.sign(zz) !== sz) bad.push(`${where}: wrong corner`);
          if (Math.abs(x) <= frame.half + 0.2 || Math.abs(x) !== Math.abs(zz)) {
            bad.push(`${where}: not out along the diagonal`);
          }
          if (y <= frame.levelY[z] || y >= frame.levelY[z] + frame.gap / 4) {
            bad.push(`${where}: ${l.text} not at its level`);
          }
        });
        // In order A to E along their line on screen
        const b = boxesOf(row, eye);
        const [a, e] = [b[0], b[4]];
        const along = b.map((p) => (p.x - a.x) * (e.x - a.x) + (p.y - a.y) * (e.y - a.y));
        if (along.some((v, k) => k > 0 && v <= along[k - 1])) bad.push(`${where}: out of order`);
      }
      expect(bad.slice(0, 20)).toEqual([]);
    });

    for (const [width, height] of WINDOWS) {
      it(`never overlaps two labels, nor lines the letters up with a row, as ${orientation} in ${width}x${height}`, () => {
        const bad: string[] = [];
        for (const { azimuth, elevation, eye, labels } of everyPose(orientation, width, height)) {
          const where = `az ${azimuth} el ${elevation}`;
          // A file or rank faded out (its platform edge-on) is not read
          const shown = boxesOf(labels, eye).filter((b) => (b.label.opacity ?? 1) >= 0.5);
          for (let i = 0; i < shown.length; i++) {
            for (let j = i + 1; j < shown.length; j++) {
              const [a, b] = [shown[i], shown[j]];
              // (see OVERHEAD_TOUCH)
              const letters = a.label.level !== undefined && b.label.level !== undefined;
              const slack = letters && elevation >= 88 && width < height ? OVERHEAD_TOUCH : 0;
              if (overlap(a, b, height) > slack) {
                bad.push(`${where}: ${a.label.id} overlaps ${b.label.id}`);
              }
            }
          }
          const row = shown.filter((b) => b.label.level !== undefined);
          for (const prefix of ['file-', 'rank-']) {
            const axis = shown.filter((b) => b.label.id.startsWith(prefix));
            // Never beside a letter: two letters' height apart at least
            for (const a of axis) {
              for (const l of row) {
                if (Math.hypot(a.x - l.x, a.y - l.y) < 2 * (a.halfY + l.halfY)) {
                  bad.push(`${where}: ${a.label.id} beside ${l.label.id}`);
                }
              }
            }
            if (axis.length < 5) continue;
            const one = readsAsOneAxis(row, axis);
            if (!one) continue;
            // Side by side is inevitable near a square view from 35° to 75°
            // up (see squareView), and allowed there only across the tower
            if (one.startsWith('side') && squareView(azimuth, elevation)) {
              const mean = (bs: Box[]) => bs.reduce((m, b) => m + b.x, 0) / bs.length;
              if (Math.sign(mean(row)) !== -Math.sign(mean(axis))) {
                bad.push(`${where}: letters and ${prefix}labels ${one}, on one side`);
              }
              continue;
            }
            bad.push(`${where}: letters and ${prefix}labels ${one}`);
          }
        }
        expect(bad.slice(0, 20)).toEqual([]);
      });
    }
  }

  it('recognises the letters beside the ranks as one axis (the old top-down row)', () => {
    // From overhead, a column of letters left of the tower level with the
    // ranks on its right, as the letters used to spread
    const eye = eyeAt(0, 89.9, 20);
    const box = (x: number, z: number, id: string, level?: number): Box =>
      boxesOf([{ id, text: id, key: '', position: [x, frame.levelY[4], z], level }], eye)[0];
    const column = [0, 1, 2, 3, 4].map((z) => box(-3, 2 - z, `level-${z}`, z));
    const ranks = [0, 1, 2, 3, 4].map((r) => box(3, 2 - r, `rank-${r}`));
    expect(readsAsOneAxis(column, ranks)).toMatch(/side by side/);
    // ...or carrying on the files' line from its end
    const files = [0, 1, 2, 3, 4].map((f) => box(-2 + f, 2.9, `file-${f}`));
    const onward = [0, 1, 2, 3, 4].map((z) => box(-3 - 0.4 * z, 2.9, `level-${z}`, z));
    expect(readsAsOneAxis(onward, files)).toMatch(/in one line/);
    // A diagonal line at a corner is neither
    const diagonal = [0, 1, 2, 3, 4].map((z) => box(-3 - 0.1 * z, -3 - 0.1 * z, `level-${z}`, z));
    expect(readsAsOneAxis(diagonal, ranks)).toBeNull();
    expect(readsAsOneAxis(diagonal, files)).toBeNull();
  });
});

/** Points' convex hull on screen (monotone chain), anticlockwise. */
const hull = (points: { x: number; y: number }[]) => {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: typeof a) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list: typeof p) => {
    const out: typeof p = [];
    for (const q of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
      out.push(q);
    }
    return out.slice(0, -1);
  };
  return [...half(p), ...half([...p].reverse())];
};

/**
 * How far (CSS px) a box stands clear of a convex polygon on screen: the
 * widest gap along any separating axis (the box's own and the polygon's
 * sides' normals), negative when they overlap.
 */
const clearance = (b: Box, poly: { x: number; y: number }[], height: number) => {
  const px = height / (2 * Math.tan(18 * DEG));
  const axes: [number, number][] = [
    [1, 0],
    [0, 1],
  ];
  poly.forEach((a, i) => {
    const c = poly[(i + 1) % poly.length];
    const l = Math.hypot(c.x - a.x, c.y - a.y) || 1;
    axes.push([(a.y - c.y) / l, (c.x - a.x) / l]);
  });
  let best = -Infinity;
  for (const [ax, ay] of axes) {
    const centre = b.x * ax + b.y * ay;
    const reach = b.halfX * Math.abs(ax) + b.halfY * Math.abs(ay);
    const ps = poly.map((q) => q.x * ax + q.y * ay);
    const gap = Math.max(Math.min(...ps) - (centre + reach), centre - reach - Math.max(...ps));
    best = Math.max(best, gap);
  }
  return best * px;
};

/**
 * The tower on screen: every platform with its glass and border (reaching
 * 0.08 past its squares) and its rim (0.03 under it), and on every level the
 * tallest pieces it can hold over its outer squares (a third of a square
 * either side of their centres).
 */
const towerPoints = (): Vec3[] => {
  const plate = frame.half + 0.08;
  const piece = frame.half - frame.pitch / 2 + 0.3 * frame.pitch;
  const pieceHeight = 0.87 * PIECE_SCALE;
  const out: Vec3[] = [];
  for (const y of frame.levelY) {
    for (const [sx, sz] of CORNERS) {
      for (const h of [0, -0.03]) out.push([sx * plate, y + h, sz * plate]);
      for (const h of [0, pieceHeight]) out.push([sx * piece, y + h, sz * piece]);
    }
  }
  return out;
};

describe('the letters from low down', SWEEP, () => {
  const tower = towerPoints();
  for (const orientation of SEATS) {
    for (const [width, height] of WINDOWS) {
      it(`stand outside the tower on screen at the side post, as ${orientation} in ${width}x${height}`, () => {
        const bad: string[] = [];
        let least = Infinity;
        // Every orbit reached from low down: at the side post to LETTERS_HIGH
        for (const { azimuth, elevation, eye, labels, state } of sweep(orientation, width, height, {
          from: 0,
        })) {
          if (state.high) continue;
          const see = viewer(eye);
          const outline = hull(tower.map(see));
          for (const b of boxesOf(letters(labels), eye)) {
            const clear = clearance(b, outline, height);
            least = Math.min(least, clear);
            if (clear <= 0) bad.push(`az ${azimuth} el ${elevation}: ${b.label.id} on the tower`);
          }
        }
        expect(bad.slice(0, 20)).toEqual([]);
        expect(least).toBeGreaterThan(0);
      });
    }
  }

  it('recognises a letter on the tower', () => {
    const eye = eyeAt(16, 18, 20);
    const outline = hull(tower.map(viewer(eye)));
    const at = (position: Vec3) =>
      clearance(boxesOf([{ id: 'l', text: 'A', key: '', position }], eye)[0], outline, 720);
    expect(at([0, 0, 0])).toBeLessThan(0);
    expect(at([frame.half, frame.levelY[0], frame.half])).toBeLessThan(0);
    expect(at([-6, 0, 0])).toBeGreaterThan(0);
  });

  // At the view each seat opens on, a letter is never smaller than the files
  // it stands beside: at least this share of the smallest file label's height
  const LEGIBLE = 0.95;
  for (const orientation of SEATS) {
    for (const [width, height] of WINDOWS) {
      it(`are as large as the files at the opening view, as ${orientation} in ${width}x${height}`, () => {
        const eye = eyeAt(16, 18, fitted(width, height, 18));
        const { labels } = labelAnchors(layout, orientation, eye, [0, 0, 0], null);
        const px = height / (2 * Math.tan(18 * DEG));
        const see = viewer(eye);
        const tall = (l: LabelAnchor) => (LABEL_SIZE / see(l.position).depth) * px;
        const n = LEGIBLE * Math.min(...labels.filter((l) => l.id.startsWith('file-')).map(tall));
        for (const l of letters(labels)) expect(tall(l), l.id).toBeGreaterThanOrEqual(n);
        // (and never tiny: a file label's sprite is 10 px tall or more even on the phone)
        expect(n).toBeGreaterThan(10);
      });
    }
  }
});

describe('the letters change corner', SWEEP, () => {
  /** The azimuths (degrees) where the letters' corner changed on a sweep, and the corner after. */
  const switches = (from: number, to: number, elevation: number, start: AnchorState | null) => {
    const step = from < to ? 0.5 : -0.5;
    let state = start;
    const out: { azimuth: number; corner: number }[] = [];
    for (let a = from; step > 0 ? a <= to : a >= to; a += step) {
      const next = labelAnchors(layout, 'white', eyeAt(a, elevation, 20), [0, 0, 0], state).state;
      if (state && next.corner !== state.corner) out.push({ azimuth: a, corner: next.corner });
      state = next;
    }
    return { out, state: state! };
  };
  const band = EDGE_HYSTERESIS / DEG;

  for (const elevation of [-14, 18, 40, 55, 89.9]) {
    it(`only past the hysteresis band, and never back within it, at ${elevation}°`, () => {
      // Turning one way, each change the band past a tie: every quarter turn
      // two edges face the camera equally; from low down the letters also
      // change sides midway, where the files and the ranks face it equally
      const high = elevation >= LETTERS_HIGH / DEG;
      const ties = high ? [90, 180, 270, 360] : [45, 90, 135, 180, 225, 270, 315, 360];
      const near = (got: number[], want: number[]) => {
        expect(got).toHaveLength(want.length);
        got.forEach((a, i) => expect(Math.abs(a - want[i])).toBeLessThanOrEqual(0.5));
      };
      near(
        switches(5, 375, elevation, null).out.map((s) => s.azimuth),
        ties.map((t) => t + band),
      );
      // ...and the other way, the band past each tie on that side
      near(
        switches(355, -15, elevation, null).out.map((s) => s.azimuth),
        ties.map((t) => 360 - t).map((t) => t - band),
      );
      // Just past a change, turning back within the band keeps the new corner
      const past = switches(60, 90 + band + 1, elevation, null).state;
      const back = switches(90 + band + 1, 90 - band + 0.5, elevation, past);
      expect(back.out).toEqual([]);
      // ...until the band's far side
      expect(switches(90 - band + 0.5, 70, elevation, back.state).out).toHaveLength(1);
    });
  }

  it('from the side post to the far one only past LETTERS_HIGH, and back only under LETTERS_LOW', () => {
    for (const azimuth of [16, 60, 110, 200, 300]) {
      /** The elevations (degrees) where the letters' post changed on a climb or dip. */
      const climb = (elevations: number[], start: AnchorState | null) => {
        let state = start;
        const out: number[] = [];
        for (const e of elevations) {
          const next = labelAnchors(layout, 'white', eyeAt(azimuth, e, 20), [0, 0, 0], state).state;
          if (state && next.high !== state.high) {
            out.push(e);
            // All five letters at once: one post, one key
            expect(next.corner).not.toBe(state.corner);
          }
          state = next;
        }
        return { out, state: state! };
      };
      const up = Array.from({ length: 419 }, (_, i) => -14 + i / 4);
      const going = climb(up, null);
      expect(going.out).toHaveLength(1);
      // (within the climb's quarter-degree steps of the threshold)
      expect(going.out[0]).toBeGreaterThanOrEqual(LETTERS_HIGH / DEG);
      expect(going.out[0]).toBeLessThanOrEqual(LETTERS_HIGH / DEG + 0.25);
      const coming = climb([...up].reverse(), going.state);
      expect(coming.out).toHaveLength(1);
      expect(coming.out[0]).toBeLessThanOrEqual(LETTERS_LOW / DEG);
      expect(coming.out[0]).toBeGreaterThanOrEqual(LETTERS_LOW / DEG - 0.25);
      // Wavering between the two never changes it
      const wavering = [46, 54, 47, 53, 50, 45.5, 54.5].flatMap((e) => [e, e]);
      expect(climb(wavering, climb([30], null).state).out).toEqual([]);
      expect(climb(wavering, climb([70], null).state).out).toEqual([]);
    }
  });
});
