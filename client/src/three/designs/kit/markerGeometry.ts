import { movePoint } from '../../movePath';
import type { Vec3 } from '../types';

// Pure geometry behind the floor markers and the last-move line, kept apart
// from the components so it can be unit tested without WebGL.

export type MarkerShape = 'square' | 'brackets' | 'ring' | 'dot';

/** Numeric shape ids the marker shader switches on. */
export const SHAPE_ID: Record<MarkerShape, number> = { square: 0, brackets: 1, ring: 2, dot: 3 };

export interface MarkerMetricsOptions {
  /** How far the outline sits inside the square's edge, as a fraction of the pitch. */
  inset?: number;
  /** Stroke width, as a fraction of the pitch. */
  lineWidth?: number;
  /** Radius of the ring, as a fraction of the pitch (clears a piece's base). */
  ringRadius?: number;
  /** Corner rounding of the square outline, as a fraction of the pitch. */
  cornerRadius?: number;
  /** Length of each corner bracket's arms, as a fraction of the outline's half side. */
  bracketLength?: number;
  /**
   * Radius of a capture ring, as a fraction of the pitch: wider than the
   * plain ring so it shows outside the victim's base (at least 0.42).
   */
  captureRingRadius?: number;
}

export interface MarkerMetrics {
  /** Side of the quad the marker is drawn on (world units). */
  quad: number;
  /** Half side of the square outline / bracket frame, to the stroke's centre. */
  half: number;
  lineWidth: number;
  ringRadius: number;
  dotRadius: number;
  cornerRadius: number;
  /** Where the bracket arms stop, measured from the centre along each axis. */
  bracketStart: number;
  /** Length of the capture cue's inward ticks. */
  tickLength: number;
  /** Radius of a capture ring (the ring shape with the capture cue). */
  captureRing: number;
  /** Length of a capture ring's ticks, pointing outward toward the square's corners. */
  captureTick: number;
}

/**
 * Sizes of a floor marker for squares `pitch` apart. Every stroke stays
 * inside its own square, so markers on neighbouring squares never touch.
 */
export const markerMetrics = (pitch: number, o: MarkerMetricsOptions = {}): MarkerMetrics => {
  const inset = (o.inset ?? 0.1) * pitch;
  const lineWidth = (o.lineWidth ?? 0.06) * pitch;
  const half = pitch / 2 - inset - lineWidth / 2;
  const captureRing = Math.min(
    Math.max((o.captureRingRadius ?? 0.42) * pitch, (o.ringRadius ?? 0.34) * pitch),
    pitch / 2 - lineWidth / 2,
  );
  // Diagonal ticks end short of the square's corner (at 0.707 of the pitch)
  const cornerRoom = (pitch / 2 - lineWidth / 2) * Math.SQRT2 - captureRing - lineWidth / 2;
  return {
    quad: pitch,
    half,
    lineWidth,
    ringRadius: Math.min((o.ringRadius ?? 0.34) * pitch, half),
    dotRadius: 0.1 * pitch,
    cornerRadius: Math.min((o.cornerRadius ?? 0.1) * pitch, half),
    bracketStart: half * (1 - (o.bracketLength ?? 0.42)),
    tickLength: Math.max(half * 0.42, lineWidth * 2),
    captureRing,
    captureTick: Math.max(Math.min(0.16 * pitch, cornerRoom - 0.02 * pitch), 0),
  };
};

export interface TracePathOptions {
  /**
   * Height of the line's centre above the floors it joins: enough to clear
   * the platform (at least the line's radius), and no more.
   */
  lift?: number;
  /**
   * Height of the move's arc above the straight line (LastMoveMarkerProps.arc):
   * 0 (the default) for a straight line, a knight's arc when knights arc.
   */
  arc?: number;
  /** Samples along an arc (a straight line is its two ends). */
  segments?: number;
}

/**
 * The centreline of the last-move line, from the centre of the source
 * square's floor to the centre of the destination's, raised `lift` off the
 * platforms: a straight segment, whatever the level change (a vertical move
 * runs straight up or down through the squares' centres), or, for a knight
 * when knights arc, exactly the arc the piece flew (movePoint in movePath.ts,
 * the same curve as the glide). It ends inside the piece that moved, which
 * hides the end of the line standing over it.
 */
export const tracePath = (from: Vec3, to: Vec3, o: TracePathOptions = {}): Vec3[] => {
  const lift = o.lift ?? 0.03;
  const arc = o.arc ?? 0;
  const a: Vec3 = [from[0], from[1] + lift, from[2]];
  const b: Vec3 = [to[0], to[1] + lift, to[2]];
  if (arc <= 0) return [a, b];
  const n = Math.max(2, Math.round(o.segments ?? 32));
  return Array.from({ length: n + 1 }, (_, i) => movePoint(a, b, i / n, arc));
};

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => scale(a, 1 / (len(a) || 1));
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Distance along `points` at each of them, from the first (the last is the total length). */
export const pathDistances = (points: Vec3[]): number[] => {
  const at = [0];
  for (let i = 1; i < points.length; i++) at.push(at[i - 1] + len(sub(points[i], points[i - 1])));
  return at;
};

/**
 * The point `s` world units along `points` (clamped to its ends) and the
 * unit direction of travel there: for placing beads, dots or anything else
 * along the last-move line.
 */
