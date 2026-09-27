import { NeutralToneMapping } from 'three';
import { preloadPieceSet } from '../../pieces';
import { focusLevelOf } from '../kit/focus';
import { clarityTower } from '../kit/layouts';
import { SmartLabels } from '../kit/smartLabels';
import type { Design, GridProps } from '../types';
import { Celebration, makeCaptureFx, makeMoveFx } from './fx';
import { FONT, hud } from './hud';
import { Capture, Check, makeLastMove, Quiet, Selection } from './markers';
import { INK, LEVELS } from './palette';
import { PieceBody } from './pieces';
import { preloadPlanetMap } from './planet';
import { Decks } from './plates';
import { Stage } from './stage';

// Orbital: an observation deck above a planet at night. The tower floats in
// a dark bay whose great window looks down on the planet's night side (city
// lights along its coasts, moonlit cloud, the thin blue line of its
// atmosphere on the limb), through a cupola's frame of struts. The decks are
// smoked glass in brushed-metal frames, each lit in one colour of the
// atmosphere seen edge-on (orange, gold, green, cyan, blue, A to E), with a
// docking light at every inner corner of its squares. Heat-shield ceramic
// plays anodised graphite; every piece stands on a strip light in its
// deck's colour. Play is told in rings of docking lights, and a picked-up
// piece turns slowly in a tractor beam.

preloadPieceSet();
preloadPlanetMap();

const PIECE_SCALE = 0.8;
const layout = clarityTower({ pieceHeight: 0.87 * PIECE_SCALE });

const MOTION = { style: 'slide' as const, durationMs: 420 };

/**
 * The decks and their coordinates. Decorative only: Board draws this outside
 * the clickable group. The deck the player points at (or holds a piece on)
 * brightens its lights and letter; the others dim a little.
 */
const Grid = ({ layout: l, orientation, focus }: GridProps) => {
  const focusLevel = focusLevelOf(focus);
  return (
    <>
      <Decks layout={l} colors={LEVELS} focusLevel={focusLevel} />
      <SmartLabels
        layout={l}
        orientation={orientation}
        font={FONT}
        weight={500}
        levelWeight={700}
        color={INK}
        outline="rgba(3, 6, 12, 0.85)"
        outlineWidth={0.06}
        size={0.34}
        opacity={0.88}
        levelColors={LEVELS}
        focusLevel={focusLevel}
        focusScale={1.3}
        focusDim={0.55}
      />
    </>
  );
};

const orbital: Design = {
  id: 'orbital',
  name: 'Orbital',
  blurb:
    'An observation deck above a night-side planet: ceramic and graphite on smoked-glass decks, docking lights and a tractor beam.',
  layout,
  continuous: false,
  canvas: { fov: 36, toneMapping: NeutralToneMapping, exposure: 1 },
  Stage,
  Grid,
  // No cell volumes: the lights on the decks say it all
  cellFills: { destination: null, lastMove: null },
  PieceBody,
  pieceScale: PIECE_SCALE,
  knightYaw: 0.55,
  markers: { Quiet, Capture, Selection, LastMove: makeLastMove(MOTION.durationMs), Check },
  hoverDestinations: true,
  // Held in the beam: lifted clear of the glass (and turning, see PieceBody)
  hoverLift: { hover: 0.06, selected: 0.2, bob: 0 },
  motion: MOTION,
  MoveFx: makeMoveFx(layout.floorY),
  CaptureFx: makeCaptureFx(layout, PIECE_SCALE),
  Celebration,
  toppleMatedKing: true,
  hud,
};

export default orbital;
