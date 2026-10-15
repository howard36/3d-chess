// The rim of the pill of starlight (.landing-play): the five level colours,
// sky at the pill's left end and rose at its right, running sky to rose
// along the top and back along the bottom, carried round the pill at one
// pace. A straight gradient whose angle turns (the tiles' rim) sweeps its
// colours across the long edges in a moment and lingers on the ends; here
// each colour is placed by its distance along the rim, so it moves the same
// number of pixels a second on the straight edges and round the ends.

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

/**
 * The points round the middle of the rim of a pill `width` by `height`
 * (its border box, rim `border` thick) at even steps of distance, from the
 * top's middle clockwise: each one's bearing from the pill's middle
 * (degrees, clockwise from up, as a conic gradient's) and how far round it
 * is (a fraction of the rim).
 */
export function rimPoints(
  width: number,
  height: number,
  border = 2,
  samples = RIM_SAMPLES,
): { angle: number; at: number }[] {
  const r = Math.max(height - border, 0) / 2;
  const straight = Math.max(width - height, 0);
  const half = straight / 2;
  const cap = Math.PI * r;
  const length = 2 * straight + 2 * cap;
  const points: { angle: number; at: number }[] = [];
  for (let i = 0; i < samples; i++) {
    const at = i / samples;
    let s = at * length;
    let x: number;
    let y: number;
    if (s <= half) {
      x = s;
      y = -r;
    } else if ((s -= half) <= cap) {
      const a = -Math.PI / 2 + (r > 0 ? s / r : 0);
      x = half + r * Math.cos(a);
      y = r * Math.sin(a);
    } else if ((s -= cap) <= straight) {
      x = half - s;
      y = r;
    } else if ((s -= straight) <= cap) {
      const a = Math.PI / 2 + (r > 0 ? s / r : 0);
      x = -half + r * Math.cos(a);
      y = r * Math.sin(a);
    } else {
      x = -half + (s - cap);
      y = -r;
    }
    let angle = (Math.atan2(x, -y) * 180) / Math.PI;
    if (angle < 0) angle += 360;
    points.push({ angle: i === 0 ? 0 : angle, at });
  }
  return points;
}

/**
 * The rim as a conic gradient about the pill's middle, `turn` (fractions of
 * a lap, clockwise) on from rest: at rest, sky at the left end and rose at
 * the right, as the straight gradient it stands in for.
 */
export function rimGradient(
  points: readonly { angle: number; at: number }[],
  turn: number,
): string {
  // From the left end (three quarters round from the top's middle): 0 at the
  // left end, a half at the right
  const colourAt = (at: number) => {
    const q = (((at - 0.75 - turn) % 1) + 1) % 1;
    return rimColour(q < 0.5 ? 2 * q : 2 - 2 * q);
  };
  let css = 'conic-gradient(';
  for (const p of points) css += `${colourAt(p.at)} ${p.angle.toFixed(2)}deg,`;
  return `${css}${colourAt(0)} 360deg)`;
}
