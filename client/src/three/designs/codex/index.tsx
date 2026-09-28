import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import { NeutralToneMapping } from 'three';
import { preloadPieceSet } from '../../pieces';
import { focusLevelOf } from '../kit/focus';
import { SmartLabels } from '../kit/smartLabels';
import type { Design, GridProps } from '../types';
import { CaptureFx, Celebration } from './fx';
import { Capture, Check, LastMove, Quiet, Selection } from './markers';
import { KNIGHT_YAW, layout, LEVEL_COLORS, LIFT, MOTION, PALETTE, PIECE_SCALE } from './palette';
import { PieceBody } from './pieces';
import { Panes } from './plates';
import { Stage } from './stage';

// Codex: an opening book written in light. The tower floats in the dark of
// a chess engine's mind, lines of opening theory drifting far off in dim
// phosphor type round it, a knight's tour tracing itself across a far-off
// board. The panes are phosphor glass, green, teal, cyan, azure and indigo
// from A to E, their lit squares glowing faintly in the level's colour
// between crisp hairlines; the armies are pale jade and near-black
// green-graphite. The markers are the notation cursor, a diamond: amber
// where a piece may go (its inside lit in the level's colour), red round a
// piece it may take, pale phosphor for the last move, and a red crown of
// light at a king in check. A picked-up piece is written in: a line of
// light draws round its base and a soft cone rises from it. See palette.ts
// for the value and hue plan, and each module's header.

preloadPieceSet();

/**
 * Panes and coordinates. Decorative only: Board draws this outside the
 * clickable group. The level the player points at (or has a piece picked up
 * on) brightens its lines, frame and letter; the others step back a little.
 */
const Grid = ({ layout: l, orientation, focus }: GridProps) => {
  const focusLevel = focusLevelOf(focus);
  return (
    <>
      <Panes focusLevel={focusLevel} />
      <SmartLabels
        layout={l}
        orientation={orientation}
        // Plex Mono: notation type, with a double-storey "a", a slashed-free
        // but open "0" never met here, and a "1" with a flag and foot
        font='"IBM Plex Mono", ui-monospace, monospace'
        weight={500}
        levelWeight={600}
        color={PALETTE.ink}
        levelColors={LEVEL_COLORS}
        outline="rgba(1, 5, 3, 0.9)"
        outlineWidth={0.08}
        shadow="rgba(110, 230, 180, 0.3)"
        size={0.33}
        levelScale={1.5}
        opacity={0.9}
        focusLevel={focusLevel}
        focusScale={1.3}
        focusDim={0.55}
      />
    </>
  );
};

// --- HUD ---------------------------------------------------------------------------------

// Black glass with thin green hairlines, and a hairline of the level spectrum
// along the top, like the rule under a page heading in an opening book
const SPECTRUM = `linear-gradient(90deg, ${LEVEL_COLORS.join(', ')})`;
const PANEL = 'linear-gradient(180deg, rgba(6, 16, 12, 0.86), rgba(2, 8, 6, 0.9))';
const HAIRLINE = '1px solid rgba(111, 227, 176, 0.18)';
// The result card's own caption, set like a line of the book (drawn as an
// image: the card is shared HUD)
const RESULT_LABEL = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="14">' +
    '<text x="0" y="11" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="10.5" ' +
    'letter-spacing="1.4" fill="rgba(160,226,196,0.62)">END OF THE LINE</text></svg>',
)}") 18px 14px / 200px 14px no-repeat`;

const codex: Design = {
  id: 'codex',
  name: 'Codex',
  blurb:
    'An opening book written in light: jade and graphite pieces on phosphor-glass panes, with lines of theory drifting in the dark.',
  layout,
  // The far book turns and breathes, very slowly
  continuous: true,
  canvas: { fov: 36, toneMapping: NeutralToneMapping, exposure: 1 },
  Stage,
  Grid,
  // No cell volumes: the marks on the panes say it all
  cellFills: { destination: null, lastMove: null },
  PieceBody,
  pieceScale: PIECE_SCALE,
  knightYaw: KNIGHT_YAW,
  markers: { Quiet, Capture, Selection, LastMove, Check },
  hoverDestinations: true,
  hoverLift: LIFT,
  motion: MOTION,
  CaptureFx,
  Celebration,
  toppleMatedKing: true,
  hud: {
    readout: true,
    vars: {
      '--hud-font': '"Space Grotesk", system-ui, sans-serif',
      '--hud-mono': '"IBM Plex Mono", ui-monospace, monospace',
      '--hud-bg': `${SPECTRUM} top / 100% 1px no-repeat, ${PANEL}`,
      '--hud-fg': PALETTE.ink,
      '--hud-muted': PALETTE.inkMuted,
      '--hud-accent': PALETTE.move,
      '--hud-accent-fg': '#1a1204',
      '--hud-border': HAIRLINE,
      '--hud-radius': '3px',
      '--hud-shadow': '0 12px 32px rgba(0, 0, 0, 0.5)',
      '--hud-blur': 'blur(8px)',
      '--hud-tracking': '0.01em',
      '--turn-bg': `${SPECTRUM} bottom / 100% 1px no-repeat, ${PANEL}`,
      '--turn-fg': '#effff7',
      '--turn-size': '18px',
      '--turn-border': '1px solid rgba(111, 227, 176, 0.24)',
      '--turn-shadow': '0 0 26px rgba(80, 220, 160, 0.1), 0 12px 32px rgba(0, 0, 0, 0.5)',
      '--modal-bg': `${SPECTRUM} top / 100% 2px no-repeat, linear-gradient(180deg, rgba(7, 18, 14, 0.97), rgba(2, 7, 5, 0.98))`,
      '--result-bg': `${RESULT_LABEL}, ${SPECTRUM} top / 100% 2px no-repeat, linear-gradient(180deg, rgba(7, 18, 14, 0.97), rgba(2, 7, 5, 0.98))`,
      '--modal-fg': PALETTE.ink,
      '--modal-backdrop': 'rgba(0, 3, 2, 0.55)',
      '--modal-radius': '4px',
      '--modal-shadow': '0 0 60px rgba(80, 220, 160, 0.12), 0 20px 50px rgba(0, 0, 0, 0.55)',
      '--button-bg': 'rgba(255, 196, 94, 0.14)',
      '--button-fg': '#fff1d6',
      '--button-border': '1px solid rgba(255, 196, 94, 0.7)',
      '--button-radius': '3px',
      '--page-bg': 'radial-gradient(ellipse at 50% 60%, #04110c 0%, #020805 60%, #010302 100%)',
      '--page-fg': PALETTE.ink,
    },
    // A still vignette: the void closes in at the corners of the screen
    overlay: {
      background:
        'radial-gradient(ellipse 80% 75% at 50% 50%, transparent 60%, rgba(0, 3, 2, 0.5) 100%)',
    },
  },
};

export default codex;
