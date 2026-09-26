import '@fontsource/quicksand/500.css';
import '@fontsource/quicksand/700.css';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import {
  CircleGeometry,
  Color,
  DoubleSide,
  InstancedMesh,
  LatheGeometry,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  ShaderMaterial,
  TorusGeometry,
  Vector2,
} from 'three';
import type { Group, Mesh } from 'three';
import { PieceType } from '../../../engine/pieces';
import { buildStauntonGeometries } from '../../pieceGeometry';
import { StauntonParts } from '../classic/pieces';
import { Bloom } from '../kit/Bloom';
import { AmbientParticles, CheckBeacon, Shards } from '../kit/fx';
import { BoardLabels } from '../kit/labels';
import { towerBoardY, towerLayout } from '../kit/layouts';
import { noRaycast } from '../kit/noRaycast';
import { GradientSky } from '../kit/sky';
import { dotTexture, fbm, paintedTexture, rng, sparkTexture } from '../kit/textures';
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
import { Shockwave, SparkleBurst, SparkleTrail } from './effects';
import { gemMaterial, gemTime } from './gem';

// Crystal Garden: five frosted-glass plates etched in a checker, rimmed in
// shifting pastel light and held up by quartz columns, float over a garden of
// crystal clusters in a lavender-to-peach dusk. The armies are cut gems:
// clear diamond fire against deep amethyst.

const SPACING = 1.05;
const layout = towerLayout({ spacing: SPACING, levelGap: 2.0, viewDirection: [0.12, 0.52, 1] });
const BOARD = SPACING * 5;
const HALF = BOARD / 2;

const PLUM = '#4a2a6e';
const AQUA = '#2fd4d0';
const ROSE = '#ff5c9e';
const CHAMPAGNE = '#ffd27a';
const CHECK = '#ff2f6d';
const PASTELS = ['#ffffff', '#ffd1ec', '#cdeeff', '#e4d4ff', '#fff2c4'];
const GLITTER = ['#ff5fae', '#a45cff', '#22bfff', '#ffae1f', '#ffffff'];
const AMETHYST_GLITTER = ['#8a3dff', '#c55cff', '#ff4f9a', '#6a2bd9'];

// --- Pieces ---------------------------------------------------------------

// An eight-sided turning, flat shaded, reads as a cut stone.
const gems = buildStauntonGeometries(8);
// Gems stand a little taller than the classic set: the cell has room to spare.
const PIECE_SCALE = 1.12;

type Glow = 'none' | 'hover' | 'selected' | 'check';
const glowColor: Record<Glow, [string, number]> = {
  none: ['#000000', 0],
  hover: ['#ffc6ec', 0.14],
  selected: [CHAMPAGNE, 0.32],
  check: [CHECK, 0.7],
};

const pieceMaterials = new Map<string, ShaderMaterial>();
const pieceMaterial = (color: 'white' | 'black', glow: Glow) => {
  const key = `${color}-${glow}`;
  let m = pieceMaterials.get(key);
  if (!m) {
    const [glowTint, glowAmount] = glowColor[glow];
    m = gemMaterial(
      color === 'white'
        ? // Clear diamond: water-clear body, strong fire and glints
          {
            // A cool cast and a firm dark outline keep it from melting into
            // the pastel sky on the lower boards.
            tint: '#e2ecff',
            clarity: 0.86,
            f0: 0.17,
            dispersion: 0.09,
            sparkle: 1.1,
            bands: 1,
            edge: '#241651',
            edgeAmount: 0.95,
          }
        : // Deep amethyst: the same cut, the light inside it steeped in violet
          {
            tint: '#8f3fe0',
            clarity: 0.62,
            f0: 0.09,
            dispersion: 0.04,
            sparkle: 0.9,
            rim: '#d9b8ff',
            rimAmount: 0.25,
          },
    );
    m.uniforms.uGlow.value.set(glowTint);
    m.uniforms.uGlowAmt.value = glowAmount;
    m.uniforms.uPulse.value = glow === 'check' ? 1 : 0;
    pieceMaterials.set(key, m);
  }
  return m;
};

