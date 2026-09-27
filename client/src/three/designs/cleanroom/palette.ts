import { levelRamp } from '../kit/colors';

// Cleanroom's colours. The world is a bright, cool, low-contrast lab (walls,
// floor and haze within a narrow band of pale greys), so the two armies sit at
// the ends of the value scale: glossy white ceramic with a slate keyline, and
// dark carbon fibre. Colour is reserved for meaning:
//
// - the five levels: the LED strips that edge-light each polycarbonate tray,
//   in a real-colour gradient from amber (A, bottom) through green, teal and
//   azure to violet (E, top);
// - the laser: a rose-magenta projection for everything the player is doing
//   right now (the selection and its legal destinations);
// - a bright red for a capture, a deep crimson for check;
// - graphite ink for the record of the last move (a measured line, drawn like
//   a technical drawing).
//
// The level hues run 72° to 300° in OKLCH; the laser sits at about 355° and
// red at 27°, both clear of the ramp's ends.

const RAMP = { from: 72, to: 300 } as const;

/** The level colour at its truest: letters' fill, foot bands, the tray tint. */
export const LEVEL = levelRamp({ ...RAMP, lightness: [0.72, 0.6], chroma: 0.17 });
/** Deeper, for thin lines and letters that must hold on a pale ground. */
export const LEVEL_DEEP = levelRamp({ ...RAMP, lightness: [0.56, 0.48], chroma: 0.15 });
/** The LED itself: brighter, for glows and the engraving it lights. */
export const LEVEL_LED = levelRamp({ ...RAMP, lightness: [0.8, 0.68], chroma: 0.16 });
/**
 * The rim strips and the pieces' foot bands: always on, so a step less vivid
 * than the laser, which must stay the most saturated mark on the board.
 */
export const LEVEL_RIM = levelRamp({ ...RAMP, lightness: [0.76, 0.63], chroma: 0.13 });
export const LEVEL_FOOT = levelRamp({ ...RAMP, lightness: [0.72, 0.6], chroma: 0.12 });

// --- Signals -----------------------------------------------------------------------

/** The laser: selection and legal destinations. */
export const LASER = '#f2077e';
/** The laser's hot core, where it is brightest (hover, the scan line). */
export const LASER_HOT = '#ff4fa6';
/** The very centre of a laser line: near white, the brightest thing on the board. */
export const LASER_CORE = '#ffd6ea';
export const CAPTURE = '#f52c1e';
/** The capture kerf's hot core. */
export const CAPTURE_HOT = '#ff7a5c';
/** Check: a deep crimson, apart from the capture's bright red, with a white core line. */
export const CHECK = '#c8102e';
/** Graphite ink: the last move, the HUD's text, the white army's keyline. */
export const INK = '#27303b';
export const INK_SOFT = '#5d6a78';

// --- World -------------------------------------------------------------------------

export const ROOM = {
  /** Haze: everything far fades toward this. */
  fog: '#dfe4ea',
  wall: '#e7ebef',
  wallShade: '#d6dce2',
  seam: '#b9c1ca',
  kick: '#a3acb6',
  /** Window frames and mullions: one of the room's few darks. */
  frame: '#7c8793',
  glass: '#f1f5f8',
  /** The yellow-filtered light of the lithography bay, seen through glass. */
  amber: '#ece6cc',
  floor: '#aab2bb',
  floorPerf: '#a8b0b9',
  floorHole: '#8a939e',
  ceiling: '#dfe4e9',
  panel: '#fbfdff',
  equipment: '#e9edf1',
  equipmentShade: '#c9d0d8',
};

// --- Pieces ------------------------------------------------------------------------

export const CERAMIC = '#eaeae5';
export const CERAMIC_COLLAR = '#e4e7ea';
/** The white army's detail: satin titanium, dark enough to draw the details. */
export const TITANIUM = '#7a8592';
export const CARBON = '#272c33';
export const CARBON_WEAVE = '#454d58';
/** The dark army's detail: a brushed-steel inlay, light enough to read at game size. */
export const STEEL = '#a3aebb';
/** The white army's keyline: a light hairline. */
export const KEYLINE = '#7d8896';
/** The light line round a hovered white piece, outside its hairline (never darker). */
export const HOVER_HALO = '#f4f6f8';
/** The dark army's hover keyline: light steel. */
export const STEEL_HOVER = '#c3ccd6';
/** The anodised instrument base the tower stands on. */
export const ANODISED = '#2f363e';
/** The chuck plate on top of the base: mid-dark, so both armies read against it from above. */
export const CHUCK = '#4b545e';
/** The unlit state of an LED, and what the other rims fade toward while a level is in focus. */
export const HOUSING = '#9aa5b1';
/** The trays' housings: graphite, lighter than the base. */
export const HOUSING_DARK = '#66707b';

/** Picker swatch: background, white army, black army, accent. */
export const SWATCH: [string, string, string, string] = [ROOM.wall, CERAMIC, CARBON, LASER];
