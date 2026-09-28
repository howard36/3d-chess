import '@fontsource/jost/latin-400.css';
import '@fontsource/jost/latin-500.css';
import '@fontsource/jost/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import { useEffect, useState } from 'react';
import { NeutralToneMapping } from 'three';
import { preloadPieceSet } from '../../pieces';
import { focusLevelOf } from '../kit/focus';
import { SmartLabels } from '../kit/smartLabels';
import type { Design, GridProps } from '../types';
import { figuresReady, NOTATION_FONT } from './fonts';
import { CaptureFx, Celebration } from './fx';
import { Capture, Check, LastMove, Quiet, Selection } from './markers';
import { KNIGHT_YAW, layout, LEVEL_COLORS, MOTION, PALETTE, PIECE_SCALE } from './palette';
import { PieceBody } from './pieces';
import { Decks } from './plates';
import { Stage } from './stage';

// Meridian: a chess observatory at night. The tower of five smoked-glass decks
// stands on a dark terrace high above a sea of cloud, under a sky whose
// constellations are chess pieces, ringed far off by a brass meridian circle
// engraved with the board's notation. The armies are moonstone and obsidian;
// the decks run from dusky rose (A, low on the horizon) to the ice of the
// zenith (E), in their lines and frames, their letters, the ring at every
// piece's foot and every destination's disc. Pale gold, the brass of the
// instruments, traces the last move; crimson marks a capture, red a check,
// and a column of starlight rises round the piece in hand.
// See palette.ts for the value and hue plan, and each module's header.

preloadPieceSet();

/**
 * Decks and coordinates. Decorative only: Board draws this outside the
 * clickable group. The level the player points at (or has a piece picked up
 * on) brightens its lines, frame and letter; the others dim a little.
 */
const Grid = ({ layout: l, orientation, focus }: GridProps) => {
  const focusLevel = focusLevelOf(focus);
  // The labels are drawn once, so they wait for the notation's figures
  const [figures, setFigures] = useState(false);
  useEffect(() => {
    let live = true;
    figuresReady().then(() => live && setFigures(true));
    return () => {
      live = false;
    };
  }, []);
  return (
    <>
      <Decks focusLevel={focusLevel} />
      {figures && (
        <SmartLabels
          layout={l}
          orientation={orientation}
          // An engraver's notation: Cormorant's double-storey "a" and round "D"
          // with lining figures (a flagged "1"), never read as "o", "O" or "l"
          font={NOTATION_FONT}
          weight={700}
          levelWeight={700}
          color={PALETTE.ink}
          levelColors={LEVEL_COLORS}
          outline="rgba(3, 5, 12, 0.9)"
          outlineWidth={0.07}
          shadow="rgba(150, 180, 240, 0.3)"
          size={0.4}
          levelScale={1.45}
          opacity={0.92}
          focusLevel={focusLevel}
          focusScale={1.3}
          focusDim={0.55}
        />
      )}
    </>
  );
};

// --- HUD ---------------------------------------------------------------------------

// Dark glass panels edged with brass hairlines, like the fittings of an
// instrument; Jost for text, the mono of the move list quiet beside it
const BRASS = 'rgba(214, 186, 122, 0.5)';
const BRASS_LINE = `linear-gradient(90deg, transparent, ${BRASS} 18%, ${BRASS} 82%, transparent)`;
const GLASS = 'linear-gradient(180deg, rgba(14, 19, 34, 0.86), rgba(7, 10, 20, 0.9))';

const meridian: Design = {
  id: 'meridian',
  name: 'Meridian',
  blurb:
    'A chess observatory at night: moonstone and obsidian on rose-to-ice glass decks, under constellations of chess pieces.',
  layout,
  continuous: false,
  canvas: { fov: 36, toneMapping: NeutralToneMapping, exposure: 1 },
  Stage,
  Grid,
  // No cell volumes: the discs on the decks say it all
  cellFills: { destination: null, lastMove: null },
  PieceBody,
  pieceScale: PIECE_SCALE,
  knightYaw: KNIGHT_YAW,
  markers: { Quiet, Capture, Selection, LastMove, Check },
  hoverDestinations: true,
  // Hover stirs a piece; picked up, it rises only a little more, into its
  // column of starlight, and holds still
  hoverLift: { hover: 0.08, selected: 0.13 },
  motion: MOTION,
  CaptureFx,
  Celebration,
  toppleMatedKing: true,
  hud: {
    readout: true,
    vars: {
      '--hud-font': '"Jost", system-ui, sans-serif',
      '--hud-mono': '"IBM Plex Mono", ui-monospace, monospace',
      '--hud-bg': `${BRASS_LINE} top / 100% 1px no-repeat, ${GLASS}`,
      '--hud-fg': PALETTE.ink,
      '--hud-muted': PALETTE.inkMuted,
      '--hud-accent': PALETTE.trace,
      '--hud-accent-fg': '#1a1406',
      '--hud-border': '1px solid rgba(214, 186, 122, 0.16)',
      '--hud-radius': '6px',
      '--hud-shadow': '0 12px 32px rgba(0, 0, 0, 0.5)',
      '--hud-blur': 'blur(8px)',
      '--hud-tracking': '0.03em',
      '--turn-bg': `${BRASS_LINE} bottom / 100% 1px no-repeat, ${GLASS}`,
      '--turn-fg': '#f1f4fb',
      '--turn-size': '18px',
      '--turn-border': '1px solid rgba(214, 186, 122, 0.3)',
      '--turn-shadow': '0 0 24px rgba(150, 180, 240, 0.1), 0 12px 32px rgba(0, 0, 0, 0.5)',
      '--modal-bg': `${BRASS_LINE} top / 100% 1px no-repeat, linear-gradient(180deg, rgba(16, 21, 38, 0.97), rgba(7, 9, 18, 0.98))`,
      '--result-bg': `${BRASS_LINE} top / 100% 1px no-repeat, ${BRASS_LINE} bottom / 100% 1px no-repeat, linear-gradient(180deg, rgba(16, 21, 38, 0.97), rgba(7, 9, 18, 0.98))`,
      '--result-title-size': '20px',
      '--modal-fg': PALETTE.ink,
      '--modal-backdrop': 'rgba(2, 3, 8, 0.55)',
      '--modal-radius': '8px',
      '--modal-shadow': '0 0 60px rgba(150, 180, 240, 0.12), 0 20px 50px rgba(0, 0, 0, 0.55)',
      '--button-bg': 'rgba(236, 208, 138, 0.12)',
      '--button-fg': '#f6ead0',
      '--button-border': '1px solid rgba(236, 208, 138, 0.6)',
      '--button-radius': '4px',
      '--page-bg': 'radial-gradient(ellipse at 50% 35%, #0b1124 0%, #04060d 60%, #020309 100%)',
      '--page-fg': PALETTE.ink,
    },
    // A still vignette: the night falls away at the corners of the screen
    overlay: {
      background:
        'radial-gradient(ellipse 80% 75% at 50% 50%, transparent 60%, rgba(1, 2, 6, 0.45) 100%)',
    },
  },
};

export default meridian;
