import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  EdgesGeometry,
  LineBasicMaterial,
  MeshBasicMaterial,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { Group, Mesh, PerspectiveCamera, Sprite, SpriteMaterial } from 'three';
import { CELLS } from '../../layout';
import { StauntonParts } from '../classic/pieces';
import { Bloom } from '../kit/Bloom';
import { AmbientParticles } from '../kit/fx';
import { latticeLayout } from '../kit/layouts';
import { noRaycast } from '../kit/noRaycast';
import { Starfield } from '../kit/sky';
import { dotTexture, rng, sparkTexture } from '../kit/textures';
import type {
  CaptureFxProps,
  CelebrationProps,
  Design,
  GridProps,
  LastMoveMarkerProps,
  MarkerProps,
  MoveFxProps,
  PieceBodyProps,
  Vec3,
} from '../types';
import { BrightStars, Nebula, RingedPlanet, SUN_DIRECTION } from './backdrop';
import { CometTrail, Galaxy, Supernova } from './fx';
import { LatticeLabels } from './labels';
import { cosmosTime, pieceMaterial, pixelScale } from './shaders';
import type { Glow } from './shaders';

// Cosmos: the board adrift in deep space. The 125 cells are a constellation,
// a star at every square joined by faint lines inside a brighter cube; the
// White army are little golden suns, the Black army night-side worlds with
// blue atmospheres. A nebula, a ringed giant and a slow drift of stardust
// fill the dark around it.

const STARLIGHT = '#dff3ff';
const CYAN = '#7dd3fc';
const CORAL = '#ff4f7b';
const EMBER = '#ff4a1c';
const GOLD = '#ffd27a';
const LILAC = '#c4b5fd';

const layout = latticeLayout(1.3);
const EDGE = layout.halfExtents[0];
const KNIGHT_YAW = 0.35;

const spark = sparkTexture(128);
const soft = dotTexture(0.7, 128);
const crisp = dotTexture(0.35, 64);

// --- Pieces ---------------------------------------------------------------

// The bishop's mitre cut: a glowing slot on the suns, a blue one on the worlds.
const grooves = {
  white: new MeshBasicMaterial({ color: new Color('#ff7a1c').multiplyScalar(1.6) }),
  black: new MeshBasicMaterial({ color: new Color('#63c8ff').multiplyScalar(1.4) }),
};

const PieceBody = ({ type, color, selected, hovered, inCheck }: PieceBodyProps) => {
  const glow: Glow = inCheck ? 'check' : selected ? 'selected' : hovered ? 'hover' : 'none';
  return (
    <StauntonParts type={type} material={pieceMaterial(color, glow)} groove={grooves[color]} />
  );
};

// --- Constellation grid -----------------------------------------------------

// A star at every cell's floor, where a piece stands.
const nodes: Vec3[] = CELLS.map((cell) => {
  const [x, y, z] = layout.toWorld(cell, 'white');
  return [x, y + layout.floorY, z];
});
const nodeCoords = [...new Set(nodes.map((n) => n[0]))].sort((a, b) => a - b);
const floors = [...new Set(nodes.map((n) => n[1]))].sort((a, b) => a - b);
const LO = nodeCoords[0];
const HI = nodeCoords[nodeCoords.length - 1];

const starPoints = (points: Vec3[], sizes: number[], colors: string[], seed: number) => {
  const random = rng(seed);
  const g = new BufferGeometry();
  const c = new Color();
  g.setAttribute('position', new BufferAttribute(new Float32Array(points.flat()), 3));
  g.setAttribute('aSize', new BufferAttribute(new Float32Array(sizes), 1));
  g.setAttribute('aSeed', new BufferAttribute(new Float32Array(points.map(() => random())), 1));
  g.setAttribute(
    'color',
    new BufferAttribute(
      new Float32Array(points.flatMap((_, i) => c.set(colors[i % colors.length]).toArray())),
      3,
    ),
  );
  return g;
};

