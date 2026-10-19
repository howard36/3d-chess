// What a finger's tap on the board was meant for. On a phone the board's
// pieces are about 17 x 28 CSS px and a move's mark about 20 x 7, often 20 px
// from the next, while a careful finger lands about 10 px (1.5 mm) from where
// it aimed. A tap acts at once, always: on what its ray hits first (nearest
// the camera), as a player expects of what is under their finger, or else on
// the likeliest of everything in reach, never on nothing when something is
// near.
//
// Pure geometry over screen points in CSS pixels; useTouchIntent.ts measures
// the scene.

/** A point on screen, in CSS pixels. */
export type ScreenPoint = readonly [number, number];

/** A rectangle on screen, in CSS pixels. */
export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How far a finger's tap lands from where it was aimed (CSS px, one axis's standard deviation). */
export const TAP_SPREAD_PX = 10;

/** While a piece is held, how much likelier a tap near a move means the move than another piece. */
export const MOVE_ODDS = 2;

/**
 * How far (CSS px) a tap must land from everything the player can act on to
 * mean none of it (and put a held piece down): a fingertip and a half, about
 * 9 mm. A near miss beside a lone mark is still that mark.
 */
export const NOTHING_PX = 56;

export interface TapTarget<Id = string> {
  id: Id;
  /** A square the held piece can move to (a capture included), or a piece to pick up or put down. */
  kind: 'destination' | 'piece';
  /** Its hit shape on screen, as convexHull returns it: a piece's, a mark's (and the piece a capture takes). */
  hull: ScreenPoint[];
  /** The middle of its hit shape. */
  centre: ScreenPoint;
}

export type TapDecision<Id = string> = { act: 'take'; id: Id } | { act: 'none' };

const cross = (o: ScreenPoint, a: ScreenPoint, b: ScreenPoint) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** The convex hull of some points, counterclockwise (Andrew's monotone chain). */
export function convexHull(points: readonly ScreenPoint[]): ScreenPoint[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const half = (list: ScreenPoint[]) => {
    const out: ScreenPoint[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

const toSegment = (p: ScreenPoint, a: ScreenPoint, b: ScreenPoint) => {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len2 = dx * dx + dy * dy;
  const t =
    len2 > 0 ? Math.min(Math.max(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2, 0), 1) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};

/** Distance from `p` to a convex polygon (as convexHull returns it): 0 inside or on it. */
export function distanceToHull(p: ScreenPoint, hull: readonly ScreenPoint[]): number {
  if (hull.length === 0) return Infinity;
  if (hull.length === 1) return Math.hypot(p[0] - hull[0][0], p[1] - hull[0][1]);
  let inside = hull.length >= 3;
  let nearest = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    if (cross(a, b, p) < 0) inside = false;
    nearest = Math.min(nearest, toSegment(p, a, b));
  }
  return inside ? 0 : nearest;
}

/** The bounds of some points. */
export const boundsOf = (points: readonly ScreenPoint[]): ScreenRect => {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
};

/** The middle of some points' bounds. */
export const centreOf = (points: readonly ScreenPoint[]): ScreenPoint => {
  const b = boundsOf(points);
  return [b.x + b.width / 2, b.y + b.height / 2];
};

/** A target from its hit shape's points on screen. */
export function tapTarget<Id>(
  id: Id,
  kind: TapTarget['kind'],
  points: readonly ScreenPoint[],
): TapTarget<Id> {
  return { id, kind, hull: convexHull(points), centre: centreOf(points) };
}

const dist = (a: ScreenPoint, b: ScreenPoint) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * The odds that a tap at `tap` was meant for `target`: falling off with the
 * tap's distance from its shape at the finger's spread, and a little with its
 * distance from the target's middle, so that of two overlapping shapes the
 * one the tap is more central to wins. (A move's shape is its mark alone, the
 * circle a player sees and aims at.)
 */
const oddsOf = (tap: ScreenPoint, target: TapTarget<unknown>, spread: number) => {
  const d = distanceToHull(tap, target.hull);
  const c = dist(tap, target.centre);
  return Math.exp(-(d * d) / (2 * spread * spread) - (c * c) / (2 * (3 * spread) ** 2));
};

export interface TapContext<Id> {
  /** Whether a piece is held (its moves are among the targets). */
  holding: boolean;
  /** What the tap's ray hit directly among the targets, if anything. */
  direct: Id | null;
}

/**
 * What a tap at `tap` does, among the targets the player can act on:
 * - a tap whose ray hits a target first takes it (a piece, a mark, or the
 *   piece a capture takes), whatever lies near it;
 * - otherwise each target's odds are weighed (oddsOf; a move counts
 *   MOVE_ODDS times while a piece is held), and the likeliest is taken,
 *   unless the tap lies NOTHING_PX clear of everything: then nothing.
 */
export function decideTap<Id>(
  tap: ScreenPoint,
  targets: readonly TapTarget<Id>[],
  { holding, direct }: TapContext<Id>,
): TapDecision<Id> {
  const hit = direct === null ? undefined : targets.find((t) => t.id === direct);
  if (hit) return { act: 'take', id: hit.id };
  let best: { target: TapTarget<Id>; odds: number } | null = null;
  for (const target of targets) {
    let odds = oddsOf(tap, target, TAP_SPREAD_PX);
    if (holding && target.kind === 'destination') odds *= MOVE_ODDS;
    if (!best || odds > best.odds) best = { target, odds };
  }
  // (A tap NOTHING_PX from everything was meant for none of it)
  const nothing = Math.exp(-(NOTHING_PX * NOTHING_PX) / (2 * TAP_SPREAD_PX * TAP_SPREAD_PX));
  return best && best.odds >= nothing ? { act: 'take', id: best.target.id } : { act: 'none' };
}
