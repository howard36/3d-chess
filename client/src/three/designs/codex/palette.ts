import { levelRamp } from '../kit/colors';
import { clarityTower, towerFrame } from '../kit/layouts';
import type { DesignMotion } from '../types';

// Codex: an opening book written in light. The tower floats in the dark of a
// chess engine's mind, a black-green void where lines of opening theory
// drift far off in dim phosphor type. Everything the stage, panes, pieces,
// markers and effects share lives here.
//
// Value plan, darkest to brightest:
//   void (black-green, 1–4%) < the far notation (a murmur, 6–12%)
//   < panes (a level-tinted veil; lit squares a little brighter than dark)
//   < graphite army (dark green-graphite, ~15–30%, a dim cool rim)
//   < the panes' hairlines and frames < jade army (~85%) < markers.
// Hue plan: the world and the level ramp are cool (green round to indigo).
// Every marker is warm or pale, off that arc: amber phosphor says "you can go
// here" (the cursor) and "held" (the selection), red says "taken" and
// "check", and a pale phosphor white traces the last move. Two phosphors, as
// on old terminals: the book is written in green, the player's cursor in amber.

export const PALETTE = {
  // The void
  skyTop: '#010302',
  skyHorizon: '#04110c',
  skyBottom: '#010403',
  // A still glow of green light low round the horizon
  skyGlow: '#051a13',
  // The far notation and the opening tree's branches (before their dimming)
  script: '#6fe3b0',
  branch: '#3fae86',
  // The knight's tour on its far-off board
  tourGrid: '#2c7f68',
  tourPath: '#a8f5d2',

  // The armies: pale jade glass, satin; green-graphite, near black
  white: '#e6f0ea',
  whiteBase: '#b2c4ba',
  whiteRim: '#f2fff8',
  whiteInk: '#1d4a3d',
  black: '#28322e',
  blackBase: '#101815',
  // A faint, cool green edge: enough to show the form, never a halo
  blackRim: '#5f8f80',
  blackInk: '#9cc8b6',
  // Hover and selection warm a piece's edge toward the cursor's amber
  warm: '#ffd38a',

  // Markers, one meaning each, all off the level ramp's arc
  move: '#ffc45e',
  select: '#ffe2a6',
  // The capture a true red, well off the amber moves; the check a pink
  // crimson, told apart from the capture from above too (and by its points)
  capture: '#ff4a3c',
  check: '#ff2a7a',
  trace: '#d6fbe9',

  // Type and HUD
  ink: '#dcefe6',
  inkMuted: 'rgba(188, 222, 206, 0.6)',
} as const;

/**
 * One colour per level, A (bottom) to E (top): green, teal, cyan, azure,
 * indigo. Equal perceptual steps of hue at one vividness, stepping a little
 * darker as they rise, so neighbours sit at least 0.1 apart in OKLab, with
 * no white or grey among them and clear of the amber, reds and pale trace of
 * the markers. The pane hairlines and frames, the level letters and the
 * level cue inside every destination marker all use it.
 */
export const LEVEL_COLORS = levelRamp({
  from: 140,
  to: 290,
  lightness: [0.85, 0.65],
  chroma: 0.16,
});

// The kit's compact tower: the Staunton set at 0.8 leaves the king clear air
// under the pane above.
export const PIECE_SCALE = 0.8;
export const layout = clarityTower({ pieceHeight: 0.87 * PIECE_SCALE, elevation: 18 });
export const FRAME = towerFrame(layout);

/** How far each pane reaches past its outer squares, to its frame. */
export const MARGIN = 0.06;

/** Hover and selection heights (piece units): selected only a little above hover. */
export const LIFT = { hover: 0.08, selected: 0.13 };

/** A calm, precise glide. */
export const MOTION: DesignMotion = { style: 'slide', durationMs: 420 };
/** Knights turn this far off the rank line, to show their profile. */
export const KNIGHT_YAW = 0.5;

/** The level (0 = A) whose pane is at this height. */
export const levelAt = (y: number) => {
  let best = 0;
  FRAME.levelY.forEach((ly, z) => {
    if (Math.abs(ly - y) < Math.abs(FRAME.levelY[best] - y)) best = z;
  });
  return best;
};
