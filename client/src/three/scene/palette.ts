import { levelRamp } from './colors';
import { towerFrame, towerLayout } from '../layout';

// The scene: a light-art garden at night. The tower of five glass levels
// floats over an endless dark plain; far off, in a wide circle round it,
// colossal chess pieces stand drawn only in thin white neon tube, their
// light caught faintly in the glossy ground, under constellations of chess
// pieces. Porcelain and charcoal pieces stand on the glass. Everything the
// stage, levels, pieces, markers and effects share lives here; each
// module's header says what it draws.
//
// Value plan, darkest to brightest:
//   night (2–6%) < ground and its colossal board (a murmur of light, none of
//   it under the tower) < the neon sculptures (a dim white line with a soft
//   halo, never behind the tower) < the level veils (a frosted checker)
//   < the charcoal army (a dark matte body, ~12–35%, a dim cool rim)
//   < level hairlines and edges < the porcelain army (~80–92%, satin).
// Hue plan: the scene is white light on black; the five levels are the only
// colours, a spectral run from cyan to rose. Every marker is white light
// carrying its level's colour, but for capture and check, which are red
// (kept clear of the rose), and the last move, pure white.

export const PALETTE = {
  // The night, blue-black, a breath of mist at the horizon
  skyTop: '#010205',
  skyHorizon: '#0a0d15',
  skyBottom: '#030408',
  ground: '#030409',
  /** The neon of the sculptures and the colossal board: a cool white. */
  neon: '#e9efff',
  /** The mist at the sculptures' feet. */
  mist: '#7d8aa6',

  // The armies (pieces.tsx)
  porcelain: '#f0ede7',
  porcelainBase: '#d2cdc4',
  /** Porcelain's accent (the parts that name a piece): a warm grey. */
  porcelainAccent: '#a8a298',
  /** Charcoal: a lifted slate, clearly the dark army, light enough to model. */
  charcoal: '#4a4e58',
  charcoalBase: '#2a2c33',
  /** Charcoal's accent: a lighter satin pewter that catches the key. */
  charcoalAccent: '#7c8391',
  /** The floor of the rook's well, each army's own value (from above it is most of a rook). */
  porcelainWell: '#d6d1c8',
  charcoalWell: '#2c2f36',
  /** The charcoal army's rim and kicker: dim and cool, so it never reads as white. */
  charcoalRim: '#7f8ca3',
  /** The porcelain army's rim: a soft sheen, warmer than the level colours. */
  porcelainRim: '#fffaf2',
  /**
   * The held piece's light (selection.tsx): its column, motes, the circle
   * round its foot and the click's ring. A cool starlight white.
   */
  select: '#e6eeff',

  // Marks, one meaning each
  /** White light: the held piece's glow and cone, hover's halo. */
  light: '#f3f6ff',
  /**
   * Where a piece may go: a soft gold of its own, clear of every level
   * colour and of the white light, so a destination never reads as a level
   * ring (its level shows as the tint of its fill).
   */
  move: '#f8c970',
  /** The last move's line and circles: a pale mint, one hue step before level A. */
  trace: '#acefd1',
  /** A capture: a clear red. */
  capture: '#ff4a3d',
  /** Check: a deeper red, drawn in shapes of its own (crown, blades). */
  check: '#ff3338',

  // Type and HUD
  ink: '#eef1f7',
  inkMuted: 'rgba(214, 222, 236, 0.58)',
} as const;

/**
 * One colour per level, A (bottom) to E (top): cyan, azure, periwinkle,
 * orchid and rose, in equal perceptual steps of hue (about 0.09 apart in
 * OKLab) stepping a little darker as they rise. No white or grey, and the
 * rose sits well away from the coral of a capture and the red of check.
 * The level hairlines and edges, the level letters, the ring at each
 * piece's foot and the fill of every destination use it.
 */
export const LEVEL_COLORS = levelRamp({
  from: 200,
  to: 350,
  lightness: [0.8, 0.7],
  chroma: 0.14,
});

// A compact tower: the Staunton set at 0.8 leaves the king clear air
// under the level above.
export const PIECE_SCALE = 0.8;
/**
 * The camera may sink below the horizon to look up past the tower into the
 * sky (its constellations), to 14° below level, where the garden's
 * sculptures still stand whole in the bottom of the frame; the stage's
 * CameraFloor keeps it above the ground however far out it is zoomed.
 */
export const layout = towerLayout({ pieceHeight: 0.87 * PIECE_SCALE, minElevation: -14 });
export const FRAME = towerFrame(layout);

/** How far each level's glass reaches past its outer squares. */
export const MARGIN = 0.05;

/** The plain the tower floats over, well below level A. */
export const GROUND_Y = FRAME.levelY[0] - 3.4;

/** A calm, weighted glide. */
export const MOTION = { durationMs: 460 };
/** Knights turn this far off the rank line, to show their profile. */
export const KNIGHT_YAW = 0.5;

/**
 * Radius of the level ring at a piece's foot (piece units; ×PIECE_SCALE in
 * the world, 0.268). With the ring cue ('ring' or 'both', a setting) it is a
 * hairline in the level's own colour (LEVEL_COLORS, blended between two
 * levels while a piece glides), with a soft halo, brightening a little
 * toward white under the pointer. The held piece's circle (PALETTE.select)
 * lies at the same radius, in the ring's place, and its click ring spreads
 * from there to 1.62× (0.43 in the world). With the default band cue there
 * is no ring: the level shows as a thin band of its colour round the foot.
 */
export const RING_RADIUS = 0.335;

/** The level (engine z) of the platform nearest a floor height. */
export const levelAt = (y: number) =>
  FRAME.levelY.reduce(
    (best, ly, z) => (Math.abs(ly - y) < Math.abs(FRAME.levelY[best] - y) ? z : best),
    0,
  );
