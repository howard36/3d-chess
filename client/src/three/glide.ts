import type { Camera, PerspectiveCamera } from 'three';
import type { Vec3 } from './types';

// A move glides: the piece, rigid, slides along the straight line between
// the squares and settles onto the next without passing it. How it sets off
// depends on who moved it. A move the player played here, by a tap on one of
// its destinations, answers the tap at once: the piece, already held up,
// leaves at its fastest a sixth of the way in, a critically damped spring let
// go. Every other move (an opponent's, the computer's, a step through the
// record, the start page's games) comes unannounced, so it announces itself:
// the piece rises to the height a picked-up piece stands at, and sets off as
// it rises, gathering speed from rest (a spring one order smoother, with no
// lurch in its first frame), and comes down onto its square on the way.
//
// It takes longer the farther it goes on screen, by the square root of the
// distance: a long move on a large window would otherwise cross hundreds of
// pixels in a blink. Everything about it is a pure function of the time since
// the move arrived (glidePose), driven on r3f's clock by MoveGlide.

/** Everything a move's glide does, fixed when it arrives (planGlide). */
export interface GlidePlan {
  /** The source's offset from the destination (world units). */
  offset: Vec3;
  /** How far it goes (world units). */
  distance: number;
  /** How high it is carried above its squares (world units). */
  lift: number;
  /** Whether it was played here (it starts held up) or arrives unannounced (it rises first). */
  played: boolean;
  /** When it leaves its square (ms after the move arrived): after a little of the rise. */
  departMs: number;
  /** From leaving its square to resting on the next. */
  travelMs: number;
  /** For a capture: when it reaches the victim, short of the square (ms after the move arrived). */
  contactMs: number | null;
  /** Which way it is going across the board (unit x, z), or null for straight up or down. */
  heading: [number, number] | null;
}

/** The glide's tunings: change them here, the tests read them. */
export const GLIDE = {
  /** Travel time from the journey's length on screen (CSS px): base, per √px, and bounds. */
  baseMs: 140,
  perRootPxMs: 20,
  minMs: 280,
  maxMs: 760,
  /** CSS px per world unit where the view is not known (about a laptop's window). */
  defaultScale: 65,
  /**
   * The springs' stiffness over the travel (ω × travel time). Played: at its
   * fastest a sixth of the way through the time. Unannounced: a quarter.
   * Each would still have 1–2% of the way to go at the end, so it is scaled
   * to arrive exactly on time.
   */
  playedStiffness: 6,
  watchedStiffness: 8,
  /** An unannounced move's rise to the carried height, and when it sets off during it. */
  riseMs: 170,
  departMs: 110,
  /** A capture reaches its victim this far short of the square. */
  contactReach: 0.5,
} as const;

const length = ([x, y, z]: Vec3) => Math.hypot(x, y, z);

/** A critically damped spring let go from rest: at its fastest at once. */
const springOut = (k: number) => (u: number) => 1 - (1 + k * u) * Math.exp(-k * u);
/** One order smoother: from rest with no acceleration either, so no lurch in its first frame. */
const springInOut = (k: number) => (u: number) =>
  1 - (1 + k * u + (k * u) ** 2 / 2) * Math.exp(-k * u);

/** A spring scaled to reach 1 exactly at the end of its time. */
const onTime = (spring: (u: number) => number) => {
  const end = spring(1);
  return (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : spring(u) / end);
};

const easePlayed = onTime(springOut(GLIDE.playedStiffness));
const easeWatched = onTime(springInOut(GLIDE.watchedStiffness));
const easeOf = (plan: GlidePlan) => (plan.played ? easePlayed : easeWatched);

/** The rise of an unannounced move, 0 to 1: from rest, slowing into its height. */
const easeRise = (u: number) => (u >= 1 ? 1 : (1 - Math.cos(Math.PI * Math.max(u, 0))) / 2);

/** Where along the time an ease reaches `s` (its inverse; each ease only rises). */
const inverse = (ease: (u: number) => number, s: number) => {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (ease(mid) < s) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};

