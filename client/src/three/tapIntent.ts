// What a finger's tap on the board was meant for. On a phone the board's
// pieces are about 17 x 28 CSS px and a move's mark about 20 x 7, often 20 px
// from the next, while a careful finger lands about 10 px (1.5 mm) from where
// it aimed: no rule for guessing tells neighbours apart reliably at that
// scale (e2e/tapIntent.spec.ts measures it). So a tap acts at once only when
// it clearly means one thing; when it could mean more than one move, the
// board shows the candidates enlarged (the magnifier, Magnifier.tsx) and the
// next tap there picks one. A piece is cheap to pick up wrongly (one more tap
// fixes it), so picking up always takes the best guess.
//
// Pure geometry over screen points in CSS pixels; useTouchIntent.ts measures
// the scene and asks.

/** A point on screen, in CSS pixels. */
export type ScreenPoint = readonly [number, number];

/** A rectangle on screen, in CSS pixels. */
export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How far a finger's tap lands from where it was aimed (CSS px, one axis's standard deviation), until a player's own is known. */
export const TAP_SPREAD_PX = 10;

/** How likely one meaning must be for a tap that could play a move to act without asking. */
export const SURE = 0.9;

/** While a piece is held, how much likelier a tap near a move means the move than another piece. */
export const MOVE_ODDS = 2;

/** How much likelier a tap means what its ray hit than what it only lies near. */
export const DIRECT_ODDS = 2;

/** Below this share of the odds, a meaning is left out of the magnifier. */
export const CANDIDATE_SHARE = 0.05;

/** The magnifier shows this many candidates at most. */
export const MAX_CANDIDATES = 4;

/** Below this share for every move together, a tap near a piece just picks it up. */
export const MOVE_DOUBT = 0.1;

export interface TapTarget<Id = string> {
  id: Id;
  /** A square the held piece can move to (a capture included), or a piece to pick up or put down. */
  kind: 'destination' | 'piece';
  /** Its hit shape on screen, as convexHull returns it: a piece's, a mark's (and the piece a capture takes). */
  hull: ScreenPoint[];
  /**
   * Where a tap counts as on it: the hull, and for a destination also the
   * held piece standing on it, where players aim as often as at the mark.
   */
  reach: ScreenPoint[];
  /** The middle of its hit shape. */
  centre: ScreenPoint;
}

export type TapDecision<Id = string> =
  { act: 'take'; id: Id } | { act: 'ask'; ids: Id[] } | { act: 'none' };

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

/**
 * A target from its hit shape's points on screen (and, for a destination,
 * the points of the held piece standing on it).
 */
export function tapTarget<Id>(
  id: Id,
  kind: TapTarget['kind'],
  points: readonly ScreenPoint[],
  standing: readonly ScreenPoint[] = [],
): TapTarget<Id> {
  const hull = convexHull(points);
  return {
    id,
    kind,
    hull,
    reach: standing.length ? convexHull([...hull, ...standing]) : hull,
    centre: centreOf(points),
  };
}

const dist = (a: ScreenPoint, b: ScreenPoint) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * The odds that a tap at `tap` was meant for `target`: falling off with the
 * tap's distance from where the target counts (its reach) at the finger's
 * spread, and a little with its distance from the target's middle, so that
 * of two overlapping shapes the one the tap is more central to wins.
 */
const oddsOf = (tap: ScreenPoint, target: TapTarget<unknown>, spread: number) => {
  const d = distanceToHull(tap, target.reach);
  const c = dist(tap, target.centre);
  return Math.exp(-(d * d) / (2 * spread * spread) - (c * c) / (2 * (3 * spread) ** 2));
};

export interface TapContext<Id> {
  /** Whether a piece is held (its moves are among the targets). */
  holding: boolean;
  /** What the tap's ray hit directly among the targets, if anything. */
  direct: Id | null;
  /** The finger's spread (TAP_SPREAD_PX until the player's own is known). */
  spread?: number;
}

/**
 * What a tap at `tap` does, among the targets the player can act on:
 * - a tap whose ray hits a piece takes that piece;
 * - otherwise each target's odds are weighed (oddsOf; what the ray hit
 *   counts DIRECT_ODDS times, a move MOVE_ODDS times while a piece is held),
 *   against a tap meant for nothing (one three spreads clear of everything);
 * - the likeliest acts when its share is at least SURE, or when it is a
 *   piece and the moves together have less than MOVE_DOUBT;
 * - otherwise the likely meanings (up to MAX_CANDIDATES) are asked about.
 */
