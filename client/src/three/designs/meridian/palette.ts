import { oklchToHex } from '../kit/colors';
import { clarityTower, towerFrame } from '../kit/layouts';
import type { DesignMotion } from '../types';

// Meridian: a chess observatory at night. The tower stands on an open terrace
// high above a sea of dark cloud, under a sky whose constellations are chess
// pieces, ringed far off by a brass meridian circle engraved with the board's
// notation. Everything the stage, platforms, pieces, markers and effects
// share lives here.
//
// Value plan, darkest to brightest:
//   cloud sea and sky (blue-black, 2–7%) < terrace (a shade above the cloud)
//   < constellations and the meridian ring (faint, low contrast, and held
//     down to nothing behind the tower)
//   < platforms (a smoked-glass veil with frosted light squares and hairlines
//     of the level's colour)
//   < obsidian army (dark blue-black, ~12–25%, a dim cool rim)
//   < markers (level-coloured discs, calm) < moonstone army (~85%, milky)
//   < the held piece's starlight.
// Hue plan: the night and the level ramp are cool, rose at the horizon up to
// ice at the zenith; every marker meaning sits off that arc: pale gold for the
// last move (the brass of the instruments), crimson for a capture, red for
// check, and near-white starlight for the held piece.

export const PALETTE = {
  // The night: zenith, the band of sky at the horizon, the cloud sea below
  skyTop: '#02040a',
  skyHorizon: '#0b1124',
  skyBottom: '#030409',
  cloud: '#070a14',
  cloudLit: '#0f1629',
  // The terrace under the tower
  terrace: '#070a12',
  // Brass of the instruments (the meridian ring, the terrace's inlays)
  brass: '#8a7448',
  brassLight: '#e9d49a',
  // Starlight: the constellations and the background stars
  star: '#cfdcf5',
  starWarm: '#f3e3c4',

  // The armies
  moonstone: '#e7ecf4',
  moonstoneBase: '#b7c2d4',
  // The blue sheen that floats on moonstone
  schiller: '#a9c6ff',
  moonstoneRim: '#f2f6ff',
  moonstoneAccent: '#46577a',
  obsidian: '#232a3c',
  obsidianBase: '#0f1320',
  obsidianRim: '#5f7196',
  obsidianAccent: '#5a6890',

  // Markers, one meaning each, all off the level ramp's arc
  select: '#e8f0ff',
  capture: '#ea3c57',
  captureMote: '#ffd9de',
  check: '#ff3b3b',
  trace: '#ecd08a',

  // Type and HUD
  ink: '#e4e9f4',
  inkMuted: 'rgba(196, 206, 228, 0.62)',
} as const;

/**
 * One colour per level, A (bottom) to E (top): starlight from the dusky rose
 * low on the horizon, through lavender, periwinkle and sky, up to the ice of
 * the zenith. Equal steps of hue, a little lighter and a little less vivid as
 * they rise (so the top deck's frame, seen against the night, is never the
 * brightest line on screen, and its ice stays ice rather than aqua), about
 * 0.07 apart in OKLab, no white or grey, and clear of the gold, crimson and
 * red of the markers. The platform lines and frames, the level letters, each
 * piece's base ring and every destination's disc use it.
 */
export const LEVEL_COLORS = [0, 1, 2, 3, 4].map((z) => {
  const k = z / 4;
  return oklchToHex({ l: 0.71 + 0.1 * k, c: 0.13 - 0.03 * k, h: 345 - 135 * k });
});

// The kit's compact tower: the Staunton set at 0.8 leaves the king clear air
// under the platform above.
export const PIECE_SCALE = 0.8;
export const layout = clarityTower({ pieceHeight: 0.87 * PIECE_SCALE });
export const FRAME = towerFrame(layout);

/** How far each platform reaches past its outer squares. */
export const MARGIN = 0.06;
/** The terrace floor, below level A. */
export const TERRACE_Y = FRAME.levelY[0] - 1.1;
/** Radius of the terrace. */
export const TERRACE_RADIUS = 5.6;

/**
 * The base ring round every piece's foot (piece units): just outside the
 * widest base in the set (0.27). The capture and last-move markers lay their
 * own ring exactly over it (world units = piece units × PIECE_SCALE), so a
 * marked piece shows one ring, retinted, never two.
 */
export const RING_RADIUS = 0.335;
export const RING_WIDTH = 0.018;
export const RING_WORLD = RING_RADIUS * PIECE_SCALE;

/** A calm, even glide. */
export const MOTION: DesignMotion = { style: 'slide', durationMs: 440 };
/** Knights turn this far off the rank line, to show their profile. */
export const KNIGHT_YAW = 0.5;

/** The level (engine z) whose platform is at world height `y`. */
export const levelAt = (y: number) =>
  FRAME.levelY.reduce(
    (best, ly, z) => (Math.abs(ly - y) < Math.abs(FRAME.levelY[best] - y) ? z : best),
    0,
  );
