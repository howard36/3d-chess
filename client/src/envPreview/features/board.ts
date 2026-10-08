// ENV PREVIEW (temporary): area B, the colossal board and its twelve neon
// sculptures (three/scene/stage.tsx, boardDetail.tsx, boardNeon.ts).
import { defineEnvFeature } from '../registry';

const GROUP = 'Colossal board';

/**
 * The sculpture right behind the tower (the queen at White's opening, the
 * king at Black's) fades as a whole as the tower's shade takes it, so its
 * crown no longer stands up among Black's back rank over level E.
 */
export const sculptureFix = defineEnvFeature({
  id: 'sculptureFix',
  label: 'Hide the one behind the tower',
  group: GROUP,
  order: 0,
  options: [
    { id: 'off', label: 'Off' },
    { id: 'on', label: 'On' },
  ],
  default: 'on',
});

/**
 * How the sculptures' tubes are drawn. Clean: every stroke one even tube,
 * round at its bends and ends (no spurs where it turns sharply), its rings
 * meeting its outline at the edge, nothing broken or left dark; and what is
 * not the same from every side fixed in the world: the knights outlined by
 * their silhouette from wherever the camera stands, the bishop's cut and the
 * unicorn's spiral on the body, so nothing flips as the view turns. Off is
 * today's ribbons, the knights turned to face each other.
 */
export const sculptureLines = defineEnvFeature({
  id: 'sculptureLines',
  label: 'Lines',
  group: GROUP,
  order: -1,
  options: [
    { id: 'off', label: 'Off' },
    { id: 'clean', label: 'Clean' },
  ],
  default: 'clean',
});

/** A real board's frame: a double rule, a lozenge inlay, corner rosettes and bright electrodes. */
export const boardFrame = defineEnvFeature({
  id: 'boardFrame',
  label: 'Frame',
  group: GROUP,
  order: 1,
  options: [
    { id: 'off', label: 'Off' },
    { id: 'on', label: 'On' },
  ],
  default: 'on',
});

/**
 * The squares: subtle gives the dark squares a deeper polish and inlays a
 * few; rich adds kintsugi cracks and a maker's mark (every line whole).
 */
export const boardSquares = defineEnvFeature({
  id: 'boardSquares',
  label: 'Squares',
  group: GROUP,
  order: 2,
  options: [
    { id: 'off', label: 'Off' },
    { id: 'subtle', label: 'Subtle' },
    { id: 'rich', label: 'Rich' },
  ],
  default: 'subtle',
});

/**
 * The sculptures: inner adds a second, quieter tube inside each outline and
 * more rings; full adds their footprints, their light pooling on the board,
 * the rings of pawns gone from ranks 2 and 7 and a few things to find.
 */
export const sculptureDetail = defineEnvFeature({
  id: 'sculptureDetail',
  label: 'Sculptures',
  group: GROUP,
  order: 3,
  options: [
    { id: 'off', label: 'Off' },
    { id: 'inner', label: 'Inner' },
    { id: 'full', label: 'Full' },
  ],
  default: 'full',
});

/**
 * The light under each sculpture. Off is the upright breath of mist at its
 * foot and its pool lifting the board's lines. Soft: a wide, even glow lying
 * on the ground, round in the world, a little brighter just past the base
 * ring and fading out over about a base's width and a half, the board's
 * lines caught in it. Grounded: the same, dimmer under the base.
 */
export const sculptureGlow = defineEnvFeature({
  id: 'sculptureGlow',
  label: 'Light underneath',
  group: GROUP,
  order: 5,
  options: [
    { id: 'off', label: 'Off' },
    { id: 'soft', label: 'Soft' },
    { id: 'grounded', label: 'Grounded' },
  ],
  default: 'soft',
});

/**
 * A sculpture (or fallen piece) the camera has passed and stands behind,
 * zoomed far out, is not drawn: it goes, and comes back, only while it is
 * out of frame, so it never pops.
 */
export const sculptureNearFade = defineEnvFeature({
  id: 'sculptureNearFade',
  label: 'Hide from behind',
  group: GROUP,
  order: 6,
  options: [
    { id: 'off', label: 'Off' },
    { id: 'on', label: 'On' },
  ],
  default: 'on',
});

/**
 * The footprints and the pawns' rings drawn as clearly on a light square as
 * on a dark one (the same light shows far more on dark stone).
 */
export const sculptureEven = defineEnvFeature({
  id: 'sculptureEven',
  label: 'Even on light and dark',
  group: GROUP,
  order: 7,
  options: [
    { id: 'off', label: 'Off' },
    { id: 'on', label: 'On' },
  ],
  default: 'on',
});

/** Captured giants lying on their sides past the board's edge, parts of their tubes dead. */
export const fallenPieces = defineEnvFeature({
  id: 'fallenPieces',
  label: 'Fallen pieces',
  group: GROUP,
  order: 4,
  options: [
    { id: 'off', label: 'Off' },
    { id: 'on', label: 'On' },
  ],
  default: 'on',
});
