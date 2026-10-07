import { FRAME, layout, PIECE_SCALE } from '../scene/palette';
import { fitShift, fitView, HUD_TOP_PX, hudTop, orbitSweep, zoomRange } from '../cameraFit';
import type { FitWindow } from '../cameraFit';
import { introPlan } from '../intro/timeline';
import { clamp01, easeOutCubic, smooth } from '../scene/ease';
import type { Vec3 } from '../types';

// The lobby's timing and framing, pure so it can be tested without WebGL.
//
// The lobby is one glass platform (level A of the tower, where it stands in
// the game) in the night garden, with the kings on its middle rank: White's
// seat on the left, Black's on the right, and on the choosing screen the
// split king between them for "Random". A seat that is taken shows its king
// in its army's material; a free seat is the king drawn in neon.

export type Side = 'white' | 'black';

/** The lobby's kings stand this much larger than the game's pieces. */
export const KING_SCALE = PIECE_SCALE * 1.25;
/** A king's height (piece units: the set's king is 0.87 tall). */
export const KING_TOP = 0.87;
/** The platform the kings stand on: level A's floor. */
export const FLOOR_Y = FRAME.levelY[0];

const VFOV = (36 * Math.PI) / 180;
export const LOBBY_FOV = 36;
const TAN_V = Math.tan(VFOV / 2);

/**
 * The seats stand on the middle squares of the glass's middle rank, one
 * square apart, whatever the window: the window's shape only moves the
 * camera. (A king's foot is 0.54 across at this scale, so they never touch.)
 */
export const SEAT_SPACING = 1;

/** Where a seat's king stands: White's on the left, Black's on the right, the coin between. */
export const seatX = (seat: Side | 'coin') =>
  seat === 'coin' ? 0 : (seat === 'white' ? -1 : 1) * SEAT_SPACING;

/**
 * The share of the frame's half-width left of a card docked beside the kings
 * (index.css: at most 42% of the width, plus its margin).
 */
const BESIDE_ROOM = 0.55;

/** Half the row of kings, their outer edges and a margin (world units). */
const HALF_ROW = SEAT_SPACING + 0.5;

/**
 * The camera's distance from the kings (world units): near enough that they
 * stand large (at most a share of the window's height), far enough that the
 * row keeps inside most of the width. A wide window is held by the first, a
 * narrow one by the second; a phone upright, whose choices stack at the
 * bottom, lets them stand smaller. With a card docked `beside` them the row
 * keeps to the room left of it, `BESIDE_ROOM` of the frame's half-width.
 */
export const viewDistance = (aspect: number, beside = false) => {
  const narrow = aspect < 0.9;
  const byHeight = (KING_TOP * KING_SCALE) / ((narrow ? 0.2 : 0.3) * 2 * TAN_V);
  const share = beside ? BESIDE_ROOM * 0.85 : narrow ? 0.94 : 0.8;
  const byWidth = HALF_ROW / (TAN_V * aspect * share);
  return Math.max(byHeight, byWidth);
};

// --- Durations (seconds) --------------------------------------------------------------------

export const LOBBY_TIMING = {
  /** A seat's king filling with its material from the foot up. */
  fill: 0.9,
  /** A king let go (not chosen) fading where it stands, back into the dark. */
  fade: 0.7,
  /** The coin thrown up spinning, the moment it shows its face, its glide to that seat. */
  toss: 1.05,
  tossHold: 0.22,
  tossGlide: 0.55,
  /**
   * From the pick (or the coin coming to rest) to the page moving on to the
   * invitation (or, against the computer, its level): once the chosen king is
   * set down, while the others are still fading, so the pick, the camera's
   * move and the card are one motion.
   */
  settle: 0.3,
  /**
   * A named pick's free seat opening with the invitation: its outline is
   * drawn up from the foot as the seat's label comes in under it
   * (index.css `.lobby-seat`: 600 ms, 200 ms in).
   */
  openDelay: 0.2,
  open: 0.7,
  /** The arrival: the empty seat fills, and the moment held after it. */
  arriveHold: 1.2,
  /**
   * The arrival, from both kings filled: their columns of light come on
   * together (once the new king is solid and the ring has spread), then,
   * a beat later, the two lift together.
   */
  arriveLight: 0.4,
  arriveLift: 0.65,
  /** Leaving for the game: the kings go up in light, then the camera draws back. */
  leaveBurn: 0.7,
  /** The camera sets off this far into the kings' going up. */
  leaveSetOff: 0.2,
  /** From the lobby's close view to the game's first frame (leavePose). */
  leaveMove: 2,
  /**
   * The lobby's picture fading over the game's, from this long before the
   * move comes to rest (by then it is within a hair of the game's first frame).
   */
  leaveReveal: 0.05,
  leaveFade: 0.2,
};

