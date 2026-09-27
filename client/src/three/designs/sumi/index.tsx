import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { NeutralToneMapping } from 'three';
import type { DirectionalLight } from 'three';
import { LAYER } from '../kit/layers';
import { clarityTower, towerFrame } from '../kit/layouts';
import { SmartLabels } from '../kit/smartLabels';
import type { Design, GridProps, LastMoveMarkerProps, MarkerProps } from '../types';
import { Celebration, makeCaptureFx, makeMoveFx } from './fx';
import { hud } from './hud';
import { BrushTrace, InkMark } from './ink';
import { CAPTURE, CHECK, INK, INK_WASH, LAST_MOVE, LAST_MOVE_EDGE, MOVE, SELECT } from './palette';
import { SumiPieceBody } from './pieces';
import { WashiPlates } from './plates';
import { PaperSky } from './sky';

// Sumi: ink and paper. A Raumschach tower of five washi sheets floating in
// a paper sky above ink-wash mountains; porcelain against black lacquer,
// both drawn with a sumi outline; every gameplay mark a brush mark in a
// mineral pigment of its own: malachite ensō where a piece may go, the same
// ensō in vermilion with four ticks for a capture, a gold ensō over an ink
// bloom for the selection, an azurite brush stroke for the last move, and a
// crimson seal for check. The scene holds still unless a piece is moving.

// --- Layout ------------------------------------------------------------------------

const PIECE_SCALE = 0.8;
// Board turns a knight toward the opponent by PI/2 - yaw; 1.3 leaves it
// in profile to the opening camera, so it never reads as a slab.
const KNIGHT_YAW = 1.3;
const layout = clarityTower({ pieceHeight: 0.87 * PIECE_SCALE });
const { pitch } = towerFrame(layout);

// --- Stage -------------------------------------------------------------------------

const DEG = Math.PI / 180;

/**
 * Lights that travel with the camera: a warm key over the viewer's left
 * shoulder and a cool rim from behind the tower. Every piece is modelled the
 * same way from any orbit and either seat, and no angle turns up a surprise
 * glare.
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
    place(key.current, az - 38 * DEG, 48 * DEG);
    place(rim.current, az + 180 * DEG + 35 * DEG, 28 * DEG);
  });
  return (
    <>
      <directionalLight ref={key} intensity={2.4} color="#fff2df" />
      <directionalLight ref={rim} intensity={1.35} color="#dde7f6" />
    </>
  );
};

const Stage = () => (
  <>
    <PaperSky />
    {/* Reflections: a dim warm room with soft paper panels, so lacquer
        stays black and shows long soft highlights rather than points */}
    <Environment resolution={64} frames={1}>
      <color attach="background" args={['#2a241f']} />
      <Lightformer
        form="rect"
        intensity={1.5}
        color="#fff6e8"
        position={[0, 8, 0]}
        rotation-x={Math.PI / 2}
        scale={[10, 10, 1]}
      />
      {[0, 1, 2, 3].map((i) => (
        <Lightformer
          key={i}
          form="rect"
          intensity={0.9}
          color="#f2ebdf"
          position={[Math.sin((i * Math.PI) / 2) * 7, 2.5, Math.cos((i * Math.PI) / 2) * 7]}
          scale={[5, 2.2, 1]}
        />
      ))}
    </Environment>
    <hemisphereLight args={['#fffaf1', '#a9acb0', 0.8]} />
    <directionalLight position={[0, 10, 0]} intensity={0.45} color="#fff8ee" />
    <CameraLights />
  </>
);

// --- Board -------------------------------------------------------------------------

/** Washi platforms and ink coordinates. Decorative only: Board draws this outside the clickable group. */
const Grid = ({ layout: l, orientation }: GridProps) => {
  useEffect(() => {
    view.orientation = orientation;
  }, [orientation]);
  return (
    <>
      <WashiPlates layout={l} />
      <SmartLabels
        layout={l}
        orientation={orientation}
        font='"Shippori Mincho", Georgia, serif'
        weight={700}
        levelWeight={800}
        color={INK}
        outline="rgba(244, 238, 227, 0.9)"
        outlineWidth={0.07}
        size={0.44}
        opacity={0.95}
        levelScale={1.35}
        // The letters are set larger than the kit's: give them more room
        levelOffset={0.7}
        offset={0.46}
      />
    </>
  );
};

/** The seat the board is seen from, for effects that redraw a piece (a captured knight's facing). */
const view = { orientation: 'white' as 'white' | 'black' };

// --- Markers -----------------------------------------------------------------------

const RING = 0.34 * pitch;
const STROKE = 0.07 * pitch;

