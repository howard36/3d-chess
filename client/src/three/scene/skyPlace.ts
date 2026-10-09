import { Vector3 } from 'three';

// Where things stand in the sky: directions by azimuth and elevation, and
// figures drawn in a unit box laid out on the dome (heavens.tsx and the
// the sky's other parts).

/** Radius of the dome the stars are set on (inside the sky sphere). */
export const DOME = 300;

export type P2 = [number, number];

export interface Constellation {
  /** Points in a unit box (x right, y up). */
  stars: P2[];
  /** Pairs of star indices joined by a line (indices past the stars are `marks`). */
  lines: [number, number][];
  /** Stars left unjoined (the knight's eye): drawn dimmer, no line. */
  loose?: P2[];
  /** Line ends that are not stars (a pawn chain's collar ticks), numbered after the stars. */
  marks?: P2[];
  /** The figure's brightest star (crafted drawing), an index into `stars`. */
  alpha?: number;
}

export interface Placement {
  c: Constellation;
  /** Degrees round from +z toward +x. */
  azimuth: number;
  /** Degrees above the horizon, of the figure's centre. */
  elevation: number;
  /** Height of the figure, degrees of sky. */
  size: number;
  /** A slight turn off upright, radians. */
  tilt: number;
}

export const DEG = Math.PI / 180;
const UP = new Vector3(0, 1, 0);

/** A direction in the sky at this azimuth (from +z toward +x) and elevation (radians). */
export const skyDirection = (azimuth: number, elevation: number) =>
  new Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation),
  );

/** A point on the dome from a constellation's unit box. */
export const placeStar = ([u, v]: P2, plan: Placement, dome = DOME): [number, number, number] => {
  const centre = skyDirection(plan.azimuth * DEG, plan.elevation * DEG);
  const inward = centre.clone().negate();
  const right = UP.clone().cross(inward).normalize();
  const up = inward.clone().cross(right).normalize();
  // The figure's size as an angle, laid out in the tangent plane
  const span = Math.tan(plan.size * DEG);
  const x = (u - 0.5) * span;
  const y = (v - 0.5) * span;
  const c = Math.cos(plan.tilt);
  const s = Math.sin(plan.tilt);
  const p = centre
    .clone()
    .addScaledVector(right, x * c - y * s)
    .addScaledVector(up, x * s + y * c);
  return p.normalize().multiplyScalar(dome).toArray() as [number, number, number];
};

/** Elevation of a point (degrees). */
export const elevationOf = ([x, y, z]: readonly number[]) => Math.atan2(y, Math.hypot(x, z)) / DEG;

/** The angle between two directions (degrees). */
export const angleBetween = (a: readonly number[], b: readonly number[]) => {
  const la = Math.hypot(a[0], a[1], a[2]);
  const lb = Math.hypot(b[0], b[1], b[2]);
  const d = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb);
  return Math.acos(Math.min(1, Math.max(-1, d))) / DEG;
};
