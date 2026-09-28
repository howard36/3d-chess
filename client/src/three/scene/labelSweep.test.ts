import { describe, expect, it } from 'vitest';
import { fitView, hudBands } from '../cameraFit';
import { towerFrame, towerLayout } from '../layout';
import type { Orientation } from '../layout';
import type { Vec3 } from '../types';
import {
  CORNERS,
  EDGE_HYSTERESIS,
  labelAnchors,
  letterCorner,
  towerFrameRings,
} from './labelAnchors';
import type { AnchorState, LabelAnchor } from './labelAnchors';

// Every label at every pose the orbit can reach, both seats: the camera
// turned all the way round a degree at a time, at every whole degree of
// elevation from 14° below the horizon to overhead, standing where the view
// fits the tower in a desktop window and a phone either way up (upright, the
// farthest, where everything looks smallest against the gaps between the
// levels). The labels are carried from pose to pose, as the grid carries them
// while the view turns, so their hysteresis applies. What a player reads:
//
// - the five level letters stand at one corner post, in a straight world
//   line, in order A to E along it on screen;
// - no two labels overlap on screen (letters, files or ranks);
// - the letters never line up with the files or the ranks as one axis
//   (near a square view from 35° to 75° up, where any corner post runs
//   parallel to one row, they stand across the tower from it);
// - the letters change corner only well past the tie, and never back within
//   the hysteresis band.

const layout = towerLayout({ pieceHeight: 0.87 * 0.8, minElevation: -14 });
const frame = towerFrame(layout);
// As the grid draws them (grid.tsx): every label's sprite 0.32 high
const SIZE = 0.32;
const rings = towerFrameRings(layout, { size: SIZE, levelScale: 1 });
const DEG = Math.PI / 180;
const ELEVATIONS = Array.from({ length: 105 }, (_, i) => Math.min(-14 + i, 89.9));
const SEATS: Orientation[] = ['white', 'black'];
const WINDOWS = [
  [1280, 720],
  [390, 844],
  [844, 390],
] as const;

/** The fitted distance for a window at an elevation (degrees), as FitCameraToBoard stands. */
const fitted = (width: number, height: number, elevation: number) => {
  const { top, bottom } = hudBands(width, height, false);
  return fitView(elevation * DEG, rings, {
    width,
    height,
    fov: 36,
    topInset: top,
    bottomInset: bottom,
  }).distance;
};

const eyeAt = (azimuth: number, elevation: number, distance: number): Vec3 => [
  Math.sin(azimuth * DEG) * Math.cos(elevation * DEG) * distance,
  Math.sin(elevation * DEG) * distance,
  Math.cos(azimuth * DEG) * Math.cos(elevation * DEG) * distance,
];

/** Screen coordinates (tangents of the view angle, y up) and depth of world points, seen from `eye` looking at the origin. */
const viewer = (eye: Vec3) => {
  const l = Math.hypot(...eye);
  const f: Vec3 = [-eye[0] / l, -eye[1] / l, -eye[2] / l];
  const rl = Math.hypot(f[2], f[0]);
  const r: Vec3 = [-f[2] / rl, 0, f[0] / rl];
  const u: Vec3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return (p: Vec3) => {
    const v = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
    const depth = v[0] * f[0] + v[1] * f[1] + v[2] * f[2];
    return {
      x: (v[0] * r[0] + v[1] * r[1] + v[2] * r[2]) / depth,
      y: (v[0] * u[0] + v[1] * u[1] + v[2] * u[2]) / depth,
      depth,
    };
  };
};

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
    return { label, x, y, halfX: (w * SIZE) / (2 * depth), halfY: (h * SIZE) / (2 * depth) };
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
 * within 20° of each other and either sit side by side (each spans a quarter
 * of the other's length or more across the same stretch, as when the letters
 * stood in a column beside the ranks) or one carries on the other's line
 * (less than three letters apart across). Null when they do not.
 */
export const readsAsOneAxis = (letters: Box[], row: Box[]): string | null => {
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
  if (shared > 0.25 * Math.min(ll, rl)) return `side by side, ${angle.toFixed(0)}° apart`;
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

/** Every pose of an orbit at each elevation, turning `direction` (1 or -1) a degree at a time, the labels carried along. */
function* sweep(orientation: Orientation, width: number, height: number, direction = 1) {
  for (const elevation of ELEVATIONS) {
    const distance = fitted(width, height, elevation);
    let state: AnchorState | null = null;
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

const letters = (labels: LabelAnchor[]) => labels.filter((l) => l.level !== undefined);

describe('the labels at every pose', () => {
  for (const orientation of SEATS) {
    it(`stand the level letters up one corner post, in order, as ${orientation}`, () => {
      const bad: string[] = [];
      for (const { azimuth, elevation, eye, labels, state } of sweep(orientation, 390, 844)) {
        const row = letters(labels);
        const where = `az ${azimuth} el ${elevation}`;
        // One corner, the one touching neither the files' nor the ranks' edge
        const [sx, sz] = CORNERS[state.corner];
        if (state.corner !== letterCorner(state.edges)) bad.push(`${where}: corner`);
        if (sx === state.edges.ranks || sz === state.edges.files) bad.push(`${where}: on a row`);
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
        for (const { azimuth, elevation, eye, labels } of sweep(orientation, width, height)) {
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
            // Never near a letter: at least two letters' height clear
            for (const a of axis) {
              for (const l of row) {
                if (Math.hypot(a.x - l.x, a.y - l.y) < 3 * (a.halfY + l.halfY)) {
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

describe('the letters change corner', () => {
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

  for (const elevation of [-14, 18, 55, 89.9]) {
    it(`only past the hysteresis band, and never back within it, at ${elevation}°`, () => {
      // Turning one way: four changes a turn, each the band past a tie (the
      // ties are every quarter turn, where two edges face the camera equally)
      const near = (got: number[], want: number[]) => {
        expect(got).toHaveLength(want.length);
        got.forEach((a, i) => expect(Math.abs(a - want[i])).toBeLessThanOrEqual(0.5));
      };
      near(
        switches(5, 375, elevation, null).out.map((s) => s.azimuth),
        [90, 180, 270, 360].map((t) => t + band),
      );
      // ...and the other way, the band past each tie on that side
      near(
        switches(355, -15, elevation, null).out.map((s) => s.azimuth),
        [270, 180, 90, 0].map((t) => t - band),
      );
      // Just past a change, turning back within the band keeps the new corner
      const past = switches(60, 90 + band + 1, elevation, null).state;
      const back = switches(90 + band + 1, 90 - band + 0.5, elevation, past);
      expect(back.out).toEqual([]);
      // ...until the band's far side
      expect(switches(90 - band + 0.5, 70, elevation, back.state).out).toHaveLength(1);
    });
  }
});
