import { NeutralToneMapping } from 'three';
import { preloadPieceSet } from '../../pieces';
import { focusLevelOf } from '../kit/focus';
import { clarityTower, towerFrame } from '../kit/layouts';
import { SmartLabels } from '../kit/smartLabels';
import type { Design, GridProps } from '../types';
import { makeCaptureFx, makeCelebration, makeMoveFx } from './fx';
import { GlassPlates } from './glass';
import { hud } from './hud';
import { makeMarkers } from './markers';
import { Stage } from './nave';
import { LEVEL, PARCHMENT } from './palette';
import { PieceBody } from './pieces';

// Vitrail: stained glass in a dark cathedral. The tower hangs in the crossing
// of a Gothic rotunda, level with its clerestory windows: five panels of
// leaded glass, emerald at the bottom through aquamarine, sapphire and
// amethyst to fuchsia at the top, each square its own pane of antique glass
// between thin cames that carry a thread of the level's light. An alabaster
// army faces an ebony one, both with gilt details, both on bands of jewel
// glass in their level's colour, both drawn by a candle-warm rim of light.
// Play is in warm light over the cool glass: gilt quatrefoils where a piece
// may go, ruby for a capture and a crown of ruby light for check, candle
// ivory for the last move, and a shaft of sunlight falling on the piece in
// hand. Far below, a labyrinth; all round, windows of old wine, amber and
// cobalt glass, softened and dim, with faint shafts of their light. The
// level colours belong to the tower alone, and the play marks are always the
// brightest things on it. Nothing moves unless the players do.

preloadPieceSet();

// --- Layout ------------------------------------------------------------------------

const PIECE_SCALE = 0.8;
const layout = clarityTower({ pieceHeight: 0.87 * PIECE_SCALE });
const { pitch, gap } = towerFrame(layout);

// --- Board -------------------------------------------------------------------------

/**
 * The glass platforms and the coordinates. The level the player points at
 * (or holds a piece on) brightens its thread of light and grows its letter.
 */
const Grid = ({ layout: l, orientation, focus }: GridProps) => {
  const focusLevel = focusLevelOf(focus);
  return (
    <>
      <GlassPlates layout={l} focusLevel={focusLevel} />
      <SmartLabels
        layout={l}
        orientation={orientation}
        font='"Cormorant Garamond", Georgia, serif'
        weight={700}
        levelWeight={700}
        color={PARCHMENT}
        outline="rgba(10, 7, 14, 0.9)"
        outlineWidth={0.07}
        shadow="rgba(0, 0, 0, 0.6)"
        size={0.42}
        opacity={0.95}
        levelScale={1.4}
        levelColors={LEVEL}
        levelOffset={0.62}
        offset={0.42}
        focusLevel={focusLevel}
        focusScale={1.3}
        focusDim={0.55}
      />
    </>
  );
};

// --- Design ------------------------------------------------------------------------

const MOTION = { style: 'slide' as const, durationMs: 460 };

const cathedral: Design = {
  id: 'cathedral',
  name: 'Vitrail',
  blurb:
    'Stained glass in a dark cathedral: alabaster and ebony on leaded jewel glass, gilt marks, a labyrinth far below.',
  layout,
  continuous: false,
  canvas: { fov: 36, toneMapping: NeutralToneMapping, exposure: 1 },
  Stage,
  Grid,
  // No cell volumes: the marks on the glass say it all
  cellFills: { destination: null, lastMove: null },
  PieceBody,
  pieceScale: PIECE_SCALE,
  // Board turns a knight toward the opponent by PI/2 - yaw: nearly in
  // profile to the opening camera, so the horse's head always reads
  knightYaw: 1.2,
  markers: makeMarkers({ pitch, gap, moveMs: MOTION.durationMs }),
  hoverDestinations: true,
  // A piece under the pointer stirs; the piece in hand rises into its shaft
  // of light and is held there, still
  hoverLift: { hover: 0.05, selected: 0.16, bob: 0 },
  motion: MOTION,
  MoveFx: makeMoveFx(layout, PIECE_SCALE),
  CaptureFx: makeCaptureFx(layout, PIECE_SCALE),
  Celebration: makeCelebration(layout),
  toppleMatedKing: true,
  hud,
};

export default cathedral;