const starMaterial = (map: typeof spark, strength: number) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexColors: true,
    uniforms: { uTime: cosmosTime, uScale: pixelScale, uMap: { value: map } },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uScale;
      attribute float aSize; attribute float aSeed;
      varying vec3 vColor; varying float vAlpha;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vAlpha = 0.72 + 0.28 * sin(uTime * (0.8 + aSeed * 1.9) + aSeed * 40.0);
        // Far stars of the lattice dim a little: a depth cue
        vAlpha *= mix(1.0, 0.45, smoothstep(10.0, 22.0, -mv.z));
        gl_PointSize = aSize * uScale / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying vec3 vColor; varying float vAlpha;
      void main() {
        vec4 t = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(vColor * ${strength.toFixed(2)}, t.a * vAlpha);
        #include <colorspace_fragment>
      }`,
  });

const nodeGeometry = starPoints(
  nodes,
  nodes.map(() => 0.11),
  ['#bcd3ff', '#d6e4ff', '#c9c2ff'],
  4,
);
const nodeMaterial = starMaterial(crisp, 1.2);

const corners: Vec3[] = [-1, 1].flatMap((x) =>
  [-1, 1].flatMap((y) => [-1, 1].map((z) => [x * EDGE, y * EDGE, z * EDGE] as Vec3)),
);
const cornerGeometry = starPoints(
  corners,
  corners.map(() => 0.34),
  [STARLIGHT],
  9,
);
const cornerMaterial = starMaterial(spark, 1.2);

// Faint lines joining the stars of each rank plane, along files and levels.
const constellationGeometry = (() => {
  const v: number[] = [];
  for (const y of floors) {
    for (const k of nodeCoords) {
      v.push(LO, y, k, HI, y, k);
      v.push(k, y, LO, k, y, HI);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(v), 3));
  return g;
})();
const constellationMaterial = new LineBasicMaterial({
  color: '#7f95e8',
  transparent: true,
  opacity: 0.2,
  blending: AdditiveBlending,
  depthWrite: false,
});

const cubeGeometry = new EdgesGeometry(new BoxGeometry(EDGE * 2, EDGE * 2, EDGE * 2));
const cubeMaterial = new LineBasicMaterial({
  color: '#a8c6ff',
  transparent: true,
  opacity: 0.55,
  blending: AdditiveBlending,
  depthWrite: false,
});

const Grid = ({ layout: l, orientation }: GridProps) => (
  <group>
    <lineSegments
      geometry={constellationGeometry}
      material={constellationMaterial}
      raycast={noRaycast}
    />
    <lineSegments geometry={cubeGeometry} material={cubeMaterial} raycast={noRaycast} />
    <points geometry={nodeGeometry} material={nodeMaterial} raycast={noRaycast} />
    <points geometry={cornerGeometry} material={cornerMaterial} raycast={noRaycast} />
    <LatticeLabels
      layout={l}
      orientation={orientation}
      family='"Space Grotesk", sans-serif'
      weight={600}
      color="#dbe6ff"
      levelColor="#fff0c8"
      shadow="rgba(125, 150, 255, 0.95)"
      size={0.5}
    />
  </group>
);

// --- Markers --------------------------------------------------------------

const additive = { transparent: true, blending: AdditiveBlending, depthWrite: false } as const;

/** A small twinkling star hanging in each empty destination. */
const Quiet = ({ floor }: MarkerProps) => {
  const star = useRef<Sprite>(null);
  const phase = floor[0] * 1.7 + floor[1] * 2.3 + floor[2] * 0.9;
  useFrame(({ clock }) => {
    const s = star.current;
    if (!s) return;
    const t = clock.elapsedTime + phase;
    s.scale.setScalar(0.66 + 0.1 * Math.sin(t * 3.2));
    (s.material as SpriteMaterial).rotation = t * 0.35;
  });
  return (
    <group position={floor}>
      <sprite ref={star} position={[0, 0.3, 0]} scale={0.66} raycast={noRaycast}>
        <spriteMaterial map={spark} color="#d9fbff" {...additive} toneMapped={false} />
      </sprite>
      <sprite position={[0, 0.3, 0]} scale={0.34} raycast={noRaycast}>
        <spriteMaterial map={soft} color={CYAN} {...additive} opacity={0.8} />
      </sprite>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} raycast={noRaycast}>
        <ringGeometry args={[0.12, 0.16, 32]} />
        <meshBasicMaterial color={CYAN} {...additive} opacity={0.85} toneMapped={false} />
      </mesh>
    </group>
  );
};

// A banded planetary ring, drawn in the capture colour.
const planetRingMaterial = new ShaderMaterial({
  ...additive,
  side: DoubleSide,
  uniforms: { uColor: { value: new Color(CORAL).multiplyScalar(2.4) }, uTime: cosmosTime },
  vertexShader: /* glsl */ `
    varying float vR;
    void main() {
      vR = length(position.xy);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor; uniform float uTime;
    varying float vR;
    void main() {
      float k = (vR - 0.44) / 0.22;
      float bands = 0.55 + 0.45 * sin(k * 19.0);
      float edge = smoothstep(0.0, 0.12, k) * smoothstep(1.0, 0.8, k);
      float a = edge * (0.35 + 0.65 * bands) * (0.85 + 0.15 * sin(uTime * 4.0));
      gl_FragColor = vec4(uColor, a);
      #include <colorspace_fragment>
    }`,
});

/** A tilted planetary ring, slowly precessing, around a piece that can be taken. */
const Capture = ({ floor }: MarkerProps) => {
  const spin = useRef<Group>(null);
  useFrame((_, delta) => {
    if (spin.current) spin.current.rotation.y += Math.min(delta, 1 / 30) * 0.8;
  });
  return (
    <group position={floor}>
      <group ref={spin} position={[0, 0.36, 0]}>
        <mesh
          rotation={[-Math.PI / 2 + 0.22, 0, 0]}
          material={planetRingMaterial}
          raycast={noRaycast}
        >
          <ringGeometry args={[0.44, 0.66, 64, 1]} />
        </mesh>
      </group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.014, 0]} raycast={noRaycast}>
        <ringGeometry args={[0.36, 0.43, 48]} />
        <meshBasicMaterial color={CORAL} {...additive} opacity={1} toneMapped={false} />
      </mesh>
    </group>
  );
};

/** An orbit around the selected (lifted) piece, with a small moon riding it. */
const Selection = ({ floor }: MarkerProps) => {
  const orbit = useRef<Group>(null);
  useFrame((_, delta) => {
    if (orbit.current) orbit.current.rotation.y += Math.min(delta, 1 / 30) * 1.8;
  });
  return (
    <group position={floor}>
      <group position={[0, 0.55, 0]} rotation={[0.38, 0, 0.18]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} raycast={noRaycast}>
          <torusGeometry args={[0.5, 0.013, 6, 96]} />
          <meshBasicMaterial color={GOLD} {...additive} opacity={0.9} toneMapped={false} />
        </mesh>
        <group ref={orbit}>
          <mesh position={[0.5, 0, 0]} raycast={noRaycast}>
            <sphereGeometry args={[0.065, 16, 12]} />
            <meshBasicMaterial color="#fff8e6" toneMapped={false} />
          </mesh>
          <sprite position={[0.5, 0, 0]} scale={0.4} raycast={noRaycast}>
            <spriteMaterial map={soft} color={GOLD} {...additive} opacity={0.9} />
          </sprite>
        </group>
      </group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} raycast={noRaycast}>
        <circleGeometry args={[0.55, 48]} />
        <meshBasicMaterial map={soft} color={GOLD} {...additive} opacity={0.55} />
      </mesh>
    </group>
  );
};

// The last move: a faint comet trail along the floor, bright where it landed.
const trailMaterial = new ShaderMaterial({
  ...additive,
  uniforms: { uColor: { value: new Color(LILAC) } },
  vertexShader: /* glsl */ `
    varying float vK;
    void main() {
      vK = uv.y;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    varying float vK;
    void main() {
      gl_FragColor = vec4(uColor * (0.6 + 0.9 * vK), pow(vK, 1.6) * 0.8);
      #include <colorspace_fragment>
    }`,
});

const LastMove = ({ from, to }: LastMoveMarkerProps) => {
  const [ax, ay, az] = from.floor;
  const [bx, by, bz] = to.floor;
  const { mid, length, quaternion } = useMemo(() => {
    const a = new Vector3(ax, ay + 0.03, az);
    const b = new Vector3(bx, by + 0.03, bz);
    const dir = b.clone().sub(a);
    return {
      mid: a.clone().add(b).multiplyScalar(0.5).toArray() as Vec3,
      length: dir.length(),
      quaternion: new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize()),
    };
  }, [ax, ay, az, bx, by, bz]);
  return (
    <>
      <mesh position={mid} quaternion={quaternion} material={trailMaterial} raycast={noRaycast}>
        <cylinderGeometry args={[0.028, 0.006, length, 8, 1, true]} />
      </mesh>
      <mesh position={[ax, ay + 0.012, az]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast}>
        <ringGeometry args={[0.2, 0.24, 40]} />
        <meshBasicMaterial color={LILAC} {...additive} opacity={0.45} />
      </mesh>
      <mesh position={[bx, by + 0.012, bz]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast}>
        <circleGeometry args={[0.5, 40]} />
        <meshBasicMaterial map={soft} color={LILAC} {...additive} opacity={0.7} />
      </mesh>
    </>
  );
};

/** A red giant's swelling glow around a king in check, with a ripple at its feet. */
const Check = ({ floor }: MarkerProps) => {
  const halo = useRef<Sprite>(null);
  const ripple = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const pulse = 0.5 + 0.5 * Math.sin(t * 5.5);
    const h = halo.current;
    if (h) {
      h.scale.setScalar(1.45 + 0.4 * pulse);
      (h.material as SpriteMaterial).opacity = 0.5 + 0.35 * pulse;
    }
    const r = ripple.current;
    if (r) {
      const k = (t * 0.9) % 1;
      r.scale.setScalar(0.6 + k * 1.3);
      (r.material as MeshBasicMaterial).opacity = (1 - k) ** 1.5;
    }
  });
  return (
    <group position={floor}>
      <sprite ref={halo} position={[0, 0.45, 0]} raycast={noRaycast}>
        <spriteMaterial map={soft} color={EMBER} {...additive} toneMapped={false} />
      </sprite>
      <mesh
        ref={ripple}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.02, 0]}
        raycast={noRaycast}
      >
        <ringGeometry args={[0.4, 0.46, 48]} />
        <meshBasicMaterial color="#ff6a3a" {...additive} toneMapped={false} />
      </mesh>
    </group>
  );
};

// --- Effects ---------------------------------------------------------------

const MoveFx = ({ from, to, color, durationMs }: MoveFxProps) => (
  <CometTrail from={from} to={to} color={color} durationMs={durationMs} />
);

const CaptureFx = ({ floor, victim, durationMs }: CaptureFxProps) => (
  <Supernova floor={floor} victim={victim} durationMs={durationMs} knightYaw={KNIGHT_YAW} />
);

const Celebration = ({ floor, winner }: CelebrationProps) => (
  <Galaxy floor={floor} winner={winner} viewDirection={layout.viewDirection} />
);

// --- Stage ----------------------------------------------------------------

const PLANET: Vec3 = [5.0, -22.3, -44.0];
const STAR_COLORS = ['#ffffff', '#cfe0ff', '#ffe6c7', '#bfefff', '#e4d4ff'];
const DUST_COLORS = ['#9fb4ff', '#c4b5fd', '#7dd3fc'];
const SUN: Vec3 = SUN_DIRECTION.clone().multiplyScalar(12).toArray() as Vec3;

const Stage = () => {
  const drift = useRef<Group>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    cosmosTime.value = t;
    const cam = state.camera as PerspectiveCamera;
    pixelScale.value =
      (state.size.height * state.viewport.dpr) / (2 * Math.tan(((cam.fov ?? 38) * Math.PI) / 360));
    if (drift.current) drift.current.rotation.y = -t * 0.0012;
  });
  return (
    <>
      <color attach="background" args={['#03040b']} />
      <group ref={drift}>
        <Nebula />
        <Starfield count={2400} radius={72} size={1.2} colors={STAR_COLORS} />
        <BrightStars />
        <RingedPlanet position={PLANET} radius={3.3} />
      </group>
      <AmbientParticles
        count={220}
        box={[18, 14, 18]}
        velocity={[0.03, 0.012, 0.02]}
        sway={0.15}
        size={0.06}
        colors={DUST_COLORS}
        opacity={0.55}
        twinkle={0.5}
      />
      {/* Reflections: the nebula's violet and teal, and the far sun */}
      <Environment resolution={128} frames={1}>
        <Lightformer
          form="rect"
          intensity={2.4}
          color="#7c5cff"
          position={[-6, 4, -5]}
          scale={[9, 6, 1]}
        />
        <Lightformer
          form="rect"
          intensity={1.8}
          color="#1fb5c9"
          position={[7, -2, -4]}
          scale={[7, 5, 1]}
        />
        <Lightformer
          form="rect"
          intensity={1.2}
          color="#ff5fa2"
          position={[0, -7, 4]}
          scale={[8, 3, 1]}
        />
        <Lightformer form="circle" intensity={8} color="#fff1d6" position={SUN} scale={2} />
      </Environment>
      <ambientLight intensity={0.35} color="#8f8cff" />
      <hemisphereLight args={['#6d5dfc', '#0b3a4a', 0.4]} />
      <directionalLight position={SUN} intensity={2.4} color="#fff0d8" />
      <directionalLight position={[3, -2, -9]} intensity={1.6} color="#5a8cff" />
      <Bloom strength={0.8} radius={0.6} threshold={0.8} />
    </>
  );
};

// Destination cells get the faintest blue haze, so a target reads in depth.
const destinationFill = new MeshBasicMaterial({
  color: CYAN,
  transparent: true,
  opacity: 0.045,
  blending: AdditiveBlending,
  depthWrite: false,
});
const hidden = new MeshBasicMaterial({ visible: false });

const cosmos: Design = {
  id: 'cosmos',
  name: 'Cosmos',
  blurb: 'A constellation board adrift in a nebula; suns against dark stars.',
  layout,
  continuous: true,
  canvas: { fov: 38, toneMapping: ACESFilmicToneMapping, exposure: 1.1 },
  Stage,
  Grid,
  cellFills: { destination: destinationFill, lastMove: hidden },
  PieceBody,
  knightYaw: KNIGHT_YAW,
  markers: { Quiet, Capture, Selection, LastMove, Check },
  motion: { style: 'slide', durationMs: 700, lift: 0 },
  MoveFx,
  CaptureFx,
  Celebration,
  toppleMatedKing: true,
  hoverLift: true,
  hud: {
    vars: {
      '--hud-font': '"Space Grotesk", system-ui, sans-serif',
      '--hud-mono': '"Space Grotesk", ui-monospace, monospace',
      '--hud-bg': 'rgba(9, 11, 30, 0.52)',
      '--hud-fg': '#e8eeff',
      '--hud-muted': 'rgba(190, 205, 255, 0.55)',
      '--hud-accent': CYAN,
      '--hud-accent-fg': '#040616',
      '--hud-border': '1px solid rgba(190, 210, 255, 0.22)',
      '--hud-radius': '12px',
      '--hud-shadow': '0 10px 40px rgba(0, 0, 0, 0.45)',
      '--hud-blur': 'blur(10px)',
      '--hud-tracking': '0.015em',
      '--turn-bg': 'rgba(9, 11, 30, 0.5)',
      '--turn-fg': '#fff3d6',
      '--turn-border': '1px solid rgba(255, 214, 140, 0.4)',
      '--turn-shadow':
        '0 0 28px rgba(125, 211, 252, 0.18), inset 0 0 18px rgba(125, 150, 255, 0.08)',
      '--modal-bg': 'linear-gradient(180deg, rgba(20, 20, 56, 0.92), rgba(6, 8, 24, 0.94))',
      '--modal-fg': '#eef2ff',
      '--modal-backdrop': 'rgba(2, 3, 12, 0.35)',
      '--modal-radius': '16px',
      '--modal-shadow': '0 0 80px rgba(109, 93, 252, 0.35), 0 0 0 1px rgba(125, 211, 252, 0.15)',
      '--button-bg': 'linear-gradient(180deg, #a5e8ff, #5fb4ff)',
      '--button-fg': '#040616',
      '--button-border': '1px solid rgba(220, 244, 255, 0.8)',
      '--button-radius': '999px',
      '--page-bg': 'radial-gradient(ellipse at 60% 35%, #1b1640 0%, #070818 55%, #02030a 100%)',
      '--page-fg': '#e8eeff',
    },
    overlay: {
      background: 'radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(2, 3, 12, 0.55) 100%)',
    },
  },
};

export default cosmos;
