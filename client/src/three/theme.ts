// Shared visual theme for the 3D board and pieces.
//
// The scene background is a medium-lightness slate so that both ivory and
// graphite pieces stay readable against it. It is desaturated but cool-hued
// (not pure gray), which sets off the warm ivory pieces; accents are saturated
// so they pop against the muted backdrop.
export const theme = {
  // Scene
  background: '#7e8ea1',
  gridLine: '#3d4757',
  gridLineOpacity: 0.4,

  // Pieces — never pure white/black: pure white blows out under lighting and
  // pure black merges with its own shadows.
  whitePiece: '#f2ead8',
  blackPiece: '#413b35',

  // Interaction accents
  select: '#ffc247', // ring under the selected piece
  selectEmissive: '#6b4a00', // subtle glow on the selected piece itself
  quietMove: '#ffb020', // dot marking an empty destination cell
  capture: '#ff5d5d', // ring marking a capturable piece
  highlightFill: '#ffb020', // faint fill of destination cells
  check: '#ff2222', // king-in-check glow

  // Last-move trace — teal, hue-opposed to both the slate background and the
  // amber interaction accents, so it can't be confused with a legal move.
  lastMoveFill: '#2dd4bf', // fill of the last move's from/to cells
  lastMoveToOpacity: 0.15, // destination cell (stronger)
  lastMoveFromOpacity: 0.07, // source cell (fainter)
} as const;
