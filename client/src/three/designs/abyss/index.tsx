import { NeutralToneMapping } from 'three';
import { preloadPieceSet } from '../../pieces';
import { clarityTower, towerFrame } from '../kit/layouts';
import type { Design } from '../types';
import { Grid } from './decks';
import { makeCaptureFx, makeCelebration, makeLevelAt, makeMoveFx } from './fx';
import { hud } from './hud';
import { makeMarkers } from './markers';
import { PieceBody } from './pieces';
import { Stage } from './stage';

// Abyss: a deep-sea research station. The board is an instrument in a glass
// observation room; outside is the abyss, teal-black water with shafts of
// faint light, rock stacks and arches on the rim of the drop, and specks of
// life hanging in the dark. Five pressure-glass decks carry glowing seams in
// a sea gradient (deep blue, cyan, sea-green, chartreuse, gold). The armies
// are mother-of-pearl and volcanic glass, both rimmed by the water's cool
// light, each piece standing on a foot band of its level's colour. Every
// mark of play is bioluminescent: plankton rings where a piece may go, an
// anglerfish's red for captures, a comb jelly's violet for the last move.
//
// Files: palette (colours), backdrop (the water), station (the room's frame
// and the distant motes), stage (lamps and reflections), decks (the glass
// and labels), view (view facts the decks publish), pieces (materials and
// floor marks), markers (the marks), fx (motion), hud (the terminal).

preloadPieceSet();

const PIECE_SCALE = 0.8;
const layout = clarityTower({ pieceHeight: 0.87 * PIECE_SCALE });
const frame = towerFrame(layout);
const levelAt = makeLevelAt(frame.levelY);

const MOTION = { style: 'slide' as const, durationMs: 420 };

const abyss: Design = {
  id: 'abyss',
  name: 'Abyss',
  blurb: 'A deep-sea research station lit by bioluminescence.',
  layout,
  // Rendered on demand: animated marks ask for frames while they are up
  // (markers.tsx), so an idle board stops rendering
  continuous: false,
  canvas: { fov: 36, toneMapping: NeutralToneMapping, exposure: 1 },
  Stage,
  Grid,
  cellFills: { destination: null, lastMove: null },
  PieceBody,
  pieceScale: PIECE_SCALE,
  knightYaw: 1.2,
  markers: makeMarkers(frame.pitch, MOTION.durationMs, levelAt),
  hoverDestinations: true,
  // Hover stirs a piece; selection floats it a little, kept low so the piece
  // stays over its own square and its halo at the 18° opening view
  hoverLift: { hover: 0.035, selected: 0.08 },
  motion: MOTION,
  MoveFx: makeMoveFx(layout.floorY, levelAt),
  CaptureFx: makeCaptureFx(PIECE_SCALE, levelAt),
  Celebration: makeCelebration(levelAt, frame.pitch),
  toppleMatedKing: true,
  hud,
};

export default abyss;
