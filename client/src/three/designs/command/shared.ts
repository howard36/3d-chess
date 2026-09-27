import { clarityTower, towerFrame } from '../kit/layouts';
import type { DesignMotion } from '../types';

// Command: a naval tactical display in a dark operations room. Everything
// here is shared by the stage, the platforms, the pieces, the markers and
// the effects, so the palette and the tower's measurements live in one place.
//
// Value plan, darkest to brightest:
//   room (navy-black, 3–10%) < glass (a cyan veil, ~12% over the room)
//   < amber army (mid value, warm) < ice army (near white, cool).
// Marker hues are kept out of all four, one meaning each, borrowed from
// tactical and avionics symbology: green for a clear move, red for hostile
// (capture, check), magenta for the route just flown (the last move).

export const PALETTE = {
  // The room: navy to black, low-frequency and cool
  skyTop: '#010309',
  skyHorizon: '#0a1829',
  skyBottom: '#02060c',
  floorLine: '#2d86b3',
  floorGlow: '#0e4766',

  // Holographic glass
  glassLight: '#a8ecff',
  glassDark: '#3d93bd',
  glassEdge: '#7fe4ff',
  glassTick: '#7fe4ff',

  // The armies: ice against amber
  white: '#e6f0f6',
  whiteRim: '#62d8ff',
  whiteAccent: '#2c6f93',
  black: '#d56d1c',
  blackRim: '#ffb257',
  blackAccent: '#4c1f05',

  // Markers, one meaning each
  move: '#62ff9a',
  capture: '#ff4747',
  lastMove: '#ff5ad2',
  select: '#dffaff',
  check: '#ff3a3a',

  // Type and HUD
  ink: '#d3eefb',
  cyan: '#39d0ff',
} as const;

// The kit's compact tower, unchanged: the Staunton set at 0.8 leaves the king
// clear air under the platform above.
export const PIECE_SCALE = 0.8;
export const layout = clarityTower({ pieceHeight: 0.87 * PIECE_SCALE });
export const FRAME = towerFrame(layout);

/** How far each platform reaches past its outer squares, to the inside of its frame. */
export const MARGIN = 0.06;
/** Width of the frame's top face. */
export const EDGE_WIDTH = 0.03;
/** The floor of the ops room, well below the tower. */
export const ROOM_FLOOR_Y = FRAME.levelY[0] - 3.2;

/** A quick hop: lifted clear of the glass, set down precisely. */
export const MOTION: DesignMotion = { style: 'hop', durationMs: 400, lift: 0.32 };
/** Knights turn this far off the rank line, to show their profile. */
export const KNIGHT_YAW = 1.0;