/**
 * The longest step one frame may take the lobby's clocks (as the game's
 * entrance, `IntroDirector`'s MAX_STEP): a stalled frame resumes where it
 * was, while a slow renderer (a phone, a few frames a second in software)
 * still plays each beat in about its own time, if in fewer frames, rather
 * than in slow motion.
 */
export const LOBBY_MAX_STEP = 0.25;

/**
 * One frame's step for a lobby motion (seconds). The canvas draws on demand,
 * so the first frame after it has rested reports the whole rest as its delta:
 * a motion setting off from rest (a hover, a pick, the card coming in) takes
 * an ordinary frame's step there, rather than a quarter of a second's worth
 * of its ease at once, a jump; under way, the frame's own time, up to
 * `LOBBY_MAX_STEP`.
 */
export const lobbyStep = (delta: number, settingOff: boolean) =>
  Math.min(delta, settingOff ? 1 / 60 : LOBBY_MAX_STEP);

// --- The entrance -----------------------------------------------------------------------------

/**
 * The lobby's entrance when it is first shown (seconds from its first frame):
 * the picture fades up while the camera settles in from a little further
 * out and higher; the glass draws itself; each king's outline comes up and
 * it forms from the foot, left to right, a beat apart.
 */
export const LOBBY_ENTRANCE = {
  fade: 0.9,
  camera: 2.4,
  platform: { start: 0.1, duration: 1.4 },
  king: { white: 0.6, coin: 0.75, black: 0.9 },
  /** A king's outline comes up over this, ending as it starts to form. */
  outline: 0.45,
};

/** Where the camera starts its entrance from: a little further out, and higher. */
export const entranceFrom = (rest: CameraPose): CameraPose => ({
  ...rest,
  distance: rest.distance * 1.14,
  elevation: rest.elevation + (5 * Math.PI) / 180,
});

/** The camera `t` (0 to 1) into its entrance: easing out, so it settles, never stops short. */
export const settlePose = (from: CameraPose, to: CameraPose, t: number): CameraPose => {
  const k = easeOutCubic(clamp01(t));
  const mix = (p: number, q: number) => p + (q - p) * k;
  return {
    target: [
      mix(from.target[0], to.target[0]),
      mix(from.target[1], to.target[1]),
      mix(from.target[2], to.target[2]),
    ],
    azimuth: mix(from.azimuth, to.azimuth),
    elevation: mix(from.elevation, to.elevation),
    distance: mix(from.distance, to.distance),
  };
};

/**
 * How far a king's entrance has come `t` seconds after the lobby's first
 * frame, for a king that starts to form at `at`: its outline's strength
 * (0 to 1), and whether it may start to form.
 */
export const kingEntrance = (t: number, at: number) => ({
  outline: smooth(clamp01((t - (at - LOBBY_ENTRANCE.outline)) / LOBBY_ENTRANCE.outline)),
  forming: t >= at,
});

// --- The coin toss ---------------------------------------------------------------------------

/**
 * The coin's turn about its axis at rest shows both halves (porcelain left,
 * charcoal right); a quarter turn one way shows its porcelain face to the
 * camera, the other way its charcoal face.
 */
export const faceAngle = (side: Side) => (side === 'white' ? Math.PI / 2 : -Math.PI / 2);

/** The coin's turn `t` seconds into a toss landing on `side`: two turns and a bit, slowing. */
export const tossAngle = (t: number, side: Side, duration = LOBBY_TIMING.toss) => {
  const end = faceAngle(side) + Math.PI * 2 * 2;
  // Fast off the hand, slowing to rest on its face without passing it
  const k = clamp01(t / duration);
  return end * (1 - (1 - k) ** 3);
};

