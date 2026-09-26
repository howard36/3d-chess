import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import { useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import {
  BackSide,
  Color,
  CylinderGeometry,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import type {
  BufferGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshPhysicalMaterialParameters,
  Sprite,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CELLS } from '../../layout';
import { Shards } from '../kit/fx';
import { noRaycast } from '../kit/noRaycast';
import { GradientSky } from '../kit/sky';
import { rng } from '../kit/textures';
import type {
  CaptureFxProps,
  CelebrationProps,
  Design,
  GridProps,
  LastMoveMarkerProps,
  MarkerProps,
  MoveFxProps,
} from '../types';
import { Balloons, confettiGeometry, confettiMaterial, PowFlash, Puff, TossedPiece } from './fx';
import { ToyLabels } from './labels';
import { bodyMaterial, PieceBody } from './pieces';
import {
  alertTexture,
  FLOORS,
  grainTexture,
  HALF_BOARD,
  HALF_TRAY,
  layout,
  LEVEL_PAINT,
  NAVY,
  SPACING,
  squareTexture,
  sunTexture,
  TOY_COLORS,
} from './shared';

// Toy Box: a wooden Raumschach set from the toy shop. Five chunky trays, each
// painted a different candy colour and inlaid with squares, are threaded on
// beech dowels over a red base that sits on a cloud in a sunny sky. The
// armies are glossy painted toys: cream with red trim against navy with
// yellow trim.

const paint = (color: string, extra: MeshPhysicalMaterialParameters = {}) =>
  new MeshPhysicalMaterial({
    color,
    map: grainTexture,
    roughness: 0.42,
    clearcoat: 0.7,
    clearcoatRoughness: 0.2,
    envMapIntensity: 0.8,
    ...extra,
  });

// --- The tower ----------------------------------------------------------------

const TRAY_DEPTH = 0.17;
const rounded = (w: number, h: number, d: number, r: number, x: number, y: number, z: number) =>
  new RoundedBoxGeometry(w, h, d, 3, r).translate(x, y, z);

// One tray, its top surface at y = 0: a thick slab with a raised lip round
// the edge. Every level shares it; only the paint changes.
const trayGeometry = (() => {
  const w = HALF_TRAY * 2;
  const lip = 0.2;
  const inner = HALF_TRAY - lip / 2;
  const parts = [
    rounded(w, TRAY_DEPTH, w, 0.07, 0, -0.025 - TRAY_DEPTH / 2, 0),
    rounded(w, 0.11, lip, 0.045, 0, -0.015, inner),
    rounded(w, 0.11, lip, 0.045, 0, -0.015, -inner),
    rounded(lip, 0.11, w, 0.045, inner, -0.015, 0),
    rounded(lip, 0.11, w, 0.045, -inner, -0.015, 0),
  ];
  const g = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return g;
})();
const trayMaterials = LEVEL_PAINT.map((p) => paint(p.tray));

const tileGeometry = new RoundedBoxGeometry(SPACING - 0.08, 0.07, SPACING - 0.08, 2, 0.028);
const tileMaterial = paint('#ffffff', { roughness: 0.5, clearcoat: 0.45 });

const POST = HALF_TRAY - 0.1;
const BASE_TOP = FLOORS[0] - 0.025 - TRAY_DEPTH - 0.38;
const BASE_HEIGHT = 0.5;
const TOP = FLOORS[4] + 0.34;

// The four dowels, with a turned collar under every tray.
const postGeometry = (() => {
  const parts: BufferGeometry[] = [];
  for (const [sx, sz] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ]) {
    const [x, z] = [sx * POST, sz * POST];
    parts.push(
      new CylinderGeometry(0.1, 0.1, TOP - BASE_TOP, 28).translate(x, (TOP + BASE_TOP) / 2, z),
    );
    for (const f of FLOORS) {
      parts.push(
        new TorusGeometry(0.12, 0.045, 12, 28)
          .rotateX(Math.PI / 2)
          .translate(x, f - 0.025 - TRAY_DEPTH - 0.04, z),
      );
    }
  }
  const g = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return g;
})();
const beech = paint('#f1c089', { roughness: 0.5, clearcoat: 0.35 });
const capGeometry = new SphereGeometry(0.19, 28, 20);
const capMaterials = ['#ff4b4b', '#ffc21f', '#3e95e6', '#2fae7e'].map((c) =>
  paint(c, { map: null }),
);
const baseGeometry = new RoundedBoxGeometry(
  HALF_TRAY * 2 + 0.7,
  BASE_HEIGHT,
  HALF_TRAY * 2 + 0.7,
  4,
  0.16,
);
const baseMaterial = paint('#ff5a5f');

const Tiles = () => {
  const mesh = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const o = new Object3D();
    const c = new Color();
    CELLS.forEach((cell, i) => {
      const [x, y, z] = layout.toWorld(cell, 'white');
      o.position.set(x, y + layout.floorY - 0.035, z);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      const p = LEVEL_PAINT[cell.z];
      m.setColorAt(i, c.set((cell.x + cell.y + cell.z) % 2 === 0 ? p.dark : p.light));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, []);
  return (
    <instancedMesh
      ref={mesh}
      args={[tileGeometry, tileMaterial, CELLS.length]}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

const Grid = ({ orientation }: GridProps) => (
  <group>
    {FLOORS.map((y, z) => (
      <mesh
        key={z}
        position={[0, y, 0]}
        geometry={trayGeometry}
        material={trayMaterials[z]}
        raycast={noRaycast}
        castShadow
      />
    ))}
    <Tiles />
    <mesh geometry={postGeometry} material={beech} raycast={noRaycast} castShadow />
    {[
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ].map(([sx, sz], i) => (
      <mesh
        key={i}
        position={[sx * POST, TOP + 0.08, sz * POST]}
        geometry={capGeometry}
        material={capMaterials[i]}
        raycast={noRaycast}
        castShadow
      />
    ))}
    <mesh
      position={[0, BASE_TOP - BASE_HEIGHT / 2, 0]}
      geometry={baseGeometry}
      material={baseMaterial}
      raycast={noRaycast}
      castShadow
    />
    <ToyLabels orientation={orientation} />
  </group>
);

// --- Markers --------------------------------------------------------------------

const pegGeometry = (() => {
  const parts = [
    new CylinderGeometry(0.115, 0.125, 0.1, 28).translate(0, 0.05, 0),
    new SphereGeometry(0.115, 28, 14).scale(1, 0.65, 1).translate(0, 0.1, 0),
  ];
  const g = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return g;
})();
const pegMaterial = new MeshPhysicalMaterial({
  color: '#ffffff',
  emissive: '#ffffff',
  emissiveIntensity: 0.18,
  roughness: 0.22,
  clearcoat: 1,
});
const pegBand = new TorusGeometry(0.12, 0.028, 10, 32).rotateX(Math.PI / 2).translate(0, 0.035, 0);
const navyPaint = new MeshStandardMaterial({ color: NAVY, roughness: 0.35 });
const halo = new MeshBasicMaterial({
  color: '#ffffff',
  transparent: true,
  opacity: 0.8,
  depthWrite: false,
  toneMapped: false,
});
const shadowRing = new MeshBasicMaterial({
  color: NAVY,
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
  toneMapped: false,
});
const haloGeometry = new TorusGeometry(0.23, 0.026, 8, 36).rotateX(Math.PI / 2);

/** A little white peg with a navy band, hopping on the spot. */
const Quiet = ({ floor }: MarkerProps) => {
  const peg = useRef<Group>(null);
  const phase = (floor[0] + floor[2]) * 0.8;
  useFrame((state) => {
    const g = peg.current;
    if (!g) return;
    const b = Math.abs(Math.sin(state.clock.elapsedTime * 4 + phase));
    const squash = (1 - b) ** 6 * 0.3;
    g.position.y = b * 0.09;
    g.scale.set(1 + squash, 1 - squash, 1 + squash);
  });
  return (
    <group position={floor}>
      <group ref={peg}>
        <mesh geometry={pegGeometry} material={pegMaterial} raycast={noRaycast} />
        <mesh geometry={pegBand} material={navyPaint} raycast={noRaycast} />
      </group>
      <mesh
        geometry={haloGeometry}
        material={shadowRing}
        position={[0, 0.012, 0]}
        raycast={noRaycast}
      />
    </group>
  );
};

const ring = (color: string, emissive = 0.25) =>
  new MeshPhysicalMaterial({
    color,
    emissive: color,
    emissiveIntensity: emissive,
    roughness: 0.25,
    clearcoat: 1,
  });
const captureRing = new TorusGeometry(0.38, 0.05, 14, 48).rotateX(Math.PI / 2);
const captureInner = new TorusGeometry(0.31, 0.018, 8, 48).rotateX(Math.PI / 2);
const captureMaterial = ring('#ff3346', 0.35);

/** A chunky red toy ring round the piece that can be taken, pulsing. */
const Capture = ({ floor }: MarkerProps) => {
  const g = useRef<Group>(null);
  useFrame((state) => {
    if (g.current) g.current.scale.setScalar(1 + 0.07 * Math.sin(state.clock.elapsedTime * 7));
  });
  return (
    <group position={floor}>
      <group ref={g} position={[0, 0.05, 0]}>
        <mesh geometry={captureRing} material={captureMaterial} raycast={noRaycast} />
        <mesh geometry={captureInner} material={halo} raycast={noRaycast} />
      </group>
    </group>
  );
};

const selectRing = new TorusGeometry(0.36, 0.06, 14, 48).rotateX(Math.PI / 2);
const selectMaterial = ring('#ffc21f', 0.35);
const beadGeometry = new SphereGeometry(0.05, 12, 8);
const beadMaterial = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.3 });

/** A yellow ring with white beads running round it. */
const Selection = ({ floor }: MarkerProps) => {
  const beads = useRef<Group>(null);
  useFrame((state) => {
    if (beads.current) beads.current.rotation.y = state.clock.elapsedTime * 1.4;
  });
  return (
    <group position={[floor[0], floor[1] + 0.05, floor[2]]}>
      <mesh geometry={selectRing} material={selectMaterial} raycast={noRaycast} />
      <group ref={beads}>
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return (
            <mesh
              key={i}
              geometry={beadGeometry}
              material={beadMaterial}
              position={[Math.cos(a) * 0.36, 0.045, Math.sin(a) * 0.36]}
              raycast={noRaycast}
            />
          );
        })}
      </group>
    </group>
  );
};

