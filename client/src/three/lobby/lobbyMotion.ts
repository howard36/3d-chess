import { FRAME, layout, PIECE_SCALE } from '../scene/palette';
import { centringShift, FIT_SOFTNESS, fitView, hudTop, ringBounds, zoomRange } from '../cameraFit';
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
  /** A seat's king filling with its material from the foot up, or draining to neon. */
  fill: 0.9,
  /** The coin thrown up spinning, the moment it shows its face, its glide to that seat. */
  toss: 1.05,
  tossHold: 0.22,
  tossGlide: 0.55,
  /** From the column of light rising to the choice counting as settled. */
  settle: 0.7,
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
  leaveMove: 1.6,
  /** The lobby's picture fading over the game's, at the end of the move. */
  leaveFade: 0.3,
};

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
 * do when the tower is built; draining, it goes from the crown down.
 */
export const formForFill = (fill: number) => clamp01(fill);

/** The neon outline's brightness for a king `fill` whole: it gives way to the material. */
export const outlineForFill = (fill: number) => 1 - smooth(clamp01(fill * 1.15));

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

/** Between two poses, `t` 0–1: turning the short way round, easing in and out. */
export const blendPose = (a: CameraPose, b: CameraPose, t: number): CameraPose => {
  const k = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
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
 * The game's opening direction for a seat, in the lobby's garden. The lobby
 * never turns its garden about (it has no board to orient), so for Black the
 * camera goes round to the far side instead, which shows the same picture as
 * the game's garden turned about for Black with its camera on the near side
 * (and level A's glass, all the lobby keeps, is the same turned about).
 */
export const leaveDirection = (seat: Side): Vec3 => {
  const [x, y, z] = layout.viewDirection;
  return seat === 'black' ? [-x, y, -z] : [x, y, z];
};

/**
 * Where the game's camera stands on its first frame in a window this size
 * (IntroDirector's `lobby` entrance: `dolly.from` times the distance
 * FitCameraToBoard fits, on the opening line of sight, about the board's
 * centre) and the fit's lens shift. The lobby ends its leaving exactly
 * there, so its last picture is the game's first.
 */
export const gameOpening = (seat: Side, width: number, height: number) => {
  const direction = leaveDirection(seat);
  const pose = poseFromDirection([0, 0, 0], direction, 1);
  const view: FitWindow = { width, height, fov: LOBBY_FOV, topInset: hudTop(height) };
  const fit = fitView(pose.elevation, layout.frameRings, view).distance;
  const { min, max } = zoomRange(fit, layout.orbit.minDistance);
  const distance = Math.min(Math.max(fit, min), max);
  const shift = centringShift(
    ringBounds(layout.frameRings, pose.elevation, distance, FIT_SOFTNESS),
    view,
  );
  return {
    pose: { ...pose, distance: distance * introPlan('lobby').dolly.from },
    shift,
  };
};
