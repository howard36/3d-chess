import { levelRamp } from '../kit/colors';
import { clarityTower, towerFrame } from '../kit/layouts';
import type { DesignMotion } from '../types';

// Lumina: Lumen's holographic studio after hours, now a chess studio. The
// board is a hard-light projection standing over a round projector table in
// a dark room; the pieces are solid "hard-light ceramic", matte and opaque.
// Everything the stage, panes, pieces, markers and effects share lives here.
//
// Value plan, darkest to brightest:
//   room (blue-black, 2–8%) < the studio's chess pieces in wire light and its
//   framed positions (dim, 10–20%, held down behind the tower)
//   < graphite army (a dark matte body, 15–35%, a dim cool edge that never
//   reads as light) < panes (a level-tinted veil whose light squares are
//   frosted with light, so the 5×5 checker always shows)
//   < light threads between squares < pearl army (~85%, a pale silver edge).
// Hue plan: the room, the panes and the level ramp are cool (teal round to
// orchid); every marker is kept off that arc. Gold says "you can go here"
// (moves, the selection's light), coral "taken", red "check", and a pale
// ice light traces the last move.

export const PALETTE = {
  // The studio, blue-black
  skyTop: '#020309',
  skyHorizon: '#060a15',
  skyBottom: '#03050b',
  floor: '#05080f',
  floorSeam: '#141c33',
  plinth: '#0a0e1a',
  // The projector table's light: a near-white steel, kept off the level
  // hues so a glow crossing a pane never reads as part of it
  projector: '#dfe4ee',
  projectorDeep: '#34405a',
  emitter: '#8a96ae',
  curtain: '#56627c',
  // The studio's hard light: the wire pieces and the framed positions
  holo: '#c6d3ea',
  lamp: '#f1dcc6',

  // The armies
  white: '#eaeef5',
  whiteBase: '#b3bccf',
  // Pearl's edge: a pale silver light
  whiteRim: '#f2f6ff',
  whiteAccent: '#28325a',
  whiteAccentGlow: '#18286a',
  // Graphite-violet: dark, with a dim cool edge (never a light one: a bright
  // rim is what made Lumen's dark army read as light)
  black: '#3a374c',
  blackBase: '#171522',
  blackRim: '#66718f',
  // The graphite army's inlays: a muted lilac, lit a little
  blackAccent: '#7e74aa',
  blackInlay: '#51468a',

  // Markers, one meaning each, all off the level ramp's arc
  move: '#ffc458',
  select: '#ffdc96',
  capture: '#ff6a4d',
  check: '#ff3b3b',
  trace: '#d6efff',

  // Type and HUD
  ink: '#e2e9f7',
  inkMuted: 'rgba(190, 204, 232, 0.6)',
} as const;

/**
 * One colour per level, A (bottom) to E (top): teal, azure, periwinkle,
 * violet, orchid. Equal steps of hue, a little darker as they rise, so
 * neighbours sit well apart (above 0.1 in OKLab); no white or grey, and clear
 * of the gold, coral, red and ice of the markers. The pane threads and
 * frames, the level letters, the hexagon at each piece's foot and the fill
 * of a destination all use it.
 */
export const LEVEL_COLORS = levelRamp({
  from: 176,
  to: 336,
  lightness: [0.83, 0.67],
  chroma: 0.16,
});

// The kit's compact tower: the Staunton set at 0.8 leaves the king clear air
// under the pane above.
export const PIECE_SCALE = 0.8;
export const layout = clarityTower({ pieceHeight: 0.87 * PIECE_SCALE, elevation: 19 });
export const FRAME = towerFrame(layout);

/** How far each pane reaches past its outer squares. */
export const MARGIN = 0.02;
/** Top of the projector table, below level A. */
export const TABLE_Y = FRAME.levelY[0] - 1.05;
/** Radius of the table's aperture ring (the light rises from inside it). */
export const APERTURE = 4.85;
/** Outer radius of the table's top. */
export const TABLE_RADIUS = 5.6;
/** The studio floor. */
export const FLOOR_Y = TABLE_Y - 1.15;

/**
 * The hexagon every piece stands in, and every mark shares: its inradius in
 * world units (flat sides toward the ranks). Wide enough to show round the
 * widest base (the king's, 0.21) from straight above.
 */
export const HEX = 0.272;

/** Piece lift (piece units): under the pointer, and picked up (only a little higher). */
export const LIFT = { hover: 0.08, selected: 0.13 };

/** A calm, precise glide. */
export const MOTION: DesignMotion = { style: 'slide', durationMs: 440 };
/** Knights turn this far off the rank line, to show their profile. */
export const KNIGHT_YAW = 0.55;

/** The level (0 = A) whose pane is at this height. */
export const levelAt = (y: number) => {
  let best = 0;
  FRAME.levelY.forEach((ly, z) => {
    if (Math.abs(ly - y) < Math.abs(FRAME.levelY[best] - y)) best = z;
  });
  return best;
};
