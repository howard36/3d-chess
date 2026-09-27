import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { NeutralToneMapping } from 'three';
import type { DirectionalLight } from 'three';
import { preloadPieceSet } from '../../pieces';
import { focusLevelOf } from '../kit/focus';
import { clarityTower, towerFrame } from '../kit/layouts';
import { SmartLabels } from '../kit/smartLabels';
import type { Design, GridProps, StageProps } from '../types';
import { Celebration, makeCaptureFx, makeMoveFx } from './fx';
import { FONT, hud } from './hud';
import { makeMarkers } from './markers';
import { INK, LEVELS, RIM } from './palette';
import { PieceBody } from './pieces';
import { IcePlates } from './plates';
import { LIFT, PIECE_SCALE, useSteep } from './shared';
import { PolarNight } from './sky';

// Polaris: a glass observatory on a polar plateau at night. Five panes of
// sea ice, tiled and frosted, stand in a stack over a snowfield far below;
// snowy ranges ring the horizon, with small observatory domes on their
// ridges, and the aurora hangs high in the sky. The levels take the
// aurora's own colours, green at the bottom to orchid at the top. Snow
// stone plays obsidian edged in aurora light. Destinations are frost stars,
// captures the same star gone red, the last move a pair of gold ice plates
// joined by a gold thread, the selection an aurora ribbon winding up round
// the piece, and check a red aurora curtain round the king.

preloadPieceSet();

// --- Layout ----------------------------------------------------------------------

// A little lower than the kit's 18°: the frame's top edge then clears the
// horizon by a few degrees, so the aurora's arc shows over the far ranges
// in the opening view (rows still stand well apart at 15°)
const layout = clarityTower({ pieceHeight: 0.87 * PIECE_SCALE, elevation: 15 });
const { pitch, levelY } = towerFrame(layout);

// --- Stage -----------------------------------------------------------------------

const DEG = Math.PI / 180;

/**
 * Lights that travel with the camera, so every piece is modelled the same
 * from any orbit and either seat: a cold moonlight key over the viewer's
 * left shoulder (well off the view's axis even from overhead), and a
 * silver rim from behind the tower.
 */
const CameraLights = () => {
  const key = useRef<DirectionalLight>(null);
  const rim = useRef<DirectionalLight>(null);
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    const az = Math.atan2(camera.position.x, camera.position.z);
    const place = (light: DirectionalLight | null, azimuth: number, elevation: number) => {
      light?.position.set(
        Math.sin(azimuth) * Math.cos(elevation) * 12,
        Math.sin(elevation) * 12,
        Math.cos(azimuth) * Math.cos(elevation) * 12,
      );
    };
    place(key.current, az - 40 * DEG, 50 * DEG);
    place(rim.current, az + 180 * DEG + 30 * DEG, 32 * DEG);
  });
  return (
    <>
      <directionalLight ref={key} intensity={2.3} color="#eef4ff" />
      <directionalLight ref={rim} intensity={1.3} color={RIM} />
    </>
  );
};

// Tall, narrow moonlit strips round the room, two to a quadrant, and no
// light overhead: obsidian shows long soft highlights down its stems and
// bulbs from every side, while its tops (all a view from overhead sees)
// stay dark
const STRIPS = Array.from({ length: 8 }, (_, i) => (i / 8) * Math.PI * 2 + Math.PI / 8);

const Stage = ({ layout: l }: StageProps) => (
  <>
    <PolarNight layout={l} />
    <Environment resolution={64} frames={1}>
      <color attach="background" args={['#04070d']} />
      {STRIPS.map((az, i) => (
        <Lightformer
          key={i}
          form="rect"
          intensity={i % 2 ? 0.8 : 0.6}
          color="#dce2ea"
          position={[Math.sin(az) * 7, 1.5, Math.cos(az) * 7]}
          scale={[1.2, 5, 1]}
        />
      ))}
      <Lightformer
        form="rect"
        intensity={0.3}
        color="#9fb4d0"
        position={[0, -6, 0]}
        rotation-x={-Math.PI / 2}
        scale={[12, 12, 1]}
      />
    </Environment>
    <hemisphereLight args={['#c4cad2', '#1e2228', 0.85]} />
    <CameraLights />
  </>
);

// --- Board -----------------------------------------------------------------------

const Grid = ({ layout: l, orientation, focus }: GridProps) => {
  const focusLevel = focusLevelOf(focus);
  useSteep();
  return (
    <>
      <IcePlates layout={l} colors={LEVELS} focusLevel={focusLevel} />
      <SmartLabels
        layout={l}
        orientation={orientation}
        font={FONT}
        weight={500}
        levelWeight={700}
        color={INK}
        outline="rgba(3, 8, 16, 0.85)"
        outlineWidth={0.06}
        size={0.36}
        opacity={0.92}
        levelScale={1.45}
        levelColors={LEVELS}
        focusLevel={focusLevel}
      />
    </>
  );
};

// --- Design ----------------------------------------------------------------------

const MOTION = { style: 'slide' as const, durationMs: 420 };

const aurora: Design = {
  id: 'aurora',
  name: 'Polaris',
  blurb: 'A polar observatory under the aurora: sea-ice levels, snow stone and obsidian.',
  layout,
  // On demand: the aurora asks for its own frames, about ten a second (sky.tsx)
  continuous: false,
  canvas: { fov: 38, toneMapping: NeutralToneMapping, exposure: 1.05 },
  Stage,
  Grid,
  cellFills: { destination: null, lastMove: null },
  PieceBody,
  pieceScale: PIECE_SCALE,
  knightYaw: 1.3,
  markers: makeMarkers(pitch, levelY, MOTION.durationMs),
  hoverDestinations: true,
  hoverLift: LIFT,
  motion: MOTION,
  MoveFx: makeMoveFx(layout.floorY),
  CaptureFx: makeCaptureFx(PIECE_SCALE),
  Celebration,
  toppleMatedKing: true,
  hud,
};

export default aurora;
