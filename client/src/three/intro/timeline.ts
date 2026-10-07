import { PieceType } from '../../engine/pieces';
import { clamp01, easeOutCubic } from '../scene/ease';

// The game's entrance, as pure timing: where each part of it stands at `t`
// seconds after it starts. IntroDirector advances `t` on r3f's clock and
// moves the camera; the levels, the labels, the pieces and the HUD each read
// their own part of the plan in their own frames.
//
// The full entrance (a game that starts while the page is open), about
// 3.9 s:
//
//   0.0 ─ the night fades up; the camera, far out on the opening line of
//         sight, starts to close in (a pure dolly toward the tower's centre,
//         which never moves on screen)
//   0.2 ─ level A draws itself: its edge grows out of its four corners, the
//         hairlines run in across it, the glass floods in from the edge;
//         each level after it starts a third of a second later
//   2.1 ─ the armies form, foot first behind a rising edge of light, both at
//         once and mirrored through the centre: the back ranks from the royal
//         pair outward, then the pawns, closing in on the empty level C
//   2.2 ─ the labels settle in; the camera lands at 2.3
//   3.1 ─ the HUD fades in as the last pawns form; the last ring on the glass
//         has faded by 3.9
//
// A rejoin (the page opened on a game already under way) plays the same
// sequence in about 1.3 s from much nearer; with reduced motion there is no
// dolly and no drawing, only a short fade; `none` is the finished scene.

export type IntroVariant = 'full' | 'short' | 'lobby' | 'none';

/** A span of the entrance, in seconds from its start. */
interface Span {
  start: number;
  duration: number;
}

export interface IntroPlan {
  variant: IntroVariant;
  /** Played for a player who asked for less motion: a fade, nothing more. */
  reduced: boolean;
  /** When everything has settled: the board takes input from here. */
  total: number;
  /** The whole scene fading up from black. */
  scene: Span;
  /** The camera closing in, from `from` times the fitted distance. */
  dolly: Span & { from: number };
  /**
   * Level z builds over [start + (z - built) * step, + duration]; the levels
   * under `built` stand from the start (the lobby's glass is level A).
   */
  levels: Span & { step: number; built?: number };
  /** The labels settling in, `stagger` apart from first to last. */
  labels: Span & { stagger: number };
  /**
   * Each piece forms over `duration`, from `start` plus its arrival
   * (pieceArrival) times `spread`.
   */
  pieces: Span & { spread: number };
  /** The HUD's pill and captured pieces fading in. */
  hud: Span;
}

const span = (start: number, duration: number): Span => ({ start, duration });
const end = (s: Span) => s.start + s.duration;

/** The latest a piece's arrival can be (pieceArrival), at a spread of 1. */
export const LAST_ARRIVAL = 0.95;

/** How long the ring of light on the glass under a forming piece lasts, as a share of its forming. */
const RING_SHARE = 1.5;

const finish = (plan: Omit<IntroPlan, 'total'>): IntroPlan => ({
  ...plan,
  total: Math.max(
    end(plan.scene),
    end(plan.dolly),
    plan.levels.start + plan.levels.step * (4 - (plan.levels.built ?? 0)) + plan.levels.duration,
    plan.labels.start + plan.labels.stagger + plan.labels.duration,
    plan.pieces.start + plan.pieces.spread * LAST_ARRIVAL + plan.pieces.duration * RING_SHARE,
    end(plan.hud),
  ),
});

const NONE: IntroPlan = finish({
  variant: 'none',
  reduced: false,
  scene: span(0, 0),
  dolly: { ...span(0, 0), from: 1 },
  levels: { ...span(0, 0), step: 0 },
  labels: { ...span(0, 0), stagger: 0 },
  pieces: { ...span(0, 0), spread: 0 },
  hud: span(0, 0),
});

/**
 * The plan for an entrance: `full` for a game that starts while the page is
 * open, `short` for one the page joins already under way, `none` for none.
 * With `reduced` (prefers-reduced-motion) the scene and the HUD only fade in
 * briefly, everything already in place.
 */
