import '@fontsource/orbitron/500.css';
import '@fontsource/orbitron/700.css';
import '@fontsource/orbitron/900.css';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  NoToneMapping,
  OctahedronGeometry,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import { Bloom } from '../kit/Bloom';
import { Burst, ScreenShake, Shards } from '../kit/fx';
import { BoardLabels } from '../kit/labels';
import { latticeLayout } from '../kit/layouts';
import { noRaycast } from '../kit/noRaycast';
import type {
  BoardLayout,
  CaptureFxProps,
  CelebrationProps,
  Design,
  GridProps,
  LastMoveMarkerProps,
  MarkerProps,
  MoveFxProps,
  Vec3,
} from '../types';
import { Banner, Delayed, Flash, glowDot, LightTrail, Rocket, Shockwave, useLife } from './fx';
import {
  CHECK_RED,
  NEON,
  PIECE_SCALE,
  PieceBody,
  SynthParts,
  accentMaterial,
  bodyMaterial,
} from './pieces';
import { GridFloor, Mountains, Stars, SunsetSky, sunDirection } from './stage';

// Synthwave: a 1980s outrun sunset. The board is a neon lattice hanging
// over an endless grid that rolls toward the viewer; a striped sun sets
// behind it between wireframe mountains. The armies are black glass traced
// in neon: electric cyan against hot magenta.

const CYAN = NEON.white;
const PINK = NEON.black;
const SUN = '#ffd23f';
const ORANGE = '#ff8a2a';
const HOT = '#ff1f5a';
const VIOLET = '#7b4dff';

// --- Layout -------------------------------------------------------------------

// An airy lattice: the lines run along the boundaries between cells, and
// every piece stands on a line-drawn floor (the cell's lower boundary).
const SPACING = 1.25;
const HALF = SPACING / 2;
const EDGE = 2 * SPACING + HALF;
const layout: BoardLayout = {
  ...latticeLayout(SPACING),
  floorY: -HALF,
  // Raycast boxes with gaps between them, so a far cell can be clicked
  // between the nearer ones
  cellSize: [0.8, 0.8, 0.8],
  halfExtents: [EDGE + 0.15, EDGE + 0.15, EDGE + 0.15],
  // Low enough that the horizon and the sun show above the board, high
  // enough that cells in a line toward the viewer don't hide each other
  viewDirection: [4.69, 2.87, 8.83],
};
const SUN_DIR = sunDirection(layout.viewDirection);

// --- The lattice ---------------------------------------------------------------

const BOUNDS = [0, 1, 2, 3, 4, 5].map((i) => (i - 2.5) * SPACING);

