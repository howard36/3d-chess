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
 * few; rich adds worn lines, kintsugi cracks and a maker's mark.
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
