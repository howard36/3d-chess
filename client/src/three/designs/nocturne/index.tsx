import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { NeutralToneMapping } from 'three';
import type { DirectionalLight } from 'three';
import { focusLevelOf } from '../kit/focus';
import { LAYER } from '../kit/layers';
import { clarityTower, towerFrame } from '../kit/layouts';
import { LastMoveLine } from '../kit/line';
import { SmartLabels } from '../kit/smartLabels';
import type { Design, GridProps, LastMoveMarkerProps, MarkerProps, Vec3 } from '../types';
import { Celebration, makeCaptureFx, makeMoveFx } from './fx';
import { hud } from './hud';
import { InkMark } from './ink';
import { CAPTURE, CHECK, LAST_MOVE, LAST_MOVE_EDGE, LEVELS, MOVE, SELECT, TEXT } from './palette';
import { makePieceBody, nocturneSet } from './pieces';
import { PaperSheets } from './sheets';
import { NightSky } from './sky';

// Nocturne: Sumi by moonlight. The same tower of paper sheets, but at night:
// silver ink on indigo paper. The tower floats high above a sea of cloud,
// ringed by ink-wash mountains with pines and a pagoda on their ridges and a
// large soft moon low behind the mist. Porcelain stands against black
// lacquer; the porcelain is drawn with a fine ink line, the lacquer with a
// silver one and lit round its edge by the moon, so it is never a blob.
// Every level has its mineral pigment (malachite, verdigris, azurite, lapis,
// amethyst) on its brushed edge and grid, its letter and the foot of every
// piece on it. The marks are moonlight: a silver ensō where a piece may go,
// the same ensō inside a vermilion one for a capture, a pool of moonlight
// and a rising moon halo for the selection, gold crescents and a gold
// thread for the last move, and a vermilion seal under a king in check.

// --- Layout ------------------------------------------------------------------------

const PIECE_SCALE = 0.8;
// Board turns a knight toward the opponent by PI/2 - yaw; 1.3 leaves it
// nearly in profile to the opening camera
const KNIGHT_YAW = 1.3;
const layout = clarityTower({ pieceHeight: 0.87 * PIECE_SCALE });
const { pitch, gap, levelY } = towerFrame(layout);
/** The level (0 = A) a marker lies on, from the height of its floor. */
const levelAt = (floor: Vec3) =>
  Math.min(Math.max(Math.round((floor[1] - levelY[0]) / gap), 0), LEVELS.length - 1);

// Build the piece set while the page loads, not on the first frame
if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
  window.requestIdleCallback(() => nocturneSet(), { timeout: 3000 });
}

// --- Stage -------------------------------------------------------------------------

const DEG = Math.PI / 180;

/**
 * Moonlight that travels with the camera: a cool key over the viewer's left
 * shoulder and a stronger silver rim from behind the tower, so every piece
 * is modelled the same way from any orbit and either seat, and the lacquer
 * always has a lit edge.
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
      <directionalLight ref={key} intensity={2.55} color="#dbe3f5" />
      <directionalLight ref={rim} intensity={2.1} color="#a9bdf0" />
    </>
  );
};

const Stage = () => (
  <>
    <NightSky />
    {/* Reflections: a dark room with long soft silver panels, so lacquer
        stays black and shows long moonlit highlights rather than points */}
    <Environment resolution={64} frames={1}>
      <color attach="background" args={['#0a0d18']} />
      {/* A modest panel overhead: a big one would mirror in every glossy top
          and turn a black piece seen from above to steel */}
      <Lightformer
        form="rect"
        intensity={0.9}
        color="#dfe7fb"
        position={[0, 8, 0]}
        rotation-x={Math.PI / 2}
        scale={[5, 5, 1]}
      />
      {[0, 1, 2, 3].map((i) => (
        <Lightformer
          key={i}
          form="rect"
          intensity={0.85}
          color="#b9c6e6"
          position={[Math.sin((i * Math.PI) / 2) * 7, 1.6, Math.cos((i * Math.PI) / 2) * 7]}
          scale={[6, 1.1, 1]}
        />
      ))}
    </Environment>
    <hemisphereLight args={['#3a4775', '#0a0c16', 1.1]} />
    <directionalLight position={[0, 10, 0]} intensity={0.35} color="#d8e1f5" />
    <CameraLights />
  </>
);

// --- Board -------------------------------------------------------------------------