// Every line through the cell boundaries, coloured by where it runs: the
// cube's twelve edges hot cyan, the outer faces blue-violet, the inside a
// faint violet haze. Floors (horizontal lines) read a touch brighter than
// the uprights, since that is what the pieces stand on.
const latticeGeometry = (() => {
  const pos: number[] = [];
  const col: number[] = [];
  const cyan = new Color(CYAN);
  const face = new Color('#5b6bff');
  const inner = new Color(VIOLET);
  const c = new Color();
  for (let axis = 0; axis < 3; axis++) {
    for (let j = 0; j < 6; j++) {
      for (let k = 0; k < 6; k++) {
        const outerJ = j === 0 || j === 5;
        const outerK = k === 0 || k === 5;
        const upright = axis === 1;
        if (outerJ && outerK) c.copy(cyan).multiplyScalar(2.6);
        else if (outerJ || outerK) c.copy(face).multiplyScalar(upright ? 0.34 : 0.5);
        else c.copy(inner).multiplyScalar(upright ? 0.12 : 0.2);
        const a: number[] = [0, 0, 0];
        const b: number[] = [0, 0, 0];
        const [o1, o2] = [0, 1, 2].filter((i) => i !== axis);
        a[axis] = BOUNDS[0];
        b[axis] = BOUNDS[5];
        a[o1] = b[o1] = BOUNDS[j];
        a[o2] = b[o2] = BOUNDS[k];
        pos.push(...a, ...b);
        col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  return g;
})();
const latticeMaterial = new LineBasicMaterial({
  vertexColors: true,
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  toneMapped: false,
});

// A glowing node at every lattice crossing; the cube's corners burn brightest.
const nodes = (() => {
  const pos: number[] = [];
  const col: number[] = [];
  const c = new Color();
  for (const x of BOUNDS)
    for (const y of BOUNDS)
      for (const z of BOUNDS) {
        const outer = [x, y, z].filter((v) => Math.abs(v) > EDGE - 0.01).length;
        pos.push(x, y, z);
        c.set(outer === 3 ? CYAN : outer === 2 ? '#6f7dff' : VIOLET).multiplyScalar(
          outer === 3 ? 3 : outer === 2 ? 0.9 : 0.35,
        );
        col.push(c.r, c.g, c.b);
      }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  return g;
})();

const Grid = ({ layout: l, orientation }: GridProps) => (
  <group>
    <lineSegments geometry={latticeGeometry} material={latticeMaterial} raycast={noRaycast} />
    <points geometry={nodes} raycast={noRaycast}>
      <pointsMaterial
        map={glowDot}
        vertexColors
        size={0.16}
        sizeAttenuation
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
        toneMapped={false}
      />
    </points>
    <BoardLabels
      layout={l}
      orientation={orientation}
      font="Orbitron, sans-serif"
      weight={900}
      color="#e7d6ff"
      shadow="rgba(255, 43, 214, 0.9)"
      size={0.46}
      opacity={0.95}
    />
  </group>
);

// --- Markers ---------------------------------------------------------------------

const hdr = (hex: string, k: number) => new Color(hex).multiplyScalar(k);
const basic = (hex: string, k: number, opacity = 1) =>
  new MeshBasicMaterial({
    color: hdr(hex, k),
    toneMapped: false,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });

// A square outline a little inside a cell's floor.
const floorSquare = (() => {
  const s = SPACING * 0.42;
  const g = new EdgesGeometry(new PlaneGeometry(s * 2, s * 2));
  g.rotateX(-Math.PI / 2);
  return g;
})();
const squareMaterial = (hex: string, k: number) =>
  new LineBasicMaterial({
    color: hdr(hex, k),
    toneMapped: false,
    transparent: true,
    depthWrite: false,
  });

const diamond = new OctahedronGeometry(0.13, 0);
const diamondEdges = new EdgesGeometry(diamond);
const quietFill = new MeshBasicMaterial({ color: hdr(SUN, 1.05), toneMapped: false });
const quietEdge = squareMaterial('#fff7c2', 1.8);
const quietSquare = squareMaterial(SUN, 1.3);
const quietGlow = { map: glowDot, color: hdr(SUN, 1), opacity: 0.32 };

const Quiet = ({ floor }: MarkerProps) => {
  const spin = useRef<Group>(null);
  useFrame((state) => {
    const g = spin.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    g.rotation.y = t * 1.6;
    g.position.y = 0.38 + Math.sin(t * 2.4 + floor[0] + floor[2]) * 0.04;
  });
  return (
    <group position={floor}>
      <lineSegments
        geometry={floorSquare}
        material={quietSquare}
        position={[0, 0.01, 0]}
        raycast={noRaycast}
      />
      <group ref={spin} position={[0, 0.38, 0]} scale={[1, 1.45, 1]}>
        <mesh geometry={diamond} material={quietFill} raycast={noRaycast} />
        <lineSegments geometry={diamondEdges} material={quietEdge} raycast={noRaycast} />
      </group>
      <sprite position={[0, 0.38, 0]} scale={0.5} raycast={noRaycast}>
        <spriteMaterial
          {...quietGlow}
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
          toneMapped={false}
        />
      </sprite>
    </group>
  );
};

// A glowing wall of light rising from a ring: bright at the foot, gone by the top.
const wallMaterial = (hex: string, strength: number, strobe = false) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    toneMapped: false,
    uniforms: { uColor: { value: hdr(hex, strength) }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uTime; varying vec2 vUv;
      void main() {
        float fall = pow(1.0 - vUv.y, 2.2);
        // Scan bands climbing the wall
        float bands = 0.65 + 0.35 * step(0.5, fract(vUv.y * 7.0 - uTime * 1.8));
        float pulse = ${strobe ? '0.3 + 0.7 * step(0.45, fract(uTime * 2.4))' : '0.75 + 0.25 * sin(uTime * 5.0)'};
        gl_FragColor = vec4(uColor, fall * bands * pulse * 0.8);
      }`,
  });
const wall = new CylinderGeometry(1, 1, 1, 40, 1, true);
const ring = (inner: number, outer: number) => new RingGeometry(inner, outer, 64);
const captureRing = ring(0.46, 0.53);
const captureOuter = ring(0.55, 0.58);
const captureFill = basic(HOT, 2.2);
const captureFaint = basic(HOT, 1.6, 0.8);
const captureWall = wallMaterial(HOT, 1.4);
const captureSquare = squareMaterial(HOT, 1.6);

const Capture = ({ floor }: MarkerProps) => {
  const pulse = useRef<Mesh>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    captureWall.uniforms.uTime.value = t;
    const k = (t * 1.4) % 1;
    const p = pulse.current;
    if (p) {
      p.scale.setScalar(1 + k * 0.45);
      (p.material as MeshBasicMaterial).opacity = 0.9 * (1 - k);
    }
  });
  return (
    <group position={floor}>
      <lineSegments
        geometry={floorSquare}
        material={captureSquare}
        position={[0, 0.01, 0]}
        raycast={noRaycast}
      />
      <mesh
        geometry={captureRing}
        material={captureFill}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.02, 0]}
        raycast={noRaycast}
      />
      <mesh
        ref={pulse}
        geometry={captureOuter}
        material={captureFaint}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.02, 0]}
        raycast={noRaycast}
      />
      <mesh
        geometry={wall}
        material={captureWall}
        position={[0, 0.55, 0]}
        scale={[0.53, 1.1, 0.53]}
        raycast={noRaycast}
      />
    </group>
  );
};

const selectRing = ring(0.4, 0.46);
const selectFill = basic('#fff6d8', 2.4);
const selectSquare = squareMaterial('#fff6d8', 2);
const selectBeam = wallMaterial('#ffc94a', 0.55);

const Selection = ({ floor }: MarkerProps) => {
  useFrame((state) => {
    selectBeam.uniforms.uTime.value = state.clock.elapsedTime;
  });
  return (
    <group position={floor}>
      <lineSegments
        geometry={floorSquare}
        material={selectSquare}
        position={[0, 0.012, 0]}
        raycast={noRaycast}
      />
      <mesh
        geometry={selectRing}
        material={selectFill}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.02, 0]}
        raycast={noRaycast}
      />
      <mesh
        geometry={wall}
        material={selectBeam}
        position={[0, 0.7, 0]}
        scale={[0.44, 1.5, 0.44]}
        raycast={noRaycast}
      />
    </group>
  );
};

// The last move: both floors outlined in sunset orange, joined by a line of
// light with pulses running from where the piece came from to where it went.
const trailMaterial = new ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  toneMapped: false,
  uniforms: { uColor: { value: hdr(ORANGE, 1.8) }, uTime: { value: 0 }, uLen: { value: 1 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor; uniform float uTime; uniform float uLen; varying vec2 vUv;
    void main() {
      float dash = fract(vUv.y * uLen * 1.6 - uTime * 1.2);
      float pulse = smoothstep(0.0, 0.25, dash) * (1.0 - smoothstep(0.35, 0.6, dash));
      float a = (0.35 + 0.65 * vUv.y) * (0.35 + 0.9 * pulse);
      gl_FragColor = vec4(uColor, a);
    }`,
});
const trailTube = new CylinderGeometry(0.03, 0.03, 1, 8, 1, true);
const fromSquare = squareMaterial(ORANGE, 0.9);
const toSquare = squareMaterial(ORANGE, 2.2);
const UP = new Vector3(0, 1, 0);

const LastMove = ({ from, to }: LastMoveMarkerProps) => {
  const { mid, len, quat } = useMemo(() => {
    const a = new Vector3(...from.floor);
    const b = new Vector3(...to.floor);
    const d = b.clone().sub(a);
    return {
      mid: a.clone().add(b).multiplyScalar(0.5).toArray() as Vec3,
      len: d.length(),
      quat: new Quaternion().setFromUnitVectors(UP, d.normalize()),
    };
  }, [from, to]);
  useFrame((state) => {
    trailMaterial.uniforms.uTime.value = state.clock.elapsedTime;
    trailMaterial.uniforms.uLen.value = len;
  });
  return (
    <group position={[0, 0.03, 0]}>
      <lineSegments
        geometry={floorSquare}
        material={fromSquare}
        position={from.floor}
        raycast={noRaycast}
      />
      <lineSegments
        geometry={floorSquare}
        material={toSquare}
        position={to.floor}
        scale={1.08}
        raycast={noRaycast}
      />
      <mesh
        geometry={trailTube}
        material={trailMaterial}
        position={mid}
        quaternion={quat}
        scale={[1, len, 1]}
        raycast={noRaycast}
      />
    </group>
  );
};

// Check: a red strobe standing on the king, with alarm rings racing out.
const checkWall = wallMaterial(CHECK_RED, 2.6, true);
const checkCore = wallMaterial('#ffd0d4', 1.2, true);
const checkRing = ring(0.48, 0.55);
const checkFills = [basic(CHECK_RED, 2.4, 0.9), basic(CHECK_RED, 2.4, 0.9)];
// A cage of solid red bars round the king's cell, strobing white: plain
// colour rather than light, so it holds up against the sunset too.
const CAGE = 1.16;
const cageBars = (() => {
  const h = CAGE / 2;
  const bars: { p: Vec3; s: Vec3 }[] = [];
  const t = 0.035;
  for (const a of [-h, h])
    for (const b of [-h, h]) {
      bars.push({ p: [0, a, b], s: [CAGE + t, t, t] });
      bars.push({ p: [a, 0, b], s: [t, CAGE + t, t] });
      bars.push({ p: [a, b, 0], s: [t, t, CAGE + t] });
    }
  return bars;
})();
const cageBox = new BoxGeometry(1, 1, 1);
const cageMaterial = new MeshBasicMaterial({ color: hdr(CHECK_RED, 1.4), toneMapped: false });
const CAGE_RED = hdr(CHECK_RED, 1.4);
const CAGE_HOT = hdr('#ffe0e4', 1.6);

const Check = ({ floor, centre }: MarkerProps) => {
  const rings = useRef<(Mesh | null)[]>([]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    cageMaterial.color.copy(Math.sin(t * 14) > 0.75 ? CAGE_HOT : CAGE_RED);
    checkWall.uniforms.uTime.value = t;
    checkCore.uniforms.uTime.value = t;
    rings.current.forEach((r, i) => {
      if (!r) return;
      const k = (t * 1.1 + i * 0.5) % 1;
      r.scale.setScalar(0.8 + k * 0.9);
      (r.material as MeshBasicMaterial).opacity = 0.95 * (1 - k);
    });
  });
  return (
    <group position={floor}>
      {[0, 1].map((i) => (
        <mesh
          key={i}
          ref={(m) => {
            rings.current[i] = m;
          }}
          geometry={checkRing}
          material={checkFills[i]}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.025, 0]}
          raycast={noRaycast}
        />
      ))}
      <mesh
        geometry={wall}
        material={checkWall}
        position={[0, 0.9, 0]}
        scale={[0.55, 1.9, 0.55]}
        raycast={noRaycast}
      />
      <mesh
        geometry={wall}
        material={checkCore}
        position={[0, 0.7, 0]}
        scale={[0.3, 1.4, 0.3]}
        raycast={noRaycast}
      />
      <Banner text="CHECK" position={[0, 1.8, 0]} width={2.8} style="alarm" blink />
      <group position={[centre[0] - floor[0], centre[1] - floor[1], centre[2] - floor[2]]}>
        {cageBars.map(({ p, s }, i) => (
          <mesh
            key={i}
            geometry={cageBox}
            material={cageMaterial}
            position={p}
            scale={s}
            raycast={noRaycast}
          />
        ))}
      </group>
    </group>
  );
};

