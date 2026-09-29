import type { Vec3 } from '../types';

// What the scene's tests share: a camera standing at an azimuth and elevation,
// and what it sees of a point.

export const DEG = Math.PI / 180;

/** A camera `distance` from the origin at this azimuth and elevation (degrees). */
export const eyeAt = (azimuth: number, elevation: number, distance: number): Vec3 => [
  Math.sin(azimuth * DEG) * Math.cos(elevation * DEG) * distance,
  Math.sin(elevation * DEG) * distance,
  Math.cos(azimuth * DEG) * Math.cos(elevation * DEG) * distance,
];

/** Screen coordinates (tangents of the view angle, y up) and depth of world points, seen from `eye` looking at the origin. */
export const viewer = (eye: Vec3) => {
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
