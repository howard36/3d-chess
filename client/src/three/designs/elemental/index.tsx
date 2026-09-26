import '@fontsource/cinzel-decorative/700.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/700.css';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  CircleGeometry,
  Color,
  DodecahedronGeometry,
  DoubleSide,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  TetrahedronGeometry,
  TorusGeometry,
} from 'three';
import type { Group } from 'three';
import { PieceType } from '../../../engine/pieces';
import type { Orientation } from '../../layout';
import { buildStauntonGeometries } from '../../pieceGeometry';
import { buildLatticeGeometry } from '../classic';
import { StauntonParts } from '../classic/pieces';
import { Bloom } from '../kit/Bloom';
import { AmbientParticles, Burst, CheckBeacon, ScreenShake, Shards } from '../kit/fx';
import { BoardLabels } from '../kit/labels';
import { latticeLayout } from '../kit/layouts';
import { noRaycast } from '../kit/noRaycast';
import { dotTexture, fbm, mixHex, paintedTexture, rng } from '../kit/textures';
import type {
  CaptureFxProps,
  CelebrationProps,
  Design,
  GridProps,
  LastMoveMarkerProps,
  MarkerProps,
  MoveFxProps,
  PieceBodyProps,
  PieceColor,
  StageProps,
} from '../types';
import { elementTime, flameMaterial, IceSpikes, Shockwave, Trail } from './fx';

// Ice & Fire: the lattice hangs between two elements. White's end of it sits
// in blue mist under falling snow, Black's end in ember-lit smoke with sparks
// rising; the lattice lines themselves cool from frost to flame. White's army
// is carved ice, Black's is obsidian veined with live lava.

// Wide gaps: in a lattice the levels stand one behind another, and every
// piece needs a clear line of sight from the default view.
const layout = latticeLayout(1.2);
const HY = layout.halfExtents[1];

const ICE = '#8fdcff';
const ICE_PALE = '#dff4ff';
const FIRE = '#ff6a1f';
const EMBER = '#ffb347';
const CHECK_RED = '#ff2a3c';

/**
 * Which army sits at the bottom of the lattice (the viewer's own), so the
 * atmosphere and the player's own markers take that side's element. Set by
 * the Grid, which knows the orientation; read by the markers.
 */
const viewer: { side: Orientation } = { side: 'white' };

// --- Procedural textures --------------------------------------------------

/** Distance to the nearest Voronoi edge (F2 - F1), tiling: 0 on a crack. */
const voronoiEdges = (seed: number, cells: number) => {
  const random = rng(seed);
  const pts = Array.from({ length: cells * cells }, (_, k) => [
    (k % cells) + random(),
    Math.floor(k / cells) + random(),
  ]);
  return (u: number, v: number) => {
    const x = u * cells;
    const y = v * cells;
    const ci = Math.floor(x);
    const cj = Math.floor(y);
    let f1 = 9;
    let f2 = 9;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const i = ci + di;
        const j = cj + dj;
        const wi = ((i % cells) + cells) % cells;
        const wj = ((j % cells) + cells) % cells;
        const p = pts[wj * cells + wi];
        const d = Math.hypot(p[0] + (i - wi) - x, p[1] + (j - wj) - y);
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) f2 = d;
      }
    }
    return f2 - f1;
  };
};

