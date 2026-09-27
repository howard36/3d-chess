import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  NormalBlending,
  ShaderMaterial,
} from 'three';
import type { Group, Mesh } from 'three';
import { PieceType } from '../../../engine/pieces';
import { easeInOutCubic } from '../../motion';
import { movePoint } from '../../movePath';
import { PIECE_PARTS, partsGeometry } from '../../pieces';
import { Burst, ScreenShake } from '../kit/fx';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import { rng } from '../kit/textures';
import type { CaptureFxProps, CelebrationProps, MoveFxProps, Vec3 } from '../types';
import { InkMark } from './ink';
import { CAPTURE, LACQUER, MOVE, PORCELAIN, SEAL, SILVER } from './palette';
import { nocturneSet } from './pieces';

// Nocturne's moments of motion, all short, all on r3f's clock. A moving
// piece draws a thread of silver ink behind it that fades as it dries, and
// lands with a ripple, as a stone dropped into a moonlit pond. A captured
// piece dissolves into mist: holes open through it with silver edges, and
// the mist it leaves rises and thins away while a vermilion ripple spreads
// under the capturer. A mate is closed with a great silver ensō round the
// fallen king, a drift of moon dust and a vermilion seal.

const MAX_FRAME = 1 / 30;
const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);

// --- Move: the silver trail ---------------------------------------------------------

const trailVertex = /* glsl */ `
  attribute vec3 aTangent;
  attribute float aSide;
  attribute float aE;
  uniform float uHead;
  uniform float uTail;
  uniform float uWidth;
  varying float vAcross;
  varying float vHalf;
  varying float vK;
  varying float vE;
  void main() {
    // Thin at the drying tail, full just behind the piece
    float k = clamp((aE - uTail) / max(uHead - uTail, 1e-4), 0.0, 1.0);
    float visible = step(uTail, aE) * step(aE, uHead);
    float halfWidth = uWidth * 0.5 * (0.2 + 0.8 * k) * visible;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 t = normalize(mat3(modelMatrix) * aTangent);
    vec3 toCamera = normalize(cameraPosition - world.xyz);
    vec3 across = cross(t, toCamera);
    float l = length(across);
    across = l > 1e-4 ? across / l : vec3(1.0, 0.0, 0.0);
    world.xyz += across * aSide * halfWidth;
    vAcross = aSide * halfWidth;
    vHalf = halfWidth;
    vK = k;
    vE = aE;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const trailFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAcross;
  varying float vHalf;
  varying float vK;
  varying float vE;
  float hash(float n) { return fract(sin(n) * 43758.5453123); }
  float vnoise(float x) {
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash(i), hash(i + 1.0), f);
  }
  void main() {
    if (vHalf < 1e-4) discard;
    float u = vAcross / vHalf;
    float aa = fwidth(u);
    float body = 1.0 - smoothstep(1.0 - aa, 1.0, abs(u));
    // Bristle streaks, breaking up toward the drying tail
    float n = vnoise(u * 5.0 + 9.0) * 0.8 + vnoise(vE * 60.0) * 0.2;
    body *= smoothstep(0.6 * (1.0 - vK) - 0.1, 0.6 * (1.0 - vK) + 0.1, n);
    // A brighter core, as wet silver
    vec3 col = mix(uColor, vec3(1.0), 0.35 * (1.0 - abs(u)) * vK);
    float a = body * uOpacity * (0.25 + 0.75 * vK);
    if (a < 0.003) discard;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }`;

const SAMPLES = 48;

