// Kontur's palette, planned by value before hue:
//
// - Paper (the background) is a warm light tone, L* about 90.
// - The white army is brighter and cooler than the paper (L* 76-100) and is
//   always drawn with an ink contour, so it never melts into the page.
// - The black army is charcoal (L* 7-38), far below everything else.
// - The platforms are translucent filters in a cool sequence (green, teal,
//   steel, violet, magenta, A to E) that multiply what lies behind them, so a
//   piece seen through a stack keeps its contrast with its surroundings.
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

/** Saturated level colours, A (bottom) to E: platform edges and level letters. */
export const LEVEL_EDGE = ['#2e9a62', '#11919e', '#55739b', '#7550c6', '#b3418f'];
/** Pale level washes: what each platform's filter passes at full strength. */
export const LEVEL_WASH = ['#8fd0a8', '#86ccd3', '#b1c1d8', '#bca9ea', '#e6a7d1'];

/** The warm dark of shadows on paper. */
export const SHADOW = '#2b241c';
