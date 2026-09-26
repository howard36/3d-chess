import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/700.css';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import {
  BoxGeometry,
  CylinderGeometry,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  PlaneGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { Mesh, MeshBasicMaterial as BasicMaterial, Sprite, SpriteMaterial } from 'three';
import { StauntonParts } from '../classic/pieces';
import { towerBoardY, towerLayout } from '../kit/layouts';
import { noRaycast } from '../kit/noRaycast';
import { GradientSky } from '../kit/sky';
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
  Vec3,
} from '../types';
import { brushMaterial, Crumble, Flurry, LandingDust, useBrushIn } from './fx';
import { FallenPetals, Rocks, Sand } from './garden';
import { ZenLabels } from './labels';
import { PetalField } from './petals';
import { grooveMaterial, stoneGeometries, stoneMaterial } from './stone';
import type { StoneState } from './stone';
import {
  bambooTexture,
  ensoTexture,
  inkDotTexture,
  mapleTexture,
  sealTexture,
  sunTexture,
  trayTexture,
  washTexture,
} from './textures';

// Zen Garden: a Raumschach set on five pale maple trays, inlaid with walnut
// and carried on bamboo, standing in a raked-sand garden on a spring
// morning. The armies are river stones — speckled granite and basalt — and
// every mark on the board is ink: sumi dots, an ensō, a vermilion seal.

const INK = '#1d1b19';
const VERMILION = '#c44536';
const PAPER = '#efe8da';
const KNIGHT_YAW = 0.55;

// A little more headroom than the tower strictly needs, so the top tray's
// pieces clear the HUD.
const tower = towerLayout({ spacing: 1.1, levelGap: 2, viewDirection: [0.14, 0.46, 1] });
const layout = { ...tower, halfExtents: [2.75, 5, 2.75] as Vec3 };
const GRID = 5 * 1.1;
const TRAY = GRID + 0.44;
const THICK = 0.13;
const LEVELS = [0, 1, 2, 3, 4].map((z) => towerBoardY(layout, z));
const BOTTOM = LEVELS[0];
const TOP = LEVELS[4];
const SAND = BOTTOM - 1.9;
const POST = TRAY / 2 + 0.08;

// --- Pieces ---------------------------------------------------------------

const PieceBody = ({ type, color, selected, hovered, inCheck }: PieceBodyProps) => {
  const state: StoneState = inCheck ? 'check' : selected ? 'selected' : hovered ? 'hover' : 'none';
  return (
    <StauntonParts
      type={type}
      material={stoneMaterial(color, state)}
      groove={grooveMaterial[color]}
      geometries={stoneGeometries}
      castShadow
    />
  );
};

// --- Trays ----------------------------------------------------------------

const margin = (TRAY - GRID) / 2 / TRAY;
const edgeMaterial = new MeshStandardMaterial({
  map: mapleTexture,
  color: '#e9dfcc',
  roughness: 0.7,
});
const lipMaterial = new MeshStandardMaterial({
  map: mapleTexture,
  color: '#8a6446',
  roughness: 0.6,
});
const faceMaterials = [false, true].map(
  (odd) =>
    new MeshStandardMaterial({
      map: trayTexture(margin, odd),
      roughness: 0.62,
      metalness: 0,
      envMapIntensity: 0.6,
    }),
);
// Box faces: +x, -x, +y (the playing face), -y, +z, -z
const trayMaterials = faceMaterials.map((face) => [
  edgeMaterial,
  edgeMaterial,
  face,
  edgeMaterial,
  edgeMaterial,
  edgeMaterial,
]);
const trayGeometry = new BoxGeometry(TRAY, THICK, TRAY);
const lipGeometry = new BoxGeometry(TRAY + 0.02, 0.05, 0.07);

const postHeight = TOP + 0.55 - SAND;
const bamboo = bambooTexture.clone();
bamboo.repeat.set(1, postHeight / 0.62);
bamboo.needsUpdate = true;
const bambooMaterial = new MeshStandardMaterial({ map: bamboo, roughness: 0.5, metalness: 0 });
const postGeometry = new CylinderGeometry(0.07, 0.075, postHeight, 20, 1, true);
const capGeometry = new CylinderGeometry(0.072, 0.072, 0.02, 20);
const capMaterial = new MeshStandardMaterial({ color: '#d8cf9a', roughness: 0.6 });
const lashGeometry = new TorusGeometry(0.082, 0.014, 6, 20);
const lashMaterial = new MeshStandardMaterial({ color: '#3a2c20', roughness: 0.9 });
const CORNERS = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

