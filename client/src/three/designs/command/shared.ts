import { clarityTower, towerFrame } from '../kit/layouts';
import type { DesignMotion } from '../types';

// Command: a naval tactical display in a dark operations room. Everything
// here is shared by the stage, the platforms, the pieces, the markers and
// the effects, so the palette and the tower's measurements live in one place.
//
// Value plan, darkest to brightest:
//   room (navy-black, 3–10%) < glass (a cyan veil, ~10% over the room)
//   < amber army (burnished, mid value, warm) < ice army (near white, cool).
// Marker hues are kept out of all four, one meaning each, borrowed from
// tactical and avionics symbology: green for a clear move, red for hostile
// (capture, check), violet for the route just flown (the last move).
// Levels are told apart by a quiet ramp inside the glass's own family, teal
// at A to ice blue at E, on the plate edges, the level letters and a thin
// ring at every piece's base.

export const PALETTE = {
  // The room: navy to black, low-frequency and cool
  skyTop: '#010309',
  skyHorizon: '#0a1829',
  skyBottom: '#02060c',
  floorLine: '#2d86b3',
  floorGlow: '#0e4766',

  // Holographic glass
  glassLight: '#9fe6ff',
  glassDark: '#5aa6cf',
  glassTick: '#8fdcf5',

  // The armies: ice against burnished amber
  white: '#e8f1f7',
  whiteCore: '#98b2c4',
  whiteRim: '#62d8ff',
  whiteAccent: '#2c6f93',
  whiteInCheck: '#eb9aa4',
  black: '#d9902e',
  blackCore: '#7a3c0e',
  blackRim: '#ffc56b',
  blackAccent: '#4a1d04',
  blackInCheck: '#b3121f',

  // Markers, one meaning each
  move: '#62ff9a',
  capture: '#ff4747',
  lastMove: '#bf74ff',
  // The fronts of the last move's dashes: a pale glint of the same violet
  lastMoveGlint: '#f3e6ff',
  select: '#dffaff',
  check: '#ff3a3a',
  // The dark stroke under every marker, so it holds on bright glass and frames
  underlay: '#020a16',

  // Type and HUD
  ink: '#d3eefb',
  cyan: '#39d0ff',
} as const;

/**
 * One colour per level, A (bottom) to E: teal to ice blue, inside the glass's
 * own family and clear of every marker hue. The plate edges, the level
 * letters and the ring at each piece's base all use it.
 */
export const LEVEL_COLORS = ['#26cbb4', '#3cbfe8', '#4f9dff', '#7d9bff', '#c4dcff'];

// The kit's compact tower, unchanged: the Staunton set at 0.8 leaves the king
// clear air under the platform above.
export const PIECE_SCALE = 0.8;
export const layout = clarityTower({ pieceHeight: 0.87 * PIECE_SCALE });
export const FRAME = towerFrame(layout);

/** How far each platform reaches past its outer squares, to the inside of its frame. */
export const MARGIN = 0.06;
/** Width of the frame's top face. */
export const EDGE_WIDTH = 0.022;
/** The floor of the ops room, well below the tower. */
export const ROOM_FLOOR_Y = FRAME.levelY[0] - 3.2;

/** A quick, precise glide from square to square. */
export const MOTION: DesignMotion = { style: 'hop', durationMs: 400 };
/** Knights turn this far off the rank line, to show their profile. */
export const KNIGHT_YAW = 1.0;
