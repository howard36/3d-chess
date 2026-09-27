import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  RingGeometry,
  ShaderMaterial,
} from 'three';
import type { Group, Material, PerspectiveCamera } from 'three';
import { PieceType } from '../../../engine/pieces';
import { ChessPiece } from '../../pieces';
import { easeInOutCubic } from '../../motion';
import { movePoint } from '../../movePath';
import { Burst, Shards } from '../kit/fx';
import { noRaycast } from '../kit/noRaycast';
import { dotTexture, rng } from '../kit/textures';
import { LAYER } from '../kit/layers';
import type { CaptureFxProps, CelebrationProps, MoveFxProps, Vec3 } from '../types';
import { MOVE, RIM, SELECT } from './palette';
import { underPieces } from './markers';
import { PolarMaterial } from './pieces';

// Motion: pieces glide like skaters on ice. A glide leaves a wake of
// diamond dust (ice crystals hanging in the air, glinting as they settle),
// and lands with a ring of frost spreading on the ice. A captured piece
// frosts over as the capturer arrives and shatters into shards of ice. A
// mate raises the aurora itself round the fallen king.

const MAX_FRAME = 1 / 20;
const DUST = { white: ['#ffffff', '#d8efff', '#bfe4ff'], black: [RIM, '#d4e2f0', '#9fb3c8'] };

// --- The glide's wake -----------------------------------------------------------

const Wake = ({
  from,
  to,
  arc,
  durationMs,
  colors,
  floorY,
}: {
  from: Vec3;
  to: Vec3;
  arc: number;
  durationMs: number;
  colors: string[];
  floorY: number;
}) => {
  const invalidate = useThree((s) => s.invalidate);
  const count = 34;
  const lifeS = 0.75;
  const elapsed = useRef(0);
  const [done, setDone] = useState(false);
  const { geometry, material, seeds } = useMemo(() => {
    const random = rng(97);
    const seeds = Array.from({ length: count }, (_, i) => ({
      born: (i / count) * (durationMs / 1000) * 0.95,
      off: [(random() - 0.5) * 0.3, 0.05 + random() * 0.45, (random() - 0.5) * 0.3] as Vec3,
      rise: 0.15 + random() * 0.3,
    }));
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const c = new Color();
    for (let i = 0; i < count; i++) {
      c.set(colors[Math.floor(random() * colors.length)]);
      col.set([c.r, c.g, c.b], i * 3);
      size[i] = 0.5 + random() * 0.8;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aAlpha', new BufferAttribute(new Float32Array(count), 1));
    geometry.setAttribute('color', new BufferAttribute(col, 3));
    geometry.setAttribute('aSize', new BufferAttribute(size, 1));
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexColors: true,
      uniforms: { uMap: { value: dotTexture(0.6) }, uScale: { value: 400 } },
      vertexShader: /* glsl */ `
        uniform float uScale;
        attribute float aAlpha;
        attribute float aSize;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = 0.07 * aSize * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vColor, a);
          #include <colorspace_fragment>
        }`,
    });
    return { geometry, material, seeds };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- configured once per move
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useEffect(() => invalidate(), [invalidate]);

  const a: Vec3 = [from[0], from[1] + floorY, from[2]];
  const b: Vec3 = [to[0], to[1] + floorY, to[2]];
  useFrame((state, delta) => {
    if (done) return;
    elapsed.current += Math.min(delta, MAX_FRAME);
    const t = elapsed.current;
    const pos = geometry.getAttribute('position') as BufferAttribute;
    const alpha = geometry.getAttribute('aAlpha') as BufferAttribute;
    seeds.forEach((s, i) => {
      const age = t - s.born;
      if (age < 0) {
        alpha.setX(i, 0);
        return;
      }
      const k = Math.min(age / lifeS, 1);
      const e = easeInOutCubic(Math.min(s.born / (durationMs / 1000), 1));
      const p = movePoint(a, b, e, arc);
      pos.setXYZ(i, p[0] + s.off[0], p[1] + s.off[1] + s.rise * k, p[2] + s.off[2]);
      // A glint as it forms, then a slow fade
      alpha.setX(i, (k < 0.1 ? k / 0.1 : 1) * (1 - k) ** 1.5 * 0.9);
    });
    pos.needsUpdate = true;
    alpha.needsUpdate = true;
    const cam = state.camera as PerspectiveCamera;
    const fov = ((cam.fov ?? 40) * Math.PI) / 180;
    material.uniforms.uScale.value =
      (state.size.height * state.viewport.dpr) / (2 * Math.tan(fov / 2));
    if (t > durationMs / 1000 + lifeS) setDone(true);
    else invalidate();
  });
  if (done) return null;
  return (
    <points geometry={geometry} material={material} raycast={noRaycast} frustumCulled={false} />
  );
};

// --- A ring of frost spreading on the ice ---------------------------------------

const ringGeometry = new RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2);