/** How high the coin is thrown while it spins (piece units): up and back down. */
export const tossHop = (t: number, duration = LOBBY_TIMING.toss) =>
  Math.sin(Math.PI * clamp01(t / duration)) * 0.4;

/** How far the landed coin has glided toward its seat, 0 to 1, eased in and out. */
export const tossGlide = (t: number) =>
  smooth(clamp01((t - LOBBY_TIMING.toss - LOBBY_TIMING.tossHold) / LOBBY_TIMING.tossGlide));

/** Whether a toss `t` seconds in has reached its seat. */
export const tossLanded = (t: number) =>
  t >= LOBBY_TIMING.toss + LOBBY_TIMING.tossHold + LOBBY_TIMING.tossGlide;

// --- The fill ---------------------------------------------------------------------------------

/**
 * The piece shader's forming (pieces.tsx `uForm`, the game's entrance) for a
 * king that is `fill` whole (0 its neon outline only, 1 its material whole):
 * filling, it forms from the foot up behind a line of light, as the pieces
 * do when the tower is built. A king let go fades instead (`fade`).
 */
export const formForFill = (fill: number) => clamp01(fill);

/** The neon outline's brightness for a king `fill` whole: it gives way to the material. */
export const outlineForFill = (fill: number) => 1 - smooth(clamp01(fill * 1.15));

/** How far a free seat's outline has come up, `t` s after its seat opened (0 to 1). */
export const seatOpening = (t: number) =>
  smooth(clamp01((t - LOBBY_TIMING.openDelay) / LOBBY_TIMING.open));

/** The free seat's slow breath: a 6 s period, calming after the first half minute. */
export const breath = (seconds: number) => {
  const depth = 0.35 * (1 - 0.6 * smooth(clamp01((seconds - 30) / 20)));
  return 1 - depth * (0.5 - 0.5 * Math.cos((seconds / 6) * Math.PI * 2));
};

// --- The camera ---------------------------------------------------------------------------------

export interface CameraPose {
  /** Where it looks. */
  target: Vec3;
  /** About the vertical from +z (radians, positive toward +x). */
  azimuth: number;
  /** Above the horizon (radians). */
  elevation: number;
  distance: number;
}

/** A window this short and wide docks the card at the right, beside the kings (index.css). */
export const cardBeside = (width: number, height: number) =>
  height <= 500 && width / Math.max(height, 1) >= 1.3;

/**
 * The lobby's view of the kings: from White's near side, a little above the
 * glass, at the framing's distance, the kings' middle a little above the
 * frame's. With a `card` docked under them (the host's invitation) they
 * stand higher; in a short window whose card docks at the right (`beside`),
 * they stand in the room left of it instead.
 */
export const lobbyPose = (aspect: number, card = false, beside = false): CameraPose => {
  const distance = viewDistance(aspect, card && beside);
  const kingMid = FLOOR_Y + KING_TOP * KING_SCALE * 0.5;
  const tanH = TAN_V * aspect;
  let raise = aspect < 0.9 ? (card ? 0.24 : 0) : card ? 0.2 : -0.04;
  let across = 0;
  if (card && beside) {
    raise = -0.12;
    // The row's middle in the middle of the room left of the card
    across = (1 - BESIDE_ROOM) * distance * tanH;
  }
  return {
    target: [across, kingMid - raise * distance * TAN_V, 0],
    azimuth: 0,
    elevation: (17 * Math.PI) / 180,
    distance,
  };
};

/** A pose's camera position. */
export const posePosition = ({ target, azimuth, elevation, distance }: CameraPose): Vec3 => [
  target[0] + Math.sin(azimuth) * Math.cos(elevation) * distance,
  target[1] + Math.sin(elevation) * distance,
  target[2] + Math.cos(azimuth) * Math.cos(elevation) * distance,
];

/** The pose on a straight direction from the target (normalized here). */
export const poseFromDirection = (target: Vec3, direction: Vec3, distance: number): CameraPose => {
  const [x, y, z] = direction;
  const l = Math.hypot(x, y, z) || 1;
  return {
    target,
    azimuth: Math.atan2(x / l, z / l),
    elevation: Math.asin(y / l),
    distance,
  };
};

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/** Between two poses, `t` 0–1: turning the short way round, easing in and out. */
export const blendPose = (a: CameraPose, b: CameraPose, t: number): CameraPose =>
  mixPose(a, b, easeInOutCubic(t));