const PieceBody = ({ type, color, selected, hovered, inCheck }: PieceBodyProps) => {
  const glow: Glow = inCheck ? 'check' : selected ? 'selected' : hovered ? 'hover' : 'none';
  const m = pieceMaterial(color, glow);
  return (
    <group scale={PIECE_SCALE}>
      <StauntonParts type={type} material={m} groove={m} geometries={gems} />
    </group>
  );
};

// --- Board ----------------------------------------------------------------

const frost = fbm(8, 6, 4);

// A plate's face: alternate squares etched to a milky frost, the others left
// clear and tinted lilac, with bright etched lines between them.
const plateTexture = (odd: boolean) =>
  paintedTexture(
    (u, v) => {
      const i = Math.floor(u * 5);
      const j = Math.floor(v * 5);
      const etched = (i + j + (odd ? 1 : 0)) % 2 === 0;
      const fu = u * 5 - i;
      const fv = v * 5 - j;
      const edge = Math.min(fu, 1 - fu, fv, 1 - fv);
      const n = frost(u * 3, v * 3);
      if (edge < 0.016) return [255, 255, 255, 230];
      // A bevelled frost along each square's edge, clearer towards its middle
      const bevel = Math.max(0, 1 - edge / 0.12);
      return etched
        ? [252 - n * 14, 247 - n * 16, 255, 70 + n * 45 + bevel * 70]
        : [150 + n * 22, 118 + n * 18, 208, 85 + n * 20 + bevel * 55];
    },
    { size: 512, repeat: false },
  );

const plateMaterials = [false, true].map(
  (odd) =>
    new MeshPhysicalMaterial({
      map: plateTexture(odd),
      transparent: true,
      roughness: 0.28,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      iridescence: 0.5,
      iridescenceIOR: 1.3,
      envMapIntensity: 1,
      depthWrite: false,
      side: DoubleSide,
    }),
);

