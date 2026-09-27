import { levelRamp } from '../kit/colors';

// Lantern's colours. The world is blue hour: deep indigo overhead, a warm
// band of last light at the horizon, a dark raked garden far below. Against
// it the only warm, bright things are the lanterns' light (every move marker
// and the selection) and the pale boxwood army, so the eye goes where play is.

/**
 * The levels, A (bottom) to E, climb from the garden to the sky: moss jade,
 * pond teal, dusk blue, wisteria, and the sakura pink of the last light.
 * Equal steps of OKLCH hue, brightening a little as they climb (neighbours
 * about 0.1 apart in OKLab), and none of them warm gold, vermilion or
 * firefly lime, which belong to the markers.
 */
export const LEVELS = levelRamp({ from: 160, to: 350, lightness: [0.68, 0.84], chroma: 0.14 });

// --- World ----------------------------------------------------------------------

export const SKY = {
  zenith: '#060a1b',
  high: '#0d1533',
  low: '#1d2448',
  /** The thin warm band of last light on the horizon. */
  band: '#4f3a36',
  glow: '#86593f',
  /** What the garden fades into at a distance. */
  mist: '#161b31',
};

export const GARDEN = {
  gravel: '#1a1f2d',
  gravelLit: '#2a2d36',
  moss: '#17261f',
  mossLit: '#22382a',
  water: '#070b16',
  stone: '#2b2c33',
};

/**
 * The garden's lamps: a deep, red candle amber, well clear of the move gold,
 * so a lamp far below never reads as a marker.
 */
export const CANDLE = '#d9803c';
/** The few fireflies over the garden, seen by moonlight: a dim, cool white, no gameplay hue. */
export const DRIFT_LIGHT = '#cfe3d6';
export const PAPER = '#f8d9a2';

// --- Armies ----------------------------------------------------------------------

export const BOXWOOD = { base: '#e7cb93', grain: '#c49a5c', accent: '#6e4a2c' };
export const ROSEWOOD = { base: '#51261f', grain: '#2a100b', accent: '#c98a52' };

// --- Markers ----------------------------------------------------------------------

/** A legal destination: the glow of a paper lantern. */
export const LANTERN = '#ffd58a';
/** The selection: the warmer glow of a lantern held under the piece. */
export const SELECT = '#ffb347';
/** A capture and a check: red lacquer. */
export const LACQUER = '#ff5b3a';
export const CHECK = '#ff4436';
/** The last move: firefly light. */
export const FIREFLY = '#9ef269';

// --- HUD ---------------------------------------------------------------------------

export const WASHI = '#f3e4c6';
export const INK = '#24160f';
