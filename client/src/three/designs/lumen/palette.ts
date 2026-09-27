import { levelRamp } from '../kit/colors';
import { clarityTower, towerFrame } from '../kit/layouts';
import type { DesignMotion } from '../types';

// Lumen: a holographic design studio after hours. The board is a hard-light
// projection standing over a round projector table in a dark room; the
// pieces are solid "hard-light ceramic", matte and opaque, with a luminous
// edge. Everything the stage, platforms, pieces, markers and effects share
// lives here.
//
// Value plan, darkest to brightest:
//   room (blue-black, 2–8%) < panes (a level-tinted veil, edge-lit)
//   < graphite army (a dark matte body, ~20–35%, carried by a bright lilac rim)
//   < light threads of the grid < pearl army (~85%, a cool cyan rim).
// Hue plan: the room, the panes and the level ramp are cool (teal round to
// magenta); every marker is kept off that arc. Gold light says "you can go
// here" (moves, the selection), coral red says "taken" (captures, check),
// and a pale ice light traces the last move.

export const PALETTE = {
  // The studio, blue-black
  skyTop: '#020309',
  skyHorizon: '#070b17',
  skyBottom: '#03050b',
  floor: '#060912',
  floorSeam: '#1a2440',
  plinth: '#0b0f1c',
  plinthEdge: '#33456d',
  // The projector table's light: a near-white, kept off the level hues so a
  // glow crossing a pane never reads as part of it
  projector: '#e2e6ee',
  projectorDeep: '#3b4557',
  // The table's emitter ring: a dim steel, part of the projector, not a lamp
  emitter: '#8f9bb3',
  // The curtain of light rising from it: cooler and darker still
  curtain: '#5d6a84',
  // The warm pools under the studies' lamps: amber-white, far from the gold
  lamp: '#f3dcc4',
  holo: '#c9d2e0',

  // The armies
  white: '#e9edf4',
  whiteBase: '#b4bdd0',
  // Each army's edge light: silver-ice and cool silver, nearly colourless,
  // so it reads as light and never as a level's colour
  whiteRim: '#e4ecfa',
  whiteAccent: '#2a3558',
  whiteAccentGlow: '#1a2f6a',
  black: '#383548',
  blackBase: '#15121e',
  blackRim: '#cfc9e2',
  // The glow of the graphite army's inlays: a small, soft lilac
  blackInlay: '#c5acff',
  blackAccent: '#d9ccff',

  // Markers, one meaning each, all off the level ramp's arc
  move: '#ffc458',
  select: '#ffd98a',
  capture: '#ff5a4c',
  check: '#ff3d3d',
  trace: '#d3efff',

  // Type and HUD
  ink: '#e2e9f7',
  inkMuted: 'rgba(190, 204, 232, 0.6)',
} as const;

/**
 * One colour per level, A (bottom) to E (top): teal, azure, periwinkle,
 * violet, orchid. Equal perceptual steps of hue, stepping a little darker as
 * they rise so neighbours sit well apart (about 0.1 in OKLab), no white or
 * grey, and clear of the gold, red and ice of the markers. The pane threads
 * and edges, the level letters, each piece's foot band and its footprint on
 * the pane all use it.
 */
export const LEVEL_COLORS = levelRamp({
  from: 184,
  to: 338,
  lightness: [0.81, 0.69],
  chroma: 0.15,
});

// The kit's compact tower: the Staunton set at 0.8 leaves the king clear air
// under the pane above.
export const PIECE_SCALE = 0.8;
export const layout = clarityTower({ pieceHeight: 0.87 * PIECE_SCALE, elevation: 19 });
export const FRAME = towerFrame(layout);

/** How far each pane reaches past its outer squares. */
export const MARGIN = 0.07;
/** Top of the projector table, below level A. */
export const TABLE_Y = FRAME.levelY[0] - 1.05;
/** Radius of the table's aperture ring (the light rises from inside it). */
export const APERTURE = 4.85;
/** Outer radius of the table's top. */
export const TABLE_RADIUS = 5.4;
/** The studio floor. */
export const FLOOR_Y = TABLE_Y - 1.15;

/** A calm, precise glide. */
export const MOTION: DesignMotion = { style: 'slide', durationMs: 440 };
/** Knights turn this far off the rank line, to show their profile. */
export const KNIGHT_YAW = 0.55;
