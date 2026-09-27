import { useEffect } from 'react';
import { NeutralToneMapping } from 'three';
import { focusLevelOf } from '../kit/focus';
import { SmartLabels } from '../kit/smartLabels';
import type { Design, GridProps } from '../types';
import { CaptureFx, Celebration, MoveFx } from './fx';
import { HUD_CSS, MONO, hud } from './hud';
import { PIECE_SCALE, layout } from './layout';
import { markers } from './markers';
import { INK, LEVEL_DEEP } from './palette';
import { PieceBody } from './pieces';
import { Trays } from './plates';
import { Stage as Lab } from './stage';

// Cleanroom: the board as an instrument in a semiconductor cleanroom, the
// one bright design. A four-post cassette of edge-lit polycarbonate trays
// stands in a pale, hushed bay (robot arms, wafer stockers and the glow of a
// yellow-lit lithography bay, all far off in the haze). Glossy white ceramic
// plays carbon fibre; the laser shows what the player is doing, graphite ink
// records what was done.
//
// - palette.ts: the value plan and the level ramp;
// - stage.tsx: the room, its equipment, lights and reflections;
// - plates.tsx: the trays (engraved pockets lit by each tray's LED rim), the
//   cassette and its base;
// - pieces.tsx: ceramic and carbon, LED feet, keylines, the scan and caliper;
// - markers.tsx: laser rings, hazard arcs, the ink record, the check beacon;
// - fx.tsx: landing ripples, the capture cut, mate;
// - hud.ts: the instrument-panel HUD.

const useHudStyle = () => {
  useEffect(() => {
    const style = document.createElement('style');
    style.dataset.design = 'cleanroom';
    style.textContent = HUD_CSS;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);
};

const Stage = () => {
  useHudStyle();
  return <Lab />;
};

const Grid = ({ layout: l, orientation, focus }: GridProps) => {
  const focusLevel = focusLevelOf(focus);
  return (
    <>
      <Trays focusLevel={focusLevel} />
      <SmartLabels
        layout={l}
        orientation={orientation}
        font={MONO}
        weight={600}
        levelWeight={600}
        color={INK}
        outline="rgba(250, 252, 254, 0.95)"
        outlineWidth={0.1}
        levelColors={LEVEL_DEEP}
        size={0.32}
        focusLevel={focusLevel}
      />
    </>
  );
};

const cleanroom: Design = {
  id: 'cleanroom',
  name: 'Cleanroom',
  blurb: 'A bright lab bay: ceramic and carbon fibre on edge-lit trays, laser-marked moves.',
  layout,
  continuous: false,
  canvas: { fov: 36, toneMapping: NeutralToneMapping, exposure: 1 },
  Stage,
  Grid,
  cellFills: { destination: null, lastMove: null },
  PieceBody,
  pieceScale: PIECE_SCALE,
  knightYaw: 0.45,
  markers,
  hoverDestinations: true,
  hoverLift: { hover: 0.05, selected: 0.16, bob: 0 },
  motion: { style: 'slide', durationMs: 380 },
  MoveFx,
  CaptureFx,
  Celebration,
  toppleMatedKing: true,
  hud,
};

export default cleanroom;
