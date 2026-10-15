// The rims of the level colours (the pill of starlight's, .landing-play, and
// the glass tiles', .landing-mode and .lobby-glass): sky at one side and
// rose at the other, running sky to rose one way round and back the other,
// carried round at one pace. A straight gradient whose angle turns sweeps
// its colours across the long edges in a moment and lingers on the short
// ones; here each colour is placed by its distance along the rim, so it
// moves the same number of pixels a second on every edge and round every
// corner.

/** The level colours, sky to rose, and where they stand along a half turn. */
const STOPS: readonly (readonly [number, readonly [number, number, number]])[] = [
  [0.08, [0x47, 0xbb, 0xec]],
  [0.29, [0x41, 0x80, 0xf3]],
  [0.5, [0x8f, 0x61, 0xfc]],
  [0.71, [0xde, 0x5c, 0xec]],
  [0.92, [0xec, 0x53, 0x9b]],
];

/** The colour a half turn of `t` (0 sky, 1 rose) from the left end, as CSS. */
export function rimColour(t: number): string {
  let i = 0;
  while (i < STOPS.length - 1 && t > STOPS[i + 1][0]) i++;
  const [t0, a] = STOPS[i];
  const [t1, b] = STOPS[Math.min(i + 1, STOPS.length - 1)];
  const k = t1 > t0 ? Math.min(Math.max((t - t0) / (t1 - t0), 0), 1) : 0;
  const c = a.map((v, j) => Math.round(v + (b[j] - v) * k));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** How many points round the rim carry a colour (a few pixels apart). */
export const RIM_SAMPLES = 64;

/** A point round a rim: its bearing from the middle and how far round it is. */
export interface RimPoint {
  /** Degrees clockwise from up, as a conic gradient's. */
  angle: number;
  /** A fraction of the rim, from the top's middle clockwise. */
  at: number;
}

/**
 * The points round the middle of the rim of a box `width` by `height` (its
 * border box) with rounded corners of `radius` (as large as its sides allow:
 * a pill's ends), the rim's middle `inset` in from its edge, at even steps
 * of distance from the top's middle clockwise.
 */
export function rimPoints(
  width: number,
  height: number,
  { radius = Infinity, inset = 1, samples = RIM_SAMPLES } = {},
): RimPoint[] {
  const w = Math.max(width - 2 * inset, 0);
  const h = Math.max(height - 2 * inset, 0);
  const r = Math.min(Math.max(radius - inset, 0), w / 2, h / 2);
  const across = w - 2 * r;
  const down = h - 2 * r;
  const corner = (Math.PI * r) / 2;
  const length = 2 * across + 2 * down + 4 * corner;
  // The rim's runs in order from the top's middle: straight ones from a
  // point along a direction, corners about a centre from a heading (radians
  // clockwise from up)
  const runs: (
    | { length: number; from: [number, number]; dir: [number, number] }
    | { length: number; centre: [number, number]; heading: number }
  )[] = [
    { length: across / 2, from: [0, -h / 2], dir: [1, 0] },
    { length: corner, centre: [across / 2, -down / 2], heading: 0 },
    { length: down, from: [w / 2, -down / 2], dir: [0, 1] },
    { length: corner, centre: [across / 2, down / 2], heading: Math.PI / 2 },
    { length: across, from: [across / 2, h / 2], dir: [-1, 0] },
    { length: corner, centre: [-across / 2, down / 2], heading: Math.PI },
    { length: down, from: [-w / 2, down / 2], dir: [0, -1] },
    { length: corner, centre: [-across / 2, -down / 2], heading: (3 * Math.PI) / 2 },
    { length: across / 2, from: [-across / 2, -h / 2], dir: [1, 0] },
  ];
  const points: RimPoint[] = [];
  for (let i = 0; i < samples; i++) {
    const at = i / samples;
    let s = at * length;
    let run = 0;
    while (run < runs.length - 1 && s > runs[run].length) s -= runs[run++].length;
    const part = runs[run];
    let x: number;
    let y: number;
    if ('dir' in part) {
      x = part.from[0] + part.dir[0] * s;
      y = part.from[1] + part.dir[1] * s;
    } else {
      const a = part.heading + (r > 0 ? s / r : 0);
      x = part.centre[0] + r * Math.sin(a);
      y = part.centre[1] - r * Math.cos(a);
    }
    let angle = (Math.atan2(x, -y) * 180) / Math.PI;
    if (angle < 0) angle += 360;
    points.push({ angle: i === 0 ? 0 : angle, at });
  }
  return points;
}

/**
 * How far round the rim of a box (as `rimPoints` takes it) its edge faces
 * `bearing` (degrees clockwise from up): the point furthest that way, where
 * a straight gradient running towards it puts its far end (a pill's end, a
 * tile's corner; a side's middle where the whole side faces it).
 */
export function rimFacing(
  width: number,
  height: number,
  { radius = Infinity, inset = 1 } = {},
  bearing: number,
): number {
  const w = Math.max(width - 2 * inset, 0);
  const h = Math.max(height - 2 * inset, 0);
  const r = Math.min(Math.max(radius - inset, 0), w / 2, h / 2);
  const across = w - 2 * r;
  const down = h - 2 * r;
  const corner = (Math.PI * r) / 2;
  const length = 2 * across + 2 * down + 4 * corner;
  if (!length) return 0;
  const b = ((bearing % 360) + 360) % 360;
  const side = Math.floor(b / 90);
  // Where each corner starts (top right, bottom right, bottom left, top left)
  // and each side's middle (top, right, bottom, left)
  const starts = [0, 1, 2, 3].map(
    (k) => across / 2 + k * corner + Math.ceil(k / 2) * down + Math.floor(k / 2) * across,
  );
  const middles = [
    0,
    starts[0] + corner + down / 2,
    starts[1] + corner + across / 2,
    starts[2] + corner + down / 2,
  ];
  const s = b % 90 === 0 ? middles[side] : starts[side] + (r * ((b - side * 90) * Math.PI)) / 180;
  return s / length;
}

/**
 * The rim as a conic gradient about the box's middle, `turn` (fractions of
 * a lap, clockwise) on from rest, where sky stands `sky` round the rim (as
 * `at`; the pill's left end, three quarters round, by default) and rose
 * half a lap from it, as the straight gradient it stands in for.
 */
export function rimGradient(points: readonly RimPoint[], turn: number, sky = 0.75): string {
  const colourAt = (at: number) => {
    const q = (((at - sky - turn) % 1) + 1) % 1;
    return rimColour(q < 0.5 ? 2 * q : 2 - 2 * q);
  };
  let css = 'conic-gradient(';
  for (const p of points) css += `${colourAt(p.at)} ${p.angle.toFixed(2)}deg,`;
  return `${css}${colourAt(0)} 360deg)`;
}