const stickerGeometry = new PlaneGeometry(SPACING * 0.94, SPACING * 0.94).rotateX(-Math.PI / 2);
const fromMaterial = new MeshBasicMaterial({
  map: squareTexture(false),
  transparent: true,
  opacity: 0.95,
  depthWrite: false,
  toneMapped: false,
});
const toMaterial = new MeshBasicMaterial({
  map: squareTexture(true),
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
  toneMapped: false,
});
const LastMove = ({ from, to }: LastMoveMarkerProps) => (
  <>
    <mesh
      geometry={stickerGeometry}
      material={fromMaterial}
      position={[from.floor[0], from.floor[1] + 0.003, from.floor[2]]}
      raycast={noRaycast}
    />
    <mesh
      geometry={stickerGeometry}
      material={toMaterial}
      position={[to.floor[0], to.floor[1] + 0.003, to.floor[2]]}
      raycast={noRaycast}
    />
  </>
);

const checkRing = new TorusGeometry(0.4, 0.04, 12, 48).rotateX(Math.PI / 2);
const checkMaterial = ring('#ff1f3d', 0.6);

/** A pulsing red ring and a comic "!" bubble bobbing over the king. */
const Check = ({ floor }: MarkerProps) => {
  const pulse = useRef<Mesh>(null);
  const bubble = useRef<Sprite>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    pulse.current?.scale.setScalar(1 + 0.1 * Math.sin(t * 8));
    const b = bubble.current;
    if (b) {
      b.position.y = 1.45 + Math.abs(Math.sin(t * 3.5)) * 0.08;
      b.scale.set(0.6, 0.75, 1);
    }
    const glow = 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(t * 7));
    bodyMaterial('white', 'check').emissiveIntensity = glow;
    bodyMaterial('black', 'check').emissiveIntensity = glow;
  });
  return (
    <group position={floor}>
      <mesh
        ref={pulse}
        geometry={checkRing}
        material={checkMaterial}
        position={[0, 0.05, 0]}
        raycast={noRaycast}
      />
      <sprite ref={bubble} position={[0, 1.45, 0]} scale={[0.6, 0.75, 1]} raycast={noRaycast}>
        <spriteMaterial
          map={alertTexture}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </sprite>
    </group>
  );
};

