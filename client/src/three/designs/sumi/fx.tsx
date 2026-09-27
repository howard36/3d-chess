import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import type { Group, Mesh, Texture } from 'three';
import { PieceType } from '../../../engine/pieces';
import { easeInOutCubic } from '../../motion';
import { Burst, ScreenShake } from '../kit/fx';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import type { CaptureFxProps, CelebrationProps, MoveFxProps, Vec3 } from '../types';
import { InkMark } from './ink';
import { INK, SEAL } from './palette';
import { bodyMaterial, grooveMaterial, hullMaterial, PieceMeshes } from './pieces';
import { splashTextures } from './textures';

// Sumi's moments of motion. A moving piece leaves a brush trail that dries
// out behind it and lands with a ring of ink; a captured piece floods with
// ink and melts into a splash that soaks into the paper and fades; a mate is
// sealed with a great ensō and a vermilion stamp. Everything runs on r3f's
// clock and ends on its own, leaving the board exactly as calm as before.

const MAX_FRAME = 1 / 30;

// --- Move: the ink trail ---------------------------------------------------------

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
  void main() {
    // Thin at the drying tail, full just behind the piece
    float k = clamp((aE - uTail) / max(uHead - uTail, 1e-4), 0.0, 1.0);
    float visible = step(uTail, aE) * step(aE, uHead);
    float halfWidth = uWidth * 0.5 * (0.15 + 0.85 * k) * visible;
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
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const trailFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAcross;
  varying float vHalf;
  varying float vK;
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
    float n = vnoise(u * 6.0 + 9.0);
    body *= smoothstep(0.55 * (1.0 - vK) - 0.1, 0.55 * (1.0 - vK) + 0.1, n);
    float a = body * uOpacity * (0.35 + 0.65 * vK);
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }`;

const SAMPLES = 48;

/**
 * A brush trail along a piece's hop, at the height of its body: it grows
 * behind the piece, thin and broken where it has dried, and is gone a
 * moment after the piece lands.
 */
const InkTrail = ({
  from,
  to,
  durationMs,
  lift,
  height,
}: {
  from: Vec3;
  to: Vec3;
  durationMs: number;
  lift: number;
  height: number;
}) => {
  const invalidate = useThree((s) => s.invalidate);
  const [done, setDone] = useState(false);
  const elapsed = useRef(0);
  const { geometry, material } = useMemo(() => {
    // The hop's path as MoveGlide flies it, parametrised by its eased progress
    const at = (e: number): Vec3 => [
      from[0] + (to[0] - from[0]) * e,
      from[1] + (to[1] - from[1]) * e + lift * 4 * e * (1 - e) + height,
      from[2] + (to[2] - from[2]) * e,
    ];
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
        uColor: { value: new Color(INK) },
        uOpacity: { value: 0.85 },
        uHead: { value: 0 },
        uTail: { value: 0 },
        uWidth: { value: 0.22 },
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

  const lag = 0.22;
  useFrame((_, delta) => {
    if (done) return;
    elapsed.current += Math.min(delta, MAX_FRAME);
    const t = (elapsed.current * 1000) / durationMs;
    const e = (x: number) => easeInOutCubic(Math.min(Math.max(x, 0), 1));
    material.uniforms.uHead.value = e(t);
    material.uniforms.uTail.value = e(t - lag - Math.max(0, t - 1) * 1.6);
    if (t > 1 + lag + 0.25) setDone(true);
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

/** An ink ring spreading once from a point on the floor, fading as it goes. */
const InkRipple = ({
  floor,
  delayMs,
  radius = 0.44,
  lifeMs = 520,
  color = INK,
  opacity = 0.55,
}: {
  floor: Vec3;
  delayMs: number;
  radius?: number;
  lifeMs?: number;
  color?: string;
  opacity?: number;
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
      const e = 1 - (1 - Math.min(Math.max(k, 0), 1)) ** 3;
      m.scale.setScalar(0.45 + 0.55 * e);
      material.opacity = k < 0 ? 0 : opacity * (1 - Math.min(k, 1)) ** 1.5;
    }
    if (k >= 1) setDone(true);
    else invalidate();
  });
  if (done) return null;
  return (
    <mesh
      ref={mesh}
      material={material}
      position={[floor[0], floor[1] + 0.014, floor[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={LAYER.marker}
      raycast={noRaycast}
    >
      <ringGeometry args={[radius * 0.86, radius, 48]} />
    </mesh>
  );
};

export const makeMoveFx = (floorY: number, lift: number) => {
  const MoveFx = ({ from, to, durationMs }: MoveFxProps) => {
    const floor: Vec3 = [to[0], to[1] + floorY, to[2]];
    return (
      <>
        <InkTrail
          from={[from[0], from[1] + floorY, from[2]]}
          to={floor}
          durationMs={durationMs}
          lift={lift}
          height={0.24}
        />
        <InkRipple floor={floor} delayMs={durationMs * 0.96} />
      </>
    );
  };
  return MoveFx;
};

// --- Capture: melting into ink -----------------------------------------------------

const splashGeometry = new PlaneGeometry(1, 1);

const inkMark = (map: Texture) =>
  new MeshBasicMaterial({
    map,
    color: INK,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 3;

/**
 * The taken piece sees the attacker coming: it trembles, floods with ink
 * from the base up and melts into a pool while the attacker is still in the
 * air; the attacker lands in the pool and throws out drops and streaks; the
 * ink then soaks into the paper and fades away.
 */
export const makeCaptureFx = (pieceScale: number) => {
  const CaptureFx = ({ floor, victim, victimFacing, durationMs }: CaptureFxProps) => {
    const invalidate = useThree((s) => s.invalidate);
    const body = useRef<Group>(null);
    const pool = useRef<Mesh>(null);
    const spatter = useRef<Mesh>(null);
    const elapsed = useRef(0);
    const [phase, setPhase] = useState<'wait' | 'splash' | 'done'>('wait');
    const land = durationMs / 1000;
    const flood = land * 0.3;

    // The victim's own materials, so darkening it leaves its army untouched
    const mats = useMemo(() => {
      const textures = splashTextures();
      return {
        body: bodyMaterial(victim.color).clone(),
        hull: hullMaterial(INK, 0.0015),
        pool: inkMark(textures.pool),
        spatter: inkMark(textures.spatter),
      };
    }, [victim.color]);
    useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
    const inkColor = useMemo(() => new Color(INK), []);
    const baseColor = useMemo(() => mats.body.color.clone(), [mats]);

    useFrame((_, delta) => {
      if (phase === 'done') return;
      elapsed.current += Math.min(delta, MAX_FRAME);
      const t = elapsed.current;
      const b = body.current;
      if (b) {
        if (t < flood) {
          // A growing tremble as the attacker takes off
          const k = t / flood;
          b.position.set(Math.sin(t * 95) * 0.01 * k, 0, Math.cos(t * 81) * 0.01 * k);
        } else {
          // Flooded with ink, then slumping down into its pool
          const ink = clamp01((t - flood) / 0.1);
          mats.body.color.copy(baseColor).lerp(inkColor, ink);
          mats.body.roughness = 0.2 + 0.5 * ink;
          const k = clamp01((t - flood) / (land - flood + 0.03));
          const melt = k ** 1.7;
          b.position.set(0, 0, 0);
          b.scale.set(1 + 0.4 * melt, Math.max(1e-3, 1 - melt), 1 + 0.4 * melt);
          b.visible = k < 1;
        }
      }
      // The pool grows as the piece melts, jumps as the attacker lands, then soaks away
      const form = easeOut((t - flood) / (land - flood));
      const hit = easeOut((t - land) / 0.16);
      const soak = clamp01((t - land - 0.4) / 1.1);
      const fade = (1 - soak) ** 1.5;
      pool.current?.scale.setScalar(1.15 * (0.35 + 0.5 * form + 0.22 * hit + 0.1 * soak));
      mats.pool.opacity = t < flood ? 0 : 0.9 * form * fade;
      spatter.current?.scale.setScalar(1.9 * (0.6 + 0.4 * hit + 0.06 * soak));
      mats.spatter.opacity = t < land ? 0 : 0.95 * hit * fade;
      if (phase === 'wait' && t >= land) setPhase('splash');
      if (t > land + 1.6) setPhase('done');
      else invalidate();
    });

    if (phase === 'done') return null;
    // Facing as Board turned it (a knight looks toward the opponent)
    const yaw = victim.type === PieceType.Knight ? (victimFacing ?? 0) : 0;
    const spin = (floor[0] * 3.1 + floor[2] * 1.7) % Math.PI;
    return (
      <>
        <group position={floor} scale={pieceScale}>
          <group ref={body} rotation={[0, yaw, 0]}>
            <PieceMeshes
              type={victim.type}
              body={mats.body}
              groove={grooveMaterial[victim.color]}
              hull={mats.hull}
            />
          </group>
        </group>
        <mesh
          ref={pool}
          geometry={splashGeometry}
          material={mats.pool}
          position={[floor[0], floor[1] + 0.008, floor[2]]}
          rotation={[-Math.PI / 2, 0, spin]}
          renderOrder={LAYER.shadow}
          raycast={noRaycast}
        />
        <mesh
          ref={spatter}
          geometry={splashGeometry}
          material={mats.spatter}
          position={[floor[0], floor[1] + 0.009, floor[2]]}
          rotation={[-Math.PI / 2, 0, spin + 1.3]}
          renderOrder={LAYER.shadow}
          raycast={noRaycast}
        />
        {phase === 'splash' && (
          <>
            <Burst
              position={[floor[0], floor[1] + 0.06, floor[2]]}
              colors={[INK, '#2d2622', '#403833']}
              count={44}
              speed={2.4}
              gravity={6.5}
              upward={0.75}
              lifeMs={650}
              size={0.11}
              additive={false}
            />
            <InkRipple floor={floor} delayMs={0} radius={0.62} lifeMs={620} opacity={0.6} />
            <ScreenShake intensity={2.5} durationMs={200} />
          </>
        )}
      </>
    );
  };
  return CaptureFx;
};

// --- Mate: the ensō and the seal ------------------------------------------------

/** A vermilion hanko stamped beside the fallen king: pressed down from a touch larger. */
const Stamp = ({ at, delayMs }: { at: Vec3; delayMs: number }) => {
  const group = useRef<Group>(null);
  const elapsed = useRef(-delayMs / 1000);
  const invalidate = useThree((s) => s.invalidate);
  const [shown, setShown] = useState(false);
  useFrame((_, delta) => {
    const g = group.current;
    if (elapsed.current > 0.4) return;
    elapsed.current += Math.min(delta, MAX_FRAME);
    const t = elapsed.current;
    if (t >= 0 && !shown) setShown(true);
    if (g) g.scale.setScalar(1 + 0.45 * (1 - Math.min(Math.max(t, 0) / 0.16, 1)) ** 2);
    invalidate();
  });
  return (
    <group ref={group} position={at} visible={shown}>
      <InkMark
        floor={[0, 0, 0]}
        kind="seal"
        color={SEAL}
        radius={0.13}
        width={0.035}
        fill={0.85}
        opacity={1}
        quad={0.4}
        renderOrder={LAYER.trace}
      />
    </group>
  );
};

export const Celebration = ({ floor, winner }: CelebrationProps) => {
  const seal: Vec3 = [floor[0] + 0.62, floor[1] + 0.004, floor[2] + 0.5];
  return (
    <>
      <InkMark
        floor={floor}
        color={winner === 'white' ? INK : '#3a3a44'}
        radius={0.72}
        width={0.12}
        gap={0.08}
        start={2.4}
        opacity={0.92}
        dry={0.7}
        drawMs={1100}
        delayMs={500}
        quad={1.8}
        renderOrder={LAYER.trace}
      />
      <InkRipple floor={floor} delayMs={420} radius={0.9} lifeMs={900} opacity={0.4} />
      <Stamp at={seal} delayMs={1700} />
    </>
  );
};
