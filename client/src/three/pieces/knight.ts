import type { BufferGeometry } from 'three';
import { decimate } from './decimate';
import type { Vec3 } from './mesh';
import { smoothLoop } from './profile';
import {
  carve,
  carvedSlab,
  ellipsoid,
  halfSpace,
  mirrorZ,
  outlineField,
  roundCone,
  smax,
  surfaceNets,
  tiltedEllipsoid,
  unite,
} from './sdf';
import type { Sdf } from './sdf';

// The knight, carved the way a Staunton knight is: one side profile (the
// neck and head as a single arched form, a broad chest, the head large and
// angled down to the muzzle), given thickness with flat sides that round
// over at the outline and narrow toward the muzzle. On that block: pricked
// ears cupped forward, full cheeks, a deep-set eye, flared nostrils and a
// parted mouth. The mane (a row of carved locks down the crest, and a
// forelock) and the eyes are separate shells, the knight's accent. It faces
// +x, stands on the turned base (buried in its collar below KNIGHT_SEAT)
// and is about 0.76 tall.

/** Height at which the neck disappears into the base's collar. */
export const KNIGHT_SEAT = 0.14;

const smooth = (t: number) => t * t * (3 - 2 * t);
const ramp = (a: number, b: number, x: number) =>
  smooth(Math.min(Math.max((x - a) / (b - a), 0), 1));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The side profile, facing +x, counter-clockwise from the foot of the chest:
 * up the chest and throat, under the jaw to the muzzle, back along the face
 * to the poll, and down the crest of the neck.
 */
export const KNIGHT_OUTLINE: readonly (readonly [number, number])[] = [
  [0.06, 0.11],
  [0.132, 0.15],
  [0.162, 0.215], // chest
  [0.154, 0.28],
  [0.12, 0.335], // throat
  [0.1, 0.375],
  [0.112, 0.412], // under the jowl
  [0.165, 0.425],
  [0.228, 0.428], // chin
  [0.27, 0.442],
  [0.294, 0.47], // muzzle
  [0.298, 0.503],
  [0.282, 0.53], // nose
  [0.225, 0.572],
  [0.162, 0.618], // face
  [0.108, 0.655], // forehead
  [0.058, 0.681],
  [0.012, 0.69], // poll
  [-0.04, 0.668],
  [-0.09, 0.615], // crest
  [-0.13, 0.535],
  [-0.157, 0.445],
  [-0.17, 0.355],
  [-0.172, 0.27],
  [-0.163, 0.195], // withers
  [-0.14, 0.14],
  [-0.08, 0.11],
];

/**
 * The knight's shapes: built on first use (the outline's distance field and
 * the placing of the details take a little while), then kept.
 */