export function decideTap<Id>(
  tap: ScreenPoint,
  targets: readonly TapTarget<Id>[],
  { holding, direct, spread = TAP_SPREAD_PX }: TapContext<Id>,
): TapDecision<Id> {
  const hit = direct === null ? undefined : targets.find((t) => t.id === direct);
  if (hit?.kind === 'piece') return { act: 'take', id: hit.id };
  const weighed = targets.map((target) => {
    let odds = oddsOf(tap, target, spread);
    if (target === hit) odds *= DIRECT_ODDS;
    if (holding && target.kind === 'destination') odds *= MOVE_ODDS;
    return { target, odds };
  });
  // (A tap three spreads from everything was meant for none of it)
  const nothing = Math.exp(-4.5);
  const total = weighed.reduce((sum, w) => sum + w.odds, nothing);
  weighed.sort((a, b) => b.odds - a.odds);
  const [best] = weighed;
  if (!best || best.odds < nothing) return { act: 'none' };
  const moves = weighed.reduce((s, w) => s + (w.target.kind === 'destination' ? w.odds : 0), 0);
  if (best.odds / total >= SURE || (best.target.kind === 'piece' && moves / total < MOVE_DOUBT)) {
    return { act: 'take', id: best.target.id };
  }
  const ids = weighed
    .filter((w) => w.odds / total >= CANDIDATE_SHARE)
    .slice(0, MAX_CANDIDATES)
    .map((w) => w.target.id);
  return ids.length > 1 ? { act: 'ask', ids } : { act: 'take', id: best.target.id };
}

// --- The magnifier --------------------------------------------------------------

/** The lens's side (CSS px), on a window wide enough for it. */
export const LENS_PX = 216;
/** How far apart the lens sets its two closest candidates (CSS px): a fingertip. */
export const LENS_SPACING_PX = 56;
/** The lens's enlargement, at least and at most. */
export const LENS_ZOOM = { min: 3, max: 5, aim: 3.5 } as const;
/** How far a tap in the lens may lie from a candidate (lens px) and still pick it. */
export const LENS_REACH_PX = 40;
/** The lens keeps this far from the window's edges, and this far clear of the finger. */
const LENS_MARGIN_PX = 8;
const FINGER_CLEAR_PX = 52;

/**
 * The magnifier: the part of the view it shows (`crop`, CSS px of the
 * canvas) and where it shows it (`frame`), enlarged `zoom` times.
 */
export interface Lens {
  crop: ScreenRect;
  frame: ScreenRect;
  zoom: number;
}

export interface LensView {
  width: number;
  height: number;
  /** The canvas's top band the lens keeps clear of (a HUD over it). */
  top?: number;
}

/** A lens of side `side` beside the finger at `finger`: above it, or below it when there is no room above. */
const frameAt = (finger: ScreenPoint, side: number, view: LensView): ScreenRect => {
  const top = (view.top ?? 0) + LENS_MARGIN_PX;
  const bottom = view.height - LENS_MARGIN_PX - side;
  const x = Math.min(
    Math.max(finger[0] - side / 2, LENS_MARGIN_PX),
    view.width - LENS_MARGIN_PX - side,
  );
  const above = finger[1] - FINGER_CLEAR_PX - side;
  const y = above >= top ? above : Math.min(Math.max(finger[1] + FINGER_CLEAR_PX, top), bottom);
  return { x, y, width: side, height: side };
};

const sideFor = (view: LensView) =>
  Math.max(Math.min(LENS_PX, view.width - 2 * LENS_MARGIN_PX, view.height / 3), 96);

/**
 * The lens for asking which of `candidates` a tap at `finger` meant: centred
 * on them, enlarged so the two closest stand LENS_SPACING_PX apart (within
 * LENS_ZOOM, and no more than fits them all), beside the finger.
 */