type Rgb = [number, number, number];
const lerpRgb = (a: Rgb, b: Rgb, t: number): Rgb =>
  [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as Rgb;
const WHITE: Rgb = [255, 255, 255];

const frostNoise = fbm(12, 4, 5);
const iceCracks = voronoiEdges(5, 5);
const fineCracks = voronoiEdges(9, 11);

// Ice: pale blue with clouded frost and fine white fractures.
const iceMap = paintedTexture((u, v) => {
  const n = frostNoise(u, v);
  const crack = Math.max(0, 1 - iceCracks(u, v) / 0.05) * 0.9;
  const fine = Math.max(0, 1 - fineCracks(u, v) / 0.03) * 0.45;
  const base = mixHex('#5fa8dd', '#eef8ff', Math.min(1, Math.max(0, n * 1.6 - 0.25)));
  return lerpRgb(base, WHITE, Math.min(1, crack + fine));
});
// What glows inside the ice: its fractures, and a faint frost everywhere.
const iceGlow = paintedTexture(
  (u, v) => {
    const crack = Math.max(0, 1 - iceCracks(u, v) / 0.06);
    const fine = Math.max(0, 1 - fineCracks(u, v) / 0.035) * 0.5;
    const g = 0.22 + frostNoise(u * 2, v * 2) * 0.2 + Math.min(1, crack + fine) * 0.8;
    const c = Math.round(Math.min(1, g) * 255);
    return [c, c, c];
  },
  { color: false },
);

const rockNoise = fbm(3, 6, 5);
const lavaCracks = voronoiEdges(17, 5);
const lavaFine = voronoiEdges(23, 9);

// Obsidian: near black glass with a faint smoky grain, scorched by the veins.
const rockMap = paintedTexture((u, v) => {
  const n = rockNoise(u, v);
  const w = lavaCracks(u, v);
  const scorch = Math.max(0, 1 - w / 0.14) * 0.6;
  const base = mixHex('#141116', '#2e2830', n * n * 1.4);
  return lerpRgb(base, [58, 18, 8], scorch);
});
// The lava in its veins: a white-hot core fading through orange to nothing.
const lavaMap = paintedTexture((u, v) => {
  const w = lavaCracks(u, v);
  const f = lavaFine(u, v);
  const core = Math.exp(-w * 70);
  const halo = Math.exp(-w * 20) * 0.35;
  const fine = Math.exp(-f * 110) * 0.45;
  const k = Math.min(1, core + halo + fine);
  const hot = mixHex('#ff2a00', '#ffe08a', Math.min(1, core * 1.2));
  return [hot[0] * k, hot[1] * k, hot[2] * k];
});

// --- Pieces ---------------------------------------------------------------

// Fourteen sides: turned smooth for obsidian, chiselled (flat shaded) for ice.
const set = buildStauntonGeometries(14);

type Glow = 'none' | 'hover' | 'selected' | 'check';

const ICE_GLOW: Record<Glow, [string, number]> = {
  none: ['#5cc0ff', 0.4],
  hover: ['#8fdcff', 0.5],
  selected: ['#bff0ff', 0.9],
  check: [CHECK_RED, 1.2],
};
const LAVA_GLOW: Record<Glow, [string, number]> = {
  none: [FIRE, 1.15],
  hover: ['#ff8a3a', 1.7],
  selected: ['#ffc56b', 2.4],
  check: [CHECK_RED, 2.6],
};

const pieceMaterials = new Map<string, MeshPhysicalMaterial>();
const pieceMaterial = (color: PieceColor, glow: Glow) => {
  const key = `${color}-${glow}`;
  let m = pieceMaterials.get(key);
  if (!m) {
    const [tint, amount] = (color === 'white' ? ICE_GLOW : LAVA_GLOW)[glow];
    m =
      color === 'white'
        ? new MeshPhysicalMaterial({
            color: '#bfe2ff',
            map: iceMap,
            flatShading: true,
            roughness: 0.16,
            clearcoat: 1,
            clearcoatRoughness: 0.04,
            sheen: 1,
            sheenColor: new Color('#bfeaff'),
            sheenRoughness: 0.3,
            iridescence: 0.25,
            emissive: new Color(tint),
            emissiveMap: iceGlow,
            emissiveIntensity: amount,
            envMapIntensity: 1.3,
          })
        : new MeshPhysicalMaterial({
            color: '#ffffff',
            map: rockMap,
            roughness: 0.3,
            metalness: 0.1,
            clearcoat: 0.9,
            clearcoatRoughness: 0.12,
            emissive: new Color(tint),
            emissiveMap: lavaMap,
            emissiveIntensity: amount,
            envMapIntensity: 1.4,
          });
    m.userData.glow = amount;
    m.userData.pulse = glow === 'check' ? 6 : color === 'black' ? 1.7 : 0;
    pieceMaterials.set(key, m);
  }
  return m;
};

/** Lava breathes; a king in check throbs. Called from the Stage every frame. */
const pulsePieces = (t: number) => {
  for (const m of pieceMaterials.values()) {
    const speed = m.userData.pulse as number;
    if (!speed) continue;
    const depth = speed > 3 ? 0.45 : 0.22;
    m.emissiveIntensity = (m.userData.glow as number) * (1 - depth + depth * Math.sin(t * speed));
  }
};

const PieceBody = ({ type, color, selected, hovered, inCheck }: PieceBodyProps) => {
  const glow: Glow = inCheck ? 'check' : selected ? 'selected' : hovered ? 'hover' : 'none';
  const m = pieceMaterial(color, glow);
  const body = <StauntonParts type={type} material={m} groove={m} geometries={set} />;
  return selected ? <Hover>{body}</Hover> : body;
};

/**
 * The picked-up piece floats a hand's breadth up and bobs. (The design keeps
 * the framework's hover lift off: in a lattice a lifted neighbour can hide
 * the piece behind it.)
 */
const Hover = ({ children }: { children: ReactNode }) => {
  const group = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (group.current) group.current.position.y = 0.1 + Math.sin(clock.elapsedTime * 3.2) * 0.04;
  });
  return <group ref={group}>{children}</group>;
};

