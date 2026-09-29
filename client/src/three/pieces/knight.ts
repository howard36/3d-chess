import type { BufferGeometry } from 'three';
import { decimate } from './decimate';
import { cross } from './mesh';
import type { Vec3 } from './mesh';
import { smoothLoop } from './profile';
import {
  carve,
  carvedSlab,
  ellipsoid,
  halfSpace,
  mirrorZ,
  orientedEllipsoid,
  outlineField,
  roundCone,
  scaleProfile,
  smax,
  surfaceNets,
  tiltedEllipsoid,
  unite,
} from './sdf';
import type { Sdf } from './sdf';

// The knight, carved the way a Staunton knight is: one side profile (the
// neck and head as a single arched form, bowed forward and down, a full
// chest, the head large, its face falling steeply to a deep, blunt muzzle
// and its jaw line falling toward it), given thickness with flat sides that
// round over at the outline: broadly over the chest, tightly at the ears
// and muzzle. On that block: two leaf-shaped ears pricked forward and
// splayed apart, round cheek plates, a carved eye under its brow, flared
// nostrils and an open mouth, and a mane down the crest: a narrow band of
// locks laid in herringbone, standing proud enough to break the outline of
// the neck. The relief names it in any finish; the mane and the eyes are
// separate shells (the knight's accent), so they can be painted apart. It
// faces +x, stands on the turned base (buried in its collar below
// KNIGHT_SEAT), and is drawn at SCALE of its profile's size (so it stands about
// 0.72 tall, below the bishop).

/** Height at which the neck disappears into the base's collar. */
export const KNIGHT_SEAT = 0.14;

/** The head is drawn scaled about the seat, in profile only (its thickness is as given). */
const SCALE = 0.92;

const smooth = (t: number) => t * t * (3 - 2 * t);
const ramp = (a: number, b: number, x: number) =>
  smooth(Math.min(Math.max((x - a) / (b - a), 0), 1));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The side profile (in profile units, before SCALE), facing +x,
 * counter-clockwise from the foot of the chest: up the chest and throat,
 * under the jaw to the muzzle, back up the face to the poll, and down the
 * crest of the neck.
 */
export const KNIGHT_OUTLINE: readonly (readonly [number, number])[] = [
  [0.06, 0.11],
  [0.142, 0.15],
  [0.178, 0.212], // chest
  [0.172, 0.268],
  [0.146, 0.312],
  [0.112, 0.34], // throat
  [0.096, 0.362],
  [0.104, 0.384], // under the jowl
  [0.138, 0.392],
  [0.19, 0.378], // the jaw, falling toward the muzzle
  [0.236, 0.362],
  [0.266, 0.362], // chin
  [0.285, 0.378],
  [0.292, 0.405], // muzzle
  [0.288, 0.44],
  [0.27, 0.472], // nose
  [0.228, 0.52],
  [0.176, 0.58], // face
  [0.126, 0.634],
  [0.082, 0.674], // forehead
  [0.04, 0.697],
  [0.002, 0.704], // poll
  [-0.04, 0.688],
  [-0.088, 0.64], // crest
  [-0.128, 0.565],
  [-0.158, 0.47],
  [-0.175, 0.37],
  [-0.178, 0.28],
  [-0.168, 0.2], // withers
  [-0.14, 0.14],
  [-0.08, 0.11],
];

/** Half the thickness across: a full chest, a strong neck, a head narrowing to the muzzle. */
const halfWidth = (x: number, y: number) => {
  const neck = lerp(0.13, 0.088, ramp(0.2, 0.46, y));
  const head = lerp(0.076, 0.052, ramp(0.14, 0.29, x));
  return lerp(neck, head, ramp(0.36, 0.48, y) * ramp(-0.02, 0.08, x));
};

/** How far in from the outline the sides round over: soft on the chest, crisp at the muzzle. */
const roundOver = (x: number, y: number) => {
  const chest = ramp(0.42, 0.36, y) * ramp(-0.02, 0.04, x);
  const crisp = Math.max(ramp(0.2, 0.26, x) * ramp(0.34, 0.37, y), ramp(0.66, 0.7, y));
  return lerp(lerp(0.036, 0.06, chest), 0.025, crisp);
};

const cutBelow =
  (f: Sdf, y: number): Sdf =>
  (px, py, pz) =>
    smax(f(px, py, pz), halfSpace([0, y, 0], [0, -1, 0])(px, py, pz), 0);