// --- Effects -------------------------------------------------------------------

const MID = 0.38; // trail height above a floor: through the piece's waist

const MoveFx = ({ from, to, color, durationMs }: MoveFxProps) => {
  const neon = NEON[color];
  const f: Vec3 = [from[0], from[1] + layout.floorY + MID, from[2]];
  const t: Vec3 = [to[0], to[1] + layout.floorY + MID, to[2]];
  const floor: Vec3 = [to[0], to[1] + layout.floorY + 0.02, to[2]];
  return (
    <>
      <LightTrail from={f} to={t} color={neon} durationMs={durationMs} />
      <Delayed ms={durationMs * 0.85}>
        <Shockwave position={floor} color={neon} radius={0.95} lifeMs={420} />
        <Burst
          position={floor}
          colors={[neon, '#ffffff']}
          count={24}
          speed={1.4}
          gravity={2}
          upward={0.7}
          lifeMs={500}
          size={0.06}
        />
      </Delayed>
    </>
  );
};

const pixel = new BoxGeometry(0.075, 0.075, 0.075);
const pixelMaterial = new MeshBasicMaterial({ color: new Color(2.2, 2.2, 2.2), toneMapped: false });

// The victim glitches for a beat as the attacker streaks in, then blows
// apart into neon pixels.
const Victim = ({
  type,
  color,
  lifeMs,
}: {
  type: CaptureFxProps['victim']['type'];
  color: CaptureFxProps['victim']['color'];
  lifeMs: number;
}) => {
  const group = useRef<Group>(null);
  const { t, done } = useLife(lifeMs);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const s = t.current;
    const k = (s * 1000) / lifeMs;
    // Stutters on and off, harder as the hit lands
    const on = Math.sin(s * 90) > (k > 0.5 ? 0.2 : -0.6);
    g.visible = on;
    g.position.x = k > 0.4 ? Math.sin(s * 140) * 0.04 : 0;
    g.scale.set(1 + k * 0.08, 1 - k * 0.05, 1 + k * 0.08);
  });
  if (done) return null;
  return (
    <group ref={group}>
      <group scale={PIECE_SCALE}>
        <SynthParts
          type={type}
          body={bodyMaterial(color, 'hover')}
          accent={accentMaterial(color, 'selected')}
        />
      </group>
    </group>
  );
};