/**
 * CSS pixels per world unit at `at`, as `camera` draws it into a view
 * `heightPx` tall: what a glide's length on screen is measured in.
 */
export const screenScale = (camera: Camera, heightPx: number, at: Vec3): number => {
  const lens = camera as PerspectiveCamera;
  if (!lens.isPerspectiveCamera || heightPx <= 0) return GLIDE.defaultScale;
  const [x, y, z] = at;
  const { x: cx, y: cy, z: cz } = camera.position;
  const away = Math.hypot(x - cx, y - cy, z - cz);
  const half = Math.tan((lens.fov * Math.PI) / 360) / lens.zoom;
  return away > 0 && half > 0 ? heightPx / (2 * away * half) : GLIDE.defaultScale;
};

/**
 * The glide of a move from `from` to `to` (world positions of the cells).
 * `played` when the player played it here (with `lift`, how high they held
 * it, 0 if they put it down meanwhile, for a promotion's choice); otherwise
 * it rises to `lift` first. `capture` whether it takes a piece on `to`;
 * `scale` the view's CSS px per world unit (screenScale).
 */
export const planGlide = (
  from: Vec3,
  to: Vec3,
  {
    lift = 0,
    played = false,
    capture = false,
    scale = GLIDE.defaultScale,
  }: { lift?: number; played?: boolean; capture?: boolean; scale?: number } = {},
): GlidePlan => {
  const offset: Vec3 = [from[0] - to[0], from[1] - to[1], from[2] - to[2]];
  const distance = length(offset);
  const across = Math.hypot(offset[0], offset[2]);
  const onScreen = distance * scale;
  const travelMs = Math.min(
    GLIDE.maxMs,
    Math.max(GLIDE.minMs, GLIDE.baseMs + GLIDE.perRootPxMs * Math.sqrt(onScreen)),
  );
  const departMs = played ? 0 : GLIDE.departMs;
  // Where along the way it reaches the victim: contactReach short of the
  // square, and no sooner than a third of the way
  let contactMs: number | null = null;
  if (capture) {
    const s = distance > 0 ? Math.max(0.35, 1 - GLIDE.contactReach / distance) : 1;
    contactMs = departMs + inverse(played ? easePlayed : easeWatched, s) * travelMs;
  }
  return {
    offset,
    distance,
    lift,
    played,
    departMs,
    travelMs,
    contactMs,
    heading: across > 1e-6 ? [-offset[0] / across, -offset[2] / across] : null,
  };
};

/** When the piece comes to rest on its square (ms after the move arrived). */
export const touchdownMs = (plan: GlidePlan) => plan.departMs + plan.travelMs;

/** When it reaches its victim, or null for a quiet move. */
export const contactAtMs = (plan: GlidePlan) => plan.contactMs;

/**
 * When it is `reach` from the square it left (ms after the move arrived), and
 * no later than two thirds of the way: what it had taken there, put back by
 * a step back through the record, stands again then (as a capture meets its
 * victim, in reverse).
 */
export const clearsSourceAtMs = (plan: GlidePlan, reach = GLIDE.contactReach) => {
  const s = plan.distance > 0 ? Math.min(0.65, reach / plan.distance) : 0;
  return plan.departMs + inverse(easeOf(plan), s) * plan.travelMs;
};

interface GlidePose {
  /** Where the piece is, as an offset from its square. */
  offset: Vec3;
  /** How far along the path it is, 0 to 1. */
  progress: number;
}

/** Where the piece is, `ms` after the move arrived. */
export const glidePose = (plan: GlidePlan, ms: number): GlidePose => {
  const [dx, dy, dz] = plan.offset;
  const s = easeOf(plan)((ms - plan.departMs) / plan.travelMs);
  const rest = 1 - s;
  // Held up from the start, or rising to that height as it sets off; either
  // way it comes down with the rest of the way
  const up = plan.played ? plan.lift : plan.lift * easeRise(ms / GLIDE.riseMs);
  return {
    offset: [dx * rest, dy * rest + up * rest, dz * rest],
    progress: s,
  };
};
