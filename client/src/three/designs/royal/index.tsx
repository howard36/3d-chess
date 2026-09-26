import '@fontsource/cinzel/500.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/700.css';
import { useMemo } from 'react';
import { Environment, Lightformer } from '@react-three/drei';
import {
  ACESFilmicToneMapping,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three';
import { PieceType } from '../../../engine/pieces';
import { GhostPiece } from '../../moveAnimation';
import { StauntonParts } from '../classic/pieces';
import { Bloom } from '../kit/Bloom';
import { Burst, CheckBeacon, Shards } from '../kit/fx';
import { BoardLabels } from '../kit/labels';
import { towerBoardY, towerLayout } from '../kit/layouts';
import { noRaycast } from '../kit/noRaycast';
import { GradientSky } from '../kit/sky';
import { dotTexture, fbm, mixHex, paintedTexture } from '../kit/textures';
import type {
  CaptureFxProps,
  CelebrationProps,
  Design,
  GridProps,
  LastMoveMarkerProps,
  MarkerProps,
  MoveFxProps,
  PieceBodyProps,
  StageProps,
} from '../types';

// Royal Marble: a collector's display set. Five smoked-glass boards inlaid
// with marble squares, framed and pillared in gold, stand in a dark salon;
// the armies are polished ivory marble and black onyx banded in gold.

const GOLD = '#d9ae55';
const RUBY = '#e0334d';
const IVORY = '#f1e9da';
const ONYX = '#18171a';

const layout = towerLayout({ spacing: 1.05, levelGap: 2.05, viewDirection: [0.1, 0.5, 1] });
const BOARD = layout.halfExtents[0] * 2 - 0.1;

// --- Marble ---------------------------------------------------------------

const veins = fbm(4, 3, 5);
const marble = (base: string, vein: string, strength: number) =>
  paintedTexture(
    (u, v) => {
      const n = veins(u, v);
      const band = Math.abs(Math.sin((u * 2.2 + v * 1.3 + n * 3.2) * Math.PI));
      const k = Math.pow(1 - band, 10) * strength + n * 0.12;
      return mixHex(base, vein, Math.min(1, k));
    },
    { size: 256 },
  );

const ivoryMarble = marble('#f4ede1', '#a9a097', 0.55);
const onyxMarble = marble('#1b1a1d', '#6c6470', 0.5);

// The board: marble squares in a 5×5 checker, alternating per level so the
// cube reads as a 3D checkerboard.
const boardTexture = (odd: boolean) =>
  paintedTexture(
    (u, v) => {
      const light = (Math.floor(u * 5) + Math.floor(v * 5) + (odd ? 1 : 0)) % 2 === 1;
      const n = veins(u * 2, v * 2);
      const band = Math.abs(Math.sin((u * 5 + v * 3 + n * 4) * Math.PI));
      const k = Math.pow(1 - band, 12);
      const [r, g, b] = light
        ? mixHex('#efe4cf', '#b8a88f', k * 0.6 + n * 0.15)
        : mixHex('#0f2a24', '#4f7a6a', k * 0.7 + n * 0.1);
      return [r, g, b, light ? 70 : 150];
    },
    { size: 512, repeat: false },
  );

const boardMaterials = [false, true].map(
  (odd) =>
    new MeshPhysicalMaterial({
      map: boardTexture(odd),
      transparent: true,
      roughness: 0.12,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      envMapIntensity: 1.1,
      depthWrite: false,
      side: DoubleSide,
    }),
);

const gold = new MeshStandardMaterial({ color: GOLD, metalness: 1, roughness: 0.22 });

// --- Pieces ---------------------------------------------------------------

type Glow = 'none' | 'hover' | 'selected' | 'check';
const glowColor: Record<Glow, [string, number]> = {
  none: ['#000000', 0],
  hover: ['#d9ae55', 0.18],
  selected: ['#d9ae55', 0.38],
  check: [RUBY, 0.7],
};

const pieceMaterials = new Map<string, MeshPhysicalMaterial>();
const pieceMaterial = (color: 'white' | 'black', glow: Glow) => {
  const key = `${color}-${glow}`;
  let m = pieceMaterials.get(key);
  if (!m) {
    const white = color === 'white';
    m = new MeshPhysicalMaterial({
      color: white ? IVORY : ONYX,
      map: white ? ivoryMarble : onyxMarble,
      roughness: white ? 0.28 : 0.16,
      metalness: white ? 0 : 0.05,
      clearcoat: 1,
      clearcoatRoughness: white ? 0.12 : 0.05,
      sheen: white ? 0.3 : 0,
      emissive: new Color(glowColor[glow][0]),
      emissiveIntensity: glowColor[glow][1],
      envMapIntensity: white ? 0.9 : 1.4,
    });
    pieceMaterials.set(key, m);
  }
  return m;
};

// Height and radius of each piece's collar, where the gold band sits.
const COLLAR: Record<PieceType, [number, number]> = {
  [PieceType.Pawn]: [0.312, 0.122],
  [PieceType.Rook]: [0.455, 0.19],
  [PieceType.Bishop]: [0.432, 0.132],
  [PieceType.Knight]: [0.108, 0.17],
  [PieceType.Unicorn]: [0.412, 0.122],
  [PieceType.Queen]: [0.502, 0.152],
  [PieceType.King]: [0.542, 0.162],
};

const PieceBody = ({ type, color, selected, hovered, inCheck }: PieceBodyProps) => {
  const glow: Glow = inCheck ? 'check' : selected ? 'selected' : hovered ? 'hover' : 'none';
  const [y, r] = COLLAR[type];
  return (
    <>
      <StauntonParts type={type} material={pieceMaterial(color, glow)} groove={gold} castShadow />
      <mesh position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} material={gold} castShadow>
        <torusGeometry args={[r + 0.004, 0.014, 8, 40]} />
      </mesh>
      {/* A thin gold foot ring on every base */}
      <mesh position={[0, 0.012, 0]} rotation={[Math.PI / 2, 0, 0]} material={gold}>
        <torusGeometry args={[type === PieceType.King ? 0.279 : 0.24, 0.012, 6, 40]} />
      </mesh>
    </>
  );
};