const sculpt = (() => {
  let shapes: { head: Sdf; mane: Sdf; eyes: Sdf; eye: Vec3 } | null = null;
  return () => {
    if (shapes) return shapes;
    const loop = smoothLoop(KNIGHT_OUTLINE, 6);
    const side = outlineField(loop, { min: [-0.26, 0.06], max: [0.36, 0.8], step: 0.005 });

    /** Half the thickness across: a broad chest, a leaner neck, a head narrowing to the muzzle. */
    const halfWidth = (x: number, y: number) => {
      const neck = lerp(0.1, 0.072, ramp(0.2, 0.45, y));
      const head = lerp(0.068, 0.047, ramp(0.13, 0.3, x));
      return lerp(neck, head, ramp(0.38, 0.5, y) * ramp(-0.04, 0.06, x));
    };
    const ROUND = 0.036;

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

    // The carved block, with the ears and the full cheeks
    const block: Sdf = (() => {
      const slab = carvedSlab(side, halfWidth, ROUND);
      const ears = mirrorZ(roundCone([0.042, 0.655, 0.03], [0.064, 0.752, 0.036], 0.026, 0.006));
      const cheeks = mirrorZ(ellipsoid([0.07, 0.49, 0.04], [0.07, 0.06, 0.032]));
      let f = unite(0.02, slab, cheeks);
      f = unite(0.016, f, ears);
      return f;
    })();

    const EYE: Vec3 = surfaceAlong(block, [0.138, 0.596, 0], [0, 0, 1]);
    const NOSTRIL: Vec3 = surfaceAlong(block, [0.272, 0.505, 0], [0, 0, 1]);

    const head: Sdf = (() => {
      // Flared nostrils: a raised rim, then the opening
      let f = unite(
        0.01,
        block,
        mirrorZ(ellipsoid([NOSTRIL[0], NOSTRIL[1], NOSTRIL[2] - 0.008], [0.024, 0.018, 0.014])),
      );
      f = carve(
        f,
        mirrorZ(
          ellipsoid([NOSTRIL[0] + 0.006, NOSTRIL[1], NOSTRIL[2] + 0.002], [0.012, 0.009, 0.012]),
        ),
        0.004,
      );
      // The eye's socket, the mouth, and the hollow in front of each ear
      f = carve(
        f,
        mirrorZ(tiltedEllipsoid([EYE[0], EYE[1], EYE[2] + 0.002], [0.032, 0.022, 0.013], -0.5)),
        0.005,
      );
      f = carve(f, tiltedEllipsoid([0.306, 0.449, 0], [0.034, 0.004, 0.1], -0.3), 0.005);
      f = carve(f, mirrorZ(ellipsoid([0.07, 0.702, 0.036], [0.008, 0.03, 0.01])), 0.005);
      return cutBelow(f, KNIGHT_SEAT);
    })();

    // The crest: the outline from the poll down to the withers, for the mane
    const crest = (() => {
      const nearest = (x: number, y: number) =>
        loop.reduce(
          (best, p, k) =>
            Math.hypot(p[0] - x, p[1] - y) < Math.hypot(loop[best][0] - x, loop[best][1] - y)
              ? k
              : best,
          0,
        );
      const a = nearest(0.012, 0.69);
      const b = nearest(-0.163, 0.2);
      return loop.slice(a, b + 1);
    })();

    /** A point a fraction of the way down the crest, with its tangent and outward normal. */
    const alongCrest = (f: number) => {
      const lengths = [0];
      for (let k = 1; k < crest.length; k++) {
        lengths.push(
          lengths[k - 1] + Math.hypot(crest[k][0] - crest[k - 1][0], crest[k][1] - crest[k - 1][1]),
        );
      }
      const target = f * lengths[lengths.length - 1];
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
      return { p, t: [tx / len, ty / len] as const, n: [ty / len, -tx / len] as const };
    };

    const LOCKS = 12;

    const mane: Sdf = (() => {
      // A continuous crest down the back of the neck...
      const ridge: Sdf[] = [];
      const steps = 10;
      for (let k = 0; k < steps; k++) {
        const a = alongCrest(k / steps);
        const b = alongCrest((k + 1) / steps);
        const at = (q: typeof a): Vec3 => [q.p[0] - q.n[0] * 0.012, q.p[1] - q.n[1] * 0.012, 0];
        const r = 0.022;
        ridge.push(roundCone(at(a), at(b), r, r, (halfWidth(a.p[0], a.p[1]) * 0.9) / r));
      }
      // ...carved into overlapping locks that fall down and in from it
      const locks: Sdf[] = [];
      for (let k = 0; k < LOCKS; k++) {
        const { p, t, n } = alongCrest((k + 0.6) / (LOCKS + 0.2));
        const ax = t[0] * 0.8 - n[0] * 0.6;
        const ay = t[1] * 0.8 - n[1] * 0.6;
        const c: Vec3 = [p[0] - n[0] * 0.01 - ax * 0.014, p[1] - n[1] * 0.01 - ay * 0.014, 0];
        const lateral = halfWidth(p[0], p[1]) * 0.98;
        locks.push(tiltedEllipsoid(c, [0.042, 0.019, lateral], Math.atan2(ay, ax)));
      }
      // The forelock, falling forward onto the forehead between the ears
      locks.push(tiltedEllipsoid([0.05, 0.681, 0], [0.034, 0.012, 0.022], -0.45));
      const f = cutBelow(
        unite(0.004, unite(0.01, ...ridge), unite(0.003, ...locks)),
        KNIGHT_SEAT + 0.02,
      );
      // The mane lies within about 0.06 of the outline: far from it, a bound will do
      return (x, y, z) => {
        const s = side(x, y);
        if (s < -0.09) return -s - 0.075;
        if (s > 0.05) return s - 0.03;
        return f(x, y, z);
      };
    })();

    const eyes: Sdf = mirrorZ(
      tiltedEllipsoid([EYE[0], EYE[1], EYE[2] - 0.007], [0.024, 0.016, 0.011], -0.5),
    );
    shapes = { head, mane, eyes, eye: EYE };
    return shapes;
  };
})();

export interface KnightGeometry {
  head: BufferGeometry;
  mane: BufferGeometry;
  eyes: BufferGeometry;
}

/**
 * Meshes the knight's head, mane and eyes: surface nets at grid `step`, then
 * decimated to `budget` triangles in all (none: keep every triangle).
 */
export const buildKnight = (step: number, budget?: number): KnightGeometry => {
  const { head, mane, eyes, eye: EYE } = sculpt();
  // Decimated meshes are relaxed and shaded after decimation instead
  const coarse = { project: budget ? 1 : 2, normals: !budget };
  const nets = {
    head: surfaceNets(head, {
      min: [-0.21, KNIGHT_SEAT - 0.01, -0.11],
      max: [0.33, 0.77, 0.11],
      step,
      ...coarse,
    }),
    mane: surfaceNets(mane, {
      min: [-0.23, KNIGHT_SEAT, -0.1],
      max: [0.1, 0.72, 0.1],
      step: step * 0.85,
      ...coarse,
    }),
    eyes: surfaceNets(eyes, {
      min: [EYE[0] - 0.03, EYE[1] - 0.03, -0.1],
      max: [EYE[0] + 0.03, EYE[1] + 0.03, 0.1],
      step: Math.min(step * 0.4, 0.005),
      ...coarse,
    }),
  };
  if (!budget) return nets;
  return {
    head: decimate(nets.head, Math.round(budget * 0.68), head),
    mane: decimate(nets.mane, Math.round(budget * 0.28), mane),
    eyes: decimate(nets.eyes, Math.round(budget * 0.04), eyes),
  };
};
