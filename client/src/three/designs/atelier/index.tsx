import '@fontsource/jost/400.css';
import '@fontsource/jost/500.css';
import '@fontsource/jost/600.css';
import { NeutralToneMapping } from 'three';
import { focusLevelOf } from '../kit/focus';
import { clarityTower, towerFrame } from '../kit/layouts';
import { SmartLabels } from '../kit/smartLabels';
import type { Design, GridProps } from '../types';
import { atelierFx } from './fx';
import { Capture, Check, lastMoveMarker, Quiet, Selection } from './markers';
import { LEVELS, PAL } from './palette';
import { PieceBody } from './pieces';
import { AcrylicPlates } from './plates';
import { Stage } from './stage';

// Atelier: a luxury modern chess set photographed in a daylight studio.
// Glazed porcelain against ink-blue lacquer on tinted acrylic slabs, a warm
// studio sweep with a floor and a pool of light under the tower, and markers
// drawn as slim rings where a piece would stand (teal to move, vermilion to
// capture, amber for the last move, crimson for check). Each level has its
// own acrylic tint (taupe, sage, cornflower, lilac, dove), shown on its edge,
// its letter and a ring at the base of every piece standing on it. Calm when
// nobody moves; a picked-up piece rises, turns and catches the light; moves
// ripple the acrylic, and captures shatter the loser into shards.
//
// Value plan (see palette.ts): ivory is the lightest thing on screen, ink the
// darkest, the backdrop a mid band between them, the platforms only a few
// steps of frost over whatever is behind them.

// --- Layout ------------------------------------------------------------------------

const PIECE_SCALE = 0.82;
const MOVE_MS = 440;
// Tuned within the kit's range: at its 18° and 1.35 gap, a piece on the back
// row of one level lands on screen exactly at the front edge of the level
// above, so from Black's seat White's back ranks on A read as standing on B.
// A 16° camera over a 1.45 gap puts that edge clearly above the piece's base,
// and still looks between the levels.
const layout = clarityTower({
  pieceHeight: 0.87 * PIECE_SCALE,
  levelGap: 1.45,
  elevation: 16,
});
const frame = towerFrame(layout);
const PLATE_MARGIN = 0.09;

// --- Board -------------------------------------------------------------------------

const FONT = "'Jost', 'Helvetica Neue', system-ui, sans-serif";

/**
 * Platforms and coordinates. Decorative only: Board draws this outside the
 * clickable group. The level under the pointer (or of the selected piece)
 * deepens its tinted edge and enlarges its letter while the others dim.
 */
const Grid = ({ layout: l, orientation, focus }: GridProps) => {
  const focusLevel = focusLevelOf(focus);
  return (
    <>
      <AcrylicPlates layout={l} margin={PLATE_MARGIN} focusLevel={focusLevel} />
      <SmartLabels
        layout={l}
        orientation={orientation}
        font={FONT}
        weight={500}
        levelWeight={500}
        color={PAL.text}
        outline={PAL.textHalo}
        outlineWidth={0.03}
        size={0.43}
        levelScale={1.4}
        levelColors={LEVELS.map((v) => v.ink)}
        opacity={0.96}
        focusLevel={focusLevel}
        focusDim={0.72}
        focusScale={1.25}
      />
    </>
  );
};

// --- Design ------------------------------------------------------------------------

const { MoveFx, CaptureFx, Celebration } = atelierFx({
  pieceScale: PIECE_SCALE,
  floorY: layout.floorY,
  platformHalf: frame.half + PLATE_MARGIN,
});

const atelier: Design = {
  id: 'atelier',
  name: 'Atelier',
  blurb: 'Porcelain and ink-blue lacquer on frosted acrylic, lit like a studio product shot.',
  layout,
  continuous: false,
  canvas: { fov: 34, toneMapping: NeutralToneMapping, exposure: 1 },
  Stage,
  Grid,
  // No cell volumes: the rings on the platforms say it all
  cellFills: { destination: null, lastMove: null },
  PieceBody,
  pieceScale: PIECE_SCALE,
  // Every knight shows its profile to the opening camera, from both seats (as
  // in a diagram, all facing one way): a flat head seen end-on reads as a slab
  knightYaw: Math.PI / 2,
  markers: { Quiet, Capture, Selection, LastMove: lastMoveMarker(MOVE_MS), Check },
  hoverDestinations: true,
  // Board reports the piece under the pointer only to hover-lifting designs;
  // PieceBody stages the lift itself (see pieces.tsx)
  hoverLift: true,
  motion: { style: 'hop', durationMs: MOVE_MS, lift: 0.5 },
  MoveFx,
  CaptureFx,
  Celebration,
  toppleMatedKing: true,
  hud: {
    // "Cc4 · White Bishop" under the turn chip for the cell under the pointer
    readout: true,
    vars: {
      '--hud-font': FONT,
      // One voice: the notation is set in Jost too
      '--hud-mono': FONT,
      '--hud-bg': 'rgba(250, 248, 244, 0.74)',
      '--hud-fg': PAL.text,
      '--hud-muted': 'rgba(38, 40, 45, 0.52)',
      // The Move button: graphite on paper (fades to a quiet grey when disabled)
      '--hud-accent': '#2c2a27',
      '--hud-accent-fg': PAL.paper,
      '--hud-border': '1px solid rgba(255, 255, 255, 0.75)',
      '--hud-radius': '14px',
      '--hud-shadow': '0 12px 32px rgba(58, 48, 36, 0.14), 0 1px 2px rgba(58, 48, 36, 0.08)',
      '--hud-blur': 'blur(14px) saturate(1.1)',
      '--hud-tracking': '0.01em',
      '--turn-bg': 'rgba(250, 248, 244, 0.86)',
      '--turn-fg': '#1d1f23',
      '--turn-size': '18px',
      '--turn-border': '1px solid rgba(255, 255, 255, 0.85)',
      '--turn-shadow': '0 14px 36px rgba(58, 48, 36, 0.16), 0 1px 2px rgba(58, 48, 36, 0.1)',
      '--modal-bg': PAL.paper,
      '--modal-fg': '#1d1f23',
      '--modal-radius': '20px',
      '--modal-shadow': '0 30px 80px rgba(40, 34, 26, 0.3)',
      '--modal-backdrop': 'rgba(120, 112, 100, 0.32)',
      '--button-bg': '#23262b',
      '--button-fg': '#f7f3ea',
      '--button-border': '1px solid #23262b',
      '--button-radius': '999px',
      '--page-bg': `radial-gradient(ellipse at 50% 35%, ${PAL.skyTop} 0%, ${PAL.skyHorizon} 55%, ${PAL.skyLow} 100%)`,
      '--page-fg': PAL.text,
    },
    // A soft studio vignette, darkening only the corners (never the tower)
    overlay: {
      background:
        'radial-gradient(ellipse 75% 70% at 50% 50%, rgba(60, 50, 40, 0) 60%, rgba(60, 50, 40, 0.16) 100%)',
    },
  },
};

export default atelier;
