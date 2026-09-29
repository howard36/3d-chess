// Tap assist: on a phone the board's pieces are narrower than a fingertip
// (about 15 CSS px, the opponent's far pawns 10 to 13, against 40 or more for
// the finger), so a touch rarely lands squarely on the piece or square it was
// aimed at. A tap that reaches nothing it can act on goes instead to the
// thing it can act on that it lies nearest, within a finger's reach: nearest
// both to its outline on screen (a big piece reaches further than a small
// one) and to its centre (where the finger was aimed; a front piece that
// overlaps its neighbour on screen does not win every tap along the seam).
// Pure geometry over screen points in CSS pixels; useTapAssist.ts measures
// the scene and asks.

/** A point on screen, in CSS pixels. */
export type ScreenPoint = readonly [number, number];

/** How far from the touch (CSS px) a target's outline may lie and still take the tap. */
export const TAP_REACH_PX = 22;

/**
 * While a piece is held, how much nearer (CSS px, in outline and centre
 * distance together) another piece must be than a destination to take the
 * tap instead: a near tie plays the move rather than trading the held piece
 * for its neighbour.
 */
export const DESTINATION_PREFERENCE_PX = 8;

export interface TapTarget<Id = string> {
  id: Id;
  /** A square the held piece can move to (a capture included), or a piece to pick up or put down. */
  kind: 'destination' | 'piece';
  /** Its hit shape on screen: any points round it (their convex hull is used). */
  outline: readonly ScreenPoint[];
}

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

const centreOf = (points: readonly ScreenPoint[]): ScreenPoint => {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [(x0 + x1) / 2, (y0 + y1) / 2];
};

/**
 * The target a tap at `tap` was meant for, among the targets it can act on
 * (the caller has already found that the tap hit none of them directly).
 * Only targets whose outline lies within TAP_REACH_PX count; of those, the one
 * with the least distance to its outline and to its centre added together,
 * a destination winning a near tie with a piece while one is held (`holding`), and the
 * nearer centre breaking an exact tie. Null when none is in reach, so a tap
 * well clear of everything still means "nothing here".
 */
export function resolveTap<Id>(
  tap: ScreenPoint,
  targets: readonly TapTarget<Id>[],
  holding = false,
): TapTarget<Id> | null {
  let best: { target: TapTarget<Id>; score: number; centre: number } | null = null;
  for (const target of targets) {
    if (target.outline.length === 0) continue;
    const distance = distanceToHull(tap, convexHull(target.outline));
    if (!(distance <= TAP_REACH_PX)) continue;
    const [cx, cy] = centreOf(target.outline);
    const centre = Math.hypot(tap[0] - cx, tap[1] - cy);
    const score =
      distance + centre + (holding && target.kind === 'piece' ? DESTINATION_PREFERENCE_PX : 0);
    if (!best || score < best.score || (score === best.score && centre < best.centre)) {
      best = { target, score, centre };
    }
  }
  return best?.target ?? null;
}
