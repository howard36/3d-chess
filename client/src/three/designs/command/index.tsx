import '@fontsource/rajdhani/600.css';
import '@fontsource/rajdhani/700.css';
import '@fontsource/share-tech-mono/400.css';
import { NeutralToneMapping } from 'three';
import { focusLevelOf } from '../kit/focus';
import { SmartLabels } from '../kit/smartLabels';
import type { Design, GridProps } from '../types';
import { CaptureFx, Celebration, MoveFx } from './fx';
import { Capture, Check, LastMove, Quiet, Selection } from './markers';
import { PieceBody } from './pieces';
import { HoloPlates } from './plates';
import { KNIGHT_YAW, layout, LEVEL_COLORS, MOTION, PALETTE, PIECE_SCALE } from './shared';
import { Stage } from './stage';

// Command: a naval tactical hologram in a dark operations room. Precise,
// legible, cool. Ice and burnished-amber units stand on five sheets of glass,
// teal at A to ice blue at E, over a plotting floor; green brackets mark where
// a unit can go, red teeth mark a target, and the last move is drawn as a
// violet route.

// --- Board -------------------------------------------------------------------------

/**
 * Platforms and coordinates. Decorative only: Board draws this outside the
 * clickable group. The level the player points at (or has a piece picked up
 * on) brightens its frame and letter; the others dim a little.
 */
const Grid = ({ layout: l, orientation, focus }: GridProps) => {
  const focusLevel = focusLevelOf(focus);
  return (
    <>
      <HoloPlates focusLevel={focusLevel} />
      <SmartLabels
        layout={l}
        orientation={orientation}
        // A mono face: its double-storey "a" never reads as "o"
        font='"Share Tech Mono", ui-monospace, monospace'
        weight={400}
        color={PALETTE.ink}
        levelColors={LEVEL_COLORS}
        outline="rgba(1, 6, 14, 0.92)"
        outlineWidth={0.09}
        shadow="rgba(57, 208, 255, 0.45)"
        size={0.36}
        levelScale={1.45}
        opacity={0.94}
        focusLevel={focusLevel}
        focusScale={1.3}
        focusDim={0.55}
      />
    </>
  );
};

// --- HUD ---------------------------------------------------------------------------

/** Corner brackets drawn as CSS backgrounds, for the HUD's thin-line panels. */
const corners = (c: string, len = 10, w = 1.5) =>
  [
    ['top left', `${len}px ${w}px`],
    ['top left', `${w}px ${len}px`],
    ['top right', `${len}px ${w}px`],
    ['top right', `${w}px ${len}px`],
    ['bottom left', `${len}px ${w}px`],
    ['bottom left', `${w}px ${len}px`],
    ['bottom right', `${len}px ${w}px`],
    ['bottom right', `${w}px ${len}px`],
  ]
    .map(([at, size]) => `linear-gradient(${c}, ${c}) ${at} / ${size} no-repeat`)
    .join(', ');

const PANEL = 'linear-gradient(180deg, rgba(9, 22, 38, 0.84), rgba(4, 11, 21, 0.88))';
const BRACKET = 'rgba(127, 228, 255, 0.9)';

// --- Design ------------------------------------------------------------------------

const command: Design = {
  id: 'command',
  name: 'Command',
  blurb: 'A naval tactical hologram: ice and amber units on cyan glass over a dark plotting floor.',
  layout,
  continuous: false,
  canvas: { fov: 36, toneMapping: NeutralToneMapping, exposure: 1 },
  Stage,
  Grid,
  // No cell volumes: the brackets on the glass say it all
  cellFills: { destination: null, lastMove: null },
  PieceBody,
  pieceScale: PIECE_SCALE,
  knightYaw: KNIGHT_YAW,
  markers: { Quiet, Capture, Selection, LastMove, Check },
  hoverDestinations: true,
  hoverLift: true,
  motion: MOTION,
  MoveFx,
  CaptureFx,
  Celebration,
  toppleMatedKing: true,
  hud: {
    vars: {
      '--hud-font': '"Rajdhani", "Segoe UI", sans-serif',
      '--hud-mono': '"Share Tech Mono", ui-monospace, monospace',
      '--hud-bg': `${corners(BRACKET)}, ${PANEL}`,
      '--hud-fg': PALETTE.ink,
      '--hud-muted': 'rgba(150, 205, 230, 0.55)',
      '--hud-accent': PALETTE.cyan,
      '--hud-accent-fg': '#021019',
      '--hud-border': '1px solid rgba(110, 200, 240, 0.2)',
      '--hud-radius': '1px',
      '--hud-shadow': '0 10px 30px rgba(0, 0, 0, 0.4)',
      '--hud-blur': 'blur(6px)',
      '--hud-case': 'uppercase',
      '--hud-tracking': '0.12em',
      '--turn-bg': `${corners('rgba(223, 250, 255, 0.95)', 12, 2)}, ${PANEL}`,
      '--turn-fg': '#effaff',
      '--turn-size': '19px',
      '--turn-border': '1px solid rgba(127, 228, 255, 0.4)',
      '--turn-shadow': '0 0 24px rgba(57, 208, 255, 0.16), 0 10px 30px rgba(0, 0, 0, 0.4)',
      '--modal-bg': `${corners(BRACKET, 16, 2)}, linear-gradient(180deg, rgba(10, 26, 44, 0.97), rgba(3, 9, 18, 0.98))`,
      '--modal-fg': PALETTE.ink,
      '--modal-backdrop': 'rgba(1, 5, 11, 0.55)',
      '--modal-radius': '2px',
      '--modal-shadow': '0 0 60px rgba(57, 208, 255, 0.18)',
      '--button-bg': 'rgba(57, 208, 255, 0.14)',
      '--button-fg': '#e6fbff',
      '--button-border': '1px solid rgba(127, 228, 255, 0.75)',
      '--button-radius': '1px',
      '--page-bg': 'radial-gradient(ellipse at 50% 65%, #0d2136 0%, #040a14 60%, #010309 100%)',
      '--page-fg': PALETTE.ink,
    },
    // The cell under the pointer, e.g. "Cc4 · White Bishop"
    readout: true,
    // A still vignette: the room falls away at the corners of the screen
    overlay: {
      background:
        'radial-gradient(ellipse 75% 70% at 50% 52%, transparent 55%, rgba(0, 3, 8, 0.55) 100%)',
    },
  },
};

export default command;