// The rims: a pastel rainbow that slowly flows around each plate.
const rimMaterial = new ShaderMaterial({
  uniforms: { uTime: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec3 vWorld;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */ `
    uniform float uTime; varying vec3 vWorld;
    vec3 hsv2rgb(vec3 c) {
      vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
      return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
    }
    void main() {
      float h = atan(vWorld.z, vWorld.x) / 6.2831853 + vWorld.y * 0.06 - uTime * 0.05;
      vec3 c = hsv2rgb(vec3(fract(h), 0.55, 1.0));
      gl_FragColor = vec4(c * 1.3, 1.0);
      #include <colorspace_fragment>
    }`,
});

// Quartz: a hexagonal prism with a pointed termination, one unit tall.
const quartzGeometry = new LatheGeometry(
  [new Vector2(0, 0), new Vector2(0.5, 0), new Vector2(0.5, 0.72), new Vector2(0, 1)],
  6,
);
// Tinted per crystal by instance colour.
const quartzMaterial = gemMaterial({ tint: '#ffffff', clarity: 0.95, f0: 0.08, sparkle: 0.8 });
const postMaterial = gemMaterial({ tint: '#f1e6ff', clarity: 1, f0: 0.1, sparkle: 0.6 });

const pedestalMaterial = new MeshPhysicalMaterial({
  color: '#efe6ff',
  flatShading: true,
  roughness: 0.35,
  clearcoat: 0.8,
  clearcoatRoughness: 0.2,
  sheen: 1,
  sheenColor: new Color('#ffd6ec'),
  envMapIntensity: 1,
});

/** Clusters of quartz growing around the pedestal, as one instanced mesh. */
const CrystalGarden = ({ y }: { y: number }) => {
  const mesh = useRef<InstancedMesh>(null);
  const crystals = useMemo(() => {
    const random = rng(21);
    const palette = ['#ffc4e1', '#d9c6ff', '#bdeaff', '#ffffff', '#b58cf0', '#ffe0c2'];
    const out: {
      p: [number, number, number];
      r: [number, number, number];
      s: [number, number, number];
      c: string;
    }[] = [];
    const clusters = 14;
    for (let k = 0; k < clusters; k++) {
      // Keep the front of the pedestal clear so nothing hides the lowest board
      const a = Math.PI * 0.28 + (k / (clusters - 1)) * Math.PI * 1.44 + (random() - 0.5) * 0.2;
      const ring = 3.7 + random() * 0.6;
      const cx = Math.sin(a + Math.PI) * ring;
      const cz = Math.cos(a + Math.PI) * ring;
      const back = Math.max(0, -cz / ring);
      const big = 0.6 + back * 1.3 + random() * 0.5;
      const color = palette[k % palette.length];
      const n = 3 + Math.floor(random() * 4);
      for (let i = 0; i < n; i++) {
        const h = big * (0.45 + random() * 0.7) * (i === 0 ? 1.25 : 1);
        const w = h * (0.22 + random() * 0.1);
        out.push({
          p: [cx + (random() - 0.5) * 0.5, y, cz + (random() - 0.5) * 0.5],
          r: [(random() - 0.5) * 0.9, random() * Math.PI, (random() - 0.5) * 0.9],
          s: [w, h, w],
          c: i === 0 ? color : palette[Math.floor(random() * palette.length)],
        });
      }
    }
    return out;
  }, [y]);

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const o = new Object3D();
    const c = new Color();
    crystals.forEach((cr, i) => {
      o.position.set(...cr.p);
      o.rotation.set(...cr.r);
      o.scale.set(...cr.s);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, c.set(cr.c));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [crystals]);

  return (
    <instancedMesh
      ref={mesh}
      args={[quartzGeometry, quartzMaterial, crystals.length]}
      raycast={noRaycast}
    />
  );
};

const Grid = ({ layout: l, orientation }: GridProps) => {
  const levels = [0, 1, 2, 3, 4].map((z) => towerBoardY(l, z));
  const top = levels[4];
  const bottom = levels[0];
  const base = bottom - 0.55;
  const r = HALF + 0.07;
  return (
    <group>
      {levels.map((y, z) => (
        <group key={z} position={[0, y, 0]}>
          <mesh
            position={[0, -0.02, 0]}
            material={plateMaterials[z % 2]}
            raycast={noRaycast}
            renderOrder={-10 + z}
          >
            <boxGeometry args={[BOARD, 0.04, BOARD]} />
          </mesh>
          {/* Glowing rim */}
          {[
            [0, r, BOARD + 0.18, 0.045],
            [0, -r, BOARD + 0.18, 0.045],
            [r, 0, 0.045, BOARD + 0.18],
            [-r, 0, 0.045, BOARD + 0.18],
          ].map(([x, zz, w, d], i) => (
            <mesh key={i} position={[x, -0.02, zz]} material={rimMaterial} raycast={noRaycast}>
              <boxGeometry args={[w, 0.045, d]} />
            </mesh>
          ))}
        </group>
      ))}
      {/* Quartz columns at the corners, each crowned with a point */}
      {[
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ].map(([sx, sz], i) => (
        <group key={i} position={[sx * (r + 0.02), 0, sz * (r + 0.02)]}>
          <mesh
            position={[0, (top + base) / 2, 0]}
            material={postMaterial}
            raycast={noRaycast}
            rotation={[0, Math.PI / 6, 0]}
          >
            <cylinderGeometry args={[0.05, 0.05, top - base, 6]} />
          </mesh>
          <mesh
            position={[0, top + 0.2, 0]}
            material={postMaterial}
            raycast={noRaycast}
            rotation={[0, Math.PI / 6, 0]}
          >
            <coneGeometry args={[0.05, 0.4, 6]} />
          </mesh>
        </group>
      ))}
      {/* A faceted pedestal, and the garden of crystals around it */}
      <mesh
        position={[0, base - 0.18, 0]}
        material={pedestalMaterial}
        raycast={noRaycast}
        rotation={[0, Math.PI / 12, 0]}
      >
        <cylinderGeometry args={[3.5, 3.8, 0.36, 12]} />
      </mesh>
      <CrystalGarden y={base - 0.1} />
      <BoardLabels
        layout={l}
        orientation={orientation}
        font="Quicksand, sans-serif"
        weight={700}
        color={PLUM}
        shadow="rgba(255,255,255,0.95)"
        size={0.42}
        opacity={0.95}
      />
    </group>
  );
};

// --- Markers --------------------------------------------------------------

const glow = dotTexture(0.85);

const quietGem = new OctahedronGeometry(0.13, 0);
const quietMaterial = gemMaterial({
  tint: '#7ff7ee',
  clarity: 1,
  f0: 0.12,
  sparkle: 1.4,
  glow: AQUA,
  glowAmount: 0.45,
  edge: '#0f4f63',
  edgeAmount: 0.5,
  bands: 0.7,
});
const floorDot = new CircleGeometry(0.3, 32);
const bigFloorDot = new CircleGeometry(0.55, 32);
const quietFloorMaterial = new MeshBasicMaterial({
  map: glow,
  color: AQUA,
  transparent: true,
  opacity: 0.9,
  depthWrite: false,
  toneMapped: false,
});

const Quiet = ({ floor }: MarkerProps) => {
  const gem = useRef<Mesh>(null);
  const phase = floor[0] * 1.7 + floor[2] * 2.3 + floor[1];
  useFrame(({ clock }) => {
    const g = gem.current;
    if (!g) return;
    const t = clock.elapsedTime;
    g.rotation.y = t * 1.8 + phase;
    g.position.y = 0.36 + Math.sin(t * 2.4 + phase) * 0.05;
  });
  return (
    <group position={floor}>
      <mesh
        ref={gem}
        geometry={quietGem}
        material={quietMaterial}
        position={[0, 0.36, 0]}
        scale={[1, 1.45, 1]}
        raycast={noRaycast}
      />
      <mesh
        geometry={floorDot}
        material={quietFloorMaterial}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.012, 0]}
        raycast={noRaycast}
      />
    </group>
  );
};

