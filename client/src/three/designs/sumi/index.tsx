import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { NeutralToneMapping } from 'three';
import type { DirectionalLight } from 'three';
import { focusLevelOf } from '../kit/focus';
import { LAYER } from '../kit/layers';
import { clarityTower, towerFrame } from '../kit/layouts';
import { SmartLabels } from '../kit/smartLabels';
import type { Design, GridProps, LastMoveMarkerProps, MarkerProps } from '../types';
import { Celebration, makeCaptureFx, makeMoveFx } from './fx';
import { hud } from './hud';
import { BrushTrace, InkMark } from './ink';
import {
  BLUE_BLACK,
  CAPTURE,
  CHECK,
  INK,
  LAST_MOVE,
  LAST_MOVE_EDGE,
  LEVEL_INKS,
  MOVE,
  SELECT,
} from './palette';
import { makePieceBody } from './pieces';
import { WashiPlates } from './plates';
import { PaperSky } from './sky';
import { SELECTION_BOB } from '../kit/motion';

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

/**
 * Washi platforms and ink coordinates. Decorative only: Board draws this
 * outside the clickable group. The level the player points at (or holds a
 * piece on) brushes its edge bolder and grows its letter, both in the
 * level's own ink, while the other levels fade back.
 */
const Grid = ({ layout: l, orientation, focus }: GridProps) => {
  const focusLevel = focusLevelOf(focus);
  return (
    <>
      <WashiPlates layout={l} inks={LEVEL_INKS} focusLevel={focusLevel} />
      <SmartLabels
        layout={l}
        orientation={orientation}
        font='"Shippori Mincho", Georgia, serif'
        weight={700}
        levelWeight={800}
        color={INK}
        outline="rgba(244, 238, 227, 0.9)"
        outlineWidth={0.055}
        size={0.44}
        opacity={0.95}
        levelScale={1.35}
        levelColors={LEVEL_INKS}
        // The letters are set larger than the kit's: give them more room
        levelOffset={0.7}
        offset={0.46}
        focusLevel={focusLevel}
        focusScale={1.25}
        focusDim={0.62}
      />
    </>
  );
};

// --- Markers -----------------------------------------------------------------------

/** Radius of an ensō where a piece would stand. */
const RING = 0.34 * pitch;
/** Radius of a capture's ensō: wide enough to show round the victim's base. */
const CAPTURE_RING = 0.44 * pitch;
const STROKE = 0.08 * pitch;

/** A legal destination: a bold malachite ensō where the piece would stand, over a faint wash. */
const Quiet = ({ floor, hovered }: MarkerProps) => (
  <InkMark
    floor={floor}
    color={MOVE}
    radius={RING}
    width={STROKE}
    opacity={0.95}
    fill={0.1}
    hovered={hovered}
    quad={pitch * 1.1}
  />
);

/**
 * A capture: the same ensō in vermilion, opened wide round the victim's
 * base, with four ticks out toward the square's corners and a red wash.
 */
const Capture = ({ floor, hovered }: MarkerProps) => (
  <InkMark
    floor={floor}
    color={CAPTURE}
    radius={CAPTURE_RING}
    width={STROKE * 0.95}
    opacity={0.95}
    fill={0.16}
    capture
    tick={0.14 * pitch}
    hovered={hovered}
    quad={pitch * 1.2}
  />
);

/** The selection: ink blooms under the piece, and a gold ensō is brushed round it. */
const Selection = ({ floor }: MarkerProps) => (
  <>
    <InkMark
      floor={floor}
      kind="bloom"
      color={BLUE_BLACK}
      radius={0.47 * pitch}
      fill={0.3}
      opacity={0.6}
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
 * The last move: azurite ensō of equal weight on both squares, joined by a
 * thin brush stroke straight from centre to centre, which the piece that
 * moved stands on the end of. While a live move's piece is in flight its own
 * ink trail tells the story; as it lands, the destination's ensō and the
 * stroke are brushed in from the source. A replayed move (history, a rejoin)
 * shows them whole. Board keys this by move, so the entrance plays once.
 */
const LastMove = ({ from, to, fresh, arc = 0 }: LastMoveMarkerProps) => (
  <>
    <InkMark
      floor={from.floor}
      color={LAST_MOVE}
      radius={RING}
      width={STROKE * 0.95}
      opacity={0.95}
      quad={pitch * 1.1}
    />
    <InkMark
      floor={to.floor}
      color={LAST_MOVE}
      radius={RING}
      width={STROKE * 0.95}
      opacity={0.95}
      drawMs={fresh ? 260 : 0}
      delayMs={MOTION.durationMs * 0.8}
      quad={pitch * 1.1}
    />
    <BrushTrace
      from={from.floor}
      to={to.floor}
      arc={arc}
      color={LAST_MOVE}
      edgeColor={LAST_MOVE_EDGE}
      radius={0.028}
      drawMs={fresh ? 320 : 0}
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

const MOTION = { style: 'hop' as const, durationMs: 440 };

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
  PieceBody: makePieceBody(LEVEL_INKS),
  pieceScale: PIECE_SCALE,
  knightYaw: KNIGHT_YAW,
  markers: { Quiet, Capture, Selection, LastMove, Check },
  hoverDestinations: true,
  // Hover lifts a piece you may pick up (and its ink outline goes bolder);
  // selection lifts it higher. The kit's Lift does both.
  // Lifted like every round-2 design, with the gentle bob of a held piece
  hoverLift: { bob: SELECTION_BOB },
  motion: MOTION,
  MoveFx: makeMoveFx(layout.floorY),
  CaptureFx: makeCaptureFx(PIECE_SCALE),
  Celebration,
  toppleMatedKing: true,
  hud,
};

export default sumi;