// --- Effects ----------------------------------------------------------------------

const MoveFx = ({ to, durationMs, capture }: MoveFxProps) =>
  capture ? null : (
    <Puff position={[to[0], to[1] + layout.floorY, to[2]]} delayMs={durationMs * 0.96} />
  );

const CaptureFx = ({ floor, victim, durationMs }: CaptureFxProps) => {
  const impact = durationMs * 0.9;
  return (
    <>
      <TossedPiece type={victim.type} color={victim.color} floor={floor} delayMs={impact} />
      <PowFlash position={[floor[0], floor[1] + 0.6, floor[2]]} delayMs={impact} size={0.95} />
      <Puff position={floor} delayMs={impact} count={12} radius={0.55} />
      <Shards
        position={[floor[0], floor[1] + 0.35, floor[2]]}
        geometry={confettiGeometry}
        material={confettiMaterial}
        colors={TOY_COLORS}
        count={60}
        speed={3}
        gravity={2.2}
        upward={0.75}
        spread={0.2}
        lifeMs={1700}
        spin={9}
        flutter
        delayMs={impact}
        seed={9}
      />
    </>
  );
};

const Celebration = ({ floor }: CelebrationProps) => (
  <>
    {/* The king hits the tray */}
    <Puff position={floor} delayMs={480} count={14} radius={0.7} size={0.11} lifeMs={800} />
    {/* A confetti cannon out of the fallen king's square... */}
    <Shards
      position={[floor[0], floor[1] + 0.5, floor[2]]}
      geometry={confettiGeometry}
      material={confettiMaterial}
      colors={TOY_COLORS}
      count={170}
      speed={5}
      gravity={2.2}
      upward={0.9}
      spread={0.3}
      lifeMs={4200}
      spin={8}
      flutter
      delayMs={450}
      seed={17}
    />
    {/* ...confetti raining over the whole tower... */}
    <Shards
      position={[0, FLOORS[4] + 0.6, 0]}
      geometry={confettiGeometry}
      material={confettiMaterial}
      colors={TOY_COLORS}
      count={200}
      speed={0.6}
      gravity={3.2}
      upward={0}
      spread={HALF_BOARD * 2.2}
      lifeMs={5200}
      spin={6}
      flutter
      delayMs={700}
      seed={23}
    />
    {/* ...and a bunch of balloons */}
    <Balloons centre={floor} delayMs={650} count={11} />
  </>
);

