import { FRAME, layout, PIECE_SCALE } from '../scene/palette';
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

/**
 * How far apart the seats stand (world units, one square is 1): two squares
 * in a wide window, one in a narrow one, where three kings side by side
 * would otherwise be too small to read.
 */
export const seatSpacing = (aspect: number) => (aspect < 0.9 ? 1 : 2);

/** Where a seat's king stands: White's on the left, Black's on the right, the coin between. */
export const seatX = (seat: Side | 'coin', aspect: number) =>
  seat === 'coin' ? 0 : (seat === 'white' ? -1 : 1) * seatSpacing(aspect);

// --- Durations (seconds) --------------------------------------------------------------------

export const LOBBY_TIMING = {
  /** A seat's king filling with its material from the foot up, or draining to neon. */
  fill: 0.95,
  /** The coin's spin, and the moment it holds its face before it goes. */
  toss: 1.7,
  tossHold: 0.35,
  /** The coin burning away once it has landed. */
  tossBurn: 0.45,
  /** From the column of light rising to the choice counting as settled. */
  settle: 0.7,
  /** The arrival: the empty seat fills, and the moment held after it. */
  arriveHold: 0.8,
  /** Leaving for the game: the kings go up in light, then the camera draws back. */
  leaveBurn: 0.7,
  leaveMove: 1.9,
  /** The lobby's picture fading over the game's, at the end of the move. */
  leaveFade: 0.45,
};

// --- The coin toss ---------------------------------------------------------------------------

/**
 * The coin's turn about its axis at rest shows both halves (porcelain left,
 * charcoal right); a quarter turn one way shows its porcelain face to the
 * camera, the other way its charcoal face.
 */
export const faceAngle = (side: Side) => (side === 'white' ? Math.PI / 2 : -Math.PI / 2);

/** The coin's turn `t` seconds into a toss landing on `side`: three turns and a bit, slowing. */
export const tossAngle = (t: number, side: Side, duration = LOBBY_TIMING.toss) => {
  const end = faceAngle(side) + Math.PI * 2 * 3;
  // Fast off the hand, slowing to rest on its face without passing it
  const k = clamp01(t / duration);
  return end * (1 - (1 - k) ** 3);
};

/** The coin's small hop while it spins (world units, before scale). */
export const tossHop = (t: number, duration = LOBBY_TIMING.toss) => {
  const k = clamp01(t / duration);
  return Math.sin(Math.PI * Math.min(k * 1.6, 1)) * 0.22;
};

// --- The fill ---------------------------------------------------------------------------------

/**
 * The piece shader's cut (pieces.tsx `uCut`) for a king that is `fill` whole
 * (0 its neon outline only, 1 its material whole). The cut burns from the
 * crown down as it rises, so a filling king (the cut falling) forms from the
 * foot up and a draining one goes from the crown down, each with its bright
 * edge. Below zero the cut is off.
 */
export const cutForFill = (fill: number) => (fill >= 1 ? -1 : 1.02 - 1.04 * clamp01(fill));

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

const VFOV = (36 * Math.PI) / 180;
export const LOBBY_FOV = 36;

/**
 * The lobby's view of the kings (`card`: with a card docked under them):
 * low over the glass, from White's near
 * side, far enough that the row fills most of the width, the kings a little
 * above the middle so the card under them (docked at the bottom on a phone)
 * never covers them.
 */
export const lobbyPose = (aspect: number, card = false): CameraPose => {
  const narrow = aspect < 0.9;
  const halfRow = seatSpacing(aspect) + (narrow ? 0.45 : 0.75);
  const tanV = Math.tan(VFOV / 2);
  const tanH = tanV * aspect;
  // The row inside most of the width, and never so close that a king fills
  // the height
  const distance = Math.max(halfRow / (tanH * (narrow ? 0.94 : 0.84)), 4.4);
  const kingMid = FLOOR_Y + KING_TOP * KING_SCALE * 0.55;
  // The kings' middle this far above the centre of the frame (NDC)
  // (higher while a card is docked under them)
  const raise = narrow ? 0.3 : card ? 0.3 : 0.12;
  return {
    target: [0, kingMid - raise * distance * tanV, 0],
    azimuth: 0,
    elevation: (11 * Math.PI) / 180,
    distance,
  };
};

/** While waiting, the camera drifts a little way round the kings, once, and rests. */
export const waitDrift = (seconds: number) =>
  ((-12 * Math.PI) / 180) * smooth(clamp01(seconds / 18));

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
  return { radius: 0.3 + easeOutCubic(k) * 3.4, strength: (1 - k) ** 1.6 };
};

// --- Handing over to the game ------------------------------------------------------------

/** Where the camera ends up as the lobby hands over to the game (its intro starts here). */
export const LEAVE_DISTANCE = 34;
export const TOWER_CENTRE: Vec3 = [
  0,
  (FRAME.levelY[0] + FRAME.levelY[FRAME.levelY.length - 1]) / 2,
  0,
];
/**
 * The game's opening direction for a seat, in the lobby's garden. The lobby
 * never turns its garden about (it has no board to orient), so for Black the
 * camera goes round to the far side instead, which shows the same picture as
 * the game's garden turned about for Black with its camera on the near side.
 */
export const leaveDirection = (seat: Side): [number, number, number] => {
  const [x, y, z] = layout.viewDirection;
  return seat === 'black' ? [-x, y, -z] : [x, y, z];
};
