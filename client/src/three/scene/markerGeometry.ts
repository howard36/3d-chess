import type { Vec3 } from '../types';

// Pure geometry behind the last-move line, kept apart from the component so
// it can be unit tested without WebGL.

export interface TracePathOptions {
  /**
   * Height of the line's centre above the floors it joins: enough to clear
   * the platform (at least the line's radius), and no more.
   */
  lift?: number;
  /**
   * Land this far short of the destination's centre, level with its floor
   * and on the side facing the source (default 0: at the centre). Just
   * outside the footprint of the piece standing there, the line then meets
   * the platform beside it, in plain view, instead of running into the piece.
   * A move straight up or down lands on the +x side.
   */
  inset?: number;
  /**
   * The level direction [x, z] the player's seat looks from. A landing that
   * would fall behind the piece seen from there, hidden by it, turns to the
   * piece's side instead (toward the source's side, else +x).
   */
  insetFront?: readonly [number, number];
}

/** The level direction [x, z] a move straight up or down lands in. */
const SIDE = [1, 0] as const;

/**
 * The centreline of the last-move line, from the centre of the source
 * square's floor to the centre of the destination's, raised `lift` off the
 * platforms: a straight segment, whatever the level change (a vertical move
 * runs straight up or down through the squares' centres). Without an `inset`
 * it ends inside the piece that moved, which hides the end of the line
 * standing over it; with one it lands on the floor beside that piece.
 */
export const tracePath = (from: Vec3, to: Vec3, o: TracePathOptions = {}): [Vec3, Vec3] => {
  const lift = o.lift ?? 0.03;
  const inset = o.inset ?? 0;
  const dx = from[0] - to[0];
  const dz = from[2] - to[2];
  const level = Math.hypot(dx, dz);
  let [sx, sz] = level > 1e-6 ? [dx / level, dz / level] : SIDE;
  const front = o.insetFront;
  const toward = front && level > 1e-6 ? sx * front[0] + sz * front[1] : 0;
  if (front && toward < 0) {
    // Behind the piece from the seat: to its side, on the source's side
    const lx = sx - toward * front[0];
    const lz = sz - toward * front[1];
    const l = Math.hypot(lx, lz);
    [sx, sz] = l > 1e-3 ? [lx / l, lz / l] : SIDE;
  }
  const a: Vec3 = [from[0], from[1] + lift, from[2]];
  const b: Vec3 = [to[0] + sx * inset, to[1] + lift, to[2] + sz * inset];
  return [a, b];
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

export interface TubeOptions {
  /** Radius of the tube (world units). */
  radius: number;
  /** Vertices round each ring (default 8: thin lines need few). */
  radialSegments?: number;
  /** Rings in each rounded end cap (default 3; 0 leaves the ends open). */
  capSegments?: number;
}

interface TubeData {
  position: Float32Array;
  normal: Float32Array;
  /**
   * Distance along the path from its start, for every vertex (the caps run
   * a radius past either end: negative at the start).
   */
  along: Float32Array;
  index: Uint16Array | Uint32Array;
  /** Length of the path (without the caps). */
  length: number;
}

/**
 * A round tube of real geometry along `points`, with rounded ends, for the
 * last-move line: lit and depth-tested like any solid, so it looks the same
 * from every side and a piece standing on it hides it. The rings are framed
 * in the vertical plane that holds the path, so the tube never twists.
 */
export const tubeData = (points: Vec3[], o: TubeOptions): TubeData => {
  const radial = Math.max(3, Math.round(o.radialSegments ?? 8));
  const caps = Math.max(0, Math.round(o.capSegments ?? 3));
  const at = pathDistances(points);
  const total = at[at.length - 1];
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
  for (let k = caps; k >= 1; k--) {
    const phi = (k / caps) * (Math.PI / 2);
    const back = o.radius * Math.sin(phi);
    const c = add(points[0], scale(t0, -back));
    rings.push({ c, t: t0, r: o.radius * Math.cos(phi), s: -back, lean: -Math.sin(phi) });
  }
  points.forEach((p, i) => rings.push({ c: p, t: tangentAt(i), r: o.radius, s: at[i], lean: 0 }));
  for (let k = 1; k <= caps; k++) {
    const phi = (k / caps) * (Math.PI / 2);
    const ahead = o.radius * Math.sin(phi);
    const c = add(points[points.length - 1], scale(t1, ahead));
    rings.push({ c, t: t1, r: o.radius * Math.cos(phi), s: total + ahead, lean: Math.sin(phi) });
  }

  const perRing = radial + 1;
  const n = rings.length * perRing;
  const position = new Float32Array(n * 3);
  const normal = new Float32Array(n * 3);
  const along = new Float32Array(n);
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
  return { position, normal, along, index, length: total };
};
