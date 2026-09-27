import { NeutralToneMapping } from 'three';
import { preloadPieceSet } from '../../pieces';
import { focusLevelOf } from '../kit/focus';
import { clarityTower, towerFrame } from '../kit/layouts';
import { SmartLabels } from '../kit/smartLabels';
import type { Design, GridProps } from '../types';
import { makeFx } from './fx';
import { hud, LABEL_FONT } from './hud';
import { makeMarkers } from './markers';
import { LABEL, LEVELS } from './palette';
import { PieceBody } from './pieces';
import { GlassPlates } from './plates';
import { makeStage } from './stage';

// Gallery: a museum at night. The Raumschach tower is the centrepiece
// exhibit of a dark sculpture rotunda after hours: five shelves of museum
// glass in anodised brass frames, one jewel colour per level (amethyst,
// sapphire, azure, teal, emerald), with a brass inlay between every square;
// a set carved in Carrara marble and basalt; and round it, in the gloom,
// sculptures on plinths, paintings under picture lights, moonlit windows
// and a polished concrete floor.
//
// The gameplay speaks the museum's language: brass inlay rings where a
// piece may go, crimson velvet rope round a piece that can be taken, a
// spotlight that strikes up over the selected piece as it turns on its
// plinth, a platinum hanging wire for the last move, and a barrier of
// stanchions and rope round a king in check. Nothing moves while nobody is
// playing.

preloadPieceSet();

const PIECE_SCALE = 0.8;
const layout = clarityTower({ pieceHeight: 0.87 * PIECE_SCALE });
const { pitch, levelY, half } = towerFrame(layout);
const MOTION = { style: 'slide' as const, durationMs: 420 };

const { Stage } = makeStage(levelY, half);

/**
 * The glass shelves and their labels (decorative: Board draws this outside
 * the clickable group). The level under the pointer, or of the selected
 * piece, brightens its frame, inlay and letter.
 */
const Grid = ({ layout: l, orientation, focus }: GridProps) => {
  const focusLevel = focusLevelOf(focus);
  return (
    <>
      <GlassPlates layout={l} colors={LEVELS} focusLevel={focusLevel} />
      <SmartLabels
        layout={l}
        orientation={orientation}
        font={LABEL_FONT}
        weight={700}
        levelWeight={700}
        color={LABEL}
        outline="rgba(6, 7, 9, 0.9)"
        outlineWidth={0.06}
        size={0.42}
        opacity={0.92}
        levelScale={1.4}
        levelColors={LEVELS}
        levelOffset={1.15}
        offset={0.44}
        focusLevel={focusLevel}
        focusScale={1.25}
        focusDim={0.55}
      />
    </>
  );
};

const gallery: Design = {
  id: 'gallery',
  name: 'Gallery',
  blurb: 'A museum at night: marble and basalt on glass shelves, under spotlights.',
  layout,
  continuous: false,
  canvas: { fov: 36, toneMapping: NeutralToneMapping, exposure: 1.05 },
  Stage,
  Grid,
  // No cell volumes: the marks on the glass say it all
  cellFills: { destination: null, lastMove: null },
  PieceBody,
  pieceScale: PIECE_SCALE,
  knightYaw: 0.45,
  markers: makeMarkers(pitch, MOTION.durationMs, levelY),
  hoverDestinations: true,
  // Hover stirs a piece and selection raises it (the kit's heights, held
  // still); the selected piece also turns on its plinth (pieces.tsx)
  hoverLift: true,
  motion: MOTION,
  ...makeFx(layout.floorY, PIECE_SCALE),
  toppleMatedKing: true,
  hud,
};

export default gallery;