/** Walks from `from` along `dir` to the surface of `f` (for placing details on it). */
const surfaceAlong = (f: Sdf, from: Vec3, dir: Vec3, limit = 0.3): Vec3 => {
  const at = (t: number): Vec3 => [
    from[0] + dir[0] * t,
    from[1] + dir[1] * t,
    from[2] + dir[2] * t,
  ];
  let t = 0;
  while (t < limit && f(...at(t)) < 0) t += 0.003;
  let lo = Math.max(0, t - 0.003);
  let hi = t;
  for (let b = 0; b < 30; b++) {
    const mid = (lo + hi) / 2;
    if (f(...at(mid)) > 0) hi = mid;
    else lo = mid;
  }
  return at(hi);
};

const normalize = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Mane locks: pairs, each falling down the crest and out to one side. */
const LOCK_PAIRS = 6;
const LOCK_SPLAY = (25 * Math.PI) / 180;

/**
 * The knight's shapes, in world units: built on first use (the outline's
 * distance field and the placing of the details take a little while), then
 * kept.
 */
const sculpt = (() => {
  let shapes: { head: Sdf; mane: Sdf; eyes: Sdf; eye: Vec3 } | null = null;
  return () => {
    if (shapes) return shapes;
    const loop = smoothLoop(KNIGHT_OUTLINE, 6);
    const side = outlineField(loop, { min: [-0.26, 0.06], max: [0.36, 0.8], step: 0.005 });

    // The carved block, with the ears and the round cheek plates
    const slab = carvedSlab(side, halfWidth, roundOver);
    const ears = mirrorZ(roundCone([0.025, 0.685, 0.03], [0.055, 0.765, 0.052], 0.03, 0.009, 1));
    const cheeks = mirrorZ(ellipsoid([0.07, 0.46, 0.045], [0.075, 0.075, 0.04]));
    const block = unite(0.016, unite(0.012, slab, cheeks), ears);

    const EYE = surfaceAlong(block, [0.118, 0.6, 0], [0, 0, 1]);
    const NOSTRIL = surfaceAlong(block, [0.268, 0.43, 0], [0, 0, 1]);

    let f: Sdf = block;
    // The brow over the eye, and the flared rim of each nostril
    f = unite(
      0.008,
      f,
      mirrorZ(ellipsoid([EYE[0] - 0.005, EYE[1] + 0.018, EYE[2] - 0.008], [0.03, 0.01, 0.012])),
    );
    f = unite(
      0.01,
      f,
      mirrorZ(ellipsoid([NOSTRIL[0], NOSTRIL[1], NOSTRIL[2] - 0.008], [0.026, 0.02, 0.015])),
    );
    // The nostrils' openings, the eye's socket, the open mouth, and the cup
    // in front of each ear
    f = carve(
      f,
      mirrorZ(
        ellipsoid([NOSTRIL[0] + 0.006, NOSTRIL[1], NOSTRIL[2] + 0.003], [0.014, 0.011, 0.014]),
      ),
      0.004,
    );
    f = carve(
      f,
      mirrorZ(tiltedEllipsoid([EYE[0], EYE[1], EYE[2] + 0.002], [0.026, 0.017, 0.012], -0.6)),
      0.005,
    );
    f = carve(f, tiltedEllipsoid([0.3, 0.385, 0], [0.05, 0.009, 0.1], -0.25), 0.005);
    f = carve(
      f,
      mirrorZ(tiltedEllipsoid([0.056, 0.724, 0.043], [0.008, 0.03, 0.011], -0.36)),
      0.005,
    );
    const head = cutBelow(f, KNIGHT_SEAT);

    // The crest: the outline from the poll down to the withers
    const nearest = (x: number, y: number) =>
      loop.reduce(
        (best, p, k) =>
          Math.hypot(p[0] - x, p[1] - y) < Math.hypot(loop[best][0] - x, loop[best][1] - y)
            ? k
            : best,
        0,
      );
    const crest = loop.slice(nearest(0.0, 0.704), nearest(-0.168, 0.2) + 1);
    const lengths = [0];
    for (let k = 1; k < crest.length; k++) {
      lengths.push(
        lengths[k - 1] + Math.hypot(crest[k][0] - crest[k - 1][0], crest[k][1] - crest[k - 1][1]),
      );
    }
    /** A point a fraction of the way down the crest, its tangent (down) and outward normal. */
    const alongCrest = (fraction: number) => {
      const target = fraction * lengths[lengths.length - 1];
      let k = 1;
      while (k < crest.length - 1 && lengths[k] < target) k++;
      const t = (target - lengths[k - 1]) / (lengths[k] - lengths[k - 1]);
      const p: [number, number] = [
        crest[k - 1][0] + (crest[k][0] - crest[k - 1][0]) * t,
        crest[k - 1][1] + (crest[k][1] - crest[k - 1][1]) * t,
      ];
      const tx = crest[k][0] - crest[k - 1][0];
      const ty = crest[k][1] - crest[k - 1][1];
      const len = Math.hypot(tx, ty);
      // The outline runs counter-clockwise, so outward is to the right of travel
      return { p, t: [tx / len, ty / len, 0] as Vec3, n: [ty / len, -tx / len, 0] as Vec3 };
    };

    // The mane: a narrow band down the crest, standing a little proud...
    const band: Sdf[] = [];
    const steps = 10;
    const bandR = 0.016;
    for (let k = 0; k < steps; k++) {
      const a = alongCrest(0.04 + (0.92 * k) / steps);
      const b = alongCrest(0.04 + (0.92 * (k + 1)) / steps);
      const at = (q: typeof a): Vec3 => [q.p[0] - q.n[0] * 0.01, q.p[1] - q.n[1] * 0.01, 0];
      band.push(roundCone(at(a), at(b), bandR, bandR, (halfWidth(a.p[0], a.p[1]) * 0.5) / bandR));
    }
    // ...carved into locks laid in herringbone, each pair falling down and out
    const locks: Sdf[] = [];
    for (let k = 0; k < LOCK_PAIRS; k++) {
      const { p, t, n } = alongCrest(0.06 + (0.86 * (k + 0.5)) / LOCK_PAIRS);
      for (const s of [-1, 1]) {
        const a = normalize([
          t[0] * Math.cos(LOCK_SPLAY),
          t[1] * Math.cos(LOCK_SPLAY),
          s * Math.sin(LOCK_SPLAY),
        ]);
        const b = normalize(cross(a, n));
        const c: Vec3 = [
          // Out past the crest, so each lock breaks the neck's outline
          p[0] + n[0] * 0.006 + a[0] * 0.042,
          p[1] + n[1] * 0.006 + a[1] * 0.042,
          a[2] * 0.042,
        ];
        locks.push(orientedEllipsoid(c, [0.05, 0.018, 0.018], a, b, n));
      }
    }
    const maneShape = cutBelow(
      unite(0.004, unite(0.01, ...band), unite(0.003, ...locks)),
      KNIGHT_SEAT + 0.02,
    );
    // The mane lies within about 0.06 of the outline: far from it, a bound will do
    const mane: Sdf = (x, y, z) => {
      const d = side(x, y);
      if (d < -0.09) return -d - 0.075;
      if (d > 0.05) return d - 0.03;
      return maneShape(x, y, z);
    };

    // The eye: a small almond deep in its socket, under the brow
    const eyes = mirrorZ(
      tiltedEllipsoid([EYE[0], EYE[1], EYE[2] - 0.01], [0.015, 0.011, 0.009], -0.6),
    );

    const origin: [number, number] = [0, KNIGHT_SEAT];
    shapes = {
      head: scaleProfile(head, SCALE, origin),
      mane: scaleProfile(mane, SCALE, origin),
      eyes: scaleProfile(eyes, SCALE, origin),
      eye: [EYE[0] * SCALE, KNIGHT_SEAT + (EYE[1] - KNIGHT_SEAT) * SCALE, EYE[2]],
    };
    return shapes;
  };
})();

