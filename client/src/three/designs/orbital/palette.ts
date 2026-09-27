import { levelRamp } from '../kit/colors';

// Orbital's colours. The value structure, darkest to brightest: the bay and
// the planet's night side far below (near black, faintly blue); the smoked
// glass decks (barely there); the graphite army (dark, but rim-lit into
// form); the level lights (mid, saturated); the ceramic army (light); and
// the play lights on the floor (brightest, each a hue of its own).

/**
 * The five decks, A (bottom, nearest the planet) to E: the colours of the
 * atmosphere seen edge-on at the terminator, from the warm glow near the
 * ground to the blue high up. Equal in lightness and vividness, so no deck
 * shouts louder than another. Orange, gold, green, cyan, blue.
 */
export const LEVELS = levelRamp({ from: 45, to: 255, lightness: 0.8, chroma: 0.14 });

/** The play lights: each clear of every deck colour. */
export const DOCK = '#dcf4ff'; // a legal destination: ice-white docking lights
export const CAPTURE = '#ff3b55'; // a capture: the same lights, red
export const CHECK = '#ff3b55'; // a king in check: red caution chevrons
export const TRAIL = '#c38cff'; // the last move: violet
export const BEAM = '#e4f2ff'; // the selection's tractor beam

/** Text and labels. */
export const INK = '#dfe8f4';
export const INK_MUTED = 'rgba(223, 232, 244, 0.58)';

/** The bay and the world outside. */
export const SPACE = {
  zenith: '#020409',
  horizon: '#070c18',
  ocean: '#04080f',
  land: '#0d1219',
  cloud: '#51627f',
  city: '#e8b77a',
  limb: '#3f86e0',
  airglow: '#3fc1b0',
  haze: '#16325c',
};

/** The armies. */
export const CERAMIC = '#e9e5dd';
export const CARBON = '#24272d';
export const GRAPHITE = '#353c47';
export const TITANIUM = '#c5ccd6';
export const STEEL = '#9aa4b0';