/**
 * Paper sheets and silver coordinates. Decorative only: Board draws this
 * outside the clickable group. The level the player points at (or holds a
 * piece on) brushes its grid and edge bolder and grows its letter, both in
 * its pigment, while the others step back.
 */
const Grid = ({ layout: l, orientation, focus }: GridProps) => {
  const focusLevel = focusLevelOf(focus);
  return (
    <>
      <PaperSheets layout={l} colors={LEVELS} focusLevel={focusLevel} />
      <SmartLabels
        layout={l}
        orientation={orientation}
        font='"Shippori Mincho", Georgia, serif'
        weight={700}
        levelWeight={800}
        color={TEXT}
        outline="rgba(5, 7, 15, 0.92)"
        outlineWidth={0.06}
        size={0.42}
        opacity={0.95}
        levelScale={1.35}
        levelColors={LEVELS}
        levelOffset={0.7}
        offset={0.46}
        focusLevel={focusLevel}
        focusScale={1.25}
        focusDim={0.6}
      />
    </>
  );
};

// --- Markers -----------------------------------------------------------------------

/** Radius of the silver ensō where a piece would stand: clear of a piece's foot wash. */
const RING = 0.31 * pitch;
/** A bold brush: as wide as Sumi's at touch-down, a hairline at the lift. */
const STROKE = 0.075 * pitch;
/** The level jewel at a mark's heart or on its brush head. */
const JEWEL = 0.06 * pitch;
/** The capture's vermilion ensō, round the silver one. */
const CAPTURE_RING = 0.43 * pitch;
/** The last move's crescents, round the base of the piece that moved. */
const CRESCENT = 0.37 * pitch;

/**
 * A legal destination: one bold, open silver ensō, the full moon, where the
 * piece would stand, with a jewel of its level's pigment at its heart, so a
 * destination says which level it is on even where levels overlap on screen.
 */
const Quiet = ({ floor, hovered }: MarkerProps) => (
  <InkMark
    floor={floor}
    color={MOVE}
    radius={RING}
    width={STROKE}
    opacity={0.9}
    fill={0.04}
    mica={0.55}
    levelColor={LEVELS[levelAt(floor)]}
    jewelRadius={JEWEL}
    hovered={hovered}
    quad={pitch * 0.9}
  />
);

/**
 * A capture: the same silver ensō round the victim's base (its jewel on the
 * brush head, clear of the victim), inside a wider vermilion one brushed the
 * other way round.
 */
const Capture = ({ floor, hovered }: MarkerProps) => (
  <>
    <InkMark
      floor={floor}
      color={MOVE}
      radius={RING}
      width={STROKE * 0.9}
      opacity={0.88}
      mica={0.55}
      levelColor={LEVELS[levelAt(floor)]}
      jewelRadius={JEWEL * 0.9}
      jewel="head"
      hovered={hovered}
      quad={pitch * 0.9}
    />
    <InkMark
      floor={floor}
      color={CAPTURE}
      radius={CAPTURE_RING}
      width={STROKE * 0.95}
      opacity={0.95}
      fill={0.07}
      start={-0.9}
      gap={0.12}
      hovered={hovered}
      quad={pitch * 1.1}
    />
  </>
);

/**
 * The selection: a pool of moonlight spreads on the paper under the piece,
 * soft-edged and filled, so it can never be taken for a destination's ring
 * (a destination straight above or below still shows through, drawn over
 * it). From the side, the moon halo rising behind the piece says the rest.
 * From above, where the halo fades and the piece (or one stacked over it)
 * hides the pool, a closed, even silver ring, the full moon's disc, fades in
 * and shows through the whole stack: outside every other mark (a capture's
 * vermilion ring is at 0.43), drawn last, with a dark keyline each side.
 */
const Selection = ({ floor }: MarkerProps) => (
  <>
    <InkMark
      floor={floor}
      kind="pool"
      color={SELECT}
      radius={0.46 * pitch}
      fill={0.32}
      opacity={0}
      drawMs={380}
      quad={pitch}
      lift={0.008}
      renderOrder={LAYER.shadow + 0.8}
    />
    <InkMark
      floor={floor}
      kind="ring"
      color={SELECT}
      radius={0.47 * pitch}
      width={0.03 * pitch}
      opacity={0.9}
      drawMs={300}
      topOnly
      depthTest={false}
      quad={pitch * 1.1}
      renderOrder={LAYER.trace + 0.9}
    />
  </>
);

