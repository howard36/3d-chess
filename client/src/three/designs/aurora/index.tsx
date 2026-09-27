import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { NeutralToneMapping } from 'three';
import type { DirectionalLight } from 'three';
import { preloadPieceSet } from '../../pieces';
import { focusLevelOf } from '../kit/focus';
import { clarityTower, towerFrame } from '../kit/layouts';
import { SmartLabels } from '../kit/smartLabels';
import type { Design, GridProps } from '../types';
import { Celebration, makeCaptureFx, makeMoveFx } from './fx';
import { FONT, hud } from './hud';
import { makeMarkers } from './markers';
import { INK, LEVELS, RIM } from './palette';
import { PieceBody } from './pieces';
import { IcePlates } from './plates';
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

const PIECE_SCALE = 0.8;
const layout = clarityTower({ pieceHeight: 0.87 * PIECE_SCALE });
const { pitch, levelY } = towerFrame(layout);

// --- Stage -----------------------------------------------------------------------

const DEG = Math.PI / 180;

/**
 * Lights that travel with the camera, so every piece is modelled the same
 * from any orbit and either seat: a cold moonlight key over the viewer's
 * left shoulder, and an aurora-green rim from behind the tower.
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
      <directionalLight ref={rim} intensity={1.5} color={RIM} />
    </>
  );
};

const Stage = () => (
  <>
    <PolarNight />
    {/* Reflections: a dark room with a soft skylight and a band of aurora
        high round it, so obsidian shows long soft highlights, never points */}
    <Environment resolution={64} frames={1}>
      <color attach="background" args={['#04070d']} />
      <Lightformer
        form="rect"
        intensity={1.1}
        color="#dce8ff"
        position={[0, 8, 0]}
        rotation-x={Math.PI / 2}
        scale={[9, 9, 1]}
      />
      {[0, 1, 2, 3].map((i) => (
        <Lightformer
          key={i}
          form="rect"
          intensity={i % 2 ? 0.9 : 0.6}
          color={i % 2 ? '#3dffae' : '#8f7bff'}
          position={[Math.sin((i * Math.PI) / 2) * 7, 3.5, Math.cos((i * Math.PI) / 2) * 7]}
          scale={[6, 1.6, 1]}
        />
      ))}
      <Lightformer
        form="rect"
        intensity={0.35}
        color="#9fb4d0"
        position={[0, -6, 0]}
        rotation-x={-Math.PI / 2}
        scale={[12, 12, 1]}
      />
    </Environment>
    <hemisphereLight args={['#a9c2e6', '#1a2638', 0.85]} />
    <CameraLights />
  </>
);

// --- Board -----------------------------------------------------------------------

const Grid = ({ layout: l, orientation, focus }: GridProps) => {
  const focusLevel = focusLevelOf(focus);
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
  continuous: true,
  canvas: { fov: 36, toneMapping: NeutralToneMapping, exposure: 1.05 },
  Stage,
  Grid,
  cellFills: { destination: null, lastMove: null },
  PieceBody,
  pieceScale: PIECE_SCALE,
  knightYaw: 1.3,
  markers: makeMarkers(pitch, levelY, MOTION.durationMs),
  hoverDestinations: true,
  hoverLift: true,
  motion: MOTION,
  MoveFx: makeMoveFx(layout.floorY),
  CaptureFx: makeCaptureFx(PIECE_SCALE),
  Celebration,
  toppleMatedKing: true,
  hud,
};

export default aurora;