// --- Board ----------------------------------------------------------------

const Grid = ({ layout: l, orientation }: GridProps) => {
  const levels = [0, 1, 2, 3, 4].map((z) => towerBoardY(l, z));
  const top = levels[4];
  const bottom = levels[0];
  const h = BOARD / 2 + 0.06;
  return (
    <group>
      {levels.map((y, z) => (
        <group key={z} position={[0, y, 0]}>
          <mesh
            position={[0, -0.025, 0]}
            material={boardMaterials[z % 2]}
            raycast={noRaycast}
            receiveShadow
            renderOrder={-10 + z}
          >
            <boxGeometry args={[BOARD, 0.05, BOARD]} />
          </mesh>
          {/* Gold frame */}
          {[
            [0, h, BOARD + 0.24, 0.07],
            [0, -h, BOARD + 0.24, 0.07],
            [h, 0, 0.07, BOARD],
            [-h, 0, 0.07, BOARD],
          ].map(([x, zz, w, d], i) => (
            <mesh key={i} position={[x, -0.03, zz]} material={gold} raycast={noRaycast} castShadow>
              <boxGeometry args={[w, 0.07, d]} />
            </mesh>
          ))}
        </group>
      ))}
      {/* Corner pillars carrying the stack */}
      {[
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ].map(([sx, sz], i) => (
        <group key={i} position={[sx * (h + 0.02), 0, sz * (h + 0.02)]}>
          <mesh
            position={[0, (top + bottom) / 2 - 0.03, 0]}
            material={gold}
            raycast={noRaycast}
            castShadow
          >
            <cylinderGeometry args={[0.045, 0.045, top - bottom, 16]} />
          </mesh>
          <mesh position={[0, top + 0.05, 0]} material={gold} raycast={noRaycast}>
            <sphereGeometry args={[0.08, 20, 14]} />
          </mesh>
        </group>
      ))}
      {/* Plinth */}
      <mesh position={[0, bottom - 0.32, 0]} raycast={noRaycast} receiveShadow>
        <boxGeometry args={[BOARD + 0.9, 0.5, BOARD + 0.9]} />
        <meshPhysicalMaterial
          color="#141215"
          map={onyxMarble}
          roughness={0.2}
          clearcoat={1}
          clearcoatRoughness={0.08}
        />
      </mesh>
      <mesh position={[0, bottom - 0.06, 0]} material={gold} raycast={noRaycast}>
        <boxGeometry args={[BOARD + 0.96, 0.03, BOARD + 0.96]} />
      </mesh>
      <BoardLabels
        layout={l}
        orientation={orientation}
        font="'Cormorant Garamond', Georgia, serif"
        weight={700}
        color="#f0d79a"
        shadow="rgba(217,174,85,0.8)"
        size={0.4}
      />
    </group>
  );
};

// --- Markers --------------------------------------------------------------

const glowSprite = dotTexture(0.8);