const CaptureFx = ({ floor, victim, durationMs }: CaptureFxProps) => {
  const neon = NEON[victim.color];
  const hit = durationMs * 0.5;
  const waist: Vec3 = [floor[0], floor[1] + 0.35, floor[2]];
  return (
    <>
      <group position={floor}>
        <Victim type={victim.type} color={victim.color} lifeMs={hit} />
      </group>
      <Delayed ms={hit}>
        <Shards
          position={[floor[0], floor[1] + 0.05, floor[2]]}
          geometry={pixel}
          material={pixelMaterial}
          colors={[neon, neon, '#ffffff', SUN]}
          count={70}
          speed={3.2}
          gravity={6}
          upward={0.45}
          spread={0.36}
          spin={9}
          lifeMs={1000}
        />
        <Burst
          position={waist}
          colors={[neon, '#ffffff', SUN]}
          count={80}
          speed={3}
          gravity={2.5}
          upward={0.3}
          lifeMs={800}
          size={0.07}
        />
        <Flash position={waist} color={neon} size={2.6} />
        <Shockwave
          position={[floor[0], floor[1] + 0.03, floor[2]]}
          color={HOT}
          radius={1.6}
          lifeMs={520}
          width={0.05}
        />
        <ScreenShake intensity={9} durationMs={340} />
      </Delayed>
    </>
  );
};