/** The pose `k` (0–1) of the way between two, turning the short way round. */
const mixPose = (a: CameraPose, b: CameraPose, k: number): CameraPose => {
  let turn = b.azimuth - a.azimuth;
  turn = Math.atan2(Math.sin(turn), Math.cos(turn));
  const mix = (p: number, q: number) => p + (q - p) * k;
  return {
    target: [
      mix(a.target[0], b.target[0]),
      mix(a.target[1], b.target[1]),
      mix(a.target[2], b.target[2]),
    ],
    azimuth: a.azimuth + turn * k,
    elevation: mix(a.elevation, b.elevation),
    // Out along a gentle curve: the distance grows geometrically
    distance: a.distance * (b.distance / a.distance) ** k,
  };
};

/** The ring of light that answers a seat being taken: its radius and brightness at `t` s. */
export const arrivalRing = (t: number) => {
  const k = clamp01(t / 1.4);
  return { radius: 0.3 + easeOutCubic(k) * 2.6, strength: 0.45 * (1 - k) ** 2 };
};

/** The smaller ring when the player's king is set down on its square: out to its edge and gone. */
export const placeRing = (t: number) => {
  const k = clamp01(t / 0.8);
  return { radius: 0.28 + easeOutCubic(k) * 0.3, strength: 0.4 * (1 - k) ** 2 };
};

// --- Handing over to the game ------------------------------------------------------------

/**
 * How far the glass itself turns about the tower's axis as the lobby leaves
 * (radians): half a turn, while the camera turns +16° round the tower to the
 * game's opening line of sight (the same for either seat), so the glass spins
 * -164° on screen. A square turned half a turn looks just as it did, so the
 * lobby's last picture is still the game's first.
 */
export const LEAVE_GLASS_TURN = Math.PI;

/** A pose turned about the vertical through the origin (radians, as azimuth). */
export const turnPose = (pose: CameraPose, turn: number): CameraPose => {
  const [x, y, z] = pose.target;
  const [c, s] = [Math.cos(turn), Math.sin(turn)];
  return { ...pose, target: [x * c + z * s, y, z * c - x * s], azimuth: pose.azimuth + turn };
};

/** How long the camera's draw back eases in, and out, as shares of the move. */
const PULL_IN = 0.4;
const PULL_OUT = 0.3;

/**
 * The camera's draw back, `t` 0–1: easing gently off the lobby's view over
 * its first two-fifths, at an even pace through the middle, and easing to
 * rest over its last three-tenths (its speed's ramps are smoothsteps).
 */
export const leavePull = (t: number) => {
  const k = clamp01(t);
  const ramp = (x: number, r: number) => r * (x ** 3 - x ** 4 / 2); // ∫ smooth over a ramp
  const whole = 1 - (PULL_IN + PULL_OUT) / 2;
  if (k < PULL_IN) return ramp(k / PULL_IN, PULL_IN) / whole;
  if (k > 1 - PULL_OUT) return 1 - ramp((1 - k) / PULL_OUT, PULL_OUT) / whole;
  return (PULL_IN / 2 + (k - PULL_IN)) / whole;
};

/**
 * The glass's spin and its way down the picture, `t` 0–1: barely turning at
 * first, gathering speed gradually, fastest three-quarters of the way, then
 * brought to rest (the distribution function of Beta(4, 2)).
 */
export const leaveSpin = (t: number) => {
  const k = clamp01(t);
  return k ** 4 * (5 - 4 * k);
};

/**
 * The leaving `t` (0–1) of the way from `from` to the game's opening `to`:
 * the camera, the glass's turn (`glass`, radians about the vertical), and how
 * far the camera has drawn back (`settled`, 0–1: the lens shift follows it).
 * The camera itself turns only a little round the tower (+16°), and only
 * while the garden is black (leaveVeil), so the garden never turns on
 * screen; the glass turns under it.
 *
 * Two motions, one under the other: the camera eases off and draws back
 * (leavePull, in the log of the distance), while the glass gathers itself
 * and spins hard into place in the second half, sliding down the picture to
 * where the game has it as the camera's look rises from it to the tower's
 * centre (leaveSpin). Both come to rest exactly on the game's first frame.
 */
