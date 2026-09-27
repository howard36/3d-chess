import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/space-grotesk/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import { NeutralToneMapping } from 'three';
import { preloadPieceSet } from '../../pieces';
import { focusLevelOf } from '../kit/focus';
import { SmartLabels } from '../kit/smartLabels';
import type { Design, GridProps } from '../types';
import { CaptureFx, Celebration, MoveFx } from './fx';
import { Capture, Check, LastMove, Quiet, Selection } from './markers';
import { KNIGHT_YAW, layout, LEVEL_COLORS, MOTION, PALETTE, PIECE_SCALE } from './palette';
import { PieceBody } from './pieces';
import { HoloPanes } from './plates';
import { Stage } from './stage';

// Lumen: a holographic design studio after hours. The board is a hard-light
// projection over a round projector table; the pieces are matte "hard-light
// ceramic", pearl and graphite-violet, each army edged in its own light. The
// five panes run teal, azure, periwinkle, violet and orchid from A to E, in
// their threads and frames, their letters, and the foot band and footprint
// of every piece standing on them. Gold light marks where a piece can go,
// coral where it can take, and a fine ice line traces the last move.
// See palette.ts for the value and hue plan, and each module's header.

preloadPieceSet();

/**
 * Panes and coordinates. Decorative only: Board draws this outside the
 * clickable group. The level the player points at (or has a piece picked up
 * on) brightens its threads, frame and letter; the others dim a little.
 */
const Grid = ({ layout: l, orientation, focus }: GridProps) => {
  const focusLevel = focusLevelOf(focus);
  return (
    <>
      <HoloPanes focusLevel={focusLevel} />
      <SmartLabels
        layout={l}
        orientation={orientation}
        // Space Grotesk's double-storey "a" never reads as "o"
        font='"Space Grotesk", system-ui, sans-serif'
        weight={500}
        levelWeight={700}
        color={PALETTE.ink}
        levelColors={LEVEL_COLORS}
        outline="rgba(3, 5, 12, 0.9)"
        outlineWidth={0.08}
        shadow="rgba(140, 200, 255, 0.35)"
        size={0.34}
        levelScale={1.5}
        opacity={0.92}
        focusLevel={focusLevel}
        focusScale={1.3}
        focusDim={0.55}
      />
    </>
  );
};

// --- HUD ---------------------------------------------------------------------------

// Thin-line glass panels with a hairline of the level spectrum along the top,
// like the chrome of a design tool
const SPECTRUM = `linear-gradient(90deg, ${LEVEL_COLORS.join(', ')})`;
// The result card's own chrome: a small mono caption in the corner, like a
// design tool's panel title (drawn as an image: the card is shared HUD)
const RESULT_LABEL = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="14">' +
    '<text x="0" y="11" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="10.5" ' +
    'letter-spacing="1.6" fill="rgba(190,204,232,0.62)">GAME RESULT</text></svg>',
)}") 18px 14px / 160px 14px no-repeat`;
const PANEL = 'linear-gradient(180deg, rgba(16, 20, 36, 0.84), rgba(8, 10, 20, 0.88))';

const lumen: Design = {
  id: 'lumen',
  name: 'Lumen',
  blurb:
    'A holographic studio after hours: pearl and graphite hard-light pieces on teal-to-orchid panes over a glowing projector table.',
  layout,
  continuous: false,
  canvas: { fov: 36, toneMapping: NeutralToneMapping, exposure: 1 },
  Stage,
  Grid,
  // No cell volumes: the light on the panes says it all
  cellFills: { destination: null, lastMove: null },
  PieceBody,
  pieceScale: PIECE_SCALE,
  knightYaw: KNIGHT_YAW,
  markers: { Quiet, Capture, Selection, LastMove, Check },
  hoverDestinations: true,
  // Hover stirs a piece; picked up, it rises a little into its scan shell and
  // holds still (the shell and the column say "picked up", so it barely lifts)
  hoverLift: { hover: 0.05, selected: 0.08 },
  motion: MOTION,
  MoveFx,
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
      '--hud-border': '1px solid rgba(150, 180, 255, 0.14)',
      '--hud-radius': '6px',
      '--hud-shadow': '0 12px 32px rgba(0, 0, 0, 0.45)',
      '--hud-blur': 'blur(8px)',
      '--hud-tracking': '0.02em',
      '--turn-bg': `${SPECTRUM} bottom / 100% 1px no-repeat, ${PANEL}`,
      '--turn-fg': '#f2f6ff',
      '--turn-size': '18px',
      '--turn-border': '1px solid rgba(150, 180, 255, 0.2)',
      '--turn-shadow': '0 0 28px rgba(120, 170, 255, 0.12), 0 12px 32px rgba(0, 0, 0, 0.45)',
      '--modal-bg': `${SPECTRUM} top / 100% 2px no-repeat, linear-gradient(180deg, rgba(18, 22, 40, 0.97), rgba(7, 9, 18, 0.98))`,
      '--result-bg': `${RESULT_LABEL}, ${SPECTRUM} top / 100% 2px no-repeat, linear-gradient(180deg, rgba(18, 22, 40, 0.97), rgba(7, 9, 18, 0.98))`,
      '--modal-fg': PALETTE.ink,
      '--modal-backdrop': 'rgba(2, 3, 8, 0.55)',
      '--modal-radius': '8px',
      '--modal-shadow': '0 0 60px rgba(120, 170, 255, 0.16), 0 20px 50px rgba(0, 0, 0, 0.5)',
      '--button-bg': 'rgba(255, 196, 88, 0.14)',
      '--button-fg': '#fff1d6',
      '--button-border': '1px solid rgba(255, 196, 88, 0.7)',
      '--button-radius': '4px',
      '--page-bg': 'radial-gradient(ellipse at 50% 70%, #0c1124 0%, #05070f 60%, #020309 100%)',
      '--page-fg': PALETTE.ink,
    },
    // A still vignette: the studio falls away at the corners of the screen
    overlay: {
      background:
        'radial-gradient(ellipse 80% 75% at 50% 50%, transparent 58%, rgba(1, 2, 6, 0.5) 100%)',
    },
  },
};

export default lumen;
