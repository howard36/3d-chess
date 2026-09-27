import type { Vec3 } from '../types';

// Pure geometry behind the floor markers and the last-move trace, kept apart
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
  /** Height of the path above the floors it joins. */
  lift?: number;
  /**
   * Horizontal distance the path stops short of the destination's centre, so
   * the arrowhead lands beside the piece that moved rather than inside it.
   */
  endInset?: number;
  /** Horizontal distance the path starts away from the source's centre. */
  startInset?: number;
  /** For a move between levels: how far the arc rises above the higher end. */
  arc?: number;
  /** Samples along a curved path. */
  segments?: number;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

/**
 * The centreline of the last-move trace between two cell floors, start to
 * end. A move on one level runs straight along it; a move between levels is
 * a gentle arc (a quadratic curve peaking above the higher level), so it
 * reads as lifted off one platform and set down on the other rather than as
 * a line through the platforms. A purely vertical move runs up or down the
 * front of its column (toward +z, the side both players' cameras open on).
 */
export const tracePath = (from: Vec3, to: Vec3, o: TracePathOptions = {}): Vec3[] => {
  const lift = o.lift ?? 0.04;
  const endInset = o.endInset ?? 0.36;
  const startInset = o.startInset ?? 0.12;
  const arc = o.arc ?? 0.45;
  const segments = o.segments ?? 40;
  const flat: Vec3 = [to[0] - from[0], 0, to[2] - from[2]];
  const across = len(flat);
  const rise = to[1] - from[1];
  let a: Vec3;
  let b: Vec3;
  if (across > 1e-6) {
    const dir = scale(flat, 1 / across);
    // Never let the insets eat the whole path of a one-square move
    const room = Math.max(across - 0.2, 0);
    const k = Math.min(1, room / (startInset + endInset || 1));
    a = add(from, add(scale(dir, startInset * k), [0, lift, 0]));
    b = add(to, add(scale(dir, -endInset * k), [0, lift, 0]));
  } else {
    const front: Vec3 = [0, 0, endInset];
    a = add(from, add(front, [0, lift, 0]));
    b = add(to, add(front, [0, lift, 0]));
  }
  if (Math.abs(rise) < 1e-6 || across <= 1e-6) return [a, b];
  const mid = scale(add(a, b), 0.5);
  // The control height that puts the curve's apex exactly `arc` above the
  // higher end: for ends at heights ya, yb and apex m, the quadratic peaks
  // at m when its control sits at m + sqrt((m - ya)(m - yb)).
  const apex = Math.max(a[1], b[1]) + arc;
  const control: Vec3 = [mid[0], apex + Math.sqrt((apex - a[1]) * (apex - b[1])), mid[2]];
  const points: Vec3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const u = 1 - t;
    points.push(add(add(scale(a, u * u), scale(control, 2 * u * t)), scale(b, t * t)));
  }
  return points;
};

export interface RibbonOptions {
  /** Full width of the ribbon (world units). */
  width: number;
  /** Length of the arrowhead along the path. */
  headLength: number;
  /** Full width of the arrowhead's base. */
  headWidth: number;
}

export interface RibbonData {
  position: Float32Array;
  tangent: Float32Array;
  /** -1 or +1: which side of the centreline a vertex is pushed to. */
  side: Float32Array;
  /** Half the ribbon's width at the vertex (0 at the arrow's tip). */
  halfWidth: Float32Array;
  /** Distance along the path from its start. */
  along: Float32Array;
  index: number[];
  /** Total length of the path. */
  length: number;
}

/**
 * Vertex data for a camera-facing ribbon along `points` that ends in an
 * arrowhead whose tip is the last point. Each centreline sample becomes two
 * vertices; the vertex shader pushes them apart across the path, facing the
 * camera, so the ribbon keeps its full world-space width from any angle.
 */
export const ribbonData = (points: Vec3[], o: RibbonOptions): RibbonData => {
  // Arc length at every sample
  const at = [0];
  for (let i = 1; i < points.length; i++) at.push(at[i - 1] + len(sub(points[i], points[i - 1])));
  const total = at[at.length - 1];
  const head = Math.min(o.headLength, total * 0.6);
  const shaftEnd = total - head;
  const tangentAt = (i: number): Vec3 => {
    const d = sub(points[Math.min(i + 1, points.length - 1)], points[Math.max(i - 1, 0)]);
    const l = len(d) || 1;
    return scale(d, 1 / l);
  };
  // Where along the path a given distance falls
  const sample = (s: number): { p: Vec3; t: Vec3 } => {
    let i = 1;
    while (i < points.length - 1 && at[i] < s) i++;
    const span = at[i] - at[i - 1] || 1;
    const k = Math.min(Math.max((s - at[i - 1]) / span, 0), 1);
    const p = add(points[i - 1], scale(sub(points[i], points[i - 1]), k));
    const t = sub(points[i], points[i - 1]);
    return { p, t: scale(t, 1 / (len(t) || 1)) };
  };

  const rows: { p: Vec3; t: Vec3; half: number; s: number }[] = [];
  points.forEach((p, i) => {
    if (at[i] < shaftEnd) rows.push({ p, t: tangentAt(i), half: o.width / 2, s: at[i] });
  });
  const neck = sample(shaftEnd);
  rows.push({ p: neck.p, t: neck.t, half: o.width / 2, s: shaftEnd });
  // The arrowhead: its base (wider than the shaft) at the neck, its tip at the end
  rows.push({ p: neck.p, t: neck.t, half: o.headWidth / 2, s: shaftEnd });
  const tip = sample(total);
  rows.push({ p: points[points.length - 1], t: tip.t, half: 0, s: total });

  const n = rows.length * 2;
  const position = new Float32Array(n * 3);
  const tangent = new Float32Array(n * 3);
  const side = new Float32Array(n);
  const halfWidth = new Float32Array(n);
  const along = new Float32Array(n);
  rows.forEach((r, i) => {
    for (let s = 0; s < 2; s++) {
      const v = i * 2 + s;
      position.set(r.p, v * 3);
      tangent.set(r.t, v * 3);
      side[v] = s === 0 ? -1 : 1;
      halfWidth[v] = r.half;
      along[v] = r.s;
    }
  });
  const index: number[] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    // The shaft's last row and the head's base share a position: no quad between them
    if (i === rows.length - 3) continue;
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  return { position, tangent, side, halfWidth, along, index, length: total };
};
