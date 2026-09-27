// Kontur's palette, planned by value before hue:
//
// - Paper (the background) is a warm light tone, L* about 90.
// - The white army is brighter and cooler than the paper (L* 76-100) and is
//   always drawn with an ink contour, so it never melts into the page.
// - The black army is charcoal (L* 7-38), far below everything else.
// - The platforms are faint translucent filters (green, teal, azure, violet,
//   rose, A to E) that multiply what lies behind them, so a piece seen
//   through a stack keeps its contrast with its surroundings; the level's
//   colour at full strength is on the sheet's edge, its badge and the feet
//   of the pieces standing on it.
// - The three Bauhaus primaries are reserved for information and appear
//   nowhere else: cobalt for where the selected piece can go, vermilion for
//   captures and check, signal yellow (edged in ink) for the last move.

export const INK = '#17171c';
export const PAPER = '#ece5d6';
/** The paper's lit highlight, for HUD panels. */
export const PAPER_LIGHT = '#f6f2e9';

export const SKY = {
  /** Above the horizon. */
  top: '#f1ece1',
  horizon: '#ece5d6',
  /** Straight down, where the low camera mostly looks. */
  bottom: '#ddd4c2',
};

/** Three flat tones per army, lit to shade. */
export const ARMY = {
  white: { lit: '#ffffff', mid: '#ebeae6', shade: '#aab1bf' },
  black: { lit: '#6b717e', mid: '#343843', shade: '#15161a' },
} as const;
/** The black army's pale keyline. */
export const KEYLINE = '#bdb5a5';

// Information colours
export const COBALT = '#1d4fd8';
export const VERMILION = '#e5391f';
export const SIGNAL = '#ffc414';

// The level ramp: five hues evenly spaced round the OKLCH wheel (150°, 198°,
// 246°, 294°, 342°: green, teal, azure, violet, rose) at one lightness and
// one chroma, so no level is louder or duller than another. It sits apart
// from the information hues (cobalt 264° is darker and twice as saturated,
// vermilion 32°, yellow 86°), and is carried at full strength by the sheets'
// cut edges, the level badges and the pieces' feet; the sheets' fill is a
// faint wash of it.

/** Level colours, A (bottom) to E: sheet edges, level badges. OKLCH L 0.61, C 0.102. */
export const LEVEL_EDGE = ['#539462', '#0c9599', '#4b89bd', '#8777ba', '#ad6a94'];
/** Pale level washes: what each sheet's filter passes at full strength. OKLCH L 0.9, C 0.045. */
export const LEVEL_WASH = ['#cae7cf', '#bce8e9', '#c6e2fb', '#dfd9fa', '#f4d3e6'];
/** The pieces' feet, three flat tones per level (OKLCH L 0.75 / 0.61 / 0.45). */
export const LEVEL_FOOT = [
  { lit: '#8fbb97', mid: '#539462', shade: '#31623d' },
  { lit: '#77bcbe', mid: '#0c9599', shade: '#006265' },
  { lit: '#8ab3d8', mid: '#4b89bd', shade: '#2c597f' },
  { lit: '#b0a6d7', mid: '#8777ba', shade: '#584c7d' },
  { lit: '#ce9dba', mid: '#ad6a94', shade: '#734362' },
];

/** The warm dark of shadows on paper. */
export const SHADOW = '#2b241c';
