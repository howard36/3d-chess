import { oklchToHex } from '../kit/colors';

// Vitrail's colours. Two families that never cross:
//
// - cool jewel glass for structure: the five levels, emerald at the bottom
//   through aquamarine, sapphire and amethyst to fuchsia at the top, the same
//   hues the nave's windows are glazed in;
// - light for play: gilt for where a piece may go, ruby for a capture and a
//   check, grisaille silver for the last move, sunlight for the selection.
//
// Every level colour is a real hue (no white, no grey), stepped round the
// cool half of the wheel so it stays clear of the warm gameplay colours, and
// lightening as the tower rises (deep emerald at A to light rose at E), so
// neighbouring levels sit 0.115 to 0.136 apart in OKLab.

/** OKLCH hue of each level, A (bottom) to E. */
export const LEVEL_HUES = [150, 192, 246, 298, 340];

const ramp = (l: number, c: number) => LEVEL_HUES.map((h) => oklchToHex({ l, c, h }));

/** The level colours as they are named: letters, foot bands, footprint rings. */
export const LEVEL = LEVEL_HUES.map((h, z) => oklchToHex({ l: 0.64 + 0.04 * z, c: 0.17, h }));
/** Deep glass: the darker squares of each level (and its window glass). */
export const GLASS_DEEP = ramp(0.56, 0.15);
/** Pale glass: the lighter squares, nearly clear with a breath of the level's hue. */
export const GLASS_PALE = ramp(0.86, 0.05);
/** Light caught on the lead between the panes. */
export const GLEAM = ramp(0.84, 0.11);

// --- Play ------------------------------------------------------------------------

/** Legal destinations: gilt. */
export const GILT = '#eabd52';
export const GILT_DEEP = '#8a5d16';
/** Captures and check: ruby glass. */
export const RUBY = '#ff4b3e';
export const RUBY_DEEP = '#7a0f12';
/** Candle ivory (the mate's motes). */
export const IVORY = '#f6e7c6';
/**
 * The last move: grisaille silver, the cool clear glass of a Gothic window,
 * so it can never be taken for the selection's warm sunlight.
 */
export const LAST_MOVE = '#d8def0';
/** The selection's shaft of sunlight. */
export const SUNLIGHT = '#ffdc9c';

// --- The nave --------------------------------------------------------------------

/**
 * The nave's old glass, dim and deep: wine, amber, cobalt, grisaille and
 * umber, as in a Gothic window, and never the level colours, which belong
 * to the tower alone (a glow in a level's colour seen through a platform
 * would read as part of it). Cobalt shares a hue with sapphire but not its
 * brightness or chroma, and it is only ever seen softened, far away.
 */
const WINDOW_HUES: [number, number, number][] = [
  [0.48, 0.14, 18],
  [0.66, 0.11, 72],
  [0.46, 0.14, 266],
  [0.72, 0.025, 85],
  [0.5, 0.08, 55],
];
export const WINDOW = WINDOW_HUES.map(([l, c, h]) => oklchToHex({ l, c, h }));
export const WINDOW_DEEP = WINDOW_HUES.map(([l, c, h]) => oklchToHex({ l: l - 0.1, c, h }));

/** The lead of the platforms' cames and rims. */
export const LEAD = '#141318';

// --- Armies ----------------------------------------------------------------------

/** Warm, milky alabaster. */
export const ALABASTER = '#eee4d2';
/** Dark ebony with a red-brown heart. */
export const EBONY = '#211612';
/** Gilt details on both armies. */
export const PIECE_GILT = '#c99a45';
/** Candlelight on the edges of a piece. */
export const CANDLE = '#ffb56b';

// --- HUD -------------------------------------------------------------------------

export const PARCHMENT = '#efe3c8';
export const HUD_GOLD = '#d8b063';
