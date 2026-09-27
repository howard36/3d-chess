import type { BufferGeometry } from 'three';
import { decimate } from './decimate';
import type { Vec3 } from './mesh';
import { carve, ellipsoid, halfSpace, mirrorZ, roundCone, smax, surfaceNets, unite } from './sdf';
import type { Sdf } from './sdf';

// The knight's head and neck, sculpted as a signed-distance field: a deep
// neck swept up from the base, a long head angled down to the muzzle, a full
// jowl behind the jaw, pricked and cupped ears, flared nostrils and a parted
// mouth, blended with small fillets so the forms stay crisp. The mane (with
// its forelock) and the eyes are separate shells: the knight's accent. It
// faces +x, stands on the turned base (buried in its collar below
// KNIGHT_SEAT) and is about 0.73 tall.

/** Height at which the neck disappears into the base's collar. */
export const KNIGHT_SEAT = 0.14;

const cutBelow =
  (f: Sdf, y: number): Sdf =>
  (px, py, pz) =>
    smax(f(px, py, pz), halfSpace([0, y, 0], [0, -1, 0])(px, py, pz), 0);

const head: Sdf = (() => {
  const neck = unite(
    0.05,
    roundCone([0.012, 0.11, 0], [-0.03, 0.35, 0], 0.142, 0.106, 0.7),
    roundCone([-0.03, 0.35, 0], [-0.002, 0.555, 0], 0.106, 0.082, 0.78),
    // The chest, filling the front of the neck down into the base
    ellipsoid([0.07, 0.215, 0], [0.108, 0.1, 0.094]),
  );
  const skull = unite(
    0.035,
    // Forehead to muzzle, angled down and forward
    roundCone([0.02, 0.6, 0], [0.222, 0.452, 0], 0.074, 0.054, 0.84),
    // The jowl: the round cheek behind the jaw
    ellipsoid([0.06, 0.505, 0], [0.084, 0.078, 0.07]),
    // The muzzle's soft end
    ellipsoid([0.244, 0.436, 0], [0.062, 0.054, 0.05]),
  );
  // Ears: pricked, leaning slightly back and out, cupped in front
  const ears = mirrorZ(roundCone([0.018, 0.63, 0.03], [-0.008, 0.735, 0.042], 0.025, 0.006, 1));
  let f = unite(0.045, neck, skull);
  f = unite(0.016, f, ears);
  f = carve(f, mirrorZ(ellipsoid([0.024, 0.685, 0.044], [0.009, 0.034, 0.009])), 0.006);
  // Nostrils and the parted mouth
  f = carve(f, mirrorZ(ellipsoid([0.292, 0.455, 0.027], [0.015, 0.012, 0.012])), 0.008);
  f = carve(f, ellipsoid([0.296, 0.405, 0], [0.052, 0.0055, 0.09]), 0.006);
  return cutBelow(f, KNIGHT_SEAT);
})();

/** Walks from `from` along `dir` to the head's surface (for placing details on it). */
const surfaceAlong = (from: Vec3, dir: Vec3, limit = 0.4): Vec3 => {
  const at = (t: number): Vec3 => [
    from[0] + dir[0] * t,
    from[1] + dir[1] * t,
    from[2] + dir[2] * t,
  ];
  let t = 0;
  while (t < limit && head(...at(t)) < 0) t += 0.004;
  // Refine by bisection between the last step and this one
  let lo = Math.max(0, t - 0.004);
  let hi = t;
  for (let b = 0; b < 30; b++) {
    const mid = (lo + hi) / 2;
    if (head(...at(mid)) > 0) hi = mid;
    else lo = mid;
  }
  return at(hi);
};

// The crest of the neck, from the poll down to the withers: the back of the
// neck found at each height, for the mane to follow.
const crest = (): Vec3[] =>
  [0.672, 0.63, 0.57, 0.5, 0.43, 0.36, 0.29, 0.22, 0.17].map((y) =>
    surfaceAlong([y > 0.62 ? 0.02 : 0.0, y, 0], [-1, y > 0.64 ? 0.4 : 0, 0], 0.3),
  );

const mane: Sdf = (() => {
  const line = crest();
  const locks: Sdf[] = [];
  for (let k = 0; k < line.length - 1; k++) {
    // A round crest whose core sits inside the neck: it stands proud by
    // ~0.013 and spreads a little way down each side
    const inset = (p: Vec3): Vec3 => [p[0] + 0.019, p[1], 0];
    const r = 0.031 + 0.004 * (k / (line.length - 2));
    locks.push(roundCone(inset(line[k]), inset(line[k + 1]), r, r + 0.002, 0.9));
  }
  const ridge = unite(0.02, ...locks);
  // Carved locks: a few broad grooves slanting down the back of the neck
  // (broad enough for the default mesh to carry them cleanly)
  const grooved: Sdf = (x, y, z) => {
    const s = (y + 0.75 * x) / 0.062;
    const g = 0.5 - 0.5 * Math.cos(2 * Math.PI * s);
    return ridge(x, y, z) + 0.008 * g ** 4;
  };
  // The forelock, falling onto the forehead between the ears
  const forelock = roundCone([0.004, 0.676, 0], [0.078, 0.63, 0], 0.024, 0.013, 0.8);
  return cutBelow(unite(0.02, grooved, forelock), KNIGHT_SEAT + 0.02);
})();

const eyes: Sdf = (() => {
  // On the side of the head, above the jowl, set a touch into the surface
  const s = surfaceAlong([0.1, 0.565, 0], [0, 0, 1], 0.2);
  return mirrorZ(ellipsoid([s[0], s[1], s[2] - 0.006], [0.02, 0.013, 0.012]));
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
  // Decimated meshes are relaxed and shaded after decimation instead
  const coarse = { project: budget ? 1 : 2, normals: !budget };
  const nets = {
    head: surfaceNets(head, {
      min: [-0.21, KNIGHT_SEAT - 0.01, -0.12],
      max: [0.33, 0.76, 0.12],
      step,
      ...coarse,
    }),
    mane: surfaceNets(mane, {
      min: [-0.22, KNIGHT_SEAT, -0.05],
      max: [0.13, 0.72, 0.05],
      step,
      ...coarse,
    }),
    eyes: surfaceNets(eyes, {
      min: [0.05, 0.53, -0.1],
      max: [0.16, 0.6, 0.1],
      step: Math.min(step * 0.5, 0.006),
      ...coarse,
    }),
  };
  if (!budget) return nets;
  return {
    head: decimate(nets.head, Math.round(budget * 0.74), head),
    mane: decimate(nets.mane, Math.round(budget * 0.22), mane),
    eyes: decimate(nets.eyes, Math.round(budget * 0.04), eyes),
  };
};