const captureRing = new TorusGeometry(0.41, 0.045, 5, 14);
const captureMaterial = new MeshStandardMaterial({
  color: ROSE,
  emissive: new Color(ROSE),
  emissiveIntensity: 0.9,
  roughness: 0.25,
  flatShading: true,
});
const captureFloorMaterial = new MeshBasicMaterial({
  map: glow,
  color: ROSE,
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
  toneMapped: false,
});

const Capture = ({ floor }: MarkerProps) => {
  const ring = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (ring.current) ring.current.rotation.z = clock.elapsedTime * 0.8;
  });
  return (
    <group position={floor}>
      <mesh
        ref={ring}
        geometry={captureRing}
        material={captureMaterial}
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0.05, 0]}
        raycast={noRaycast}
      />
      <mesh
        geometry={bigFloorDot}
        material={captureFloorMaterial}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.012, 0]}
        raycast={noRaycast}
      />
    </group>
  );
};

// The selection: a gold ring at the piece's foot and a little orbit of
// golden crystals and stars circling it.
const HALO = 7;
const haloGem = new OctahedronGeometry(0.07, 0);
const haloMaterial = gemMaterial({
  tint: '#ffd27a',
  clarity: 1.1,
  f0: 0.15,
  sparkle: 1.5,
  glow: '#ffb640',
  glowAmount: 0.5,
  edge: '#6b3a10',
  edgeAmount: 0.4,
  bands: 0.6,
});
const selectionFloorMaterial = new MeshBasicMaterial({
  map: glow,
  color: '#ffc861',
  transparent: true,
  opacity: 0.75,
  depthWrite: false,
  toneMapped: false,
});
const Selection = ({ floor }: MarkerProps) => {
  const halo = useRef<Group>(null);
  useFrame(({ clock }) => {
    const h = halo.current;
    if (!h) return;
    const t = clock.elapsedTime;
    h.rotation.y = t * 1.1;
    h.children.forEach((c, i) => {
      c.position.y = 0.45 + Math.sin(t * 2.2 + i * 1.9) * 0.18;
      c.rotation.set(t * 2 + i, t * 3 + i, 0);
    });
  });
  return (
    <group position={floor}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.014, 0]} raycast={noRaycast}>
        <ringGeometry args={[0.34, 0.42, 48]} />
        <meshBasicMaterial color="#ffc24d" toneMapped={false} transparent opacity={0.95} />
      </mesh>
      <mesh
        geometry={bigFloorDot}
        material={selectionFloorMaterial}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.01, 0]}
        raycast={noRaycast}
      />
      <group ref={halo}>
        {Array.from({ length: HALO }, (_, i) => {
          const a = (i / HALO) * Math.PI * 2;
          return (
            <mesh
              key={i}
              geometry={haloGem}
              material={haloMaterial}
              position={[Math.cos(a) * 0.44, 0.45, Math.sin(a) * 0.44]}
              scale={[1, 1.6, 1]}
              raycast={noRaycast}
            />
          );
        })}
      </group>
    </group>
  );
};

