import '@fontsource/cormorant-garamond/latin-600.css';
import '@fontsource/cormorant-garamond/latin-700.css';
import '@fontsource/manrope/latin-500.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import './hud.css';
import { NeutralToneMapping } from 'three';
import { preloadPieceSet } from '../../pieces';
import { focusLevelOf } from '../kit/focus';
import { SmartLabels } from '../kit/smartLabels';
import type { Design, GridProps } from '../types';
import { CaptureFx, Celebration } from './fx';
import { Capture, Check, LastMove, Quiet, Selection } from './markers';
import { KNIGHT_YAW, layout, LEVEL_COLORS, LIFT, MOTION, PALETTE, PIECE_SCALE } from './palette';
import { PieceBody } from './pieces';
import { TournamentPlates } from './plates';
import { Stage } from './stage';

// Simul: a hall of light where a simultaneous exhibition plays on. The
// tower is a Raumschach set of five boards made of light (a maple-and-walnut
// checker, threads and a border in each level's colour: amber, gold, lime,
// teal, azure) standing in the open middle of an endless dark tournament
// hall, where rows of tables recede into the gloom, each with a small board
// of warm light and a chess clock beside it. The armies are turned ivory and
// ebony; a held piece is lit by its own lamp. See palette.ts for the value
// and hue plan, and each module's header.

preloadPieceSet();

/**
 * Platforms and coordinates. Decorative only: Board draws this outside the
 * clickable group. The level the player points at (or holds a piece on)
 * lifts its threads, border and letter; the others step back a little.
 */
const Grid = ({ layout: l, orientation, focus }: GridProps) => {
  const focusLevel = focusLevelOf(focus);
  return (
    <>
      <TournamentPlates focusLevel={focusLevel} selectedLevel={focus?.selected ?? null} />
      <SmartLabels
        layout={l}
        orientation={orientation}
        // Manrope: a double-storey "a", a flagged "1", nothing to mistake
        font='"Manrope", system-ui, sans-serif'
        weight={600}
        levelWeight={700}
        color={PALETTE.ink}
        levelColors={LEVEL_COLORS}
        outline="rgba(10, 6, 4, 0.9)"
        outlineWidth={0.08}
        shadow="rgba(255, 214, 160, 0.25)"
        size={0.33}
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

// Ivory type on dark warm glass, titles in Cormorant (hud.css), the rest in
// Manrope; a hairline of lamp light under the turn, like the rule on a
// scoresheet. Restrained: the board is the event.
const GLASS = 'linear-gradient(180deg, rgba(30, 22, 16, 0.84), rgba(15, 10, 7, 0.88))';
const RULE =
  'linear-gradient(90deg, rgba(255, 226, 182, 0), rgba(255, 226, 182, 0.55), rgba(255, 226, 182, 0))';
const CARD = 'linear-gradient(180deg, rgba(32, 23, 17, 0.97), rgba(13, 9, 6, 0.98))';

const simul: Design = {
  id: 'simul',
  name: 'Simul',
  blurb:
    'A hall of light where a simultaneous exhibition plays on: ivory and ebony on five boards of warm light, amid rows of glowing tables and chess clocks.',
  layout,
  continuous: false,
  canvas: { fov: 36, toneMapping: NeutralToneMapping, exposure: 1 },
  Stage,
  Grid,
  // No cell volumes: the light on the boards says it all
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
      '--hud-font': '"Manrope", system-ui, sans-serif',
      '--hud-mono': '"Manrope", system-ui, sans-serif',
      '--hud-bg': GLASS,
      '--hud-fg': PALETTE.ink,
      '--hud-muted': PALETTE.inkMuted,
      '--hud-accent': PALETTE.lamp,
      '--hud-accent-fg': '#1c130b',
      '--hud-border': '1px solid rgba(255, 226, 182, 0.12)',
      '--hud-radius': '6px',
      '--hud-shadow': '0 12px 32px rgba(0, 0, 0, 0.45)',
      '--hud-blur': 'blur(8px)',
      '--hud-tracking': '0.01em',
      '--turn-bg': `${RULE} bottom / 100% 1px no-repeat, ${GLASS}`,
      '--turn-fg': '#f6ecdc',
      '--turn-size': '21px',
      '--turn-border': '1px solid rgba(255, 226, 182, 0.18)',
      '--turn-shadow': '0 0 28px rgba(255, 200, 130, 0.1), 0 12px 32px rgba(0, 0, 0, 0.45)',
      '--modal-bg': CARD,
      '--result-bg': `${RULE} center top / 60% 1px no-repeat, ${CARD}`,
      '--result-title-size': '27px',
      '--modal-fg': PALETTE.ink,
      '--modal-backdrop': 'rgba(4, 2, 1, 0.55)',
      '--modal-radius': '8px',
      '--modal-shadow': '0 0 60px rgba(255, 200, 130, 0.1), 0 20px 50px rgba(0, 0, 0, 0.5)',
      '--button-bg': 'rgba(255, 226, 182, 0.12)',
      '--button-fg': '#fff3e0',
      '--button-border': '1px solid rgba(255, 226, 182, 0.6)',
      '--button-radius': '4px',
      '--page-bg': 'radial-gradient(ellipse at 50% 70%, #140d09 0%, #080504 60%, #030201 100%)',
      '--page-fg': PALETTE.ink,
    },
    // A still vignette: the hall falls away at the corners of the screen
    overlay: {
      background:
        'radial-gradient(ellipse 80% 75% at 50% 50%, transparent 60%, rgba(3, 2, 1, 0.45) 100%)',
    },
  },
};

export default simul;