/** Angle (in a mark's plane) that points along the move, for the crescents. */
const heading = (from: Vec3, to: Vec3) => {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  // A move straight up or down the tower has no heading on the paper: face the viewer
  if (Math.hypot(dx, dz) < 1e-3) return -Math.PI / 2;
  return Math.atan2(-dz, dx);
};

const CRESCENT_GAP = 0.44;
const crescentStart = (angle: number) => angle - (1 - CRESCENT_GAP) * Math.PI;

/**
 * The last move: a gold crescent on each square, swelling toward where the
 * piece went (the source's thinner, the destination's full), each with its
 * level's jewel at its fullest point, joined
 * by a thin gold thread from centre to centre along which a brighter glint
 * slowly flows. A live move draws its thread and destination crescent in as
 * the piece lands; a replayed one shows them whole.
 */
const LastMove = ({ from, to, fresh, arc = 0 }: LastMoveMarkerProps) => {
  const angle = heading(from.floor, to.floor);
  // A move straight up or down the tower: from above, the source's crescent
  // would hide under the arrival's, so it is drawn wider than a square's ring
  const vertical = Math.hypot(to.floor[0] - from.floor[0], to.floor[2] - from.floor[2]) < 1e-3;
  return (
    <>
      <InkMark
        floor={from.floor}
        kind="crescent"
        color={LAST_MOVE}
        radius={vertical ? 0.45 * pitch : CRESCENT * 0.94}
        width={STROKE * 1.1}
        gap={CRESCENT_GAP}
        start={crescentStart(angle)}
        opacity={0.85}
        mica={0.5}
        levelColor={LEVELS[levelAt(from.floor)]}
        jewelRadius={JEWEL * 0.85}
        quad={pitch * 1.1}
      />
      <InkMark
        floor={to.floor}
        kind="crescent"
        color={LAST_MOVE}
        radius={CRESCENT}
        width={STROKE * 1.35}
        gap={CRESCENT_GAP}
        start={crescentStart(angle)}
        opacity={0.95}
        mica={0.5}
        levelColor={LEVELS[levelAt(to.floor)]}
        jewelRadius={JEWEL}
        drawMs={fresh ? 280 : 0}
        delayMs={MOTION.durationMs * 0.85}
        quad={pitch}
      />
      <LastMoveLine
        from={from.floor}
        to={to.floor}
        arc={arc}
        color={LAST_MOVE}
        pulseColor="#fff3d1"
        radius={0.013}
        shade={0.3}
        outline={LAST_MOVE_EDGE}
        outlineWidth={0.006}
        flowSpeed={0.45}
        pulse={0.6}
        pulseLength={0.35}
        drawInMs={fresh ? 320 : 0}
        drawInDelayMs={MOTION.durationMs * 0.6}
      />
    </>
  );
};

/** Check: a vermilion seal stamped on the king's square. */
const Check = ({ floor }: MarkerProps) => (
  <InkMark
    floor={floor}
    kind="seal"
    color={CHECK}
    radius={0.41 * pitch}
    width={0.07 * pitch}
    fill={0.13}
    opacity={0.95}
    quad={pitch}
  />
);

// --- Design ------------------------------------------------------------------------

const MOTION = { style: 'slide' as const, durationMs: 460 };

const nocturne: Design = {
  id: 'nocturne',
  name: 'Nocturne',
  blurb:
    'Sumi by moonlight: porcelain and silver-lined lacquer on night paper, a moon behind the mist.',
  layout,
  // Nothing moves at rest: the sky is a painting, repainted only when the
  // camera moves (the last move's thread asks for its own frames)
  continuous: false,
  canvas: { fov: 36, toneMapping: NeutralToneMapping, exposure: 1 },
  Stage,
  Grid,
  // No cell volumes: the brush marks on the paper say it all
  cellFills: { destination: null, lastMove: null },
  PieceBody: makePieceBody(LEVELS, pitch),
  pieceScale: PIECE_SCALE,
  knightYaw: KNIGHT_YAW,
  markers: { Quiet, Capture, Selection, LastMove, Check },
  hoverDestinations: true,
  // A small lift, held still (no bob), so a raised piece never seems to
  // float a rank back or into the sheet above: the moon halo rising behind
  // it is the selection's signature
  hoverLift: { hover: 0.05, selected: 0.075 },
  motion: MOTION,
  MoveFx: makeMoveFx(layout.floorY),
  CaptureFx: makeCaptureFx(PIECE_SCALE),
  Celebration,
  toppleMatedKing: true,
  hud,
};

export default nocturne;