// Soft-edged squares of light under the last move.
const softSquare = paintedTexture(
  (u, v) => {
    const e = Math.min(u, 1 - u, v, 1 - v);
    const a = Math.min(1, e / 0.18) ** 1.5;
    return [255, 255, 255, Math.round(a * 255)];
  },
  { size: 128, repeat: false },
);
const squareGeometry = new PlaneGeometry(1, 1);
const lastMoveMaterials = [0.35, 0.6].map(
  (opacity) =>
    new MeshBasicMaterial({
      map: softSquare,
      color: '#ffb38a',
      transparent: true,
      opacity,
      depthWrite: false,
      toneMapped: false,
    }),
);
const LastMove = ({ from, to }: LastMoveMarkerProps) => (
  <>
    {[from, to].map((m, i) => (
      <mesh
        key={i}
        geometry={squareGeometry}
        material={lastMoveMaterials[i]}
        position={[m.floor[0], m.floor[1] + 0.006, m.floor[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={SPACING * 0.98}
        raycast={noRaycast}
      />
    ))}
  </>
);

// Check: a pulsing ruby ring and a crown of red crystals whirling round the
// king, painted rather than glowing so it reads against the pale sky.
const alarmGem = new OctahedronGeometry(0.06, 0);
const alarmMaterial = gemMaterial({
  tint: '#ff4d7a',
  clarity: 0.9,
  f0: 0.12,
  sparkle: 1.2,
  glow: CHECK,
  glowAmount: 0.35,
  edge: '#5a0620',
  edgeAmount: 0.5,
  bands: 0.7,
});
const alarmRingMaterial = new MeshBasicMaterial({
  color: CHECK,
  transparent: true,
  depthWrite: false,
  toneMapped: false,
});
const ALARM = 8;
const Check = ({ floor }: MarkerProps) => {
  const crown = useRef<Group>(null);
  const ring = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (crown.current) crown.current.rotation.y = t * 2.2;
    const r = ring.current;
    if (r) {
      const k = (t * 1.2) % 1;
      r.scale.setScalar(0.75 + k * 0.7);
      alarmRingMaterial.opacity = 0.95 * (1 - k);
    }
  });
  return (
    <group position={floor}>
      <CheckBeacon floor={[0, 0, 0]} color={CHECK} height={1.2} />
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} raycast={noRaycast}>
        <ringGeometry args={[0.36, 0.45, 48]} />
        <primitive object={alarmRingMaterial} attach="material" />
      </mesh>
      <group ref={crown} position={[0, 0.62, 0]}>
        {Array.from({ length: ALARM }, (_, i) => {
          const a = (i / ALARM) * Math.PI * 2;
          return (
            <mesh
              key={i}
              geometry={alarmGem}
              material={alarmMaterial}
              position={[Math.cos(a) * 0.42, Math.sin(a * 2) * 0.06, Math.sin(a) * 0.42]}
              scale={[1, 1.5, 1]}
              raycast={noRaycast}
            />
          );
        })}
      </group>
    </group>
  );
};

// --- Effects ---------------------------------------------------------------

const MOTION = { style: 'hop' as const, durationMs: 520, lift: 0.6 };
// The height of a piece's heart above its cell centre, where the trail flows.
const BODY_Y = layout.floorY + 0.32;