// Fireworks over the mated king in the winner's neon, gold and white.
const SHELLS: { dx: number; dz: number; h: number; delay: number }[] = [
  { dx: 0, dz: 0, h: 2.6, delay: 150 },
  { dx: -1.4, dz: 0.6, h: 2.1, delay: 420 },
  { dx: 1.5, dz: -0.4, h: 2.4, delay: 650 },
  { dx: 0.5, dz: 1.2, h: 3.1, delay: 900 },
  { dx: -0.8, dz: -1.1, h: 2.9, delay: 1150 },
  { dx: 1.1, dz: 0.9, h: 1.9, delay: 1500 },
];

const Celebration = ({ floor, winner }: CelebrationProps) => {
  const neon = winner ? NEON[winner] : SUN;
  const other = winner === 'white' ? '#9ff6ff' : '#ffa6ef';
  return (
    <>
      <Banner
        text="CHECKMATE"
        position={[floor[0], floor[1] + 2, floor[2]]}
        width={4.2}
        style="chrome"
        delayMs={250}
      />
      <Flash
        position={[floor[0], floor[1] + 0.4, floor[2]]}
        color={CHECK_RED}
        size={3}
        lifeMs={400}
      />
      <Shockwave
        position={[floor[0], floor[1] + 0.03, floor[2]]}
        color={neon}
        radius={2.4}
        lifeMs={900}
      />
      {SHELLS.map(({ dx, dz, h, delay }, i) => {
        const at: Vec3 = [floor[0] + dx, floor[1] + h, floor[2] + dz];
        const colors = i % 3 === 2 ? [SUN, '#ffffff', ORANGE] : [neon, other, '#ffffff'];
        return (
          <Delayed key={i} ms={delay}>
            <Rocket
              from={[floor[0] + dx * 0.3, floor[1] + 0.2, floor[2] + dz * 0.3]}
              at={at}
              color={colors[0]}
            >
              <Burst
                position={at}
                colors={colors}
                count={140}
                speed={3.4}
                gravity={1.1}
                upward={0}
                lifeMs={1700}
                size={0.085}
                seed={i * 7 + 3}
              />
              <Flash position={at} color={colors[0]} size={2.4} lifeMs={300} />
            </Rocket>
          </Delayed>
        );
      })}
    </>
  );
};

