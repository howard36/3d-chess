import { clarityTower, towerFrame } from '../kit/layouts';

// Candy Tower's palette and measurements, shared by every part of the design.
//
// Value plan, chosen before anything else:
// - the armies sit at the two ends of the value range: vanilla cream (very
//   light, warm) against blueberry navy (very dark, cool);
// - behind them, a sunny sky over a sea of cumulus. The opening view looks
//   toward the sun, so the clouds behind the tower are backlit: mid-value
//   lilac bodies with cream linings, and the brightest cream stays in thin
//   rims, away from the cream army's value;
// - the platforms are clear sugar glass that multiplies (like tinted glass)
//   instead of hazing, so a piece three levels down keeps its contrast and
//   its colour; the checker is faint enough that three stacked plates swing
//   by about 10% at most;
// - three gameplay colours appear nowhere else: mint for "can go", cherry
//   red for "can take", sunflower for "just moved". The level ramp
//   (candy-floss to aqua) and the armies' trims stay clear of all three.

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
  zenith: '#5aa9f0',
  upper: '#8cc6f6',
  horizon: '#ffd9b8',
  haze: '#dcbcc8',
  sun: '#fff1d2',
  /** Between the clouds, far below: the blue shade under the cloud sea. */
  below: '#7189d6',
};

/** The cloud sea's paint: cream where the sun catches it, lilac and periwinkle only in shadow. */
export const CLOUD = {
  light: '#fff3e6',
  warm: '#cdbfe6',
  mid: '#aaa6e0',
  shadow: '#8e95d8',
  deep: '#7a84cf',
};

/**
 * Clear sugar glass, as a multiply tint, leaning faintly toward each level's
 * colour (see plates.tsx), so each slab matches its letter; its checker is
 * kept faint so stacked plates stay clean from above.
 */
export const GLASS = { light: '#fdfcfb' };

/**
 * One candy colour per level, bottom (A) to top (E): the gummy rim, the
 * letter, a faint tint in the glass and the band round every piece's base.
 * Candy-floss, lavender, periwinkle, sky, aqua: a warm-to-cool ramp that
 * keeps at least 30° of hue from the marker colours (mint, cherry,
 * sunflower), with the cool end at the top, where its rim sits against the
 * warm horizon.
 */
export const LEVEL_COLORS = ['#f59eef', '#c8a8ff', '#a3adff', '#80c0ff', '#6fdcea'];

/** Confetti, sprinkles and puffs. */
export const CANDY = ['#ff85d8', '#7a5cf5', '#3ee8a2', '#ffcc2e', '#5ab8ff', '#ff8a5c'];

// --- Layout ---------------------------------------------------------------------

/** Pieces are modeled up to 0.86 tall; at this scale the king clears the level above. */
export const PIECE_SCALE = 0.8;
export const TALLEST = 0.86;
export const layout = clarityTower({ pieceHeight: TALLEST * PIECE_SCALE });
export const frame = towerFrame(layout);
export const { pitch } = frame;
