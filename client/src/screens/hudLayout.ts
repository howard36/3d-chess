// Where the game screen's HUD stands: the move history and the flag in a
// column beside the tower where the window has room for it, else the steps
// across the top (the top layout). "Room" is measured, not guessed: the move
// history beside the tower (240 px wide once the game is over, 12 px in from
// the window's right edge) stays at least SIDE_GAP px clear of the tower at
// its widest, its labels and all, from every elevation the view can turn to
// (the camera's fit, three/cameraFit.ts). The fit sizes the tower by the
// window's height, so the width that leaves that room grows with the height;
// plain media queries, pairs of an aspect and a width, stand for it and never
// let a window in where the gap would be smaller (hudLayout.test.ts holds
// them to the fit). index.css spells the same queries out.

/**
 * The windows with room beside the tower, as pairs of the narrowest shape
 * (width / height) and the narrowest width, CSS px, any one of which lets a
 * window in: the tower grows with the window's height, so a squarer window
 * has room only once it is wide enough.
 */
export const SIDE_ROOM: readonly (readonly [aspect: number, width: number])[] = [
  [3 / 2, 1200],
  [4 / 3, 1460],
];
/** The least room, in CSS px, between the tower and the move history beside it. */
export const SIDE_GAP = 50;

/** A window with room beside the tower (and of some height: a short one has a layout of its own). */
export const ROOM_BESIDE =
  '((min-aspect-ratio: 3/2) and (min-width: 1200px)) or ((min-aspect-ratio: 4/3) and (min-width: 1460px))';

/** The top layout: a window of some height without room beside the tower. */
export const TOP_LAYOUT = `(min-height: 481px) and (not (${ROOM_BESIDE}))`;
