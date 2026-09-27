import { clarityTower, towerFrame } from '../kit/layouts';
import type { BoardLayout, DesignMotion } from '../types';

// Qubit: the board is the chip at the heart of a dilution refrigerator, the
// gold "chandelier" of a quantum computer. Everything the stage, wafers,
// pieces, markers and effects share lives here.
//
// Value plan, darkest to brightest:
//   cryostat (blue-black, 3–9%) < gold chandelier (dim, misted, ~12–20%)
//   < sapphire wafers (a faint blue veil) < black ceramic army (dark, but
//   lifted by a frosty rim and gold inlays) < level traces (mid, cool)
//   < gold army (bright, warm, brushed) < markers (the brightest, most
//   saturated marks on the board).
// Hues: the levels own the cool arc, cyan (A) to orchid (E); everything that
// means "play" sits outside it. Gold is a move you may make (and the piece
// that makes it), mint is the move just made, red is capture and check.

export const PALETTE = {
  // The cryostat: blue-black, a cold glow far below
  voidTop: '#03050a',
  voidHorizon: '#07101c',
  voidBottom: '#050b16',
  glow: '#1a4a78',
  mist: '#0b1a2c',
  chandelier: '#c8953a',

  // The armies
  gold: '#e7b85f',
  goldPolished: '#f3c872',
  ceramic: '#17191f',
  frost: '#a9d8ff',
  /** The echoes of superposition and of a moving piece's wave packet. */
  echo: '#cfeaff',
  echoWarm: '#ffe3a6',

  // Markers, one meaning each
  move: '#fccd73',
  capture: '#ff5a4f',
  select: '#ffd88a',
  lastMove: '#79f1a8',
  check: '#ff3b47',

  // Type
  ink: '#dbe6f2',
  inkMuted: 'rgba(219, 230, 242, 0.58)',
  rule: 'rgba(231, 184, 95, 0.55)',
} as const;

/**
 * One colour per level, A (bottom) to E: levelRamp({ from: 195, to: 335,
 * lightness: 0.74, chroma: 0.135 }), cyan through azure, periwinkle and
 * lavender to orchid. Equal steps of hue at one lightness, no white or grey,
 * clear of gold, mint and red. The wafer traces and edges, the level
 * letters, the foot of every piece and the ring round its base all use it.
 */
export const LEVEL_COLORS = ['#00c3c3', '#31baef', '#81a8ff', '#b896f3', '#df89cc'];

// --- Layout ------------------------------------------------------------------------

export const PIECE_SCALE = 0.8;
const base = clarityTower({ pieceHeight: 0.87 * PIECE_SCALE });
/**
 * The kit's compact tower. The zoom stops short of the chandelier's inner
 * rim, so the camera never passes through the gold plates round the board.
 */
export const layout: BoardLayout = {
  ...base,
  orbit: { ...base.orbit, maxDistance: 21 },
};
export const FRAME = towerFrame(layout);
export const PITCH = FRAME.pitch;

/** A quick, precise glide from square to square. */
export const MOTION: DesignMotion = { style: 'slide', durationMs: 420 };

/** Board turns a knight toward the opponent by PI/2 - yaw: 1.2 shows its profile. */
export const KNIGHT_YAW = 1.2;