// --- HUD text glow ----------------------------------------------------------------

// The HUD variables cover panels but not text glow, so the stage adds a
// stylesheet for the neon text while this design is on screen.
const HUD_CSS = `
[data-testid="turn-indicator"] {
  text-shadow: 0 0 4px rgba(255, 255, 255, 0.6), 0 0 10px rgba(255, 43, 214, 0.95), 0 0 22px rgba(255, 43, 214, 0.6);
}
[data-synthwave-hud] { text-shadow: 0 0 6px rgba(39, 227, 255, 0.55); }
`;
const useHudGlow = () => {
  useEffect(() => {
    const style = document.createElement('style');
    style.dataset.design = 'synthwave';
    style.textContent = HUD_CSS;
    document.head.appendChild(style);
    const root = document.querySelector('[data-testid="r3f-canvas"]')?.parentElement?.parentElement;
    root?.setAttribute('data-synthwave-hud', '');
    return () => {
      style.remove();
      root?.removeAttribute('data-synthwave-hud');
    };
  }, []);
};

// --- Stage ----------------------------------------------------------------------

const Stage = () => {
  useHudGlow();
  return (
    <>
      <SunsetSky sun={SUN_DIR} />
      <Stars />
      <Mountains sun={SUN_DIR} />
      <GridFloor sun={SUN_DIR} />
      <fog attach="fog" args={['#12031f', 20, 48]} />
      {/* Reflections in the black glass: the sunset behind, neon strips either side */}
      <Environment resolution={128} frames={1}>
        <Lightformer
          form="rect"
          intensity={1.3}
          color="#ff3a8a"
          position={[SUN_DIR.x * 8, 0.5, SUN_DIR.z * 8]}
          scale={[10, 3, 1]}
        />
        <Lightformer
          form="rect"
          intensity={2}
          color={CYAN}
          position={[-7, 2, 3]}
          rotation-y={Math.PI / 2}
          scale={[1, 8, 1]}
        />
        <Lightformer
          form="rect"
          intensity={1.8}
          color={PINK}
          position={[7, 2, 3]}
          rotation-y={-Math.PI / 2}
          scale={[1, 8, 1]}
        />
        <Lightformer
          form="rect"
          intensity={0.8}
          color="#6a3cff"
          position={[0, 8, 0]}
          rotation-x={Math.PI / 2}
          scale={[10, 10, 1]}
        />
      </Environment>
      <ambientLight intensity={0.35} color="#8a6cff" />
      <directionalLight position={[6, 7, 9]} intensity={1.1} color="#bff6ff" />
      <directionalLight
        position={[SUN_DIR.x * 10, 2, SUN_DIR.z * 10]}
        intensity={0.9}
        color="#ff5a8a"
      />
      <Bloom strength={0.85} radius={0.55} threshold={0.8} />
    </>
  );
};