const Quiet = ({ floor }: MarkerProps) => (
  <group position={floor}>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} raycast={noRaycast}>
      <circleGeometry args={[0.12, 32]} />
      <meshBasicMaterial color="#ffd889" toneMapped={false} transparent opacity={0.95} />
    </mesh>
    <sprite position={[0, 0.06, 0]} scale={0.6} raycast={noRaycast}>
      <spriteMaterial
        map={glowSprite}
        color={GOLD}
        transparent
        opacity={0.55}
        depthWrite={false}
        toneMapped={false}
      />
    </sprite>
  </group>
);

const Capture = ({ floor }: MarkerProps) => (
  <group position={floor}>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} raycast={noRaycast}>
      <ringGeometry args={[0.36, 0.44, 48]} />
      <meshBasicMaterial color="#ff5470" toneMapped={false} transparent opacity={0.95} />
    </mesh>
  </group>
);

const Selection = ({ floor }: MarkerProps) => (
  <group position={floor}>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.014, 0]} raycast={noRaycast}>
      <ringGeometry args={[0.31, 0.37, 48]} />
      <meshBasicMaterial color="#ffe3a3" toneMapped={false} />
    </mesh>
    <sprite position={[0, 0.15, 0]} scale={[1.1, 0.5, 1]} raycast={noRaycast}>
      <spriteMaterial map={glowSprite} color={GOLD} transparent opacity={0.35} depthWrite={false} />
    </sprite>
  </group>
);

