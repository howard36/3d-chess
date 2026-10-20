// Where the game screen's HUD stands: the move history and the flag in a
// column beside the tower where the window has room for it, else the steps
// across the top (the top layout). "Room" is measured, not guessed: the move
// history beside the tower (240 px wide once the game is over, 12 px in from
// the window's right edge) stays at least SIDE_GAP px clear of the tower at
// its widest, its labels and all, from every elevation the view can turn to
// (the camera's fit, three/cameraFit.ts). The fit sizes the tower by the
// window's height, so the width that leaves that room grows with the height;
// two plain media queries, an aspect and a width, stand for it and never let
// a window in where the gap would be smaller (hudLayout.test.ts holds them to
// the fit). index.css spells the same queries out.

/** The narrowest window shape with room beside the tower (width / height). */
export const SIDE_ASPECT = 3 / 2;
/** The narrowest window, in CSS px, with room beside the tower. */
export const SIDE_WIDTH = 1200;
/** The least room, in CSS px, between the tower and the move history beside it. */
export const SIDE_GAP = 50;

/** A window with room beside the tower (and of some height: a short one has a layout of its own). */
export const ROOM_BESIDE = '(min-aspect-ratio: 3/2) and (min-width: 1200px)';

/** The top layout: a window of some height without room beside the tower. */
export const TOP_LAYOUT = `(min-height: 481px) and (not (${ROOM_BESIDE}))`;