const Grid = ({ layout: l, orientation }: GridProps) => (
  <group>
    {LEVELS.map((y, z) => (
      <group key={z} position={[0, y, 0]}>
        <mesh
          position={[0, -THICK / 2, 0]}
          geometry={trayGeometry}
          material={trayMaterials[z % 2]}
          receiveShadow
          castShadow
          raycast={noRaycast}
        />
        {[0, 1, 2, 3].map((i) => (
          <mesh
            key={i}
            geometry={lipGeometry}
            material={lipMaterial}
            position={[
              i < 2 ? 0 : (i === 2 ? -1 : 1) * (TRAY / 2 - 0.035),
              0.012,
              i < 2 ? (i === 0 ? -1 : 1) * (TRAY / 2 - 0.035) : 0,
            ]}
            rotation={[0, i < 2 ? 0 : Math.PI / 2, 0]}
            castShadow
            receiveShadow
            raycast={noRaycast}
          />
        ))}
      </group>
    ))}
    {CORNERS.map(([sx, sz], i) => (
      <group key={i} position={[sx * POST, 0, sz * POST]}>
        <mesh
          position={[0, SAND + postHeight / 2, 0]}
          geometry={postGeometry}
          material={bambooMaterial}
          castShadow
          receiveShadow
          raycast={noRaycast}
        />
        <mesh
          position={[0, SAND + postHeight, 0]}
          geometry={capGeometry}
          material={capMaterial}
          raycast={noRaycast}
        />
        {LEVELS.map((y) => (
          <group key={y} position={[0, y - THICK / 2, 0]}>
            {[-0.035, 0.035].map((dy) => (
              <mesh
                key={dy}
                position={[0, dy, 0]}
                rotation={[Math.PI / 2, 0, 0]}
                geometry={lashGeometry}
                material={lashMaterial}
                raycast={noRaycast}
              />
            ))}
          </group>
        ))}
      </group>
    ))}
    <ZenLabels layout={l} orientation={orientation} tray={TRAY} />
  </group>
);

// --- Markers --------------------------------------------------------------

const markGeometry = new PlaneGeometry(1, 1);
const inkMaterial = (map: typeof inkDotTexture, color = '#ffffff', opacity = 1) =>
  new MeshBasicMaterial({
    map,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    toneMapped: false,
  });
const dotMaterial = inkMaterial(inkDotTexture, '#ffffff', 0.9);
const sealMaterial = inkMaterial(sealTexture, '#ffffff', 0.95);
const washMaterial = inkMaterial(washTexture, '#ffffff', 0.42);

/** A sumi-ink dot on each empty square the piece may move to. */
const Quiet = ({ floor }: MarkerProps) => (
  <mesh
    geometry={markGeometry}
    material={dotMaterial}
    position={[floor[0], floor[1] + 0.004, floor[2]]}
    rotation={[-Math.PI / 2, 0, (floor[0] * 3.7 + floor[2] * 5.3) % Math.PI]}
    scale={0.48}
    raycast={noRaycast}
    renderOrder={3}
  />
);

/** A vermilion seal pressed around a piece that can be taken. */
const Capture = ({ floor }: MarkerProps) => {
  const mesh = useRef<Mesh>(null);
  const t = useRef(0);
  useFrame((_, delta) => {
    const m = mesh.current;
    if (!m || t.current > 0.3) return;
    t.current += Math.min(delta, 1 / 30);
    // Stamped: pressed down from a touch larger
    m.scale.setScalar(0.98 * (1 + 0.18 * (1 - Math.min(t.current / 0.22, 1)) ** 2));
  });
  return (
    <mesh
      ref={mesh}
      geometry={markGeometry}
      material={sealMaterial}
      position={[floor[0], floor[1] + 0.005, floor[2]]}
      rotation={[-Math.PI / 2, 0, 0.3]}
      scale={0.98}
      raycast={noRaycast}
      renderOrder={4}
    />
  );
};

