import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import { NeutralToneMapping } from 'three';
import type { Design } from '../types';
import { CaptureFx, Celebration, MoveFx } from './fx';
import { Capture, Check, LastMove, Quiet, Selection } from './markers';
import { CREAM, GRAPE, INK, layout, PIECE_SCALE, SKY, SUNFLOWER } from './palette';
import { KNIGHT_YAW, PieceBody } from './pieces';
import { Grid } from './plates';
import { Stage } from './stage';

// Candy Tower: a toy-box Raumschach set floating above a sea of clouds on a
// sunny day. Five slabs of clear sugar glass with gummy rims hold chunky
// vinyl toys: vanilla cream trimmed in grape against blueberry navy trimmed
// in orchid. Every gameplay mark is a die-cut sticker on the glass (mint to
// go, cherry with teeth to take, sunflower for the last move, joined by a
// striped candy path) and every move bounces.
//
// Clarity first: the armies hold both ends of the value range and the world
// stays in the middle; the glass multiplies rather than hazes, so pieces far
// down keep their colour; stickers carry an ink border so they read on
// anything; the lights ride with the camera, so no angle is backlit or
// glaring; and the only things that move while nobody plays are clouds far
// off on the horizon.

const HUD_SHADOW = `0 3px 0 ${INK}, 0 10px 24px rgba(31, 40, 120, 0.22)`;

const candy: Design = {
  id: 'candy',
  name: 'Candy Tower',
  blurb: 'Chunky vinyl toys on sugar-glass platforms, floating above the clouds.',
  layout,
  continuous: true,
  canvas: { fov: 36, toneMapping: NeutralToneMapping, exposure: 1 },
  Stage,
  Grid,
  cellFills: { destination: null, lastMove: null },
  PieceBody,
  pieceScale: PIECE_SCALE,
  knightYaw: KNIGHT_YAW,
  markers: { Quiet, Capture, Selection, LastMove, Check },
  hoverDestinations: true,
  hoverLift: true,
  motion: { style: 'bounce', durationMs: 440, lift: 0.5 },
  MoveFx,
  CaptureFx,
  Celebration,
  toppleMatedKing: true,
  hud: {
    vars: {
      '--hud-font': '"Fredoka", "Trebuchet MS", sans-serif',
      '--hud-mono': '"Fredoka", ui-monospace, monospace',
      '--hud-bg': 'rgba(255, 250, 240, 0.95)',
      '--hud-fg': INK,
      '--hud-muted': 'rgba(31, 36, 87, 0.55)',
      '--hud-accent': GRAPE,
      '--hud-accent-fg': '#ffffff',
      '--hud-border': `2px solid ${INK}`,
      '--hud-radius': '16px',
      '--hud-shadow': HUD_SHADOW,
      '--hud-blur': 'none',
      '--hud-tracking': '0.01em',
      '--turn-bg': SUNFLOWER,
      '--turn-fg': INK,
      '--turn-size': '20px',
      '--turn-border': `2px solid ${INK}`,
      '--turn-shadow': HUD_SHADOW,
      '--modal-bg': CREAM,
      '--modal-fg': INK,
      '--modal-backdrop': 'rgba(61, 127, 224, 0.32)',
      '--modal-radius': '24px',
      '--modal-shadow': `0 5px 0 ${INK}, 0 18px 40px rgba(31, 40, 120, 0.3)`,
      '--button-bg': GRAPE,
      '--button-fg': '#ffffff',
      '--button-border': `2px solid ${INK}`,
      '--button-radius': '999px',
      '--page-bg': `linear-gradient(180deg, ${SKY.zenith} 0%, ${SKY.horizon} 55%, ${SKY.seaMid} 100%)`,
      '--page-fg': INK,
    },
  },
};

export default candy;