const MoveFx = ({ from, to, color, durationMs }: MoveFxProps) => {
  const white = color === 'white';
  // Painted, not glowing: saturated sparks read against the pale sky
  const colors = white ? GLITTER : AMETHYST_GLITTER;
  return (
    <>
      <SparkleTrail
        from={[from[0], from[1] + BODY_Y, from[2]]}
        to={[to[0], to[1] + BODY_Y, to[2]]}
        lift={MOTION.lift}
        durationMs={durationMs}
        colors={colors}
        size={0.17}
        additive={false}
      />
      <SparkleBurst
        position={[to[0], to[1] + layout.floorY + 0.05, to[2]]}
        colors={colors}
        count={26}
        speed={1.3}
        gravity={0.8}
        upward={0.7}
        lifeMs={750}
        size={0.2}
        additive={false}
        delayMs={durationMs * 0.95}
      />
      <Shockwave
        position={[to[0], to[1] + layout.floorY + 0.02, to[2]]}
        color={white ? '#ff8cc8' : '#9d5cff'}
        radius={0.75}
        lifeMs={550}
        delayMs={durationMs * 0.95}
        opacity={0.7}
        additive={false}
      />
    </>
  );
};

const shardGeometry = new OctahedronGeometry(0.06, 0);
const shardMaterials = {
  white: gemMaterial({ tint: '#ffffff', clarity: 1, f0: 0.17, sparkle: 1.5 }),
  black: gemMaterial({ tint: '#8f3fe0', clarity: 0.7, f0: 0.1, sparkle: 1.5 }),
};

/**
 * The captured piece stands its ground until the attacker drops onto it,
 * shivers, and bursts into crystal shards and sparkles.
 */
const Shatter = ({
  victim,
  centre,
  durationMs,
}: Pick<CaptureFxProps, 'victim' | 'centre' | 'durationMs'>) => {
  const group = useRef<Group>(null);
  const elapsed = useRef(0);
  const breakAt = durationMs * 0.82;
  useEffect(() => {
    group.current?.traverse((o) => {
      (o as Mesh).raycast = noRaycast;
    });
  }, []);
  useFrame((_, delta) => {
    const g = group.current;
    if (!g || !g.visible) return;
    elapsed.current += Math.min(delta, 1 / 30) * 1000;
    const t = elapsed.current;
    if (t >= breakAt) {
      g.visible = false;
      return;
    }
    // A shiver as the attacker bears down
    const k = Math.max(0, (t - breakAt * 0.55) / (breakAt * 0.45));
    g.position.x = Math.sin(t * 0.9) * 0.025 * k;
    g.position.z = Math.cos(t * 1.1) * 0.025 * k;
    g.scale.setScalar(1 + 0.06 * k);
  });
  const yaw = victim.type === PieceType.Knight ? (victim.color === 'white' ? 1 : -1) * 1.05 : 0;
  return (
    <group position={[centre[0], centre[1] + layout.floorY, centre[2]]}>
      <group ref={group} rotation={[0, yaw, 0]}>
        <PieceBody
          type={victim.type}
          color={victim.color}
          emissive="#000000"
          selected={false}
          hovered={false}
          inCheck={false}
        />
      </group>
    </group>
  );
};

const CaptureFx = ({ centre, floor, victim, durationMs }: CaptureFxProps) => {
  const white = victim.color === 'white';
  const at = durationMs * 0.82;
  return (
    <>
      <Shatter victim={victim} centre={centre} durationMs={durationMs} />
      <Shards
        position={[floor[0], floor[1] + 0.3, floor[2]]}
        geometry={shardGeometry}
        material={shardMaterials[victim.color]}
        count={34}
        speed={2.6}
        gravity={5}
        upward={0.45}
        spread={0.35}
        lifeMs={1300}
        spin={9}
        delayMs={at}
      />
      <SparkleBurst
        position={[floor[0], floor[1] + 0.4, floor[2]]}
        colors={white ? GLITTER : AMETHYST_GLITTER}
        count={70}
        speed={2.6}
        gravity={1.4}
        upward={0.3}
        lifeMs={1200}
        size={0.22}
        additive={false}
        delayMs={at}
      />
      <Shockwave
        position={[floor[0], floor[1] + 0.02, floor[2]]}
        color={ROSE}
        radius={1.1}
        lifeMs={700}
        delayMs={at}
        additive={false}
      />
    </>
  );
};

