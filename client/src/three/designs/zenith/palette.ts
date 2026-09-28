import { levelRamp } from '../kit/colors';
import { clarityTower, towerFrame } from '../kit/layouts';
import type { DesignMotion } from '../types';

// Monolith: a light-art garden at night. The tower of five glass levels
// floats over an endless dark plain; far off, in a wide circle round it,
// colossal chess pieces stand drawn only in thin white neon tube, their
// light caught faintly in the glossy ground. Everything the stage, levels,
// pieces, markers and effects share lives here.
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

  // The armies
  porcelain: '#f0ede7',
  porcelainBase: '#d2cdc4',
  porcelainAccent: '#a8a298',
  charcoal: '#383b43',
  charcoalBase: '#1b1c20',
  charcoalAccent: '#555a64',
  /** The charcoal army's rim: dim and cool, so it never reads as white. */
  charcoalRim: '#7f8ca3',
  /** The porcelain army's rim: a soft sheen, warmer than the level colours. */
  porcelainRim: '#fffaf2',

  // Marks, one meaning each
  /** White light: the held piece's glow and cone, hover's halo. */
  light: '#f3f6ff',
  /** The last move's dashed line and rings. */
  trace: '#f5f7ff',
  capture: '#ff5646',
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

// The kit's compact tower: the Staunton set at 0.8 leaves the king clear air
// under the level above.
export const PIECE_SCALE = 0.8;
export const layout = clarityTower({ pieceHeight: 0.87 * PIECE_SCALE });
export const FRAME = towerFrame(layout);
export const PITCH = FRAME.pitch;

/** How far each level's glass reaches past its outer squares. */
export const MARGIN = 0.05;

/** The plain the tower floats over, well below level A. */
export const GROUND_Y = FRAME.levelY[0] - 3.4;

/** A calm, weighted glide. */
export const MOTION: DesignMotion = { style: 'slide', durationMs: 460 };
/** Knights turn this far off the rank line, to show their profile. */
export const KNIGHT_YAW = 0.5;

/** Radius of the level ring at a piece's foot (piece units). */
export const RING_RADIUS = 0.335;

/** The level (engine z) of the platform nearest a floor height. */
export const levelAt = (y: number) =>
  FRAME.levelY.reduce(
    (best, ly, z) => (Math.abs(ly - y) < Math.abs(FRAME.levelY[best] - y) ? z : best),
    0,
  );