export const leavePose = (from: CameraPose, to: CameraPose, t: number) => {
  const end = LEAVE_GLASS_TURN;
  const pull = leavePull(t);
  const spin = leaveSpin(t);
  // The camera's own turn round the tower, the short way, less the glass's
  let round = to.azimuth - from.azimuth;
  round = Math.atan2(Math.sin(round), Math.cos(round));
  const mix = (p: number, q: number, k: number) => p + (q - p) * k;
  const onGlass: CameraPose = {
    target: [
      mix(from.target[0], to.target[0], spin),
      mix(from.target[1], to.target[1], spin),
      mix(from.target[2], to.target[2], spin),
    ],
    // Seen from the glass the camera turns on the glass's spin...
    azimuth: from.azimuth + (round - end) * spin,
    elevation: mix(from.elevation, to.elevation, pull),
    distance: from.distance * (to.distance / from.distance) ** pull,
  };
  // ...while round the tower it turns only in the dark: the glass turns
  // under it by the difference
  const glass = round * leaveTurn(t) - (round - end) * spin;
  return { pose: turnPose(onGlass, glass), glass, settled: pull };
};

/**
 * How dark the garden is as the lobby leaves, `t` of the move (0 seen, 1
 * black). It starts before the move does, from the moment the lobby starts
 * leaving (`t` −0.1: leaveSetOff before the camera sets off), so the lobby's
 * garden and its caption ease off together over the first 0.8 s rather than
 * cut to black; it stays black past halfway (long enough that the lobby's
 * garden and the game's never read as one place seen from two sides), and
 * the game's garden fades up, already where the game has it, as the glass
 * spins into place, whole a little before it lands.
 */
export const leaveVeil = (t: number) => {
  if (t < 0.5) return smooth(clamp01((t + 0.1) / 0.4));
  return 1 - smooth(clamp01((t - 0.55) / 0.42));
};

/**
 * From this far into the move the garden is black, and becomes the game's:
 * laid out for the player's seat, in the game's light (until past halfway).
 */
export const LEAVE_GARDEN_DARK = 0.3;

/**
 * How far the camera has turned round the tower, `t` 0–1 of the move: all
 * of it while the garden is black, so the garden never turns on screen.
 */
const leaveTurn = (t: number) => smooth(clamp01((t - 0.32) / 0.21));

/**
 * Where the game's camera stands on its first frame in a window this size
 * (IntroDirector's `lobby` entrance: `dolly.from` times the distance
 * FitCameraToBoard fits, on the opening line of sight, about the board's
 * centre) and the fit's lens shift. The lobby's leaving comes to rest on it
 * exactly, so its last picture is the game's first.
 */
/** The last opening worked out, which the leaving asks for every frame (the fit sweeps the orbit's elevations). */
let lastOpening: {
  key: string;
  opening: {
    pose: ReturnType<typeof poseFromDirection>;
    shift: [number, number];
  };
} | null = null;

export const gameOpening = (width: number, height: number, reduced = false) => {
  const key = `${width} ${height} ${reduced}`;
  if (lastOpening?.key === key) return lastOpening.opening;
  const pose = poseFromDirection([0, 0, 0], layout.viewDirection, 1);
  const view: FitWindow = {
    width,
    height,
    fov: LOBBY_FOV,
    topInset: hudTop(height),
    balanceInset: HUD_TOP_PX,
    sweep: orbitSweep(layout.orbit),
  };
  const fit = fitView(pose.elevation, layout.frameRings, view).distance;
  const { min, max } = zoomRange(fit, layout.orbit.minDistance);
  const distance = Math.min(Math.max(fit, min), max);
  const shift = fitShift(layout.frameRings, pose.elevation, distance, view);
  const opening = {
    // (the entrance the game will play: under reduced motion it has no dolly)
    pose: { ...pose, distance: distance * introPlan('lobby', reduced).dolly.from },
    shift,
  };
  lastOpening = { key, opening };
  return opening;
};
