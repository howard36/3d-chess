import type { Vec3 } from './types';

// A move is a piece picked up, carried and set down. It hops off its square
// (a short crouch first, unless the player already holds it up), travels
// along the straight line between the squares with a low arc over it,
// stretching a little in the air and leaning as it speeds up and slows, and
// comes down onto its square with a squash and a small settle. A capture
// holds still for a beat as it reaches its victim (the hit), then drives on
// through and lands harder. Everything about it is a pure function of the
// time since the move arrived (glidePose), driven on r3f's clock by MoveGlide.

/** Everything a move's glide does, fixed when it arrives (planGlide). */
export interface GlidePlan {
  /** The source's offset from the destination (world units). */
  offset: Vec3;
  /** How high the piece starts above its square (held up by the player), world units. */
  lift: number;
  /** Its height at the top of the arc, over the straight line. */
  hop: number;
  /** The crouch before it leaves a square it stood on (0 when held up). */
  crouchMs: number;
  /** From leaving its square to touching down, without the hit. */
  travelMs: number;
  /** For a capture: how far into the travel it reaches the victim. */
  contactMs: number | null;
  /** How long it holds still there. */
  hitstopMs: number;
  /** How deep it squashes as it lands (a share of its height), and its settle. */
  squash: number;
  settleMs: number;
  /** The most it leans, toward or away from where it is going (radians). */
  lean: number;
  /** Which way it is going across the board (unit x, z), or null for straight up or down. */
  heading: [number, number] | null;
}

/** The glide's tunings: change them here, the tests read them. */
export const GLIDE = {
  /** The crouch before a hop from the floor, and how deep. */
  crouchMs: 70,
  crouch: 0.07,
  /** Travel time: base, per world unit of the journey, and its bounds. */
  baseMs: 230,
  perUnitMs: 48,
  minMs: 290,
  maxMs: 520,
  /** How high the arc rises (world units; a level's floor is 1.35 under the next). */
  hop: { base: 0.13, perUnit: 0.03, max: 0.28, knight: 0.36 },
  /** How much a piece stretches upward in the air. */
  stretch: 0.05,
  /** Landing squash: a quiet move's and a capture's. */
  squash: 0.09,
  captureSquash: 0.16,
  settleMs: 260,
  /** Lean at full speed over a journey of two squares or more. */
  lean: 0.1,
  /** A capture reaches its victim this far short of the square, and holds this long. */
  contactReach: 0.5,
  hitstopMs: 80,
} as const;

const length = ([x, y, z]: Vec3) => Math.hypot(x, y, z);

/**
 * The glide of a move from `from` to `to` (world positions of the cells).
 * `lift` is how high the piece already stands (a piece the player held up),
 * `capture` whether it takes a piece on `to`, `knight` whether it jumps.
 */
export const planGlide = (
  from: Vec3,
  to: Vec3,
  { lift = 0, capture = false, knight = false } = {},
): GlidePlan => {
  const offset: Vec3 = [from[0] - to[0], from[1] - to[1], from[2] - to[2]];
  const distance = length(offset);
  const across = Math.hypot(offset[0], offset[2]);
  const travelMs = Math.min(
    GLIDE.maxMs,
    Math.max(GLIDE.minMs, GLIDE.baseMs + GLIDE.perUnitMs * distance),
  );
  const hop = Math.max(
    knight
      ? GLIDE.hop.knight
      : Math.min(GLIDE.hop.max, GLIDE.hop.base + GLIDE.hop.perUnit * distance),
    lift + 0.04,
  );
  // Where along the way it reaches the victim: contactReach short of the
  // square, and no sooner than a third of the way
  let contactMs: number | null = null;
  if (capture && distance > 0) {
    const s = Math.max(0.35, 1 - GLIDE.contactReach / distance);
    contactMs = (Math.acos(1 - 2 * s) / Math.PI) * travelMs;
  }
  return {
    offset,
    lift,
    hop,
    crouchMs: lift > 0 ? 0 : GLIDE.crouchMs,
    travelMs,
    contactMs,
    hitstopMs: capture ? GLIDE.hitstopMs : 0,
    squash: capture ? GLIDE.captureSquash : GLIDE.squash,
    settleMs: GLIDE.settleMs,
    lean: GLIDE.lean * Math.min(across / 2, 1),
    heading: across > 1e-6 ? [-offset[0] / across, -offset[2] / across] : null,
  };
};

/** When the piece touches down on its square (ms after the move arrived). */
export const touchdownMs = (plan: GlidePlan) => plan.crouchMs + plan.travelMs + plan.hitstopMs;

/** When it reaches its victim and the hit begins, or null for a quiet move. */
export const contactAtMs = (plan: GlidePlan) =>
  plan.contactMs === null ? null : plan.crouchMs + plan.contactMs;

/** When the glide is over, the piece settled. */
export const glideEndMs = (plan: GlidePlan) => touchdownMs(plan) + plan.settleMs;

export interface GlidePose {
  /** Where the piece is, as an offset from its square. */
  offset: Vec3;
  /** Its height's scale (the width's is 1 / sqrt of it, so it keeps its volume). */
  scaleY: number;
  /** How far it leans toward its heading (radians; negative leans back). */
  lean: number;
  /** How far along the path it is, 0 to 1. */
  progress: number;
}

// A damped spring, 0 at the start, first peak (about 0.46) a sixth of the
// way, a small overshoot the other way, at rest by the end
const spring = (v: number, cycles = 1.6) => Math.exp(-5 * v) * Math.sin(2 * Math.PI * cycles * v);
const SPRING_PEAK = 0.46;

/** Where the piece is and how it is shaped, `ms` after the move arrived. */
export const glidePose = (plan: GlidePlan, ms: number): GlidePose => {
  const [dx, dy, dz] = plan.offset;
  const down = touchdownMs(plan);
  if (ms >= down) {
    // Landed: squash, spring back past its height a little, and settle; a
    // lean forward it carried in springs back the same way
    const v = Math.min((ms - down) / plan.settleMs, 1);
    if (v >= 1) return { offset: [0, 0, 0], scaleY: 1, lean: 0, progress: 1 };
    return {
      offset: [0, 0, 0],
      scaleY: 1 - (plan.squash / SPRING_PEAK) * spring(v),
      lean: (plan.lean * 0.7 * spring(v, 1.2)) / SPRING_PEAK,
      progress: 1,
    };
  }
  if (ms < plan.crouchMs) {
    // Gathering itself on the source square
    const v = ms / plan.crouchMs;
    return {
      offset: [dx, dy, dz],
      scaleY: 1 - GLIDE.crouch * Math.sin(Math.PI * v),
      lean: 0,
      progress: 0,
    };
  }
  // In the air. A capture's clock stops for the hit.
  let t = ms - plan.crouchMs;
  if (plan.contactMs !== null && t > plan.contactMs) {
    t = Math.max(plan.contactMs, t - plan.hitstopMs);
  }
  const u = Math.min(t / plan.travelMs, 1);
  // Along the line: eased in and out. Over it: an arc in plain time, so the
  // piece comes down onto its square still falling, and lands.
  const s = 0.5 - 0.5 * Math.cos(Math.PI * u);
  const height = plan.lift * (1 - u) + (plan.hop - plan.lift / 2) * 4 * u * (1 - u);
  return {
    offset: [dx * (1 - s), dy * (1 - s) + height, dz * (1 - s)],
    scaleY: 1 + GLIDE.stretch * Math.sin(Math.PI * u),
    // Leaning back as it speeds up, forward as it slows
    lean: -plan.lean * Math.sin(2 * Math.PI * u),
    progress: s,
  };
};
