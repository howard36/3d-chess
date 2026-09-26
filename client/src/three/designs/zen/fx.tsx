import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, DodecahedronGeometry, ShaderMaterial, TetrahedronGeometry } from 'three';
import type { Group, Texture } from 'three';
import { PieceType } from '../../../engine/pieces';
import { StauntonParts } from '../classic/pieces';
import { Burst, Shards } from '../kit/fx';
import { noRaycast } from '../kit/noRaycast';
import type { PieceColor, Vec3 } from '../types';
import { PETAL_COLORS, petalGeometry, petalMaterial } from './petals';
import { ENSO_START, ENSO_SWEEP, ensoTexture } from './textures';
import { stoneGeometries, stoneMaterial } from './stone';

// Zen effects: a stone taken crumbles to grit and dust and shakes loose a
// few petals; a mate brings down a flurry of blossom while an ensō is
// brushed around the fallen king.

const MAX_FRAME = 1 / 30;

/**
 * Ink on the board, drawn in along its stroke: `uProgress` 0..1 reveals the
 * ensō from where the brush touched down.
 */
export const brushMaterial = (map: Texture, color: string, opacity = 1) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    uniforms: {
      uMap: { value: map },
      uColor: { value: new Color(color) },
      uOpacity: { value: opacity },
      uProgress: { value: 1 },
      uStart: { value: ENSO_START },
      uSweep: { value: ENSO_SWEEP },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform vec3 uColor; uniform float uOpacity;
      uniform float uProgress; uniform float uStart; uniform float uSweep;
      varying vec2 vUv;
      void main() {
        vec4 t = texture2D(uMap, vUv);
        // Angle along the stroke, in the canvas's frame (y down)
        vec2 d = vec2(vUv.x - 0.5, 0.5 - vUv.y);
        float a = atan(d.y, d.x) - uStart;
        a = mod(a, 6.28318) / (6.28318 * uSweep);
        float shown = 1.0 - smoothstep(uProgress - 0.04, uProgress, a);
        gl_FragColor = vec4(uColor, t.a * uOpacity * shown);
        #include <colorspace_fragment>
      }`,
  });

/** Eases a brush material's stroke in over `ms`, once, after `delayMs`. */
export const useBrushIn = (material: ShaderMaterial, ms: number, delayMs = 0) => {
  const elapsed = useRef(-delayMs / 1000);
  const invalidate = useThree((s) => s.invalidate);
  useFrame((_, delta) => {
    if (elapsed.current * 1000 > ms) return;
    elapsed.current += Math.min(delta, MAX_FRAME);
    const k = Math.min(Math.max(elapsed.current * 1000, 0) / ms, 1);
    material.uniforms.uProgress.value = 1 - (1 - k) ** 2;
    invalidate();
  });
};

const chipGeometry = new DodecahedronGeometry(0.045, 0);
const shardGeometry = new TetrahedronGeometry(0.06, 0);

const DUST: Record<PieceColor, string[]> = {
  white: ['#efe9dd', '#d9d1c2', '#c8bfae'],
  black: ['#6e6c68', '#8b877f', '#55534f'],
};

/**
 * The taken stone trembles as the attacker comes down on it, then crumbles:
 * it slumps into its own footprint while chips and grit spray out, a puff
 * of stone dust rolls across the tray, and a few petals shake loose.
 */
export const Crumble = ({
  floor,
  victim,
  durationMs,
  knightYaw,
}: {
  floor: Vec3;
  victim: { type: PieceType; color: PieceColor };
  durationMs: number;
  knightYaw: number;
}) => {
  const invalidate = useThree((s) => s.invalidate);
  const body = useRef<Group>(null);
  const elapsed = useRef(0);
  const impact = (durationMs * 0.78) / 1000;
  const [phase, setPhase] = useState<'wait' | 'crumble' | 'done'>('wait');

  useFrame((_, delta) => {
    if (phase === 'done') return;
    elapsed.current += Math.min(delta, MAX_FRAME);
    const t = elapsed.current;
    const b = body.current;
    const since = t - impact;
    if (b) {
      if (since < 0) {
        // A growing tremble as the attacker lands
        const k = t / impact;
        b.position.set(Math.sin(t * 90) * 0.006 * k, 0, Math.cos(t * 77) * 0.006 * k);
      } else {
        const k = Math.min(since / 0.42, 1);
        const slump = k * k;
        b.scale.set(1 + 0.25 * slump, Math.max(1e-3, 1 - slump), 1 + 0.25 * slump);
        b.visible = k < 1;
      }
    }
    if (phase === 'wait' && since >= 0) setPhase('crumble');
    if (since > 2.6) setPhase('done');
    else invalidate();
  });

  // A stone never crumbles into the tray below: the chips stop at the floor
  // by fading before they fall far.
  const dust = DUST[victim.color];
  const material = stoneMaterial(victim.color);
  const yaw =
    victim.type === PieceType.Knight ? (victim.color === 'white' ? -1 : 1) * knightYaw : 0;
  if (phase === 'done') return null;
  return (
    <>
      <group position={floor}>
        <group ref={body} rotation={[0, yaw, 0]}>
          <StauntonParts
            type={victim.type}
            material={material}
            groove={material}
            geometries={stoneGeometries}
            castShadow
          />
        </group>
      </group>
      {phase === 'crumble' && (
        <>
          <Shards
            position={[floor[0], floor[1] + 0.2, floor[2]]}
            geometry={chipGeometry}
            material={material}
            count={26}
            speed={1.5}
            gravity={5}
            upward={0.55}
            spread={0.3}
            lifeMs={700}
            spin={9}
          />
          <Shards
            position={[floor[0], floor[1] + 0.35, floor[2]]}
            geometry={shardGeometry}
            material={material}
            count={12}
            speed={1.1}
            gravity={5}
            upward={0.7}
            spread={0.2}
            lifeMs={620}
            spin={7}
            seed={9}
          />
          <Burst
            position={[floor[0], floor[1] + 0.08, floor[2]]}
            colors={dust}
            count={70}
            speed={1.1}
            gravity={-0.25}
            upward={0.15}
            lifeMs={1700}
            size={0.3}
            additive={false}
          />
          <Shards
            position={[floor[0], floor[1] + 0.5, floor[2]]}
            geometry={petalGeometry}
            material={petalMaterial}
            colors={PETAL_COLORS}
            count={16}
            speed={1.4}
            gravity={0.9}
            upward={0.6}
            spread={0.35}
            lifeMs={2400}
            spin={5}
            flutter
          />
        </>
      )}
    </>
  );
};

/** A small puff of grit where a piece is set down. */
export const LandingDust = ({ at, delayMs }: { at: Vec3; delayMs: number }) => (
  <Burst
    position={at}
    colors={['#e6dccb', '#d5c9b4']}
    count={22}
    speed={0.7}
    gravity={-0.15}
    upward={0.05}
    lifeMs={900}
    size={0.16}
    additive={false}
    delayMs={delayMs}
  />
);

/**
 * The mate: a large ensō brushed around the fallen king, and a flurry of
 * petals loosed over it in two waves.
 */
export const Flurry = ({ floor, ink }: { floor: Vec3; ink: string }) => {
  const enso = useMemo(() => brushMaterial(ensoTexture, ink, 0.9), [ink]);
  useEffect(() => () => enso.dispose(), [enso]);
  useBrushIn(enso, 1100, 450);
  return (
    <>
      <mesh
        position={[floor[0], floor[1] + 0.006, floor[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={enso}
        raycast={noRaycast}
        renderOrder={2}
      >
        <planeGeometry args={[2.1, 2.1]} />
      </mesh>
      <Shards
        position={[floor[0], floor[1] + 2.2, floor[2]]}
        geometry={petalGeometry}
        material={petalMaterial}
        colors={PETAL_COLORS}
        count={180}
        speed={3.2}
        gravity={0.7}
        upward={0.35}
        spread={1.4}
        lifeMs={5200}
        spin={5}
        flutter
        delayMs={300}
      />
      <Shards
        position={[floor[0], floor[1] + 3, floor[2]]}
        geometry={petalGeometry}
        material={petalMaterial}
        colors={PETAL_COLORS}
        count={140}
        speed={2.4}
        gravity={0.55}
        upward={0.2}
        spread={2.2}
        lifeMs={6200}
        spin={4}
        flutter
        seed={17}
        delayMs={1300}
      />
    </>
  );
};