const squareGeometry = new PlaneGeometry(1, 1);
const lastMoveMaterial = new MeshBasicMaterial({
  color: '#f5c86b',
  transparent: true,
  opacity: 0.32,
  depthWrite: false,
  toneMapped: false,
});
const LastMove = ({ from, to }: LastMoveMarkerProps) => (
  <>
    {[from, to].map((m, i) => (
      <mesh
        key={i}
        geometry={squareGeometry}
        material={lastMoveMaterial}
        position={[m.floor[0], m.floor[1] + 0.006, m.floor[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={layout.cellSize[0] * 0.96}
        raycast={noRaycast}
      />
    ))}
  </>
);

const Check = ({ floor }: MarkerProps) => <CheckBeacon floor={floor} color={RUBY} />;

// --- Effects ---------------------------------------------------------------

const MoveFx = ({ to, durationMs }: MoveFxProps) => (
  <Burst
    position={[to[0], to[1] + layout.floorY + 0.03, to[2]]}
    colors={['#ffe2a1', GOLD]}
    count={26}
    speed={1.1}
    gravity={1.2}
    upward={0.8}
    lifeMs={700}
    size={0.07}
    delayMs={durationMs * 0.92}
  />
);

const CaptureFx = ({ centre, floor, victim, durationMs }: CaptureFxProps) => (
  <>
    <GhostPiece type={victim.type} color={victim.color} position={centre} />
    <Burst
      position={[floor[0], floor[1] + 0.35, floor[2]]}
      colors={['#fff1c9', GOLD, '#b8862e']}
      count={90}
      speed={2.4}
      gravity={2.2}
      upward={0.35}
      lifeMs={1300}
      size={0.08}
      delayMs={durationMs * 0.6}
    />
  </>
);

const confettiGeometry = new PlaneGeometry(0.09, 0.05);
const confettiMaterial = new MeshStandardMaterial({
  metalness: 0.8,
  roughness: 0.3,
  side: DoubleSide,
});
const Celebration = ({ floor }: CelebrationProps) => (
  <>
    <Shards
      position={[floor[0], floor[1] + 0.9, floor[2]]}
      geometry={confettiGeometry}
      material={confettiMaterial}
      colors={[GOLD, '#fff3d6', '#f3c969', RUBY]}
      count={160}
      speed={3.4}
      gravity={1.2}
      upward={0.85}
      spread={0.4}
      lifeMs={3600}
      spin={7}
      flutter
      delayMs={500}
    />
    <Burst
      position={[floor[0], floor[1] + 0.6, floor[2]]}
      colors={['#fff4d0', GOLD]}
      count={120}
      speed={3}
      gravity={1}
      upward={0.5}
      lifeMs={1800}
      size={0.09}
      delayMs={450}
    />
  </>
);

// --- Stage ----------------------------------------------------------------

const Stage = ({ layout: l }: StageProps) => {
  const bottom = useMemo(() => towerBoardY(l, 0), [l]);
  return (
    <>
      <GradientSky top="#07060a" horizon="#2a1a1c" bottom="#050406" exponent={0.55} />
      <fog attach="fog" args={['#140d10', 16, 38]} />
      {/* Reflections: a warm softbox overhead and two cool strips at the sides */}
      <Environment resolution={256} frames={1}>
        <Lightformer
          form="rect"
          intensity={3}
          color="#fff1d8"
          position={[0, 6, 2]}
          rotation-x={Math.PI / 2}
          scale={[8, 4, 1]}
        />
        <Lightformer
          form="rect"
          intensity={1.4}
          color="#d8e2ff"
          position={[-6, 1, 0]}
          rotation-y={Math.PI / 2}
          scale={[2, 8, 1]}
        />
        <Lightformer
          form="rect"
          intensity={1.6}
          color="#ffd9a6"
          position={[6, 1, 2]}
          rotation-y={-Math.PI / 2}
          scale={[2, 8, 1]}
        />
        <Lightformer form="ring" intensity={2} color="#ffcf8a" position={[0, 2, 7]} scale={2} />
      </Environment>
      <ambientLight intensity={0.25} color="#ffe7d0" />
      <directionalLight
        position={[3, 12, 6]}
        intensity={2.6}
        color="#ffe9cc"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
        shadow-camera-near={2}
        shadow-camera-far={30}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      <spotLight position={[-7, 4, 5]} angle={0.5} penumbra={0.8} intensity={30} color="#9fb5ff" />
      {/* A pool of warm light on the salon floor under the plinth */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, bottom - 0.58, 0]} raycast={noRaycast}>
        <circleGeometry args={[9, 64]} />
        <meshBasicMaterial
          map={glowSprite}
          color="#5a3524"
          transparent
          opacity={0.7}
          depthWrite={false}
        />
      </mesh>
      <Bloom strength={0.55} radius={0.55} threshold={0.92} />
    </>
  );
};

// Destination cells get no box fill: the floor markers say it all.
const hidden = new MeshBasicMaterial({ visible: false });

const royal: Design = {
  id: 'royal',
  name: 'Royal Marble',
  blurb: 'Marble and onyx on five glass boards framed in gold, in a candlelit salon.',
  layout,
  continuous: false,
  canvas: { fov: 36, shadows: true, toneMapping: ACESFilmicToneMapping, exposure: 1.05 },
  Stage,
  Grid,
  cellFills: { destination: hidden, lastMove: hidden },
  PieceBody,
  knightYaw: 0.55,
  markers: { Quiet, Capture, Selection, LastMove, Check },
  motion: { style: 'hop', durationMs: 460, lift: 0.55 },
  MoveFx,
  CaptureFx,
  Celebration,
  toppleMatedKing: true,
  hoverLift: true,
  hud: {
    vars: {
      '--hud-font': '"Cinzel", Georgia, serif',
      // Cinzel has no lowercase, and the notation needs it (Bb1: level B, file b)
      '--hud-mono': '"Cormorant Garamond", Georgia, serif',
      '--hud-bg': 'rgba(22, 15, 17, 0.72)',
      '--hud-fg': '#f3e5c6',
      '--hud-muted': 'rgba(217, 174, 85, 0.55)',
      '--hud-accent': '#d9ae55',
      '--hud-accent-fg': '#1a1113',
      '--hud-border': '1px solid rgba(217, 174, 85, 0.55)',
      '--hud-radius': '3px',
      '--hud-shadow': '0 10px 30px rgba(0, 0, 0, 0.5)',
      '--hud-blur': 'blur(6px)',
      '--hud-tracking': '0.06em',
      '--turn-bg': 'linear-gradient(180deg, rgba(40, 26, 20, 0.85), rgba(22, 15, 17, 0.85))',
      '--turn-fg': '#f6dfa6',
      '--turn-border': '1px solid rgba(217, 174, 85, 0.8)',
      '--turn-shadow': '0 0 24px rgba(217, 174, 85, 0.25)',
      '--modal-bg': 'linear-gradient(180deg, #2a1c1c, #150e10)',
      '--modal-fg': '#f6e3b8',
      '--modal-backdrop': 'rgba(8, 5, 6, 0.45)',
      '--modal-radius': '4px',
      '--modal-shadow': '0 0 60px rgba(217, 174, 85, 0.25)',
      '--button-bg': 'linear-gradient(180deg, #f0cf7f, #b98a36)',
      '--button-fg': '#1a1113',
      '--button-border': '1px solid #f7dc9a',
      '--button-radius': '3px',
      '--page-bg': 'radial-gradient(ellipse at 50% 40%, #3a2224 0%, #120b0d 70%)',
      '--page-fg': '#f3e5c6',
    },
  },
};

export default royal;