interface KnightGeometry {
  /** The head and neck (body). */
  head: BufferGeometry;
  /** The mane and the eyes (the knight's accent). */
  mane: BufferGeometry;
  eyes: BufferGeometry;
}

/**
 * Meshes the knight's head, mane and eyes: surface nets at grid `step`, then
 * decimated to `budget` triangles in all (none: keep every triangle).
 */
export const buildKnight = (step: number, budget?: number): KnightGeometry => {
  const { head, mane, eyes, eye } = sculpt();
  // Decimated meshes are relaxed and shaded after decimation instead
  const coarse = { project: budget ? 1 : 2, normals: !budget };
  const nets = {
    head: surfaceNets(head, {
      min: [-0.2, KNIGHT_SEAT - 0.01, -0.15],
      max: [0.3, 0.74, 0.15],
      step,
      ...coarse,
    }),
    mane: surfaceNets(mane, {
      min: [-0.2, KNIGHT_SEAT, -0.06],
      max: [0.06, 0.71, 0.06],
      // Fine enough (0.008 at medium) for each lock to resolve cleanly
      step: step * 0.62,
      ...coarse,
    }),
    eyes: surfaceNets(eyes, {
      min: [eye[0] - 0.025, eye[1] - 0.025, -0.12],
      max: [eye[0] + 0.025, eye[1] + 0.025, 0.12],
      step: Math.min(step * 0.4, 0.005),
      ...coarse,
    }),
  };
  if (!budget) return nets;
  return {
    head: decimate(nets.head, Math.round(budget * 0.72), head),
    mane: decimate(nets.mane, Math.round(budget * 0.25), mane),
    eyes: decimate(nets.eyes, Math.round(budget * 0.03), eyes),
  };
};