/** An ensō brushed around the selected piece, drawn in as it is picked up. */
const Selection = ({ floor }: MarkerProps) => {
  const material = useMemo(() => brushMaterial(ensoTexture, INK, 0.88), []);
  useEffect(() => () => material.dispose(), [material]);
  useBrushIn(material, 380);
  return (
    <mesh
      geometry={markGeometry}
      material={material}
      position={[floor[0], floor[1] + 0.006, floor[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
      scale={1.02}
      raycast={noRaycast}
      renderOrder={5}
    />
  );
};

/** A pale ink wash over the squares of the last move. */
const LastMove = ({ from, to }: LastMoveMarkerProps) => (
  <>
    {[from, to].map((m, i) => (
      <mesh
        key={i}
        geometry={markGeometry}
        material={washMaterial}
        position={[m.floor[0], m.floor[1] + 0.003, m.floor[2]]}
        rotation={[-Math.PI / 2, 0, i * Math.PI]}
        scale={layout.cellSize[0] * 0.97}
        raycast={noRaycast}
        renderOrder={2}
      />
    ))}
  </>
);

const rippleGeometry = new PlaneGeometry(1, 1);

/**
 * A king in check: a red sun rises behind it, and vermilion ripples spread
 * from its feet like rings on still water.
 */
const Check = ({ floor }: MarkerProps) => {
  const rings = useRef<(Mesh | null)[]>([]);
  const sun = useRef<Sprite>(null);
  const camera = useThree((s) => s.camera);
  const materials = useMemo(() => [0, 1, 2].map(() => inkMaterial(sealTexture, '#ffffff', 0)), []);
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);
  const away = useMemo(() => new Vector3(), []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    rings.current.forEach((r, i) => {
      if (!r) return;
      const k = (t * 0.55 + i / 3) % 1;
      r.scale.setScalar(0.7 + k * 1.7);
      (r.material as BasicMaterial).opacity = 0.95 * (1 - k) ** 1.3;
    });
    const s = sun.current;
    if (s) {
      // Set just behind the king, as seen from wherever the camera is
      away
        .set(floor[0], floor[1] + 0.5, floor[2])
        .sub(camera.position)
        .normalize();
      s.position.set(floor[0], floor[1] + 0.52, floor[2]).addScaledVector(away, 0.45);
      s.scale.setScalar(1.05 + 0.06 * Math.sin(t * 4));
      (s.material as SpriteMaterial).opacity = 0.72 + 0.18 * Math.sin(t * 4);
    }
    const pulse = 0.32 + 0.22 * Math.sin(t * 4);
    stoneMaterial('white', 'check').emissiveIntensity = pulse;
    stoneMaterial('black', 'check').emissiveIntensity = pulse + 0.2;
  });
  return (
    <>
      <sprite ref={sun} raycast={noRaycast} renderOrder={1}>
        <spriteMaterial map={sunTexture} transparent depthWrite={false} toneMapped={false} />
      </sprite>
      {materials.map((m, i) => (
        <mesh
          key={i}
          ref={(el) => {
            rings.current[i] = el;
          }}
          geometry={rippleGeometry}
          material={m}
          position={[floor[0], floor[1] + 0.007 + i * 0.001, floor[2]]}
          rotation={[-Math.PI / 2, 0, i * 2.1]}
          raycast={noRaycast}
          renderOrder={6}
        />
      ))}
    </>
  );
};

// --- Effects ---------------------------------------------------------------

const MoveFx = ({ to, durationMs }: MoveFxProps) => (
  <LandingDust at={[to[0], to[1] + layout.floorY + 0.04, to[2]]} delayMs={durationMs * 0.95} />
);

const CaptureFx = ({ floor, victim, durationMs }: CaptureFxProps) => (
  <Crumble floor={floor} victim={victim} durationMs={durationMs} knightYaw={KNIGHT_YAW} />
);

const Celebration = ({ floor, winner }: CelebrationProps) => (
  <Flurry floor={floor} ink={winner === 'black' ? INK : VERMILION} />
);

// --- Stage ----------------------------------------------------------------

const Stage = ({ layout: l }: StageProps) => {
  const bottom = useMemo(() => towerBoardY(l, 0), [l]);
  const sand = bottom - 1.9;
  return (
    <>
      <GradientSky top="#e4dfd3" horizon={PAPER} bottom={PAPER} exponent={0.6} />
      <fog attach="fog" args={[PAPER, 26, 70]} />
      {/* Soft reflections: an overcast morning sky and a warm sun */}
      <Environment resolution={128} frames={1}>
        <Lightformer
          form="rect"
          intensity={1.6}
          color="#fff6e8"
          position={[0, 8, 2]}
          rotation-x={Math.PI / 2}
          scale={[12, 8, 1]}
        />
        <Lightformer
          form="rect"
          intensity={0.8}
          color="#dfe8f2"
          position={[-7, 2, 3]}
          scale={[4, 6, 1]}
        />
        <Lightformer form="circle" intensity={3} color="#ffe2b8" position={[-6, 9, 7]} scale={2} />
      </Environment>
      <hemisphereLight args={['#fff9ee', '#cdbd9c', 1.0]} />
      <directionalLight
        position={[-7, 13, 8]}
        intensity={2.8}
        color="#fff0da"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
        shadow-camera-near={1}
        shadow-camera-far={50}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      />
      <directionalLight position={[8, 4, -6]} intensity={0.45} color="#dce6f5" />
      <Sand y={sand} />
      <Rocks y={sand} />
      <FallenPetals y={sand} />
      <PetalField count={320} box={[18, 14, 18]} centre={[0, 0.5, 0]} />
    </>
  );
};

const hidden = new MeshBasicMaterial({ visible: false });

const zen: Design = {
  id: 'zen',
  name: 'Zen Garden',
  blurb: 'River stones on pale maple trays, drifting blossoms.',
  layout,
  continuous: true,
  canvas: { fov: 34, shadows: true, toneMapping: NeutralToneMapping, exposure: 1 },
  Stage,
  Grid,
  cellFills: { destination: hidden, lastMove: hidden },
  PieceBody,
  knightYaw: KNIGHT_YAW,
  markers: { Quiet, Capture, Selection, LastMove, Check },
  motion: { style: 'hop', durationMs: 620, lift: 0.5 },
  MoveFx,
  CaptureFx,
  Celebration,
  toppleMatedKing: true,
  hoverLift: true,
  hud: {
    vars: {
      '--hud-font': '"Cormorant Garamond", Georgia, serif',
      '--hud-mono': '"Cormorant Garamond", Georgia, serif',
      '--hud-bg': 'rgba(251, 247, 238, 0.88)',
      '--hud-fg': INK,
      '--hud-muted': 'rgba(70, 58, 48, 0.55)',
      '--hud-accent': VERMILION,
      '--hud-accent-fg': '#fbf6ea',
      '--hud-border': '1px solid rgba(40, 32, 26, 0.16)',
      '--hud-radius': '2px',
      '--hud-shadow': '0 6px 24px rgba(90, 70, 45, 0.12)',
      '--hud-blur': 'blur(4px)',
      '--hud-tracking': '0.03em',
      '--turn-bg': 'rgba(251, 247, 238, 0.92)',
      '--turn-fg': INK,
      '--turn-size': '22px',
      '--turn-border': '1px solid rgba(40, 32, 26, 0.16)',
      '--turn-shadow': `0 6px 20px rgba(90, 70, 45, 0.12), inset 0 -3px 0 ${VERMILION}`,
      '--modal-bg': 'radial-gradient(ellipse at 30% 15%, #fffcf4 0%, #f2eadb 100%)',
      '--modal-fg': INK,
      '--modal-backdrop': 'rgba(70, 58, 44, 0.16)',
      '--modal-radius': '2px',
      '--modal-shadow': '0 24px 60px rgba(70, 52, 34, 0.25)',
      '--button-bg': VERMILION,
      '--button-fg': '#fbf6ea',
      '--button-border': '1px solid #a8372a',
      '--button-radius': '2px',
      '--page-bg': 'radial-gradient(ellipse at 50% 30%, #fbf7ee 0%, #ebe2d0 100%)',
      '--page-fg': INK,
    },
    overlay: {
      background:
        'radial-gradient(ellipse at 50% 45%, transparent 62%, rgba(120, 96, 64, 0.16) 100%)',
    },
  },
};

export default zen;
