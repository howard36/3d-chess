import { clarityTower, towerFrame } from '../kit/layouts';

// Nightdrive's palette, planned by value before hue:
//
// - the world is a dusk: dark indigo overhead and on the ground, with a warm
//   rose glow only at the horizon, so it sits in the middle-to-dark range;
// - the armies sit at the two ends of the value scale: pearl white (very
//   light) and ink indigo (darker than anything behind it), and the ink army
//   carries a hot-pink neon rim so it never sinks into the night;
// - the platforms are pale lilac glass: lighter than the night behind them,
//   so they read as surfaces, but faint enough to see four levels down;
// - the markers own three hues nothing else uses: cyan for "can go", red for
//   "can take" (and check), amber for "last move".

// --- World ---------------------------------------------------------------------------

export const SKY = {
  zenith: '#060318',
  high: '#140a33',
  low: '#3a1152',
  horizon: '#e0457f',
  sunGlow: '#ff8a4c',
  ground: '#07031a',
  haze: '#5a1a5e',
  grid: '#7d4bff',
} as const;

// --- Armies --------------------------------------------------------------------------

export const PEARL = '#f6f3fb';
export const INK = '#120d26';
/** The ink army's neon edge. */
export const INK_RIM = '#ff3cac';
/** The pearl army's faint cool sheen at grazing angles. */
export const PEARL_RIM = '#ece6ff';

// --- Platforms -------------------------------------------------------------------------

/**
 * Perimeter neon per level, A (bottom) to E: a quiet colour code from warm
 * orchid at the bottom to cool periwinkle at the top, matched by the level
 * letters. Kept violet so it never collides with the marker hues or the ink
 * army's pink.
 */
export const LEVEL_EDGES = ['#d77cff', '#c283ff', '#ab8bff', '#9894ff', '#8a9cff'];

// --- Markers ---------------------------------------------------------------------------

export const MOVE = '#35f0ff';
export const CAPTURE = '#ff2d55';
export const LAST_MOVE = '#ffa630';
export const CHECK = '#ff2d55';
export const SELECT = '#6ff6ff';

// --- HUD ---------------------------------------------------------------------------

export const HUD_FG = '#f1eaff';
export const HUD_MUTED = 'rgba(214, 200, 255, 0.62)';

// --- Layout --------------------------------------------------------------------------

/** Pieces are scaled so the king clears the platform above with air to spare. */
export const PIECE_SCALE = 0.8;
export const layout = clarityTower({ pieceHeight: 0.87 * PIECE_SCALE });
export const frame = towerFrame(layout);
export const { pitch } = frame;
