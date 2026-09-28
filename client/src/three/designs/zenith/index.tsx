import '@fontsource/manrope/latin-500.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import { NeutralToneMapping } from 'three';
import { preloadPieceSet } from '../../pieces';
import { focusLevelOf } from '../kit/focus';
import { SmartLabels } from '../kit/smartLabels';
import { ENV_SETTINGS } from './settings-env';
import { MARKER_SETTINGS } from './settings-markers';
import { PIECE_SETTINGS } from './settings-pieces';
import type { Design, GridProps } from '../types';
import { CaptureFx, Celebration } from './fx';
import { Capture, Check, LastMove, Quiet } from './markers';
import { KNIGHT_YAW, layout, LEVEL_COLORS, MOTION, PALETTE, PIECE_SCALE } from './palette';
import { PieceBody } from './pieces';
import { Selection } from './selection';
import { Levels } from './plates';
import { Stage } from './stage';

// Monolith: a light-art garden at night. The tower of five glass levels,
// each edged by one thin square of its level's light over a frosted checker,
// floats above an endless dark plain; far off, colossal chess pieces drawn
// only in thin white neon tube stand in a wide circle on a colossal
// chessboard of faint light, reflected in the polished ground. The scene is
// white light on black; the five levels, cyan to rose, are its only colours.
// Porcelain and charcoal pieces stand in rings of their level's light.
// See palette.ts for the value and hue plan, and each module's header.

preloadPieceSet();

/**
 * The levels and their coordinates. Decorative only: Board draws this
 * outside the clickable group. The level the player points at (or has a
 * piece picked up on) brightens its lines, edge and letter.
 */
const Grid = ({ layout: l, orientation, focus }: GridProps) => {
  const focusLevel = focusLevelOf(focus);
  return (
    <>
      <Levels focusLevel={focusLevel} />
      <SmartLabels
        layout={l}
        orientation={orientation}
        // Manrope's double-storey "a" never reads as "o"; its "1" has a flag
        font='"Manrope", system-ui, sans-serif'
        weight={600}
        levelWeight={700}
        color={PALETTE.ink}
        levelColors={LEVEL_COLORS}
        outline="rgba(2, 3, 7, 0.9)"
        outlineWidth={0.08}
        shadow="rgba(200, 215, 255, 0.25)"
        size={0.32}
        levelScale={1.5}
        opacity={0.9}
        focusLevel={focusLevel}
        focusScale={1.3}
        focusDim={0.55}
      />
    </>
  );
};

// --- HUD -----------------------------------------------------------------------------------

// Black glass, white type, hairline borders: the chrome of a gallery's
// wall text at night
const GLASS = 'linear-gradient(180deg, rgba(14, 16, 22, 0.82), rgba(6, 7, 11, 0.86))';
const HAIRLINE = '1px solid rgba(236, 241, 255, 0.16)';

const zenith: Design = {
  id: 'zenith',
  name: 'Zenith',
  blurb: 'A light-art garden of colossal chess sculptures under constellations of chess pieces.',
  layout,
  continuous: false,
  canvas: { fov: 36, toneMapping: NeutralToneMapping, exposure: 1 },
  Stage,
  Grid,
  // No cell volumes: the light on the glass says it all
  cellFills: { destination: null, lastMove: null },
  PieceBody,
  pieceScale: PIECE_SCALE,
  knightYaw: KNIGHT_YAW,
  markers: { Quiet, Capture, Selection, LastMove, Check },
  hoverDestinations: true,
  // Hover stirs a piece; held, it rises only a little higher, and holds still
  hoverLift: { hover: 0.08, selected: 0.13 },
  motion: MOTION,
  CaptureFx,
  Celebration,
  toppleMatedKing: true,
  // The result card waits for the mate pulse to cross the board (its length
  // is a setting), and a beat more to take it in
  resultDelayMs: (settings) => (Number(settings['mark.mateSeconds']) || 2.4) * 1000 + 400,
  settings: [...ENV_SETTINGS, ...PIECE_SETTINGS, ...MARKER_SETTINGS],
  hud: {
    readout: true,
    vars: {
      '--hud-font': '"Manrope", system-ui, sans-serif',
      '--hud-bg': GLASS,
      '--hud-fg': PALETTE.ink,
      '--hud-muted': PALETTE.inkMuted,
      '--hud-accent': '#f3f6ff',
      '--hud-accent-fg': '#07080c',
      '--hud-border': HAIRLINE,
      '--hud-radius': '4px',
      '--hud-shadow': '0 10px 30px rgba(0, 0, 0, 0.5)',
      '--hud-blur': 'blur(8px)',
      '--hud-tracking': '0.01em',
      '--turn-bg': GLASS,
      '--turn-fg': '#f6f8ff',
      '--turn-size': '17px',
      '--turn-border': '1px solid rgba(236, 241, 255, 0.24)',
      '--turn-shadow': '0 0 24px rgba(220, 230, 255, 0.07), 0 10px 30px rgba(0, 0, 0, 0.5)',
      '--modal-bg': 'linear-gradient(180deg, rgba(14, 16, 22, 0.97), rgba(5, 6, 10, 0.98))',
      '--modal-fg': PALETTE.ink,
      '--modal-backdrop': 'rgba(1, 2, 5, 0.55)',
      '--modal-radius': '6px',
      '--modal-shadow': '0 0 0 1px rgba(236, 241, 255, 0.14), 0 24px 60px rgba(0, 0, 0, 0.6)',
      '--button-bg': 'transparent',
      '--button-fg': '#f6f8ff',
      '--button-border': '1px solid rgba(236, 241, 255, 0.55)',
      '--button-radius': '3px',
      '--page-bg': 'radial-gradient(ellipse at 50% 60%, #0a0d15 0%, #04050a 60%, #010205 100%)',
      '--page-fg': PALETTE.ink,
    },
  },
};

export default zenith;
