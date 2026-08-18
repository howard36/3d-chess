// Shared visual theme for the 3D board and pieces.
//
// The scene background is a light, lightly-saturated cool gray ("glacier") so
// that the saturated accents — the teal last-move trace above all — read
// against it while both ivory and graphite pieces stay legible. The depth fog
// follows it automatically.
export const theme = {
  // Scene
  background: '#c2cbd8',
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
  highlightFill: '#ffb020', // fill of destination cells
  highlightFillOpacity: 0.2,
  check: '#ff2222', // king-in-check glow

  // Last-move trace — teal, hue-opposed to both the cool background and the
  // amber interaction accents, so it can't be confused with a legal move.
  lastMoveFill: '#14b8a6', // fill of the last move's from/to cells
  lastMoveToOpacity: 0.3, // destination cell (stronger)
  lastMoveFromOpacity: 0.15, // source cell (fainter)
} as const;
