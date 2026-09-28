import { oklchToHex } from '../kit/colors';
import { clarityTower, towerFrame } from '../kit/layouts';
import type { DesignMotion } from '../types';

// Simul: a hall of light where a simultaneous exhibition plays on. The tower
// stands in the open middle of an endless, dark tournament hall; round it,
// rows of tables recede into the gloom, each with a small board drawn in warm
// light and a chess clock glowing beside it. Everything the stage, the
// platforms, the pieces, the markers and the effects share lives here.
//
// Value plan, darkest to brightest:
//   the hall (warm black, 1–4%) < its boards, clocks and strips (dim warm
//   light, 8–18%, and held down to nothing behind the tower)
//   < the platforms (a maple-and-walnut checker of translucent light,
//   ~10–14%, lines and border in the level's colour)
//   < the ebony army (deep brown, ~12–25%, a dim warm-grey rim)
//   < the markers (level-coloured light, red for captures and check)
//   < the ivory army (~80–88%, warm, softly lit).
// Hue plan: the hall and the checker are warm and nearly colourless; the five
// levels run amber, gold, lime, teal, azure; every marker keeps its own
// meaning: a destination wears its level's colour, a capture is a deep
// crimson and a check a hot red-orange (well apart, so a check never reads
// as a capture), the last move is warm white, the selection is lamp light.

export const PALETTE = {
  // The hall
  skyTop: '#040302',
  skyHorizon: '#0c0806',
  skyBottom: '#060403',
  // Board light in the hall: warm, dim
  hallLight: '#ffd9a8',
  // The overhead strips
  strip: '#ffe8c8',
  // The clocks' running face, and the stopped one
  clockOn: '#ffb866',
  clockOff: '#b89878',

  // The platform checker: maple and walnut, in light
  maple: '#f3e6cf',
  walnut: '#5a3b24',
  sheen: '#c9a57e',

  // The armies
  ivory: '#f1e7d4',
  ivoryBase: '#cdb898',
  ivoryRim: '#fff4e2',
  ivoryAccent: '#6e4a2c',
  ebony: '#2e2019',
  ebonyBase: '#170f0b',
  ebonyRim: '#8b7868',
  ebonyAccent: '#a0764c',

  // Markers, one meaning each
  lamp: '#ffe2b6',
  // A capture: deep crimson; a check: a hot red-orange, 0.14 apart in OKLab
  capture: '#c4263e',
  check: '#ff4a38',
  trace: '#f6e8cf',

  // Type and HUD
  ink: '#f1e8d8',
  inkMuted: 'rgba(233, 220, 198, 0.62)',
} as const;

/**
 * One colour per level, A (bottom) to E (top): amber, gold, lime, teal,
 * azure. Hand-placed in OKLCH rather than evenly spaced, so the two warm
 * neighbours (amber and gold) part by lightness as well as hue: every
 * neighbouring pair is at least 0.1 apart in OKLab, none is white or grey,
 * and all stay clear of the capture and check reds, the lamp light and the
 * warm white of the last move. The platform lines and border, the level
 * letters and the fill of a destination all use it.
 */
export const LEVEL_COLORS = (
  [
    [0.74, 0.145, 66],
    [0.84, 0.145, 90],
    [0.83, 0.16, 130],
    [0.79, 0.125, 188],
    [0.73, 0.135, 245],
  ] as const
).map(([l, c, h]) => oklchToHex({ l, c, h }));

// The kit's compact tower: the Staunton set at 0.8 leaves the king clear air
// under the platform above.
export const PIECE_SCALE = 0.8;
export const layout = clarityTower({ pieceHeight: 0.87 * PIECE_SCALE });
export const FRAME = towerFrame(layout);

/** How far each platform reaches past its outer squares, to its border. */
export const MARGIN = 0.035;

/** Held pieces rise only a little above a hovered one (piece units). */
export const LIFT = { hover: 0.08, selected: 0.13 } as const;

/** The hall's floor, well below the tower, and its tables' tops. */
export const FLOOR_Y = FRAME.levelY[0] - 4.6;
export const TABLE_Y = FLOOR_Y + 0.72;

/** A calm, even glide. */
export const MOTION: DesignMotion = { style: 'slide', durationMs: 460 };
/** Knights turn this far off the rank line, to show their profile. */
export const KNIGHT_YAW = 0.5;