/** A legal destination: a malachite ensō where the piece would stand. */
const Quiet = ({ floor, hovered }: MarkerProps) => (
  <InkMark
    floor={floor}
    color={MOVE}
    radius={RING}
    width={STROKE}
    opacity={0.95}
    fill={0.05}
    hovered={hovered}
    quad={pitch}
  />
);

/** A capture: the same ensō in vermilion, with four crosshair ticks and a faint red wash. */
const Capture = ({ floor, hovered }: MarkerProps) => (
  <InkMark
    floor={floor}
    color={CAPTURE}
    radius={RING}
    width={STROKE}
    opacity={0.95}
    fill={0.17}
    capture
    tick={0.11 * pitch}
    hovered={hovered}
    quad={pitch}
  />
);

/** The selection: ink blooms under the piece, and a gold ensō is brushed round it. */
const Selection = ({ floor }: MarkerProps) => (
  <>
    <InkMark
      floor={floor}
      kind="bloom"
      color={INK_WASH}
      radius={0.47 * pitch}
      fill={0.3}
      opacity={0.55}
      drawMs={520}
      quad={pitch}
      renderOrder={LAYER.shadow}
      lift={0.006}
    />
    <InkMark
      floor={floor}
      color={SELECT}
      radius={0.38 * pitch}
      width={0.07 * pitch}
      opacity={1}
      dry={0.3}
      drawMs={420}
      delayMs={60}
      quad={pitch}
    />
  </>
);

/**
 * The last move: azurite ensō on both squares, joined by a brush stroke with
 * an arrowhead. While the piece is in flight its own ink trail tells the
 * story; as it lands, the destination's ensō and the stroke are brushed in
 * from the source, and then hold still.
 */
const LastMove = ({ from, to }: LastMoveMarkerProps) => (
  <LastMoveMarks key={JSON.stringify([from.floor, to.floor])} from={from} to={to} />
);

const LastMoveMarks = ({ from, to }: LastMoveMarkerProps) => (
  <>
    <InkMark
      floor={from.floor}
      color={LAST_MOVE}
      radius={RING}
      width={STROKE * 0.85}
      opacity={0.8}
      quad={pitch}
    />
    <InkMark
      floor={to.floor}
      color={LAST_MOVE}
      radius={RING}
      width={STROKE}
      opacity={0.95}
      drawMs={260}
      delayMs={MOTION.durationMs * 0.8}
      quad={pitch}
    />
    <BrushTrace
      from={from.floor}
      to={to.floor}
      color={LAST_MOVE}
      edgeColor={LAST_MOVE_EDGE}
      width={0.1}
      headLength={0.3}
      headWidth={0.3}
      chevrons={0.42}
      endInset={0.38}
      startInset={0.16}
      drawMs={300}
      delayMs={MOTION.durationMs * 0.7}
    />
  </>
);

/** Check: a crimson seal pressed on the king's square, with an ensō round its base. */
const Check = ({ floor }: MarkerProps) => (
  <>
    <InkMark
      floor={floor}
      kind="seal"
      color={CHECK}
      radius={0.43 * pitch}
      width={0.075 * pitch}
      fill={0.16}
      opacity={1}
      quad={pitch}
    />
    <InkMark
      floor={floor}
      color={CHECK}
      radius={0.3 * pitch}
      width={0.05 * pitch}
      opacity={0.95}
      gap={0.08}
      quad={pitch}
    />
  </>
);

// --- Design ------------------------------------------------------------------------

const MOTION = { style: 'hop' as const, durationMs: 440, lift: 0.34 };

const sumi: Design = {
  id: 'sumi',
  name: 'Sumi',
  blurb:
    'Ink and paper: porcelain and lacquer on washi sheets, brush-stroke markers, misty ink mountains.',
  layout,
  continuous: false,
  canvas: { fov: 36, toneMapping: NeutralToneMapping, exposure: 1 },
  Stage,
  Grid,
  // No cell volumes: the brush marks on the platforms say it all
  cellFills: { destination: null, lastMove: null },
  PieceBody: SumiPieceBody,
  pieceScale: PIECE_SCALE,
  knightYaw: KNIGHT_YAW,
  markers: { Quiet, Capture, Selection, LastMove, Check },
  hoverDestinations: true,
  motion: MOTION,
  MoveFx: makeMoveFx(layout.floorY, MOTION.lift),
  CaptureFx: makeCaptureFx(PIECE_SCALE, () => view.orientation, KNIGHT_YAW),
  Celebration,
  toppleMatedKing: true,
  hud,
};

export default sumi;