const prismGeometry = new OctahedronGeometry(0.07, 0).scale(1, 1.6, 0.35);
// Tinted per prism by instance colour.
const prismMaterial = gemMaterial({ tint: '#ffffff', clarity: 1.05, f0: 0.12, sparkle: 1.4 });

const Celebration = ({ floor }: CelebrationProps) => (
  <>
    <Shards
      position={[floor[0], floor[1] + 1, floor[2]]}
      geometry={prismGeometry}
      material={prismMaterial}
      colors={['#ffb8dc', '#b8e6ff', '#d8bcff', '#fff0a8', '#bff5dc', '#ffffff']}
      count={180}
      speed={3.6}
      gravity={1.1}
      upward={0.85}
      spread={0.5}
      lifeMs={4200}
      spin={6}
      flutter
      delayMs={450}
    />
    <SparkleBurst
      position={[floor[0], floor[1] + 0.7, floor[2]]}
      colors={[...GLITTER, ...PASTELS]}
      additive={false}
      count={140}
      speed={3.2}
      gravity={0.9}
      upward={0.55}
      lifeMs={2200}
      size={0.26}
      delayMs={400}
    />
    <Shockwave
      position={[floor[0], floor[1] + 0.03, floor[2]]}
      color="#c77dff"
      radius={2.2}
      lifeMs={1100}
      delayMs={380}
      additive={false}
    />
  </>
);

// --- Stage ----------------------------------------------------------------

const sparkles = sparkTexture(64);

const Stage = ({ layout: l }: StageProps) => {
  const bottom = useMemo(() => towerBoardY(l, 0), [l]);
  useFrame(({ clock }) => {
    gemTime.value = clock.elapsedTime;
    rimMaterial.uniforms.uTime.value = clock.elapsedTime;
  });
  return (
    <>
      <GradientSky top="#8f7ee0" horizon="#ffd8cf" bottom="#9b84da" exponent={0.9} />
      <fog attach="fog" args={['#e9c6e6', 30, 70]} />
      {/* Reflections: pastel softboxes around a dusky lilac room */}
      <Environment resolution={256} frames={1}>
        {/* A deep indigo room with pastel strips and sparks of light: facets
            flip between dark and bright, which is what makes a cut stone read */}
        <color attach="background" args={['#221a40']} />
        <Lightformer
          form="rect"
          intensity={2.6}
          color="#ffffff"
          position={[0, 7, 1]}
          rotation-x={Math.PI / 2}
          scale={[5, 2.5, 1]}
        />
        <Lightformer
          form="rect"
          intensity={2.6}
          color="#ffa8d2"
          position={[-6, 1, 1]}
          rotation-y={Math.PI / 2}
          scale={[1.2, 8, 1]}
        />
        <Lightformer
          form="rect"
          intensity={2.6}
          color="#9fe0ff"
          position={[6, 1, 1]}
          rotation-y={-Math.PI / 2}
          scale={[1.2, 8, 1]}
        />
        <Lightformer form="ring" intensity={2.4} color="#fff0c2" position={[0, 2, 7]} scale={1.8} />
        <Lightformer
          form="rect"
          intensity={1.4}
          color="#d4bcff"
          position={[0, 1, -7]}
          scale={[6, 1.5, 1]}
        />
        {[
          [-4, 4, 4, '#ffffff'],
          [4, 5, 3, '#ffe6a8'],
          [-3, -2, 5, '#c7f0ff'],
          [3, -1, 5, '#ffc2e6'],
          [-5, 3, -3, '#e6d2ff'],
          [5, 2, -4, '#ffffff'],
          [0, -4, 4, '#ffd9f0'],
        ].map(([x, y, z, c], i) => (
          <Lightformer
            key={i}
            form="circle"
            intensity={4}
            color={c as string}
            position={[x as number, y as number, z as number]}
            scale={0.9}
            target={[0, 0, 0]}
          />
        ))}
      </Environment>
      <hemisphereLight args={['#f6eeff', '#f2c9df', 0.9]} />
      <directionalLight position={[3, 12, 6]} intensity={1.4} color="#fff6ee" />
      <pointLight position={[-5, 3, 4]} intensity={18} color="#ff9ccd" distance={20} />
      <pointLight position={[5, 1, 4]} intensity={18} color="#9edcff" distance={20} />
      {/* A soft pool of light under the pedestal */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, bottom - 1.2, 0]} raycast={noRaycast}>
        <circleGeometry args={[10, 64]} />
        <meshBasicMaterial
          map={glow}
          color="#ffffff"
          transparent
          opacity={0.5}
          depthWrite={false}
        />
      </mesh>
      <AmbientParticles
        count={260}
        box={[18, 14, 18]}
        velocity={[0, 0.12, 0]}
        sway={0.4}
        size={0.2}
        colors={['#ffffff', '#fff0fa', '#e6f7ff', '#fff6d6']}
        texture={sparkles}
        twinkle={0.9}
        opacity={0.95}
      />
      <Bloom strength={0.45} radius={0.55} threshold={0.95} />
    </>
  );
};