const FrostRing = ({
  floor,
  color,
  delayMs = 0,
  lifeMs = 520,
  from = 0.18,
  to = 0.62,
  opacity = 0.85,
}: {
  floor: Vec3;
  color: string;
  delayMs?: number;
  lifeMs?: number;
  from?: number;
  to?: number;
  opacity?: number;
}) => {
  const invalidate = useThree((s) => s.invalidate);
  const mesh = useRef<Mesh>(null);
  const elapsed = useRef(-delayMs / 1000);
  const [done, setDone] = useState(false);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        uniforms: { uColor: { value: new Color(color) }, uA: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uA;
          void main() {
            gl_FragColor = vec4(uColor, uA);
            #include <colorspace_fragment>
          }`,
      }),
    [color],
  );
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => invalidate(), [invalidate]);
  useFrame((_, delta) => {
    if (done) return;
    elapsed.current += Math.min(delta, MAX_FRAME);
    const k = elapsed.current / (lifeMs / 1000);
    const m = mesh.current;
    if (m) {
      const e = 1 - (1 - Math.min(Math.max(k, 0), 1)) ** 3;
      const r = from + (to - from) * e;
      m.scale.set(r, 1, r);
      m.visible = k >= 0;
    }
    material.uniforms.uA.value = k < 0 ? 0 : opacity * (1 - Math.min(k, 1)) ** 1.4;
    if (k >= 1) setDone(true);
    else invalidate();
  });
  if (done) return null;
  return (
    <mesh
      ref={mesh}
      geometry={ringGeometry}
      material={material}
      position={[floor[0], floor[1] + 0.02, floor[2]]}
      renderOrder={LAYER.marker}
      raycast={noRaycast}
      visible={false}
    />
  );
};

/** The glide's diamond-dust wake, then a frost ring and a puff of glints where it lands. */
export const makeMoveFx = (floorY: number) => {
  const MoveFx = ({ from, to, color, durationMs, arc = 0 }: MoveFxProps) => {
    const floor: Vec3 = [to[0], to[1] + floorY, to[2]];
    const colors = DUST[color];
    return (
      <>
        <Wake
          from={from}
          to={to}
          arc={arc}
          durationMs={durationMs}
          colors={colors}
          floorY={floorY}
        />
        <FrostRing
          floor={floor}
          color={color === 'white' ? MOVE : RIM}
          delayMs={durationMs * 0.92}
        />
        <Burst
          position={[floor[0], floor[1] + 0.05, floor[2]]}
          colors={colors}
          count={18}
          speed={1.1}
          gravity={0.6}
          lifeMs={620}
          size={0.07}
          upward={0.55}
          delayMs={durationMs * 0.92}
          seed={31}
        />
      </>
    );
  };
  return MoveFx;
};

// --- Capture: the victim frosts over and shatters -------------------------------

const shardGeometry = new OctahedronGeometry(0.05, 0).scale(0.6, 1.6, 0.6);
const shardMaterials = {
  white: new MeshStandardMaterial({
    color: '#eaf6ff',
    emissive: '#8fc8ff',
    emissiveIntensity: 0.35,
    roughness: 0.2,
    transparent: true,
    opacity: 0.9,
  }),
  black: new MeshStandardMaterial({
    color: '#16202a',
    emissive: RIM,
    emissiveIntensity: 0.3,
    roughness: 0.12,
    transparent: true,
    opacity: 0.92,
  }),
};

const FrozenVictim = ({
  type,
  color,
  facing,
  scale,
  freezeMs,
}: {
  type: PieceType;
  color: 'white' | 'black';
  facing?: number;
  scale: number;
  freezeMs: number;
}) => {
  const invalidate = useThree((s) => s.invalidate);
  const group = useRef<Group>(null);
  const elapsed = useRef(0);
  const [gone, setGone] = useState(false);
  // Its own materials: it frosts over alone
  const mats = useMemo(() => {
    const body = new PolarMaterial({
      color: color === 'white' ? '#e9eef3' : '#10151d',
      roughness: color === 'white' ? 0.6 : 0.2,
      emissive: new Color('#bfe6ff'),
      emissiveIntensity: 0,
    });
    body.rim.set(color === 'white' ? '#bfe6ff' : RIM);
    body.rimStrength = 0.6;
    body.rimPower = 2.4;
    return { body };
  }, [color]);
  useEffect(() => () => mats.body.dispose(), [mats]);
  useEffect(() => invalidate(), [invalidate]);
  useFrame((_, delta) => {
    if (gone) return;
    elapsed.current += Math.min(delta, MAX_FRAME) * 1000;
    const k = Math.min(elapsed.current / freezeMs, 1);
    mats.body.emissiveIntensity = k * k * 0.9;
    const g = group.current;
    if (g) {
      // A shiver as the frost takes it
      const shiver = k > 0.6 ? Math.sin(elapsed.current * 0.09) * 0.02 * (k - 0.6) : 0;
      g.rotation.z = shiver;
    }
    if (k >= 1) setGone(true);
    else invalidate();
  });
  if (gone) return null;
  return (
    <group
      ref={group}
      scale={scale}
      rotation={[0, type === PieceType.Knight ? (facing ?? 0) : 0, 0]}
    >
      <ChessPiece type={type} parts={{ body: mats.body as Material }} />
    </group>
  );
};

export const makeCaptureFx = (pieceScale: number) => {
  const CaptureFx = ({ floor, victim, victimFacing, durationMs }: CaptureFxProps) => {
    // The capturer arrives at the end of its glide; the victim breaks just before
    const breakMs = durationMs * 0.82;
    const centre: Vec3 = [floor[0], floor[1] + 0.25, floor[2]];
    return (
      <>
        <group position={floor}>
          <FrozenVictim
            type={victim.type}
            color={victim.color}
            facing={victimFacing}
            scale={pieceScale}
            freezeMs={breakMs}
          />
        </group>
        <Shards
          position={centre}
          geometry={shardGeometry}
          material={shardMaterials[victim.color]}
          count={22}
          speed={1.9}
          gravity={5}
          lifeMs={850}
          spin={9}
          upward={0.55}
          spread={0.2}
          delayMs={breakMs}
          seed={7}
        />
        <Burst
          position={centre}
          colors={DUST[victim.color]}
          count={30}
          speed={1.6}
          gravity={1.2}
          lifeMs={700}
          size={0.08}
          upward={0.4}
          delayMs={breakMs}
          seed={17}
        />
        <FrostRing
          floor={floor}
          color="#ff7a66"
          delayMs={breakMs}
          from={0.25}
          to={0.7}
          opacity={0.7}
        />
      </>
    );
  };
  return CaptureFx;
};

// --- Mate: the aurora rises round the fallen king -------------------------------

const crownGeometry = new CylinderGeometry(0.62, 0.5, 2.6, 64, 1, true).translate(0, 1.3, 0);

const crownFragment = /* glsl */ `
  uniform float uTime;
  uniform float uRise;
  uniform vec3 uA;
  uniform vec3 uB;
  uniform vec3 uC;
  varying vec2 vUv;
  float hash(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
  float noise(float x, float period) {
    float i = floor(x);
    float f = fract(x);
    float u = f * f * (3.0 - 2.0 * f);
    return mix(hash(mod(i, period)), hash(mod(i + 1.0, period)), u);
  }
  void main() {
    float u = vUv.x;
    float v = vUv.y;
    float top = uRise;
    if (v > top) discard;
    float hem = smoothstep(0.0, 0.05, v) * pow(1.0 - v / max(top, 1e-3), 1.4);
    float rays = 0.45 + 0.55 * noise(u * 60.0 - uTime * 0.3, 60.0);
    float folds = 0.6 + 0.4 * noise(u * 9.0 + uTime * 0.12, 9.0);
    vec3 col = mix(uA, uB, smoothstep(0.05, 0.4, v));
    col = mix(col, uC, smoothstep(0.35, 0.9, v));
    float a = hem * rays * folds * 0.75;
    gl_FragColor = vec4(col * a, 1.0);
    #include <colorspace_fragment>
  }`;

/** The aurora curtain rising round the mated king, and a wide ring of frost. */
export const Celebration = ({ floor }: CelebrationProps) => {
  const invalidate = useThree((s) => s.invalidate);
  const elapsed = useRef(0);
  // Added on before the pieces are drawn, and only its far wall: it rises
  // behind the fallen king and glows in the gaps, never over a piece
  const material = useMemo(
    () =>
      underPieces(crownFragment, {
        uTime: { value: 0 },
        uRise: { value: 0 },
        uA: { value: new Color(SELECT[0]) },
        uB: { value: new Color(SELECT[1]) },
        uC: { value: new Color(SELECT[2]) },
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame((state, delta) => {
    elapsed.current += Math.min(delta, MAX_FRAME);
    const k = Math.min(elapsed.current / 1.4, 1);
    material.uniforms.uRise.value = 1 - (1 - k) ** 3;
    material.uniforms.uTime.value = state.clock.elapsedTime;
    invalidate();
  });
  return (
    <>
      <mesh
        geometry={crownGeometry}
        material={material}
        position={floor}
        renderOrder={-1}
        raycast={noRaycast}
      />
      <FrostRing floor={floor} color={SELECT[0]} lifeMs={1100} from={0.3} to={2.2} opacity={0.8} />
      <FrostRing
        floor={floor}
        color={SELECT[2]}
        delayMs={220}
        lifeMs={1200}
        from={0.3}
        to={1.6}
        opacity={0.6}
      />
      <Burst
        position={[floor[0], floor[1] + 0.1, floor[2]]}
        colors={[...SELECT, '#ffffff']}
        count={70}
        speed={2.2}
        gravity={0.9}
        lifeMs={1400}
        size={0.09}
        upward={0.8}
        seed={5}
      />
    </>
  );
};