// --- Stage ------------------------------------------------------------------------

const cloudMaterial = new MeshStandardMaterial({
  color: '#ffffff',
  roughness: 1,
  emissive: '#e3f1ff',
  emissiveIntensity: 0.5,
});

/** A puffy cartoon cloud: a row of balls, biggest in the middle, flat-ish underneath. */
const cloudGeometry = (seed: number, puffs: number) => {
  const random = rng(seed);
  const parts = Array.from({ length: puffs }, (_, i) => {
    const u = i / (puffs - 1);
    const r = 0.55 + Math.sin(u * Math.PI) * 0.5 + random() * 0.18;
    return new SphereGeometry(r, 20, 14).translate(
      (u - 0.5) * puffs * 0.62,
      r * 0.45 + random() * 0.1,
      (random() - 0.5) * 0.5,
    );
  });
  const g = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return g.scale(1, 0.82, 0.8);
};
const cloudShapes = [cloudGeometry(3, 6), cloudGeometry(8, 5), cloudGeometry(12, 7)];

// Where the background clouds sit and how fast they drift (units per second).
const CLOUDS: { p: [number, number, number]; s: number; shape: number; v: number }[] = [
  { p: [-13, -3, -16], s: 1.6, shape: 0, v: 0.22 },
  { p: [11, 1.5, -20], s: 1.9, shape: 2, v: 0.16 },
  { p: [-6, -10, -22], s: 2.2, shape: 1, v: 0.18 },
  { p: [15, -9, -12], s: 1.4, shape: 0, v: 0.25 },
  { p: [-17, 5, -24], s: 1.8, shape: 1, v: 0.14 },
  { p: [5, -15, -18], s: 2.4, shape: 2, v: 0.2 },
  { p: [-12, -13, -6], s: 1.3, shape: 2, v: 0.24 },
  { p: [12, 7, -26], s: 1.5, shape: 1, v: 0.12 },
];
const WRAP = 36;

