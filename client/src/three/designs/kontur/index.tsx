import '@fontsource/jost/500.css';
import '@fontsource/jost/600.css';
import '@fontsource/jost/700.css';
import { NoToneMapping } from 'three';
import type { Design, GridProps } from '../types';
import { CaptureFx, Celebration, MoveFx } from './fx';
import { KonturLabels } from './labels';
import { layout } from './layout';
import { markers, MOVE_MS } from './markers';
import {
  COBALT,
  INK,
  LEVEL_EDGE,
  LEVEL_WASH,
  PAPER,
  PAPER_LIGHT,
  SIGNAL,
  VERMILION,
} from './palette';
import { PieceBody } from './pieces';
import { AcrylicPlates } from './plates';
import { Stage } from './stage';

// Kontur: a Bauhaus board game. Five sheets of coloured acrylic stacked on
// warm paper, geometric pieces after Hartwig's 1923 set drawn in ink, and
// the three primaries kept for what the player needs to see: cobalt where
// the held piece can go, vermilion for captures and check, signal yellow for
// the last move.

const FONT = "'Jost', 'Futura', 'Century Gothic', sans-serif";

/** Platforms and coordinates. Decorative only: Board draws this outside the clickable group. */
const Grid = ({ layout: l, orientation }: GridProps) => (
  <>
    <AcrylicPlates washes={LEVEL_WASH} edges={LEVEL_EDGE} />
    <KonturLabels
      layout={l}
      orientation={orientation}
      font={FONT}
      weight={600}
      levelWeight={700}
      color={INK}
      outline={PAPER}
      outlineWidth={0.09}
      levelColors={LEVEL_EDGE}
      levelScale={1.7}
      size={0.34}
      opacity={1}
    />
  </>
);

const kontur: Design = {
  id: 'kontur',
  name: 'Kontur',
  blurb: 'A Bauhaus board game: ink-drawn geometric pieces on colour-coded acrylic sheets.',
  layout,
  continuous: false,
  // A long, flat lens: every level is seen from nearly the same angle, like
  // an axonometric drawing, so none is flattened more than another
  canvas: { fov: 26, toneMapping: NoToneMapping, antialias: true },
  Stage,
  Grid,
  // No cell volumes: the marks on the platforms say it all
  cellFills: { destination: null, lastMove: null },
  PieceBody,
  pieceScale: 1,
  // Turned well round from the ranks, so the knight shows its profile
  knightYaw: 1.05,
  markers,
  hoverDestinations: true,
  hoverLift: true,
  motion: { style: 'bounce', durationMs: MOVE_MS, lift: 0.42 },
  MoveFx,
  CaptureFx,
  Celebration,
  toppleMatedKing: true,
  hud: {
    vars: {
      '--hud-font': FONT,
      '--hud-mono': FONT,
      '--hud-bg': PAPER_LIGHT,
      '--hud-fg': INK,
      '--hud-muted': 'rgba(23, 23, 28, 0.55)',
      '--hud-accent': COBALT,
      '--hud-accent-fg': '#ffffff',
      '--hud-border': `2px solid ${INK}`,
      '--hud-radius': '0px',
      '--hud-shadow': `4px 4px 0 ${INK}`,
      '--hud-blur': 'none',
      '--hud-case': 'uppercase',
      '--hud-tracking': '0.06em',
      '--turn-bg': INK,
      '--turn-fg': PAPER_LIGHT,
      '--turn-size': '19px',
      '--turn-border': `2px solid ${INK}`,
      '--turn-shadow': `4px 4px 0 ${SIGNAL}`,
      '--modal-bg': PAPER_LIGHT,
      '--modal-fg': INK,
      '--modal-backdrop': 'rgba(236, 229, 214, 0.45)',
      '--modal-radius': '0px',
      '--modal-shadow': `10px 10px 0 ${INK}`,
      '--button-bg': VERMILION,
      '--button-fg': '#ffffff',
      '--button-border': `2px solid ${INK}`,
      '--button-radius': '0px',
      '--page-bg': PAPER,
      '--page-fg': INK,
    },
  },
};

export default kontur;