// --- Lattice ----------------------------------------------------------------

const lattice = buildLatticeGeometry(layout);

/** Frost below, flame above (or the other way up for Black's view). */
const latticeColors = (flip: boolean) => {
  const pos = lattice.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const ice = new Color('#5cc8ff');
  const mid = new Color('#c9c2ff');
  const fire = new Color('#ff5418');
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    let t = (pos.getY(i) + HY) / (2 * HY);
    if (flip) t = 1 - t;
    // Each element holds its own end; they meet in a narrow band mid-lattice
    const k = Math.min(1, Math.max(0, (t - 0.3) / 0.4));
    if (k < 0.5) c.lerpColors(ice, mid, k / 0.5);
    else c.lerpColors(mid, fire, (k - 0.5) / 0.5);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  return colors;
};
const latticeColorSets = { white: latticeColors(false), black: latticeColors(true) };
lattice.setAttribute('color', new BufferAttribute(latticeColorSets.white, 3));

const latticeMaterial = new ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  vertexColors: true,
  uniforms: { uTime: elementTime, uNear: { value: 12 }, uFar: { value: 19 } },
  vertexShader: /* glsl */ `
    varying vec3 vColor; varying float vY; varying float vDepth;
    void main() {
      vColor = color;
      vY = position.y;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vDepth = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform float uTime; uniform float uNear; uniform float uFar;
    varying vec3 vColor; varying float vY; varying float vDepth;
    void main() {
      // A slow shimmer runs up the lattice, like heat through frost
      float s = 0.75 + 0.25 * sin(vY * 2.2 - uTime * 1.4);
      // The far layers fade back, so the cube reads in depth
      float d = 1.0 - 0.7 * smoothstep(uNear, uFar, vDepth);
      gl_FragColor = vec4(vColor * s, 0.4 * d);
      #include <colorspace_fragment>
    }`,
});

const Grid = ({ layout: l, orientation }: GridProps) => {
  useLayoutEffect(() => {
    viewer.side = orientation;
    lattice.setAttribute('color', new BufferAttribute(latticeColorSets[orientation], 3));
  }, [orientation]);
  useFrame(({ camera }) => {
    // Depth fade spans the cube as seen from wherever the camera now is
    const d = camera.position.length();
    latticeMaterial.uniforms.uNear.value = d - HY;
    latticeMaterial.uniforms.uFar.value = d + HY;
  });
  return (
    <group>
      <lineSegments geometry={lattice} material={latticeMaterial} raycast={noRaycast} />
      <BoardLabels
        layout={l}
        orientation={orientation}
        font="'Cormorant Garamond', Georgia, serif"
        weight={700}
        color="#f5f0ff"
        shadow="rgba(150, 120, 255, 0.9)"
        size={0.5}
      />
    </group>
  );
};

// --- Markers --------------------------------------------------------------

const glow = dotTexture(0.85);
const sideColor = (side: Orientation) => (side === 'white' ? ICE : EMBER);

const orbGeometry = new SphereGeometry(0.1, 20, 14);
const orbMaterials = {
  white: new MeshBasicMaterial({ color: '#c9f1ff', toneMapped: false }),
  black: new MeshBasicMaterial({ color: '#ffc46b', toneMapped: false }),
};
const haloMaterials = {
  white: new MeshBasicMaterial({
    map: glow,
    color: ICE,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  }),
  black: new MeshBasicMaterial({
    map: glow,
    color: FIRE,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  }),
};
const haloGeometry = new PlaneGeometry(0.62, 0.62);

const Quiet = ({ centre }: MarkerProps) => {
  const side = viewer.side;
  const halo = useRef<Group>(null);
  const phase = centre[0] * 1.3 + centre[1] * 2.1 + centre[2] * 0.7;
  useFrame(({ clock, camera }) => {
    const h = halo.current;
    if (!h) return;
    h.quaternion.copy(camera.quaternion);
    h.scale.setScalar(0.9 + 0.12 * Math.sin(clock.elapsedTime * 3 + phase));
  });
  return (
    <group position={centre}>
      <mesh geometry={orbGeometry} material={orbMaterials[side]} raycast={noRaycast} />
      <group ref={halo}>
        <mesh geometry={haloGeometry} material={haloMaterials[side]} raycast={noRaycast} />
      </group>
    </group>
  );
};

// The capture marker: a ring of flame around the victim's feet.
const captureFlame = flameMaterial({ hot: '#ffd36b', cool: '#ff3a0a', intensity: 1.8 });
const captureBase = new MeshBasicMaterial({ color: '#ff7a2a', toneMapped: false });
const captureTorus = new TorusGeometry(0.43, 0.025, 8, 48);