export function askingLens(
  finger: ScreenPoint,
  candidates: readonly TapTarget<unknown>[],
  view: LensView,
): Lens {
  const side = sideFor(view);
  const all = boundsOf(candidates.flatMap((c) => c.hull));
  let closest = Infinity;
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      closest = Math.min(closest, dist(candidates[i].centre, candidates[j].centre));
    }
  }
  const wanted = Math.min(Math.max(LENS_SPACING_PX / closest, LENS_ZOOM.min), LENS_ZOOM.max);
  // Every candidate whole in the lens, with a fingertip's half round it
  const fits = (side - LENS_SPACING_PX) / Math.max(all.width, all.height, 1);
  const zoom = Math.max(Math.min(wanted, fits), 1.5);
  const span = side / zoom;
  const [cx, cy] = [all.x + all.width / 2, all.y + all.height / 2];
  return {
    crop: { x: cx - span / 2, y: cy - span / 2, width: span, height: span },
    frame: frameAt(finger, side, view),
    zoom,
  };
}

/** The lens for aiming by hand: the view round the finger, beside it. */
export function aimingLens(finger: ScreenPoint, view: LensView): Lens {
  const side = sideFor(view);
  const span = side / LENS_ZOOM.aim;
  return {
    crop: { x: finger[0] - span / 2, y: finger[1] - span / 2, width: span, height: span },
    frame: frameAt(finger, side, view),
    zoom: LENS_ZOOM.aim,
  };
}

/** Whether a point lies in a rectangle. */
export const inRect = ([x, y]: ScreenPoint, r: ScreenRect) =>
  x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;

/** A point in the lens's frame as the point of the view it shows. */
export const fromLens = ([x, y]: ScreenPoint, lens: Lens): ScreenPoint => [
  lens.crop.x + (x - lens.frame.x) / lens.zoom,
  lens.crop.y + (y - lens.frame.y) / lens.zoom,
];

/** A point of the view as shown in the lens's frame. */
export const toLens = ([x, y]: ScreenPoint, lens: Lens): ScreenPoint => [
  lens.frame.x + (x - lens.crop.x) * lens.zoom,
  lens.frame.y + (y - lens.crop.y) * lens.zoom,
];

/**
 * The candidate a point of the view (`at`, as fromLens gives it) picks, seen
 * through a lens of `zoom`: the nearest by its shape, the more central of two
 * close ones, within LENS_REACH_PX of the lens; null when none is in reach.
 */
export function pickInLens<Id>(
  at: ScreenPoint,
  candidates: readonly TapTarget<Id>[],
  zoom: number,
): Id | null {
  let best: { id: Id; score: number } | null = null;
  for (const c of candidates) {
    const d = distanceToHull(at, c.hull) * zoom;
    if (d > LENS_REACH_PX) continue;
    const score = d + 0.25 * dist(at, c.centre) * zoom;
    if (!best || score < best.score) best = { id: c.id, score };
  }
  return best?.id ?? null;
}

// --- The player's own spread ----------------------------------------------------

/** What is known of a player's taps: how many, and their squared distances from what they meant. */
export interface SpreadRecord {
  n: number;
  sumSq: number;
}

/** The spread's bounds, and how many taps the default counts as until a player's own outweigh it. */
const SPREAD_BOUNDS = { min: 6, max: 14 } as const;
const PRIOR_TAPS = 8;
/** Only the latest taps count, so a player's spread follows them (a new phone, a steadier hand). */
const MAX_TAPS = 60;

/** A record with one more tap, landed `offset` (CSS px) from the middle of what it meant. */
export const recordTap = (record: SpreadRecord, offset: ScreenPoint): SpreadRecord => {
  const sq = offset[0] * offset[0] + offset[1] * offset[1];
  if (record.n < MAX_TAPS) return { n: record.n + 1, sumSq: record.sumSq + sq };
  // Full: the new tap takes an average one's place
  return { n: record.n, sumSq: record.sumSq + sq - record.sumSq / record.n };
};

/** The player's spread from their record: the default until their taps outweigh it, within bounds. */
export const spreadOf = (record: SpreadRecord | null): number => {
  if (!record || record.n === 0) return TAP_SPREAD_PX;
  // A tap's squared distance from its aim averages twice one axis's variance
  const variance = (PRIOR_TAPS * TAP_SPREAD_PX ** 2 + record.sumSq / 2) / (PRIOR_TAPS + record.n);
  return Math.min(Math.max(Math.sqrt(variance), SPREAD_BOUNDS.min), SPREAD_BOUNDS.max);
};