export const pointAlong = (
  points: Vec3[],
  s: number,
  distances: number[] = pathDistances(points),
): { point: Vec3; tangent: Vec3 } => {
  let i = 1;
  while (i < points.length - 1 && distances[i] < s) i++;
  const span = distances[i] - distances[i - 1] || 1;
  const k = Math.min(Math.max((s - distances[i - 1]) / span, 0), 1);
  const d = sub(points[i], points[i - 1]);
  return { point: add(points[i - 1], scale(d, k)), tangent: unit(d) };
};

export interface TubeOptions {
  /** Radius of the tube (world units). */
  radius: number;
  /** Vertices round each ring (default 8: thin lines need few). */
  radialSegments?: number;
  /** Rings in each rounded end cap (default 3; 0 leaves the ends open). */
  capSegments?: number;
  /**
   * The radius at distance `s` along a path of length `length`, for a line
   * that tapers or swells (a brush stroke); default the constant `radius`.
   * The end caps take the radius at their end.
   */
  radiusAt?: (s: number, length: number) => number;
}

export interface TubeData {
  position: Float32Array;
  normal: Float32Array;
  /**
   * Distance along the path from its start, for every vertex (the caps run
   * a radius past either end: negative at the start).
   */
  along: Float32Array;
  /** Where round the tube each vertex sits, 0 to 1 (for texture across the line). */
  angle: Float32Array;
  index: Uint16Array | Uint32Array;
  /** Length of the path (without the caps). */
  length: number;
}

/**
 * A round tube of real geometry along `points`, with rounded ends, for the
 * last-move line: lit and depth-tested like any solid, so it looks the same
 * from every side and a piece standing on it hides it. The rings are framed
 * in the plane that holds the path (a straight line or a knight's arc, both
 * vertical planes), so the tube never twists.
 */
export const tubeData = (points: Vec3[], o: TubeOptions): TubeData => {
  const radial = Math.max(3, Math.round(o.radialSegments ?? 8));
  const caps = Math.max(0, Math.round(o.capSegments ?? 3));
  const at = pathDistances(points);
  const total = at[at.length - 1];
  const radiusAt = (s: number) => (o.radiusAt ? o.radiusAt(s, total) : o.radius);
  const chord = sub(points[points.length - 1], points[0]);
  // The path's plane is vertical: its normal is horizontal, across the chord
  // (any horizontal axis will do for a vertical line)
  const flat: Vec3 = [chord[0], 0, chord[2]];
  const side: Vec3 = len(flat) > 1e-6 ? unit(cross(flat, [0, 1, 0])) : [1, 0, 0];
  const tangentAt = (i: number): Vec3 =>
    unit(sub(points[Math.min(i + 1, points.length - 1)], points[Math.max(i - 1, 0)]));

  // Rings: centre, tangent, radius, and how far along the path it sits
  // `lean` is how far a cap's ring leans its normals along the path (-1 to 1)
  const rings: { c: Vec3; t: Vec3; r: number; s: number; lean: number }[] = [];
  const t0 = tangentAt(0);
  const t1 = tangentAt(points.length - 1);
  const r0 = radiusAt(0);
  const r1 = radiusAt(total);
  for (let k = caps; k >= 1; k--) {
    const phi = (k / caps) * (Math.PI / 2);
    const back = r0 * Math.sin(phi);
    const c = add(points[0], scale(t0, -back));
    rings.push({ c, t: t0, r: r0 * Math.cos(phi), s: -back, lean: -Math.sin(phi) });
  }
  points.forEach((p, i) =>
    rings.push({ c: p, t: tangentAt(i), r: radiusAt(at[i]), s: at[i], lean: 0 }),
  );
  for (let k = 1; k <= caps; k++) {
    const phi = (k / caps) * (Math.PI / 2);
    const ahead = r1 * Math.sin(phi);
    const c = add(points[points.length - 1], scale(t1, ahead));
    rings.push({ c, t: t1, r: r1 * Math.cos(phi), s: total + ahead, lean: Math.sin(phi) });
  }

  const perRing = radial + 1;
  const n = rings.length * perRing;
  const position = new Float32Array(n * 3);
  const normal = new Float32Array(n * 3);
  const along = new Float32Array(n);
  const angle = new Float32Array(n);
  rings.forEach((ring, i) => {
    const up = unit(cross(side, ring.t));
    // Where the ring curls into a cap, its normals lean along the path with it
    const round = Math.sqrt(Math.max(1 - ring.lean * ring.lean, 0));
    for (let j = 0; j <= radial; j++) {
      const theta = (j / radial) * Math.PI * 2;
      const dir = add(scale(side, Math.cos(theta)), scale(up, Math.sin(theta)));
      const v = i * perRing + j;
      position.set(add(ring.c, scale(dir, ring.r)), v * 3);
      normal.set(unit(add(scale(dir, round), scale(ring.t, ring.lean))), v * 3);
      along[v] = ring.s;
      angle[v] = j / radial;
    }
  });
  const quads = (rings.length - 1) * radial;
  const index = n > 65535 ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6);
  let q = 0;
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * perRing + j;
      const b = a + perRing;
      // Counter-clockwise seen from outside the tube
      index.set([a, b, a + 1, a + 1, b, b + 1], q);
      q += 6;
    }
  }
  return { position, normal, along, angle, index, length: total };
};
