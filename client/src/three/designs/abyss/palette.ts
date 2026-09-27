import { oklchToHex } from '../kit/colors';

// Abyss: the colours of a deep-sea research station. Values, darkest to
// brightest: the water outside (a teal-black that never quite reaches black),
// the pressure-glass decks (barely there), the obsidian army (smoky glass,
// held off the water by a cool rim), the level seams (the sea gradient,
// glowing), the nacre army, and the marks of play (bioluminescence, the
// brightest things in the room).

/**
 * The five levels, A (bottom) to E: a sea gradient from deep blue through
 * cyan and sea-green to chartreuse and gold, in even steps of hue (OKLCH)
 * and growing lighter as it rises. The deep end is set darker than an even
 * ramp would, so A and B, whose pieces sit nearest each other on screen,
 * differ most.
 */
export const LEVELS = (
  [
    [262, 0.6, 0.17],
    [214, 0.71, 0.14],
    [168, 0.77, 0.15],
    [122, 0.82, 0.17],
    [84, 0.83, 0.16],
  ] as const
).map(([h, l, c]) => oklchToHex({ l, c, h }));

/** The water, from the faint light far above to the dark below. */
export const WATER = {
  above: '#0f3a44',
  horizon: '#0a2630',
  below: '#041319',
  deep: '#010608',
};

/** Pale plankton light: legal moves and the selection. */
export const PLANKTON = '#dcfbff';
/** A comb jelly's violet: the last move. */
export const LAST_MOVE = '#b99cff';
/** An anglerfish's lure: a capture. */
export const LURE = '#ff5a3c';
/** Check: a red pulse from the king. */
export const CHECK = '#ff3f52';

/** Text and labels: a pale sea-foam white. */
export const INK = '#d8f3f1';
/** The HUD's accent: a soft instrument green. */
export const SIGNAL = '#6ff2c4';

/** Mother-of-pearl, inlaid with dark paua shell. */
export const NACRE = '#efe7de';
export const PAUA = '#40616b';
/** Volcanic glass, inlaid with pearl. */
export const OBSIDIAN = '#272c37';
export const PEARL = '#c3cacd';
/** The cool light that rims every piece, so the dark army keeps its shape against the water. */
export const RIM = '#8cc4d4';

/** Station hardware: the titanium of the deck bezels and the dome ribs. */
export const TITANIUM = '#2a343b';