const Capture = ({ floor }: MarkerProps) => (
  <group position={floor}>
    <mesh
      geometry={captureTorus}
      material={captureBase}
      rotation={[Math.PI / 2, 0, 0]}
      position={[0, 0.02, 0]}
      raycast={noRaycast}
    />
    <mesh position={[0, 0.24, 0]} material={captureFlame} raycast={noRaycast}>
      <cylinderGeometry args={[0.43, 0.45, 0.48, 40, 1, true]} />
    </mesh>
  </group>
);

const selectionFlame = flameMaterial({
  hot: '#fff0b0',
  cool: '#ff8a1f',
  intensity: 1.4,
  speed: 1.6,
  tongues: 7,
});
const iceSpike = new MeshPhysicalMaterial({
  color: '#dff4ff',
  flatShading: true,
  roughness: 0.1,
  clearcoat: 1,
  emissive: new Color('#6cc8ff'),
  emissiveIntensity: 0.6,
});

const Selection = ({ floor }: MarkerProps) => {
  const side = viewer.side;
  const ring = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (ring.current) ring.current.rotation.y = clock.elapsedTime * 0.7;
  });
  return (
    <group position={floor}>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} raycast={noRaycast}>
        <torusGeometry args={[0.37, 0.03, 8, 48]} />
        <meshBasicMaterial color={side === 'white' ? ICE_PALE : '#ffd08a'} toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} raycast={noRaycast}>
        <circleGeometry args={[0.6, 32]} />
        <meshBasicMaterial
          map={glow}
          color={sideColor(side)}
          transparent
          opacity={0.5}
          depthWrite={false}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      {side === 'white' ? (
        <group ref={ring}>
          {Array.from({ length: 9 }, (_, i) => {
            const a = (i / 9) * Math.PI * 2;
            return (
              <mesh
                key={i}
                position={[Math.cos(a) * 0.4, 0.08, Math.sin(a) * 0.4]}
                rotation={[Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5]}
                material={iceSpike}
                raycast={noRaycast}
              >
                <coneGeometry args={[0.035, 0.18 + (i % 3) * 0.05, 5]} />
              </mesh>
            );
          })}
        </group>
      ) : (
        <mesh position={[0, 0.16, 0]} material={selectionFlame} raycast={noRaycast}>
          <cylinderGeometry args={[0.38, 0.4, 0.32, 36, 1, true]} />
        </mesh>
      )}
    </group>
  );
};

