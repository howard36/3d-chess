import { clarityTower, towerFrame } from '../kit/layouts';

// Nightdrive's palette, planned by value before hue:
//
// - the world is a dusk: dark indigo overhead and on the ground, with a warm
//   rose glow only at the horizon, so it sits in the middle-to-dark range;
// - the armies sit at the two ends of the value scale: pearl white (very
//   light) and ink indigo (darker than anything behind it); both carry a neon
//   rim, cool white on the pearl army and violet-magenta on the ink army,
//   whose very edge turns pale cyan so it survives the pink horizon;
// - the platforms are pale lilac glass: lighter than the night behind them,
//   so they read as surfaces, but faint enough to see four levels down;
// - each level owns a neon hue, on its plate edge, its letter and a band
//   round the base of every piece standing on it;
// - the markers own three hues nothing else uses: cyan for "can go", red for
//   "can take" (and check), amber for "last move".

// --- World ---------------------------------------------------------------------------

export const SKY = {
  zenith: '#060318',
  high: '#150a35',
  low: '#3d1152',
  horizon: '#b93a7c',
  sunGlow: '#f0606a',
  ground: '#07031a',
  haze: '#431648',
  grid: '#9a2a78',
} as const;

// --- Armies --------------------------------------------------------------------------

export const PEARL = '#f7f5fb';
export const INK = '#120d26';
/** The ink army's neon edge: violet-magenta, well clear of capture red. */
export const INK_RIM = '#d946ef';
/** The outermost sliver of the ink army's rim, so it still reads against the pink horizon. */
export const INK_RIM_EDGE = '#c9f6ff';
/** The pearl army's neon edge: a cool white. */
export const PEARL_RIM = '#e6f7ff';

// --- Levels --------------------------------------------------------------------------

/**
 * One neon hue per level, A (bottom) to E, far enough apart to name: pink,
 * violet, blue, green, lime, in spectral order so the stack reads as a
 * sequence. Worn by the plate edge, the level letter and a band round the
 * base of every piece on that level. The ramp steps round the marker hues
 * (cyan, red, amber) rather than through them, and its brighter greens are
 * held down so no level shouts over the others.
 */
export const LEVEL_NEON = ['#ff6ec7', '#a57bff', '#5a8bff', '#33d17f', '#b4e33a'];

// --- Markers ---------------------------------------------------------------------------

export const MOVE = '#35f0ff';
export const CAPTURE = '#ff2d55';
export const LAST_MOVE = '#ffb000';
export const CHECK = '#ff2d55';
export const SELECT = '#6ff6ff';

// --- HUD ---------------------------------------------------------------------------

export const HUD_FG = '#f1eaff';
export const HUD_MUTED = 'rgba(214, 200, 255, 0.62)';

// --- Layout --------------------------------------------------------------------------

/** Pieces are scaled so the king clears the platform above with air to spare. */
export const PIECE_SCALE = 0.8;
/**
 * Two degrees under the kit's 18°: rows of neighbouring levels stay further
 * apart on screen, and a sliver of dusk sky (and the sun, from its side)
 * shows above the tower at the top of the frame.
 */
export const layout = clarityTower({ pieceHeight: 0.87 * PIECE_SCALE, elevation: 16 });
export const frame = towerFrame(layout);
export const { pitch } = frame;

/** The level (0 = A) whose platform is at this world height. */
export const levelAt = (y: number) =>
  frame.levelY.reduce(
    (best, ly, z) => (Math.abs(ly - y) < Math.abs(frame.levelY[best] - y) ? z : best),
    0,
  );
