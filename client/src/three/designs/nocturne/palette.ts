import { levelRamp } from '../kit/colors';

// Nocturne's palette, planned by value before hue. It is Sumi by moonlight:
// the paper has gone indigo-black and the ink has turned to silver, so the
// value scale is Sumi's turned inside out. The world sits low (night paper,
// mountains, mist), the platforms are barely there, the armies hold the two
// ends (porcelain near white; lacquer near black, but lit round its edge by
// the moon and drawn with a silver line), and every gameplay mark is a
// bright pigment brushed on top:
//
//   value   0 ─ lacquer ─ night paper ─ mountains ─ mist ── pigments ── silver ─ porcelain ─ 100
//
// Hue families are kept apart: the level colours run through the cool
// mineral pigments (malachite → verdigris → azurite → lapis → amethyst), so
// the marks can take everything else: silver for "can move", vermilion for
// "capture" and "check", and moon gold for the last move.

/** The night paper: the backdrop from the zenith down to the sea of cloud below. */
export const NIGHT = {
  zenith: '#05070e',
  sky: '#0b0f1f',
  horizon: '#232b4e',
  mist: '#222a4b',
  sea: '#0f1329',
  deep: '#080b18',
};

/** The ink-wash mountains, far to near: paler with distance, as they sink into the mist. */
export const MOUNTAINS = ['#1c2341', '#151a33', '#0f1329', '#090c19'];
/** The silver of a moonlit ridge line, and of the ink the world is drawn in. */
export const RIDGE_SILVER = '#8e9bbd';
/** The moon: a cool silver disc, with a warmer haze round it. */
export const MOON = '#dfe5f1';
export const MOON_HAZE = '#6e7aa3';

/**
 * Each level's own pigment, A (bottom) to E (top): malachite, verdigris,
 * azurite, lapis and amethyst, evenly spaced in hue and lightening a little
 * with height (toward the moon), so they read as one gradient up the tower
 * while neighbours stay at least 0.1 apart in OKLab. They colour a level's brushed edge and grid, its letter and the
 * band at the foot of every piece standing on it.
 */
export const LEVELS = levelRamp({ from: 138, to: 318, lightness: [0.7, 0.82], chroma: 0.135 });

/** White army: porcelain, a touch cool under the moon. */
export const PORCELAIN = '#eceef2';
/** Its drawn line and painted details: sumi ink, blue-black. */
export const INK = '#0b0d16';
/** Black army: urushi lacquer, a deep blue-black. */
export const LACQUER = '#171b2c';
/** Its drawn line, painted details and moonlit rim: silver. */
export const SILVER = '#c3cde0';
export const RIM = '#9fb2dc';
/**
 * Inlay at the collars and the pieces' details: indigo sumi on porcelain,
 * pewter on lacquer. Never a marker colour: no gold (the last move), no
 * bright silver (a destination).
 */
export const INLAY_INK = '#1e2436';
export const INLAY_PEWTER = '#737d95';

/** Legal destinations: a silver ensō, the full moon. */
export const MOVE = '#e4eaf6';
/** Capture: vermilion, round the silver ensō. */
export const CAPTURE = '#ff5b3d';
/** Check: the same vermilion, as a seal under the king. */
export const CHECK = '#f0472e';
/** The last move: moon gold crescents and a gold thread. */
export const LAST_MOVE = '#e8b75a';
export const LAST_MOVE_EDGE = '#3a2a10';
/** The selection: moonlight. */
export const SELECT = '#f2f5ff';

/** HUD and labels: silver type on night paper. */
export const TEXT = '#dde3ee';
export const TEXT_MUTED = 'rgba(221, 227, 238, 0.58)';
export const PANEL = 'rgba(13, 16, 30, 0.84)';
export const RULE = 'rgba(190, 201, 224, 0.26)';
export const SEAL = '#d8452f';