const Clouds = () => {
  const refs = useRef<(Mesh | null)[]>([]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    CLOUDS.forEach((c, i) => {
      const m = refs.current[i];
      if (!m) return;
      m.position.x = ((((c.p[0] + c.v * t + WRAP / 2) % WRAP) + WRAP) % WRAP) - WRAP / 2;
    });
  });
  return (
    <>
      {CLOUDS.map((c, i) => (
        <mesh
          key={i}
          ref={(m) => {
            refs.current[i] = m;
          }}
          position={c.p}
          scale={c.s}
          geometry={cloudShapes[c.shape]}
          material={cloudMaterial}
          raycast={noRaycast}
        />
      ))}
    </>
  );
};

// The big cloud the whole set stands on.
const platformGeometry = (() => {
  const random = rng(31);
  const under = BASE_TOP - BASE_HEIGHT;
  // A broad flattened body the base sinks into, a ring of puffs hugging the
  // base (never taller than it) and a few heavier ones hanging underneath.
  const parts: BufferGeometry[] = [
    new SphereGeometry(3.6, 36, 20).scale(1.3, 0.34, 1.2).translate(0, under - 1.05, 0),
  ];
  for (let i = 0; i < 13; i++) {
    const a = (i / 13) * Math.PI * 2 + random() * 0.25;
    const r = 0.85 + random() * 0.55;
    parts.push(
      new SphereGeometry(r, 24, 16).translate(
        Math.cos(a) * (3.9 + random() * 0.6),
        under + 0.35 - r + random() * 0.2,
        Math.sin(a) * (3.7 + random() * 0.5),
      ),
    );
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    parts.push(
      new SphereGeometry(1.5 + random() * 0.5, 24, 16).translate(
        Math.cos(a) * 2.6,
        under - 1.9 - random() * 0.4,
        Math.sin(a) * 2.4,
      ),
    );
  }
  const g = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return g;
})();
const platformMaterial = new MeshStandardMaterial({
  color: '#ffffff',
  roughness: 1,
  emissive: '#dcecff',
  emissiveIntensity: 0.28,
});

