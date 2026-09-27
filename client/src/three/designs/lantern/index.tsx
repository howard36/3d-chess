import { NeutralToneMapping } from 'three';
import { preloadPieceSet } from '../../pieces';
import { focusLevelOf } from '../kit/focus';
import { clarityTower, towerFrame } from '../kit/layouts';
import { SmartLabels } from '../kit/smartLabels';
import type { Design, GridProps } from '../types';
import { makeCaptureFx, makeCelebration, makeMoveFx } from './fx';
import { FONT, hud } from './hud';
import { lanternMarkers } from './markers';
import { LEVELS, WASHI } from './palette';
import { PieceBody } from './pieces';
import { ShojiPlates } from './plates';
import { Stage } from './stage';

// Lantern: a zen garden at blue hour. Five shoji screens float, stacked,
// high over a raked gravel garden: frames of dark lacquer inlaid in the
// level's colour (moss jade at the bottom, through pond teal, dusk blue and
// wisteria, to sakura pink at the top), kumiko slats in the same colour
// dividing each into its 25 panes, and washi so thin the pieces below show
// through. The set is boxwood against rosewood, grained and varnished, on
// felt feet of the level's colour. Every mark is light on paper: a small
// lantern where a piece may go, red lacquer for a capture or a check, a
// lantern held under the piece you pick up (its glow swells and a ripple
// runs out across the screen), and firefly light for the last move.

preloadPieceSet();

const PIECE_SCALE = 0.8;
const layout = clarityTower({ pieceHeight: 0.87 * PIECE_SCALE });
const frame = towerFrame(layout);
const { pitch } = frame;
/** How far from the centre the platforms reach: effects are kept inside. */
const CLIP = frame.half + 0.03;

const MOTION = { style: 'slide' as const, durationMs: 440 };

/**
 * Shoji platforms and coordinates. Decorative only: Board draws this outside
 * the clickable group. The level the player points at (or holds a piece on)
 * lights its slats and inlay and grows its letter.
 */
const Grid = ({ layout: l, orientation, focus }: GridProps) => {
  const focusLevel = focusLevelOf(focus);
  return (
    <>
      <ShojiPlates layout={l} colors={LEVELS} focusLevel={focusLevel} />
      <SmartLabels
        layout={l}
        orientation={orientation}
        font={FONT}
        weight={700}
        levelWeight={800}
        color={WASHI}
        outline="rgba(8, 10, 22, 0.9)"
        outlineWidth={0.07}
        size={0.4}
        opacity={0.95}
        levelScale={1.4}
        levelColors={LEVELS}
        levelOffset={0.66}
        offset={0.44}
        focusLevel={focusLevel}
        focusScale={1.28}
        focusDim={0.55}
      />
    </>
  );
};

const lantern: Design = {
  id: 'lantern',
  name: 'Lantern',
  blurb: 'A zen garden at dusk: boxwood and rosewood on lantern-lit shoji, fireflies below.',
  layout,
  continuous: true,
  canvas: { fov: 36, toneMapping: NeutralToneMapping, exposure: 1 },
  Stage,
  Grid,
  // No cell volumes: the marks on the paper say it all
  cellFills: { destination: null, lastMove: null },
  PieceBody,
  pieceScale: PIECE_SCALE,
  knightYaw: 0.45,
  markers: lanternMarkers({ pitch, clip: CLIP, moveMs: MOTION.durationMs }),
  hoverDestinations: true,
  // Hover stirs a piece, selection lifts it, held still: the lantern glow
  // under it is the selection's signature
  hoverLift: true,
  motion: MOTION,
  MoveFx: makeMoveFx(layout.floorY, CLIP),
  CaptureFx: makeCaptureFx(PIECE_SCALE),
  Celebration: makeCelebration(CLIP),
  toppleMatedKing: true,
  hud,
};

export default lantern;