/** A silver thread along a piece's path, just behind it, drying and fading as it goes. */
const SilverTrail = ({
  from,
  to,
  durationMs,
  arc,
  height,
}: {
  from: Vec3;
  to: Vec3;
  durationMs: number;
  arc: number;
  height: number;
}) => {
  const invalidate = useThree((s) => s.invalidate);
  const [done, setDone] = useState(false);
  const elapsed = useRef(0);
  const { geometry, material } = useMemo(() => {
    const at = (e: number): Vec3 => {
      const [x, y, z] = movePoint(from, to, e, arc);
      return [x, y + height, z];
    };
    const n = SAMPLES + 1;
    const position = new Float32Array(n * 2 * 3);
    const tangent = new Float32Array(n * 2 * 3);
    const side = new Float32Array(n * 2);
    const eAttr = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const e = i / SAMPLES;
      const p = at(e);
      const a = at(Math.max(0, e - 0.01));
      const b = at(Math.min(1, e + 0.01));
      const t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      for (let s = 0; s < 2; s++) {
        const v = i * 2 + s;
        position.set(p, v * 3);
        tangent.set(t, v * 3);
        side[v] = s === 0 ? -1 : 1;
        eAttr[v] = e;
      }
    }
    const index: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('aTangent', new BufferAttribute(tangent, 3));
    geometry.setAttribute('aSide', new BufferAttribute(side, 1));
    geometry.setAttribute('aE', new BufferAttribute(eAttr, 1));
    geometry.setIndex(index);
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      uniforms: {
        uColor: { value: new Color(SILVER) },
        uOpacity: { value: 0.8 },
        uHead: { value: 0 },
        uTail: { value: 0 },
        uWidth: { value: 0.09 },
      },
      vertexShader: trailVertex,
      fragmentShader: trailFragment,
    });
    return { geometry, material };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a trail is configured once
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useEffect(() => invalidate(), [invalidate]);

  const lag = 0.28;
  useFrame((_, delta) => {
    if (done) return;
    elapsed.current += Math.min(delta, MAX_FRAME);
    const t = (elapsed.current * 1000) / durationMs;
    const e = (x: number) => easeInOutCubic(clamp01(x));
    // The head stays a little behind the piece's centre, so the thread
    // seems to come from it rather than run through it
    material.uniforms.uHead.value = e(t) * 0.97;
    material.uniforms.uTail.value = e(t - lag - Math.max(0, t - 1) * 1.4);
    if (t > 1 + lag + 0.4) setDone(true);
    else invalidate();
  });

  if (done) return null;
  return (
    <mesh
      geometry={geometry}
      material={material}
      renderOrder={LAYER.trace}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

/** A ring spreading once across the paper from where a piece lands, fading as it goes. */
const Ripple = ({
  floor,
  delayMs,
  radius = 0.5,
  lifeMs = 700,
  color = MOVE,
  opacity = 0.5,
  width = 0.08,
}: {
  floor: Vec3;
  delayMs: number;
  radius?: number;
  lifeMs?: number;
  color?: string;
  opacity?: number;
  width?: number;
}) => {
  const mesh = useRef<Mesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const [done, setDone] = useState(false);
  const elapsed = useRef(-delayMs / 1000);
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    [color],
  );
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => invalidate(), [invalidate]);
  useFrame((_, delta) => {
    if (done) return;
    elapsed.current += Math.min(delta, MAX_FRAME);
    const k = (elapsed.current * 1000) / lifeMs;
    const m = mesh.current;
    if (m) {
      const e = 1 - (1 - clamp01(k)) ** 3;
      const r = radius * (0.5 + 0.5 * e);
      // The ring thins as it spreads
      m.scale.set(r, r, 1);
      material.opacity = k < 0 ? 0 : opacity * (1 - clamp01(k)) ** 1.6;
      m.visible = k >= 0;
    }
    if (k >= 1) setDone(true);
    else invalidate();
  });
  if (done) return null;
  const inner = 1 - width / radius;
  return (
    <mesh
      ref={mesh}
      material={material}
      position={[floor[0], floor[1] + 0.014, floor[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={LAYER.marker}
      raycast={noRaycast}
      visible={false}
    >
      <ringGeometry args={[Math.min(Math.max(inner, 0.05), 0.95), 1, 64]} />
    </mesh>
  );
};

export const makeMoveFx = (floorY: number) => {
  const MoveFx = ({ from, to, durationMs, arc = 0, capture }: MoveFxProps) => {
    const floor: Vec3 = [to[0], to[1] + floorY, to[2]];
    return (
      <>
        <SilverTrail
          from={[from[0], from[1] + floorY, from[2]]}
          to={floor}
          durationMs={durationMs}
          arc={arc}
          height={0.2}
        />
        {!capture && (
          <>
            <Ripple floor={floor} delayMs={durationMs * 0.94} radius={0.46} width={0.05} />
            <Ripple
              floor={floor}
              delayMs={durationMs * 0.94 + 140}
              radius={0.62}
              width={0.035}
              opacity={0.3}
              lifeMs={800}
            />
          </>
        )}
      </>
    );
  };
  return MoveFx;
};

// --- Capture: dissolving into mist -------------------------------------------------

const dissolveVertex = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vLocal = position;
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }`;

const dissolveFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uEdge;
  uniform vec3 uRim;
  uniform float uProgress;
  varying vec3 vLocal;
  varying vec3 vNormal;
  varying vec3 vView;
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
                   mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
                   mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  void main() {
    // Holes open from the top down, ragged, until nothing is left
    float n = noise(vLocal * 16.0) * 0.65 + noise(vLocal * 38.0) * 0.35;
    float t = uProgress * 1.45 - 0.3 + vLocal.y * 0.3;
    float cut = n - t;
    if (cut < 0.0) discard;
    vec3 N = normalize(vNormal);
    vec3 V = normalize(vView);
    vec3 L = normalize(vec3(-0.4, 0.8, 0.5));
    float diffuse = 0.3 + 0.7 * max(dot(N, L), 0.0);
    float rim = pow(1.0 - abs(dot(N, V)), 2.4);
    vec3 col = uColor * diffuse + uRim * rim * 0.6;
    // Silver where the piece is coming apart
    float edge = 1.0 - smoothstep(0.0, 0.07, cut);
    col = mix(col, uEdge, edge * step(0.001, uProgress));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const mistVertex = /* glsl */ `
  attribute vec3 aVelocity;
  attribute float aSize;
  attribute float aDelay;
  uniform float uTime;
  uniform float uScale;
  varying float vAlpha;
  void main() {
    float t = max(uTime - aDelay, 0.0);
    // Rising and slowing, as smoke does
    vec3 p = position + aVelocity * (1.0 - exp(-t * 1.8)) / 1.8 + vec3(0.0, 0.12 * t, 0.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float life = clamp(t / 1.35, 0.0, 1.0);
    vAlpha = step(0.0001, uTime - aDelay) * smoothstep(0.0, 0.12, life) * (1.0 - life) * (1.0 - life);
    gl_PointSize = aSize * (0.6 + 1.4 * life) * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;

const mistFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c) * 2.0;
    float a = (1.0 - smoothstep(0.2, 1.0, r)) * vAlpha * uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }`;

/** Puffs of mist rising from where a piece stood, thinning away. */
const MistPuffs = ({
  at,
  color,
  count = 36,
  delayMs = 0,
  height = 0.6,
}: {
  at: Vec3;
  color: string;
  count?: number;
  delayMs?: number;
  height?: number;
}) => {
  const invalidate = useThree((s) => s.invalidate);
  const size = useThree((s) => s.size);
  const [done, setDone] = useState(false);
  const elapsed = useRef(-delayMs / 1000);
  const { geometry, material } = useMemo(() => {
    const random = rng(5);
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    const sz = new Float32Array(count);
    const delay = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = random() * Math.PI * 2;
      const r = random() * 0.16;
      const y = random() * height;
      pos.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
      const out = 0.15 + random() * 0.35;
      vel.set([Math.cos(a) * out, 0.2 + random() * 0.45, Math.sin(a) * out], i * 3);
      sz[i] = 0.22 + random() * 0.26;
      // Top first, as the piece dissolves from the top down
      delay[i] = (1 - y / height) * 0.22 + random() * 0.08;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(pos, 3));
    geometry.setAttribute('aVelocity', new BufferAttribute(vel, 3));
    geometry.setAttribute('aSize', new BufferAttribute(sz, 1));
    geometry.setAttribute('aDelay', new BufferAttribute(delay, 1));
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      uniforms: {
        uColor: { value: new Color(color) },
        uOpacity: { value: 0.32 },
        uTime: { value: 0 },
        uScale: { value: 1 },
      },
      vertexShader: mistVertex,
      fragmentShader: mistFragment,
    });
    return { geometry, material };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- configured once
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useEffect(() => invalidate(), [invalidate]);
  useFrame((state, delta) => {
    if (done) return;
    elapsed.current += Math.min(delta, MAX_FRAME);
    material.uniforms.uTime.value = elapsed.current;
    // Point sizes are in pixels: scale world size by the view's pixels per unit at depth 1
    const camera = state.camera as { fov?: number };
    const fov = ((camera.fov ?? 36) * Math.PI) / 180;
    material.uniforms.uScale.value = (size.height * state.viewport.dpr) / (2 * Math.tan(fov / 2));
    if (elapsed.current > 1.8) setDone(true);
    else invalidate();
  });
  if (done) return null;
  return (
    <points
      geometry={geometry}
      material={material}
      position={at}
      renderOrder={LAYER.trace}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

/**
 * The taken piece dissolves into mist as the capturer glides in: holes open
 * through it from the top down with silver edges, its mist rises and thins,
 * and a vermilion ripple spreads under the capturer as it lands.
 */
export const makeCaptureFx = (pieceScale: number) => {
  const CaptureFx = ({ floor, victim, victimFacing, durationMs }: CaptureFxProps) => {
    const invalidate = useThree((s) => s.invalidate);
    const elapsed = useRef(0);
    const [phase, setPhase] = useState<'dissolve' | 'landed' | 'done'>('dissolve');
    const land = durationMs / 1000;
    const start = land * 0.35;
    const end = land + 0.12;
    const material = useMemo(
      () =>
        new ShaderMaterial({
          uniforms: {
            uColor: { value: new Color(victim.color === 'white' ? PORCELAIN : LACQUER) },
            uEdge: { value: new Color('#f4f7ff') },
            uRim: { value: new Color(victim.color === 'white' ? '#9fb2dc' : SILVER) },
            uProgress: { value: 0 },
          },
          vertexShader: dissolveVertex,
          fragmentShader: dissolveFragment,
        }),
      [victim.color],
    );
    useEffect(() => () => material.dispose(), [material]);
    useEffect(() => invalidate(), [invalidate]);
    useFrame((_, delta) => {
      if (phase === 'done') return;
      elapsed.current += Math.min(delta, MAX_FRAME);
      const t = elapsed.current;
      material.uniforms.uProgress.value = clamp01((t - start) / (end - start));
      if (phase === 'dissolve' && t >= land) setPhase('landed');
      if (t > land + 1.8) setPhase('done');
      else invalidate();
    });
    if (phase === 'done') return null;
    const yaw = victim.type === PieceType.Knight ? (victimFacing ?? 0) : 0;
    const geometry = partsGeometry(nocturneSet(), victim.type, PIECE_PARTS)!;
    return (
      <>
        <group position={floor} scale={pieceScale}>
          <mesh
            geometry={geometry}
            material={material}
            rotation={[0, yaw, 0]}
            raycast={noRaycast}
          />
        </group>
        <MistPuffs
          at={floor}
          color={victim.color === 'white' ? '#aeb8d2' : '#6c7898'}
          delayMs={start * 1000}
          height={0.62 * pieceScale}
        />
        {phase === 'landed' && (
          <>
            <Ripple
              floor={floor}
              delayMs={0}
              radius={0.6}
              width={0.06}
              color={CAPTURE}
              opacity={0.6}
            />
            <Ripple
              floor={floor}
              delayMs={150}
              radius={0.78}
              width={0.04}
              color={CAPTURE}
              opacity={0.3}
              lifeMs={820}
            />
            <ScreenShake intensity={1.6} durationMs={170} />
          </>
        )}
      </>
    );
  };
  return CaptureFx;
};

// --- Mate: the great ensō ---------------------------------------------------------

/** A vermilion seal stamped beside the fallen king: pressed down from a touch larger. */
const Stamp = ({ at, delayMs }: { at: Vec3; delayMs: number }) => {
  const group = useRef<Group>(null);
  const elapsed = useRef(-delayMs / 1000);
  const invalidate = useThree((s) => s.invalidate);
  const [shown, setShown] = useState(false);
  useFrame((_, delta) => {
    if (elapsed.current > 0.4) return;
    elapsed.current += Math.min(delta, MAX_FRAME);
    const t = elapsed.current;
    if (t >= 0 && !shown) setShown(true);
    group.current?.scale.setScalar(1 + 0.45 * (1 - clamp01(t / 0.16)) ** 2);
    invalidate();
  });
  return (
    <group ref={group} position={at} visible={shown}>
      <InkMark
        floor={[0, 0, 0]}
        kind="seal"
        color={SEAL}
        radius={0.14}
        width={0.035}
        fill={0.85}
        opacity={1}
        quad={0.4}
        renderOrder={LAYER.trace}
      />
    </group>
  );
};

export const Celebration = ({ floor }: CelebrationProps) => {
  const seal: Vec3 = [floor[0] + 0.66, floor[1] + 0.004, floor[2] + 0.52];
  return (
    <>
      <InkMark
        floor={floor}
        color={MOVE}
        radius={0.74}
        width={0.11}
        gap={0.07}
        start={2.4}
        opacity={0.95}
        dry={0.7}
        mica={0.8}
        drawMs={1100}
        delayMs={500}
        quad={1.8}
        renderOrder={LAYER.trace}
      />
      <Ripple floor={floor} delayMs={420} radius={1.0} width={0.05} lifeMs={1000} opacity={0.4} />
      <Ripple floor={floor} delayMs={700} radius={1.3} width={0.04} lifeMs={1100} opacity={0.25} />
      <Burst
        position={[floor[0], floor[1] + 0.3, floor[2]]}
        colors={['#e8eeff', '#c3cde0', '#f0d9a0']}
        count={46}
        speed={1.2}
        gravity={-0.25}
        upward={0.85}
        lifeMs={1600}
        size={0.07}
        additive
        delayMs={600}
      />
      <Stamp at={seal} delayMs={1700} />
    </>
  );
};
