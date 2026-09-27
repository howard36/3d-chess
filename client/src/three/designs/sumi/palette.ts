// Sumi's palette, planned by value before hue. The armies sit at the two ends
// of the value range (porcelain near white, lacquer near black), the paper
// world in the upper middle, and every gameplay marker in a saturated
// mineral pigment of mid value, each in its own hue family, none of them used
// by the armies, the platforms or the backdrop:
//
//   value   0 ── lacquer ─ ink ──── markers ─────── mountains ── paper ── porcelain ── 100
//
// Markers are Nihonga pigments: malachite for "can move", vermilion for
// "capture", azurite for "last move", gold leaf for the selection, and a
// deep crimson seal for check.

/** Sumi: the warm black of the outlines, labels and ink effects. */
export const INK = '#211c19';
/** A thinner ink, for washes. */
export const INK_WASH = '#3b3631';
/** Blue-black ink, for the bloom under a selected piece. */
export const BLUE_BLACK = '#1f2430';

/**
 * Each level's own ink, A (bottom) to E, warm earth to cool sky: sepia,
 * plum, plain sumi, teal and indigo. Neighbouring levels are the ones whose
 * rows interleave on screen, so each step turns the hue decisively rather
 * than creeping along one ramp. Low key by design; it tones the platform's brushed edge, the level letter and
 * the ring at each piece's foot, so a piece's level reads from its base even
 * where two levels' rows interleave on screen. None of these is a marker hue:
 * they are dark inks, the markers bright mineral pigments.
 */
export const LEVEL_INKS = ['#7a563a', '#62455a', '#474541', '#3e5a5f', '#404664'];

/** The paper world: backdrop from zenith to horizon to the mist below. */
export const PAPER = {
  top: '#efe9dd',
  horizon: '#e4dccb',
  bottom: '#e9e2d4',
};
/** Ink-wash mountains, far to near: cooler and paler with distance. */
export const MOUNTAIN_INKS = ['#7d8894', '#5f6a74', '#4b4f52'];

/** White army: glazed porcelain, a touch cooler than the paper around it. */
export const PORCELAIN = '#f7f6f2';
/** Black army: urushi lacquer, a warm black. */
export const LACQUER = '#15100d';
/** Gold leaf: the unicorn's horn on both sides, so it never reads as a bishop. */
export const GOLD_LEAF = '#b98322';

/** Legal destinations: malachite green. */
export const MOVE = '#0d6b44';
/** Captures: vermilion, the same ensō with a seal-red treatment. */
export const CAPTURE = '#d13a22';
/** The last move: azurite blue. */
export const LAST_MOVE = '#2352b0';
/** Its outline: a deep indigo that keeps the stroke crisp on paper. */
export const LAST_MOVE_EDGE = '#10275a';
/** The selected piece's ring: gold. */
export const SELECT = '#d49b22';
/** Check: a crimson seal. */
export const CHECK = '#b3122a';

/** HUD accent: the vermilion of a hanko seal. */
export const SEAL = '#b8322a';