export function introPlan(variant: IntroVariant, reduced = false): IntroPlan {
  if (variant === 'none') return NONE;
  if (reduced) {
    return finish({ ...NONE, variant, reduced: true, scene: span(0, 0.15), hud: span(0, 0.15) });
  }
  if (variant === 'short') {
    return finish({
      variant,
      reduced: false,
      scene: span(0, 0.25),
      dolly: { ...span(0, 0.95), from: 1.3 },
      levels: { ...span(0, 0.45), step: 0.1 },
      labels: { ...span(0.7, 0.3), stagger: 0.12 },
      pieces: { ...span(0.5, 0.36), spread: 0.3 },
      hud: span(0.85, 0.35),
    });
  }
  if (variant === 'lobby') {
    // Handed over from the lobby, whose glass is level A and whose last
    // picture is this one's first: nothing fades up, and the camera stands
    // where the lobby brought it to rest (lobbyMotion's leavePose) as the
    // tower builds on up from A
    return finish({
      variant,
      reduced: false,
      scene: span(0, 0),
      dolly: { ...span(0, 0), from: 1 },
      levels: { ...span(0.1, 0.9), step: 0.28, built: 1 },
      labels: { ...span(1.5, 0.5), stagger: 0.35 },
      pieces: { ...span(1.35, 0.55), spread: 1 },
      hud: span(2.3, 0.5),
    });
  }
  return finish({
    variant,
    reduced: false,
    scene: span(0, 0.45),
    dolly: { ...span(0, 2.3), from: 2.4 },
    levels: { ...span(0.2, 1), step: 0.32 },
    labels: { ...span(2.2, 0.5), stagger: 0.35 },
    pieces: { ...span(2.1, 0.55), spread: 1 },
    hud: span(3.1, 0.5),
  });
}

/** How far through `s` the time `t` is, 0 to 1. */
const through = (s: Span, t: number) =>
  s.duration > 0 ? clamp01((t - s.start) / s.duration) : t >= s.start ? 1 : 0;

/** Whether the entrance is over at `t` (everything in its final state). */
export const introDone = (plan: IntroPlan, t: number) => t >= plan.total;

/** The whole scene's opacity at `t`: up from black. */
export const sceneFade = (plan: IntroPlan, t: number) => through(plan.scene, t);

/**
 * The camera's distance at `t`, as a multiple of the fitted distance: from
 * `dolly.from` to exactly 1, easing out. Eased in proportion rather than
 * in length (each frame closes the same share of what is left), so the
 * tower grows on screen at an even pace instead of rushing in at the end.
 */
export const dollyFactor = (plan: IntroPlan, t: number) => {
  const k = easeOutCubic(through(plan.dolly, t));
  return k >= 1 ? 1 : plan.dolly.from ** (1 - k);
};

/** How far level `z` (0 = A) has built at `t`, 0 to 1 (the shaders ease their own parts). */
export const levelBuild = (plan: IntroPlan, z: number, t: number) =>
  z < (plan.levels.built ?? 0)
    ? 1
    : through(
        {
          start: plan.levels.start + plan.levels.step * (z - (plan.levels.built ?? 0)),
          duration: plan.levels.duration,
        },
        t,
      );

/** A label's opacity at `t`, the `order`th (0 to 1) from the first to settle to the last. */
export const labelFade = (plan: IntroPlan, t: number, order: number) =>
  through(
    {
      start: plan.labels.start + plan.labels.stagger * clamp01(order),
      duration: plan.labels.duration,
    },
    t,
  );

/**
 * When a piece standing at `(x, y, z)` arrives, in seconds after the first
 * (at a spread of 1, at most LAST_ARRIVAL): both armies at once, each piece
 * with its mirror image through the board's centre, the back ranks first
 * from the royal pair outward, then the pawns. In the opening that is the
 * king and his black counterpart first, then the knights, the queen, the
 * rooks and the rest of level A and E, then the pawns of levels B and D,
 * closing in on the empty level C. The same order holds a game in progress
 * (read from the square each piece stands on) together.
 */
export const pieceArrival = (piece: {
  type: PieceType;
  color: 'white' | 'black';
  x: number;
  y: number;
}) => {
  // The piece's rank as its own army counts them, 0 nearest its own side
  const rank = piece.color === 'white' ? piece.y : 4 - piece.y;
  const out = Math.abs(piece.x - 2);
  const base = piece.type === PieceType.Pawn ? 0.55 : 0;
  return Math.min(
    base + 0.09 * out + 0.12 * Math.min(rank, 1) + 0.02 * Math.max(rank - 1, 0),
    LAST_ARRIVAL,
  );
};

/** When a piece arriving at `arrival` starts to form. */
const formSpan = (plan: IntroPlan, arrival: number): Span => ({
  start: plan.pieces.start + plan.pieces.spread * arrival,
  duration: plan.pieces.duration,
});

/** How far a piece arriving at `arrival` has formed at `t`, 0 (not yet there) to 1 (whole). */
export const pieceForm = (plan: IntroPlan, arrival: number, t: number) =>
  through(formSpan(plan, arrival), t);

/**
 * The ring of light on the glass under a forming piece at `t`: 0 before it
 * starts and 1 once it has faded, spreading over a little longer than the
 * piece takes to form.
 */
export const pieceRing = (plan: IntroPlan, arrival: number, t: number) => {
  const s = formSpan(plan, arrival);
  return through({ start: s.start, duration: s.duration * RING_SHARE }, t);
};

/** The HUD's opacity at `t`. */
export const hudFade = (plan: IntroPlan, t: number) => through(plan.hud, t);