// Destination cells get no box fill: the floating gems say it all.
const hidden = new MeshBasicMaterial({ visible: false });

const crystal: Design = {
  id: 'crystal',
  name: 'Crystal Garden',
  blurb: 'Clear crystal against amethyst on frosted glass, in pastel light.',
  layout,
  continuous: true,
  canvas: { fov: 36, toneMapping: NeutralToneMapping, exposure: 1.0 },
  Stage,
  Grid,
  cellFills: { destination: hidden, lastMove: hidden },
  PieceBody,
  knightYaw: 0.55,
  markers: { Quiet, Capture, Selection, LastMove, Check },
  motion: MOTION,
  MoveFx,
  CaptureFx,
  Celebration,
  toppleMatedKing: true,
  hoverLift: true,
  hud: {
    vars: {
      '--hud-font': '"Quicksand", "Nunito", system-ui, sans-serif',
      '--hud-mono': '"Quicksand", system-ui, sans-serif',
      '--hud-bg': 'rgba(255, 255, 255, 0.42)',
      '--hud-fg': '#4a2a6e',
      '--hud-muted': 'rgba(74, 42, 110, 0.6)',
      '--hud-accent': '#b25fe0',
      '--hud-accent-fg': '#ffffff',
      '--hud-border': '1px solid rgba(255, 255, 255, 0.75)',
      '--hud-radius': '16px',
      '--hud-shadow': '0 8px 28px rgba(110, 70, 170, 0.18), inset 0 1px 0 rgba(255,255,255,0.8)',
      '--hud-blur': 'blur(14px) saturate(1.4)',
      '--hud-tracking': '0.02em',
      '--turn-bg': 'linear-gradient(135deg, rgba(255,255,255,0.62), rgba(246,226,255,0.5))',
      '--turn-fg': '#4a2a6e',
      '--turn-border': '1px solid rgba(255, 255, 255, 0.9)',
      '--turn-shadow': '0 6px 24px rgba(178, 95, 224, 0.28), inset 0 1px 0 #ffffff',
      '--modal-bg': 'linear-gradient(160deg, rgba(255,255,255,0.86), rgba(243,226,255,0.8))',
      '--modal-fg': '#3f2360',
      '--modal-backdrop': 'rgba(190, 160, 230, 0.28)',
      '--modal-radius': '22px',
      '--modal-shadow': '0 20px 60px rgba(120, 70, 190, 0.3), inset 0 1px 0 #ffffff',
      '--button-bg': 'linear-gradient(135deg, #c48bff, #ff8cc6)',
      '--button-fg': '#ffffff',
      '--button-border': '1px solid rgba(255, 255, 255, 0.8)',
      '--button-radius': '999px',
      '--page-bg': 'linear-gradient(170deg, #b9a8ee 0%, #f6d3ea 55%, #ffe3cf 100%)',
      '--page-fg': '#4a2a6e',
    },
    overlay: {
      background:
        'radial-gradient(ellipse at 50% 45%, transparent 55%, rgba(150, 110, 210, 0.2) 100%), ' +
        'linear-gradient(120deg, rgba(255, 200, 235, 0.12), transparent 40%, rgba(190, 230, 255, 0.1))',
    },
  },
};

export default crystal;
