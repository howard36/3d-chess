import { levelRamp } from '../kit/colors';

// Polaris: a polar observatory at night. The value structure, dark to light:
// the night (sky, snowfield, mountains) stays deep and low in contrast; the
// ice platforms are barely there, drawn by their etched joints and frost;
// the obsidian army is darker than the night but edged in aurora light;
// the snow-stone army is the brightest mass; the markers are the only warm
// or white-hot marks on the board.

// --- The levels: the aurora's own colours, low to high --------------------------

/**
 * One colour per level, A (bottom) to E, climbing the aurora the way it
 * climbs the sky: oxygen green at the base, through teal and blue, to the
 * violet and orchid of its high fringe. Equal perceptual steps of hue,
 * no white or grey among them.
 */
export const LEVELS = levelRamp({ from: 140, to: 330, lightness: [0.82, 0.72], chroma: 0.17 });
/** The same hues, deeper: the band at each piece's foot, which must hold on snow stone. */
export const LEVEL_FEET = levelRamp({ from: 140, to: 330, lightness: [0.66, 0.58], chroma: 0.17 });

// --- The night ------------------------------------------------------------------

export const NIGHT = {
  zenith: '#02050c',
  sky: '#060d1b',
  horizon: '#1b2a3e',
  haze: '#172537',
  /** Moonless snow: blue in the hollows, a little brighter on the wind's faces. */
  snowLow: '#131f2f',
  snowHigh: '#3a4e68',
  rock: '#0b111b',
  /** Moonlit snow on the ranges: a neutral cold grey-blue, well away from every level hue. */
  mountainSnow: '#4a5d78',
  mountainShade: '#1a2434',
  /** The aurora, as the sky shows it (dim: it lights the world, it is not a light show). */
  auroraLow: '#39f5a0',
  auroraMid: '#2fd6c8',
  auroraHigh: '#9d6bff',
  /** The observatories' slit lights: a cold lamp (warm gold is the last move's colour). */
  window: '#bcd6f2',
};

// --- The armies -----------------------------------------------------------------

export const SNOW_STONE = '#e9eef3';
/** Glacier-blue ice inlaid in the snow stone: the cut, the mane, the spiral, the pearls, the cross. */
export const SNOW_ACCENT = '#7f9ec0';
export const OBSIDIAN = '#252321';
/** Deep ice-grey inlaid in the obsidian: the cut, the mane, the spiral, the pearls, the cross. */
export const OBSIDIAN_ACCENT = '#2e3f52';
/**
 * Moonlight: the cold silver that edges the obsidian army. Low in chroma, so
 * the army's edge never reads as a level's colour or as the selection's.
 */
export const RIM = '#c0c9d4';

// --- Marks on the board ---------------------------------------------------------

/** A legal destination: the frost star, white-hot ice. */
export const MOVE = '#e8f6ff';
/** The capture: the same star gone crimson, with a crimson core (well clear of the gold). */
export const CAPTURE = '#ff3f5e';
/** Polaris gold: the last move's squares and the line between them. */
export const LAST_MOVE = '#ffc45c';
/** Check: a red aurora. */
export const CHECK = '#ff3b3b';
/**
 * The selection is aurora light itself, pale: mint ice at the hem, ice
 * white through the body, a lavender fringe at the head. Each is at least
 * 0.11 OKLab from every level colour, so the selection owns its light and
 * borrows no level's hue.
 */
export const SELECT = ['#b4ffe2', '#dff6ff', '#d6c6ff'] as const;
/** The cold mint light on the held piece's crown (obsidian; snow stone takes a deeper one to show). */
export const CROWN = '#b4ffe2';
export const CROWN_WHITE = '#3dffa8';

export const INK = '#e6f0fa';
