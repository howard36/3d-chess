import { clarityTower, towerFrame } from '../kit/layouts';

// Candy Tower's palette and measurements, shared by every part of the design.
//
// Value plan, chosen before anything else:
// - the armies sit at the two ends of the value range: vanilla cream (very
//   light, warm) against blueberry navy (very dark, cool);
// - the world behind them stays in the middle: a mid-blue sky over a
//   periwinkle sea of clouds, nothing near white or near black;
// - the platforms are clear sugar glass that multiplies (like tinted glass)
//   instead of hazing, so a piece three levels down keeps its contrast and
//   its colour;
// - the world (sky, glass, armies) lives in blue, violet, orchid and cream,
//   so the three gameplay colours are the only mint, cherry and sunflower on
//   screen: mint for "can go", cherry red for "can take", sunflower for "just
//   moved".

// --- Armies ---------------------------------------------------------------------

export const CREAM = '#fbe9c9';
/** The white army's trim: grape, a candy colour no marker uses. */
export const GRAPE = '#7a5cf5';
export const NAVY = '#252a66';
/** The black army's trim: orchid pink, well clear of the capture red. */
export const ORCHID = '#ff85d8';
/** Ink for outlines, text and the dark edge of every sticker. */
export const INK = '#1f2457';

// --- Markers --------------------------------------------------------------------

export const MINT = '#3ee8a2';
export const CHERRY = '#ff2d4f';
export const SUNFLOWER = '#ffcc2e';
export const SPARKLE = '#fffaf0';
export const CHECK_RED = '#ff2f45';

// --- World ----------------------------------------------------------------------

export const SKY = {
  zenith: '#3a7bdc',
  horizon: '#93c4f6',
  haze: '#94b7ef',
  sun: '#fff1c9',
  sunHaze: '#f4d6c6',
  seaLight: '#bcc6f3',
  seaMid: '#8096de',
  seaShadow: '#6679ca',
  seaDeep: '#5063b5',
};

/** Clear sugar glass, as a multiply tint (the checker's two tones). */
export const GLASS = { light: '#fcfbfa', dark: '#e6e4ef' };
export const RIM = '#f7f2ff';

/** Level letters, bottom (A) to top (E): one candy ramp, cool to warm. */
export const LEVEL_COLORS = ['#9fd0ff', '#b7b4ff', '#d3a8ff', '#f3a6ec', '#ffb3c9'];

/** Confetti, sprinkles and puffs. */
export const CANDY = ['#ff85d8', '#7a5cf5', '#3ee8a2', '#ffcc2e', '#5ab8ff', '#ff8a5c'];

// --- Layout ---------------------------------------------------------------------

/** Pieces are modeled up to 0.86 tall; at this scale the king clears the level above. */
export const PIECE_SCALE = 0.8;
export const TALLEST = 0.86;
export const layout = clarityTower({ pieceHeight: TALLEST * PIECE_SCALE });
export const frame = towerFrame(layout);
export const { pitch } = frame;
