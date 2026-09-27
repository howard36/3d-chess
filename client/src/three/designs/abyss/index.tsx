import { NeutralToneMapping } from 'three';
import { preloadPieceSet } from '../../pieces';
import { clarityTower, towerFrame } from '../kit/layouts';
import type { Design } from '../types';
import { Grid } from './decks';
import { Celebration, makeCaptureFx, makeLevelAt, makeMoveFx } from './fx';
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
// Files: palette (colours), backdrop (the water), stage (lamps), decks (the
// glass and labels), pieces (materials), markers (the marks), fx (motion),
// hud (the terminal).

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
  // Marks breathe, plankton drifts round the selection: slow ambience
  continuous: true,
  canvas: { fov: 36, toneMapping: NeutralToneMapping, exposure: 1 },
  Stage,
  Grid,
  cellFills: { destination: null, lastMove: null },
  PieceBody,
  pieceScale: PIECE_SCALE,
  knightYaw: 1.2,
  markers: makeMarkers(frame.pitch, MOTION.durationMs, levelAt),
  hoverDestinations: true,
  // Hover stirs a piece; selection floats it up, while it lights from within
  hoverLift: { hover: 0.07, selected: 0.24 },
  motion: MOTION,
  MoveFx: makeMoveFx(layout.floorY, levelAt),
  CaptureFx: makeCaptureFx(PIECE_SCALE, levelAt),
  Celebration,
  toppleMatedKing: true,
  hud,
};

export default abyss;