const Stage = () => {
  return (
    <>
      <GradientSky top="#2f8cff" horizon="#5fb3ff" bottom="#d9f1ff" exponent={0.75} />
      <Environment resolution={128} frames={1}>
        <mesh scale={40}>
          <sphereGeometry args={[1, 24, 12]} />
          <meshBasicMaterial side={BackSide} color="#8ccaff" />
        </mesh>
        <Lightformer
          form="rect"
          intensity={3}
          color="#fff6e6"
          position={[2, 8, 3]}
          rotation-x={Math.PI / 2}
          scale={[10, 6, 1]}
        />
        <Lightformer
          form="rect"
          intensity={1.4}
          color="#ffffff"
          position={[0, 2, 9]}
          scale={[10, 3, 1]}
        />
        <Lightformer
          form="rect"
          intensity={0.9}
          color="#fff0dc"
          position={[0, -5, 0]}
          rotation-x={-Math.PI / 2}
          scale={[14, 14, 1]}
        />
      </Environment>
      <hemisphereLight args={['#d6ecff', '#ffe6c7', 1.25]} />
      <directionalLight
        position={[6, 11, 7]}
        intensity={2.1}
        color="#fff0d6"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
        shadow-camera-near={2}
        shadow-camera-far={40}
        shadow-bias={-0.0006}
        shadow-normalBias={0.03}
        shadow-radius={6}
      />
      <directionalLight position={[-7, 3, 6]} intensity={0.55} color="#d9e8ff" />
      <mesh
        geometry={platformGeometry}
        material={platformMaterial}
        raycast={noRaycast}
        receiveShadow
      />
      <Clouds />
      <sprite position={[30, -1, -46]} scale={16} raycast={noRaycast} renderOrder={-900}>
        <spriteMaterial map={sunTexture} depthWrite={false} fog={false} toneMapped={false} />
      </sprite>
    </>
  );
};

// Destination and last-move cells get no box fill: the markers say it all.
const hidden = new MeshBasicMaterial({ visible: false });

const toybox: Design = {
  id: 'toybox',
  name: 'Toy Box',
  blurb: 'Chunky painted-wood toys on stacked candy-coloured trays.',
  layout,
  continuous: true,
  canvas: { fov: 36, shadows: true, toneMapping: NeutralToneMapping, exposure: 1 },
  Stage,
  Grid,
  cellFills: { destination: hidden, lastMove: hidden },
  PieceBody,
  knightYaw: 0.75,
  markers: { Quiet, Capture, Selection, LastMove, Check },
  motion: { style: 'bounce', durationMs: 520, lift: 0.75 },
  MoveFx,
  CaptureFx,
  Celebration,
  toppleMatedKing: true,
  hoverLift: true,
  hud: {
    vars: {
      '--hud-font': '"Fredoka", "Trebuchet MS", sans-serif',
      '--hud-mono': '"Fredoka", ui-monospace, monospace',
      '--hud-bg': '#fffdf6',
      '--hud-fg': NAVY,
      '--hud-muted': 'rgba(39, 54, 107, 0.45)',
      '--hud-accent': '#ff4b4b',
      '--hud-accent-fg': '#ffffff',
      '--hud-border': `3px solid ${NAVY}`,
      '--hud-radius': '16px',
      '--hud-shadow': `0 5px 0 ${NAVY}`,
      '--hud-blur': 'none',
      '--hud-tracking': '0.01em',
      '--turn-bg': '#ffc21f',
      '--turn-fg': NAVY,
      '--turn-size': '22px',
      '--turn-border': `3px solid ${NAVY}`,
      '--turn-shadow': `0 6px 0 ${NAVY}`,
      '--modal-bg': '#fffdf6',
      '--modal-fg': NAVY,
      '--modal-backdrop': 'rgba(47, 140, 255, 0.28)',
      '--modal-radius': '28px',
      '--modal-shadow': `0 10px 0 ${NAVY}`,
      '--button-bg': '#ff4b4b',
      '--button-fg': '#ffffff',
      '--button-border': `3px solid ${NAVY}`,
      '--button-radius': '999px',
      '--page-bg': 'linear-gradient(180deg, #4aa6ff 0%, #bfe6ff 100%)',
      '--page-fg': NAVY,
    },
  },
};

export default toybox;