// Destination cells get no box fill: the markers say it all.
const hidden = new MeshBasicMaterial({ visible: false });

const synthwave: Design = {
  id: 'synthwave',
  name: 'Synthwave',
  blurb: 'Neon-traced black glass over an endless retro grid, under a striped setting sun.',
  layout,
  continuous: true,
  canvas: { fov: 52, toneMapping: NoToneMapping, antialias: true },
  Stage,
  Grid,
  cellFills: { destination: hidden, lastMove: hidden },
  PieceBody,
  knightYaw: 0.35,
  markers: { Quiet, Capture, Selection, LastMove, Check },
  motion: { style: 'slide', durationMs: 320, lift: 0 },
  MoveFx,
  CaptureFx,
  Celebration,
  toppleMatedKing: true,
  hoverLift: true,
  hud: {
    vars: {
      '--hud-font': '"Orbitron", "Segoe UI", sans-serif',
      '--hud-mono': '"Orbitron", ui-monospace, monospace',
      '--hud-bg': 'linear-gradient(180deg, rgba(34, 6, 58, 0.78), rgba(12, 2, 26, 0.82))',
      '--hud-fg': '#e8fbff',
      '--hud-muted': 'rgba(39, 227, 255, 0.55)',
      '--hud-accent': 'linear-gradient(180deg, #ffd23f, #ff5a8a)',
      '--hud-accent-fg': '#1a0326',
      '--hud-border': '1px solid rgba(39, 227, 255, 0.75)',
      '--hud-radius': '2px',
      '--hud-shadow': '0 0 14px rgba(39, 227, 255, 0.35), inset 0 0 18px rgba(255, 43, 214, 0.12)',
      '--hud-blur': 'blur(4px)',
      '--hud-case': 'uppercase',
      '--hud-tracking': '0.12em',
      '--turn-bg': 'linear-gradient(180deg, rgba(58, 8, 74, 0.85), rgba(16, 2, 32, 0.85))',
      '--turn-fg': '#fff2fd',
      '--turn-size': '19px',
      '--turn-border': '1px solid #ff2bd6',
      '--turn-shadow': '0 0 18px rgba(255, 43, 214, 0.55), inset 0 0 14px rgba(255, 43, 214, 0.25)',
      '--modal-bg': 'linear-gradient(180deg, #2a0746 0%, #12031f 60%, #3a0a3a 100%)',
      '--modal-fg': '#e8fbff',
      '--modal-backdrop': 'rgba(10, 0, 20, 0.5)',
      '--modal-radius': '2px',
      '--modal-shadow': '0 0 40px rgba(255, 43, 214, 0.45), 0 0 90px rgba(39, 227, 255, 0.2)',
      '--button-bg': 'linear-gradient(180deg, #fff27a 0%, #ff9d2e 45%, #ff2e8a 100%)',
      '--button-fg': '#1a0326',
      '--button-border': '1px solid #ffe9a8',
      '--button-radius': '2px',
      '--page-bg': 'linear-gradient(180deg, #040009 0%, #2a0748 55%, #8a0f6e 85%, #ff4d6d 100%)',
      '--page-fg': '#e8fbff',
    },
    overlay: {
      background:
        'repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.14) 0px, rgba(0, 0, 0, 0.14) 1px, transparent 1px, transparent 3px), radial-gradient(ellipse at 50% 45%, transparent 55%, rgba(8, 0, 18, 0.55) 100%)',
    },
  },
};

export default synthwave;
