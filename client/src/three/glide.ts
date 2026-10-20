import type { Vec3 } from './types';

// A move glides: the piece, rigid, slides along the straight line between
// the squares like a critically damped spring let go from its square: it
// sets off at once, at its fastest early on, and settles onto the next
// square without passing it, never sitting still and then darting. It
// takes longer the farther it goes, by the square root of the distance, so
// a one-square move is quick and a long one not much slower. A piece the player held up sets off from that
// height and settles onto its square on the way. Everything about it is a
// pure function of the time since the move arrived (glidePose), driven on
// r3f's clock by MoveGlide.

/** Everything a move's glide does, fixed when it arrives (planGlide). */
export interface GlidePlan {
  /** The source's offset from the destination (world units). */
  offset: Vec3;
  /** How high the piece starts above its square (held up by the player), world units. */
  lift: number;
  /** From leaving its square to resting on the next. */
  travelMs: number;
  /** For a capture: when it reaches the victim, short of the square. */
  contactMs: number | null;
  /** Which way it is going across the board (unit x, z), or null for straight up or down. */
  heading: [number, number] | null;
}

/** The glide's tunings: change them here, the tests read them. */
export const GLIDE = {
  /** Travel time: base, per square root of the journey's world units, and its bounds. */
  baseMs: 200,
  perRootUnitMs: 110,
  minMs: 280,
  maxMs: 500,
  /**
   * The spring's stiffness over the travel (ω × travel time): higher sets
   * off harder and leaves a longer settle. At 6 it is at its fastest a sixth
   * of the way through the time; it would still have 2% of the way to go at
   * the end, so it is scaled to arrive exactly on time.
   */
  stiffness: 6,
  /** A capture reaches its victim this far short of the square. */
  contactReach: 0.5,
} as const;

const length = ([x, y, z]: Vec3) => Math.hypot(x, y, z);

/** A critically damped spring from rest, 0 to 1 over its time `u`. */
const spring = (u: number) => 1 - (1 + GLIDE.stiffness * u) * Math.exp(-GLIDE.stiffness * u);
const springEnd = spring(1);

/** The glide's ease, 0 to 1: off at once, fastest early, settling into the square. */
const easeGlide = (u: number) => (u >= 1 ? 1 : spring(u) / springEnd);

/** Where along the time the ease reaches `s` (its inverse; it only rises). */
const easeGlideInverse = (s: number) => {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (easeGlide(mid) < s) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};

/**
 * The glide of a move from `from` to `to` (world positions of the cells).
 * `lift` is how high the piece already stands (a piece the player held up),
 * `capture` whether it takes a piece on `to`.
 */
export const planGlide = (from: Vec3, to: Vec3, { lift = 0, capture = false } = {}): GlidePlan => {
  const offset: Vec3 = [from[0] - to[0], from[1] - to[1], from[2] - to[2]];
  const distance = length(offset);
  const across = Math.hypot(offset[0], offset[2]);
  const travelMs = Math.min(
    GLIDE.maxMs,
    Math.max(GLIDE.minMs, GLIDE.baseMs + GLIDE.perRootUnitMs * Math.sqrt(distance)),
  );
  // Where along the way it reaches the victim: contactReach short of the
  // square, and no sooner than a third of the way
  let contactMs: number | null = null;
  if (capture) {
    const s = distance > 0 ? Math.max(0.35, 1 - GLIDE.contactReach / distance) : 1;
    contactMs = easeGlideInverse(s) * travelMs;
  }
  return {
    offset,
    lift,
    travelMs,
    contactMs,
    heading: across > 1e-6 ? [-offset[0] / across, -offset[2] / across] : null,
  };
};

/** When the piece comes to rest on its square (ms after the move arrived). */
export const touchdownMs = (plan: GlidePlan) => plan.travelMs;

/** When it reaches its victim, or null for a quiet move. */
export const contactAtMs = (plan: GlidePlan) => plan.contactMs;

interface GlidePose {
  /** Where the piece is, as an offset from its square. */
  offset: Vec3;
  /** How far along the path it is, 0 to 1. */
  progress: number;
}

/** Where the piece is, `ms` after the move arrived. */
export const glidePose = (plan: GlidePlan, ms: number): GlidePose => {
  const [dx, dy, dz] = plan.offset;
  const s = easeGlide(Math.min(Math.max(ms / plan.travelMs, 0), 1));
  const rest = 1 - s;
  return {
    offset: [dx * rest, dy * rest + plan.lift * rest, dz * rest],
    progress: s,
  };
};