// A soft glowing square frame on the floor of the last move's cells.
const frameTexture = paintedTexture(
  (u, v) => {
    const e = Math.min(u, 1 - u, v, 1 - v);
    const a = Math.exp(-e * 22) * 0.9 + 0.12;
    return [255, 255, 255, Math.round(Math.min(1, a) * 255)];
  },
  { size: 128, repeat: false },
);
const squareGeometry = new PlaneGeometry(1, 1);
const lastMoveMaterials = [0.35, 0.8].map(
  (opacity) =>
    new MeshBasicMaterial({
      map: frameTexture,
      color: '#ffe3bd',
      transparent: true,
      opacity,
      depthWrite: false,
      blending: AdditiveBlending,
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
        position={[m.floor[0], m.floor[1] + 0.01, m.floor[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={0.98}
        raycast={noRaycast}
      />
    ))}
  </>
);

/** The colour of the king standing at `centre`, read off the scene. */
const useKingAt = (centre: MarkerProps['centre']) => {
  const scene = useThree((s) => s.scene);
  const found = useRef<PieceColor | null>(null);
  const find = () => {
    scene.traverse((o) => {
      const p = o.userData?.piece as { type: PieceType; color: PieceColor } | undefined;
      if (
        p?.type === PieceType.King &&
        Math.abs(o.position.x - centre[0]) < 1e-3 &&
        Math.abs(o.position.y - centre[1]) < 1e-3 &&
        Math.abs(o.position.z - centre[2]) < 1e-3
      ) {
        found.current = p.color;
      }
    });
    return found.current;
  };
  return { found, find };
};

// Check: a beacon in the element of the side in check.
const Check = ({ centre, floor }: MarkerProps) => {
  const { found, find } = useKingAt(centre);
  const ice = useRef<Group>(null);
  const fire = useRef<Group>(null);
  useFrame(() => {
    const c = found.current ?? find();
    if (ice.current) ice.current.visible = c !== 'black';
    if (fire.current) fire.current.visible = c === 'black';
  });
  return (
    <>
      <group ref={ice}>
        <CheckBeacon floor={floor} color="#4fc4ff" radius={0.46} height={1.4} />
        <CheckBeacon floor={floor} color={CHECK_RED} radius={0.3} height={0.5} />
      </group>
      <group ref={fire} visible={false}>
        <CheckBeacon floor={floor} color="#ff5a14" radius={0.46} height={1.4} />
        <CheckBeacon floor={floor} color={CHECK_RED} radius={0.3} height={0.5} />
      </group>
    </>
  );
};

// --- Effects ---------------------------------------------------------------

const MOTION = { style: 'hop' as const, durationMs: 480, lift: 0.5 };
const BODY_Y = layout.floorY + 0.3;

const SNOW = ['#ffffff', '#e2f5ff', '#aee2ff'];
const SPARKS = ['#ffe08a', '#ffb347', '#ff6a1f', '#ff3d0a'];
const STEAM = ['#eef2f6', '#d3dde6', '#c4ccd6'];

/** Mounts its children once `delayMs` of r3f clock has passed. */
const After = ({ delayMs, children }: { delayMs: number; children: ReactNode }) => {
  const elapsed = useRef(0);
  const [ready, setReady] = useState(false);
  const invalidate = useThree((s) => s.invalidate);
  useFrame((_, delta) => {
    if (ready) return;
    elapsed.current += Math.min(delta, 1 / 30) * 1000;
    if (elapsed.current >= delayMs) setReady(true);
    else invalidate();
  });
  return ready ? <>{children}</> : null;
};

const MoveFx = ({ from, to, color, durationMs }: MoveFxProps) => {
  const white = color === 'white';
  const land: [number, number, number] = [to[0], to[1] + layout.floorY + 0.04, to[2]];
  return (
    <>
      <Trail
        from={[from[0], from[1] + BODY_Y, from[2]]}
        to={[to[0], to[1] + BODY_Y, to[2]]}
        lift={MOTION.lift}
        durationMs={durationMs}
        colors={white ? SNOW : SPARKS}
        drift={white ? [0, -0.35, 0] : [0, 0.55, 0]}
        size={white ? 0.1 : 0.08}
      />
      {white ? (
        <Burst
          position={land}
          colors={SNOW}
          count={46}
          speed={1.5}
          gravity={0.3}
          upward={0.25}
          lifeMs={900}
          size={0.14}
          delayMs={durationMs * 0.95}
        />
      ) : (
        <Burst
          position={land}
          colors={SPARKS}
          count={40}
          speed={1.6}
          gravity={-0.8}
          upward={0.75}
          lifeMs={900}
          size={0.09}
          delayMs={durationMs * 0.95}
        />
      )}
      <Shockwave
        position={land}
        color={white ? '#9fe3ff' : '#ff8a3a'}
        radius={0.8}
        lifeMs={520}
        delayMs={durationMs * 0.95}
      />
    </>
  );
};

const iceShard = new TetrahedronGeometry(0.075, 0);
const rockChunk = new DodecahedronGeometry(0.065, 0);

/**
 * The captured piece holds its ground until the attacker lands, shivers,
 * then breaks: ice into shards, obsidian into glowing chunks, with steam
 * where the elements meet.
 */
const Victim = ({
  victim,
  centre,
  breakAt,
}: {
  victim: CaptureFxProps['victim'];
  centre: MarkerProps['centre'];
  breakAt: number;
}) => {
  const group = useRef<Group>(null);
  const elapsed = useRef(0);
  useEffect(() => {
    group.current?.traverse((o) => {
      o.raycast = noRaycast;
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
    const k = Math.max(0, (t - breakAt * 0.5) / (breakAt * 0.5));
    g.position.x = Math.sin(t * 0.9) * 0.03 * k;
    g.position.z = Math.cos(t * 1.3) * 0.03 * k;
  });
  const yaw = victim.type === PieceType.Knight ? (victim.color === 'white' ? -0.35 : 0.35) : 0;
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
  const ice = victim.color === 'white';
  const at = durationMs * 0.85;
  const base: [number, number, number] = [floor[0], floor[1] + 0.3, floor[2]];
  return (
    <>
      <Victim victim={victim} centre={centre} breakAt={at} />
      <Shards
        position={base}
        geometry={ice ? iceShard : rockChunk}
        material={pieceMaterial(victim.color, 'none')}
        count={ice ? 34 : 26}
        speed={ice ? 2.8 : 2.3}
        gravity={ice ? 5.5 : 7}
        upward={0.45}
        spread={0.35}
        lifeMs={1300}
        spin={ice ? 10 : 6}
        delayMs={at}
      />
      <Burst
        position={[floor[0], floor[1] + 0.45, floor[2]]}
        colors={ice ? SNOW : SPARKS}
        count={70}
        speed={2.6}
        gravity={ice ? 1.6 : -0.6}
        upward={0.35}
        lifeMs={1100}
        size={ice ? 0.12 : 0.09}
        delayMs={at}
      />
      {/* Steam: fire and ice meeting */}
      <Burst
        position={[floor[0], floor[1] + 0.3, floor[2]]}
        colors={STEAM}
        count={26}
        speed={0.9}
        gravity={-0.9}
        upward={0.85}
        lifeMs={1500}
        size={0.42}
        additive={false}
        seed={4}
        delayMs={at}
      />
      <Shockwave
        position={[floor[0], floor[1] + 0.02, floor[2]]}
        color={ice ? '#bfeeff' : '#ff7a2a'}
        radius={1.1}
        lifeMs={650}
        delayMs={at}
      />
      <After delayMs={at}>
        <ScreenShake intensity={5} durationMs={280} />
      </After>
    </>
  );
};

/** A flame column that roars up, burns and dies down. */
const FlameColumn = ({ floor, delayMs }: { floor: MarkerProps['floor']; delayMs: number }) => {
  const material = useMemo(
    () => flameMaterial({ hot: '#fff1b8', cool: '#ff4a0a', intensity: 2, speed: 3, tongues: 6 }),
    [],
  );
  const mesh = useRef<Group>(null);
  const elapsed = useRef(-delayMs / 1000);
  useEffect(() => () => material.dispose(), [material]);
  useFrame((_, delta) => {
    elapsed.current += Math.min(delta, 1 / 30);
    const t = elapsed.current;
    const rise = Math.min(Math.max(t / 0.35, 0), 1);
    const die = Math.min(Math.max((t - 2.6) / 0.8, 0), 1);
    material.uniforms.uFade.value = rise * (1 - die);
    if (mesh.current) mesh.current.scale.set(1, Math.max(rise, 1e-3), 1);
  });
  return (
    <group ref={mesh} position={floor}>
      <mesh position={[0, 1.1, 0]} material={material} raycast={noRaycast}>
        <cylinderGeometry args={[0.2, 0.55, 2.2, 36, 1, true]} />
      </mesh>
    </group>
  );
};

const flake = new CircleGeometry(0.045, 6);
const flakeMaterial = new MeshBasicMaterial({
  color: '#ffffff',
  toneMapped: false,
  side: DoubleSide,
});

const Celebration = ({ floor, winner }: CelebrationProps) => {
  const lift: [number, number, number] = [floor[0], floor[1] + 0.6, floor[2]];
  if (winner === 'white') {
    // A blizzard: ice bursts from the floor and a whirl of snow flies up
    return (
      <>
        <IceSpikes position={floor} material={iceSpike} delayMs={350} count={14} />
        <Shards
          position={lift}
          geometry={flake}
          material={flakeMaterial}
          colors={SNOW}
          count={170}
          speed={3.4}
          gravity={1}
          upward={0.8}
          spread={0.6}
          lifeMs={4000}
          spin={5}
          flutter
          delayMs={400}
        />
        <Burst
          position={lift}
          colors={SNOW}
          count={220}
          speed={3.6}
          gravity={1.2}
          upward={0.6}
          lifeMs={2400}
          size={0.14}
          delayMs={380}
        />
        <Shockwave
          position={[floor[0], floor[1] + 0.03, floor[2]]}
          color="#bff0ff"
          radius={2.6}
          lifeMs={1100}
          delayMs={360}
        />
        <After delayMs={380}>
          <ScreenShake intensity={7} durationMs={420} />
        </After>
      </>
    );
  }
  if (winner === 'black') {
    // A fire fountain: a roaring column and a spray of sparks
    return (
      <>
        <FlameColumn floor={floor} delayMs={350} />
        <Burst
          position={lift}
          colors={SPARKS}
          count={240}
          speed={4.2}
          gravity={2.4}
          upward={0.9}
          lifeMs={2600}
          size={0.1}
          delayMs={380}
        />
        <Shockwave
          position={[floor[0], floor[1] + 0.03, floor[2]]}
          color="#ff7a2a"
          radius={2.6}
          lifeMs={1100}
          delayMs={360}
        />
        <After delayMs={380}>
          <ScreenShake intensity={7} durationMs={420} />
        </After>
      </>
    );
  }
  return (
    <Burst position={lift} colors={[...SNOW, ...SPARKS]} count={120} speed={2.5} lifeMs={1800} />
  );
};

// --- Stage ----------------------------------------------------------------

// The backdrop: navy mist below, ember smoke above, split in screen height.
const skyMaterial = new ShaderMaterial({
  side: BackSide,
  depthWrite: false,
  fog: false,
  uniforms: { uTime: elementTime, uFlip: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform float uTime; uniform float uFlip; varying vec3 vDir;
    float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
    float noise(vec3 p) {
      vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
            mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
        mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
            mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
    }
    float fbm(vec3 p) {
      float a = 0.5; float s = 0.0;
      for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
      return s;
    }
    void main() {
      vec3 d = normalize(vDir);
      float t = smoothstep(-0.62, 0.05, d.y);
      if (uFlip > 0.5) t = 1.0 - t;
      float mist = fbm(d * 3.2 + vec3(uTime * 0.05, 0.0, uTime * 0.03));
      vec3 cold = mix(vec3(0.004, 0.01, 0.04), vec3(0.04, 0.12, 0.28), mist * mist * 1.6);
      float smoke = fbm(d * 2.6 + vec3(0.0, -uTime * 0.07, 0.0));
      vec3 hot = mix(vec3(0.035, 0.005, 0.004), vec3(0.34, 0.06, 0.012), smoke * smoke * 1.7);
      float seam = pow(1.0 - abs(fbm(d * 5.0 + vec3(0.0, -uTime * 0.12, 0.0)) * 2.0 - 1.0), 10.0);
      hot += vec3(1.0, 0.32, 0.04) * seam * 0.22;
      gl_FragColor = vec4(mix(cold, hot, t), 1.0);
      #include <colorspace_fragment>
    }`,
});

// Drifting mist (or, seen from Black's side, a lava glow) under the lattice.
const floorMaterial = new ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  uniforms: {
    uTime: elementTime,
    uColor: { value: new Color('#3aa6ff') },
    uSpeed: { value: new Color(0.05, 0.02, 0) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform float uTime; uniform vec3 uColor; uniform vec3 uSpeed; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
    }
    float fbm(vec2 p) {
      float a = 0.5; float s = 0.0;
      for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.1; a *= 0.5; }
      return s;
    }
    void main() {
      vec2 p = vUv * 6.0;
      float n = fbm(p + uTime * uSpeed.xy) * fbm(p * 0.7 - uTime * uSpeed.yx * 1.3 + 3.0);
      float r = length(vUv - 0.5) * 2.0;
      float a = smoothstep(0.08, 0.45, n) * (1.0 - smoothstep(0.35, 1.0, r));
      gl_FragColor = vec4(uColor, a * 0.55);
      #include <colorspace_fragment>
    }`,
});

const Stage = ({ orientation }: StageProps) => {
  const flip = orientation === 'black';
  // Which end is which: the viewer's own army always stands at the bottom.
  const cold = flip ? 1 : -1;
  useLayoutEffect(() => {
    skyMaterial.uniforms.uFlip.value = flip ? 1 : 0;
    floorMaterial.uniforms.uColor.value.set(flip ? '#ff5a14' : '#3aa6ff');
  }, [flip]);
  useFrame(({ clock }) => {
    elementTime.value = clock.elapsedTime;
    pulsePieces(clock.elapsedTime);
  });
  return (
    <>
      <mesh material={skyMaterial} raycast={noRaycast} renderOrder={-1000} frustumCulled={false}>
        <sphereGeometry args={[80, 48, 24]} />
      </mesh>
      <mesh
        material={floorMaterial}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -HY - 0.9, 0]}
        raycast={noRaycast}
      >
        <planeGeometry args={[26, 26]} />
      </mesh>
      <Environment resolution={256} frames={1}>
        <color attach="background" args={['#06060d']} />
        <Lightformer
          form="rect"
          intensity={2.2}
          color="#6cc8ff"
          position={[0, 6 * cold, 2]}
          rotation-x={(Math.PI / 2) * -cold}
          scale={[10, 4, 1]}
        />
        <Lightformer
          form="rect"
          intensity={2.6}
          color="#ff6a1f"
          position={[0, -6 * cold, 0]}
          rotation-x={(Math.PI / 2) * cold}
          scale={[10, 4, 1]}
        />
        <Lightformer
          form="rect"
          intensity={1.6}
          color="#9fdcff"
          position={[-7, 0, 2]}
          rotation-y={Math.PI / 2}
          scale={[2, 8, 1]}
        />
        <Lightformer
          form="rect"
          intensity={1.8}
          color="#ff8a3a"
          position={[7, 0, 2]}
          rotation-y={-Math.PI / 2}
          scale={[2, 8, 1]}
        />
        <Lightformer form="ring" intensity={1.6} color="#ffffff" position={[3, 3, 8]} scale={2} />
      </Environment>
      <ambientLight intensity={0.3} color="#7b86b8" />
      <directionalLight position={[5, 8, 8]} intensity={1.3} color="#fff3e6" />
      <directionalLight position={[-4, 7, -9]} intensity={1.4} color="#ff7a33" />
      <pointLight position={[0, cold * 4.2, 1]} intensity={22} distance={12} color="#4fb4ff" />
      <pointLight position={[0, -cold * 3.6, 0]} intensity={26} distance={12} color="#ff5a14" />
      <AmbientParticles
        key={`snow-${orientation}`}
        count={320}
        box={[16, 7, 16]}
        centre={[0, cold * 2.1, 0]}
        velocity={[0.12, -0.45, 0.05]}
        sway={0.35}
        size={0.07}
        colors={SNOW}
        opacity={0.85}
        twinkle={0.2}
        seed={5}
      />
      <AmbientParticles
        key={`embers-${orientation}`}
        count={220}
        box={[16, 7, 16]}
        centre={[0, -cold * 2.1, 0]}
        velocity={[0, 0.7, 0]}
        sway={0.5}
        size={0.075}
        colors={SPARKS}
        opacity={1}
        twinkle={0.7}
        seed={8}
      />
      <Bloom strength={0.85} radius={0.55} threshold={0.72} />
    </>
  );
};

const hidden = new MeshBasicMaterial({ visible: false });

const elemental: Design = {
  id: 'elemental',
  name: 'Ice & Fire',
  blurb: 'Carved ice against molten obsidian, with snow and embers.',
  layout,
  continuous: true,
  canvas: { fov: 38, toneMapping: ACESFilmicToneMapping, exposure: 1.15 },
  Stage,
  Grid,
  cellFills: { destination: hidden, lastMove: hidden },
  PieceBody,
  knightYaw: 0.35,
  markers: { Quiet, Capture, Selection, LastMove, Check },
  motion: MOTION,
  MoveFx,
  CaptureFx,
  Celebration,
  toppleMatedKing: true,
  hoverLift: false,
  hud: {
    vars: {
      '--hud-font': '"Cinzel Decorative", "Cinzel", Georgia, serif',
      '--hud-mono': '"Cormorant Garamond", Georgia, serif',
      '--hud-bg':
        'linear-gradient(rgba(9, 10, 22, 0.86), rgba(9, 10, 22, 0.86)) padding-box, ' +
        'linear-gradient(100deg, #7ad7ff, #b9a6ff 50%, #ff6a1f) border-box',
      '--hud-fg': '#eef3ff',
      '--hud-muted': 'rgba(200, 214, 240, 0.6)',
      '--hud-accent': '#ff7a2a',
      '--hud-accent-fg': '#140a06',
      '--hud-border': '1px solid transparent',
      '--hud-radius': '6px',
      '--hud-shadow':
        '-6px 8px 26px rgba(80, 170, 255, 0.16), 6px -4px 26px rgba(255, 100, 30, 0.14)',
      '--hud-blur': 'blur(6px)',
      '--hud-tracking': '0.04em',
      '--turn-bg':
        'linear-gradient(rgba(9, 10, 22, 0.9), rgba(9, 10, 22, 0.9)) padding-box, ' +
        'linear-gradient(100deg, #7ad7ff, #b9a6ff 50%, #ff6a1f) border-box',
      '--turn-fg': '#f6f1ff',
      '--turn-border': '1.5px solid transparent',
      '--turn-shadow':
        '-10px 0 26px rgba(90, 190, 255, 0.28), 10px 0 26px rgba(255, 106, 31, 0.28)',
      '--modal-bg':
        'linear-gradient(180deg, rgba(40, 16, 10, 0.96), rgba(8, 14, 32, 0.96)) padding-box, ' +
        'linear-gradient(180deg, #ff6a1f, #b9a6ff 50%, #7ad7ff) border-box',
      '--modal-fg': '#f4efff',
      '--modal-backdrop': 'rgba(4, 4, 12, 0.5)',
      '--modal-radius': '8px',
      '--modal-shadow': '0 -12px 50px rgba(255, 106, 31, 0.3), 0 12px 50px rgba(90, 190, 255, 0.3)',
      '--button-bg': 'linear-gradient(100deg, #58c4ff, #9b7bff 50%, #ff6a1f)',
      '--button-fg': '#ffffff',
      '--button-border': '1px solid rgba(255, 255, 255, 0.35)',
      '--button-radius': '4px',
      '--page-bg': 'linear-gradient(180deg, #2a0906 0%, #0b0a18 50%, #04112a 100%)',
      '--page-fg': '#eef3ff',
    },
    overlay: {
      background:
        'linear-gradient(180deg, rgba(255, 90, 20, 0.1), transparent 30%, transparent 70%, rgba(70, 170, 255, 0.1)), ' +
        'radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0, 0, 0, 0.45) 100%)',
    },
  },
};

export default elemental;
