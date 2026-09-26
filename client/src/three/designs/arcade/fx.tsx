import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  MeshBasicMaterial,
  NearestFilter,
  Object3D,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { Group, InstancedMesh, Mesh, SpriteMaterial } from 'three';
import type { PieceType } from '../../../engine/pieces';
import { Burst, ScreenShake, Shards } from '../kit/fx';
import { noRaycast } from '../kit/noRaycast';
import { rng } from '../kit/textures';
import type { PieceColor, Vec3 } from '../types';
import { VoxelPiece } from './pieces';
import { debrisColors, PALETTES, VOXEL } from './voxels';

// The Arcade's one-shot effects: pixel sparks, the warp streak of a
// teleporting piece, a voxel explosion for a capture and pixel fireworks for
// the mate. All run on r3f's clock, clamped per frame like the kit's.

const MAX_FRAME = 1 / 30;

const useLifetime = (delayMs: number, lifeMs: number) => {
  const invalidate = useThree((s) => s.invalidate);
  const elapsed = useRef(-delayMs / 1000);
  const [done, setDone] = useState(false);
  useEffect(() => invalidate(), [invalidate]);
  const tick = (delta: number) => {
    elapsed.current += Math.min(delta, MAX_FRAME);
    if (elapsed.current * 1000 >= lifeMs) setDone(true);
    else invalidate();
    return elapsed.current;
  };
  return { done, tick };
};

/** Unlit, instance-coloured cubes: sparks and fireworks. */
export const sparkGeometry = new BoxGeometry(0.06, 0.06, 0.06);
export const sparkMaterial = new MeshBasicMaterial({ toneMapped: false });
/** Lit debris: chunks of a blown-up voxel piece. */
const debrisGeometry = new BoxGeometry(VOXEL * 1.25, VOXEL * 1.25, VOXEL * 1.25);
const debrisMaterial = new MeshBasicMaterial({ toneMapped: false });

/** A pop of square sparks in the colours of a side. */
export const PixelPop = ({
  position,
  color,
  delayMs = 0,
  count = 18,
  seed = 1,
}: {
  position: Vec3;
  color: PieceColor;
  delayMs?: number;
  count?: number;
  seed?: number;
}) => {
  const p = PALETTES[color];
  return (
    <Shards
      position={position}
      geometry={sparkGeometry}
      material={sparkMaterial}
      colors={[p.a, p.c, p.d, '#ffffff']}
      count={count}
      speed={2.2}
      gravity={5}
      upward={0.6}
      spread={0.25}
      lifeMs={520}
      spin={0}
      delayMs={delayMs}
      seed={seed}
    />
  );
};

// --- Warp streak --------------------------------------------------------------

const STREAK = 14;

/**
 * A dotted streak of pixels from where a piece vanished to where it
 * reappears, drawn out along the path and then eaten from the tail.
 */
export const WarpStreak = ({
  from,
  to,
  color,
  durationMs,
}: {
  from: Vec3;
  to: Vec3;
  color: PieceColor;
  durationMs: number;
}) => {
  const mesh = useRef<InstancedMesh>(null);
  const life = durationMs * 1.4;
  const { done, tick } = useLifetime(0, life);
  const dummy = useMemo(() => new Object3D(), []);
  const colors = useMemo(() => {
    const p = PALETTES[color];
    return [p.c, p.a, p.d];
  }, [color]);
  const ready = useRef(false);

  useFrame((_, delta) => {
    const m = mesh.current;
    if (done || !m) return;
    if (!ready.current) {
      const c = new Color();
      for (let i = 0; i < STREAK; i++) m.setColorAt(i, c.set(colors[i % colors.length]));
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      ready.current = true;
    }
    const t = (tick(delta) * 1000) / life;
    for (let i = 0; i < STREAK; i++) {
      const u = (i + 0.5) / STREAK;
      // Head sweeps to the target in the first half; the tail follows
      const head = Math.min(t / 0.45, 1);
      const tail = Math.max((t - 0.35) / 0.65, 0);
      const on = u <= head && u >= tail;
      dummy.position.set(
        from[0] + (to[0] - from[0]) * u,
        from[1] + (to[1] - from[1]) * u + Math.sin(u * Math.PI) * 0.35,
        from[2] + (to[2] - from[2]) * u,
      );
      dummy.scale.setScalar(on ? 1.4 - 0.6 * ((u - tail) / Math.max(head - tail, 1e-3)) : 1e-4);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });

  if (done) return null;
  return (
    <instancedMesh
      ref={mesh}
      args={[sparkGeometry, sparkMaterial, STREAK]}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

// --- Capture ------------------------------------------------------------------

/** The captured piece, standing its ground until the attacker lands on it. */
export const DoomedPiece = ({
  type,
  color,
  floor,
  delayMs,
}: {
  type: PieceType;
  color: PieceColor;
  floor: Vec3;
  delayMs: number;
}) => {
  const group = useRef<Group>(null);
  const { done, tick } = useLifetime(delayMs, 0);
  useFrame((state, delta) => {
    const g = group.current;
    if (done || !g) return;
    tick(delta);
    // It shivers as the attacker comes for it
    g.position.x = floor[0] + (Math.floor(state.clock.elapsedTime * 30) % 2 ? 0.02 : -0.02);
  });
  if (done) return null;
  return (
    <group ref={group} position={floor}>
      <VoxelPiece type={type} color={color} glow="check" />
    </group>
  );
};

/** The victim blown into its own voxels, with a flash and a jolt. */
export const VoxelExplosion = ({
  type,
  color,
  floor,
  delayMs,
}: {
  type: PieceType;
  color: PieceColor;
  floor: Vec3;
  delayMs: number;
}) => {
  const colors = useMemo(() => debrisColors(type, color), [type, color]);
  const [shaking, setShaking] = useState(false);
  const { done, tick } = useLifetime(delayMs, 1400);
  useFrame((_, delta) => {
    if (done) return;
    if (tick(delta) >= 0 && !shaking) setShaking(true);
  });
  return (
    <>
      <Shards
        position={[floor[0], floor[1] + 0.25, floor[2]]}
        geometry={debrisGeometry}
        material={debrisMaterial}
        colors={colors}
        count={56}
        speed={3.2}
        gravity={7}
        upward={0.55}
        spread={0.35}
        lifeMs={1300}
        spin={9}
        delayMs={delayMs}
        seed={13}
      />
      <Burst
        position={[floor[0], floor[1] + 0.35, floor[2]]}
        colors={['#ffffff', '#ffe23d', '#ff6a2b']}
        count={40}
        speed={2.6}
        gravity={2}
        upward={0.3}
        lifeMs={500}
        size={0.16}
        delayMs={delayMs}
      />
      {shaking && !done && <ScreenShake intensity={9} durationMs={320} />}
    </>
  );
};

// --- Mate ---------------------------------------------------------------------

const FIREWORK_COLORS = [
  ['#ffe23d', '#ffffff', '#ff9a2e'],
  ['#39ff88', '#2ee6ff', '#ffffff'],
  ['#ff3fb4', '#b04cff', '#ffffff'],
  ['#2ee6ff', '#2ea8ff', '#ffe23d'],
  ['#ff3b3b', '#ffe23d', '#ffffff'],
];

/** One rocket: a pixel that climbs, then a starburst of square sparks. */
const Firework = ({
  at,
  delayMs,
  colors,
  seed,
}: {
  at: Vec3;
  delayMs: number;
  colors: string[];
  seed: number;
}) => {
  const RISE = 0.55;
  const rocket = useRef<Mesh>(null);
  const { done, tick } = useLifetime(delayMs, RISE * 1000 + 50);
  useFrame((state, delta) => {
    const r = rocket.current;
    if (done || !r) return;
    const t = tick(delta);
    const k = Math.min(Math.max(t / RISE, 0), 1);
    r.visible = t >= 0;
    r.position.set(at[0], at[1] - 2.2 * (1 - k) ** 2, at[2]);
    // Its tail flickers as it climbs
    r.scale.set(1, Math.floor(state.clock.elapsedTime * 20) % 2 ? 2.2 : 1.4, 1);
  });
  const burst = delayMs + RISE * 1000;
  return (
    <>
      {!done && (
        <mesh
          ref={rocket}
          geometry={sparkGeometry}
          material={sparkMaterial}
          visible={false}
          raycast={noRaycast}
        />
      )}
      <Shards
        position={at}
        geometry={sparkGeometry}
        material={sparkMaterial}
        colors={colors}
        count={46}
        speed={3.4}
        gravity={1.6}
        upward={0}
        spread={0.05}
        lifeMs={1500}
        spin={0}
        delayMs={burst}
        seed={seed}
      />
      <Burst
        position={at}
        colors={colors}
        count={36}
        speed={2.4}
        gravity={0.8}
        upward={0}
        lifeMs={1100}
        size={0.14}
        delayMs={burst}
        seed={seed + 1}
      />
    </>
  );
};

/** A salvo of pixel fireworks over the board. */
export const Fireworks = ({ centre, count = 7 }: { centre: Vec3; count?: number }) => {
  const shots = useMemo(() => {
    const random = rng(29);
    return Array.from({ length: count }, (_, i) => ({
      at: [
        centre[0] * 0.3 + (random() - 0.5) * 5,
        1.6 + random() * 2.2,
        centre[2] * 0.3 + (random() - 0.5) * 3,
      ] as Vec3,
      delayMs: 250 + i * 420 + random() * 150,
      colors: FIREWORK_COLORS[i % FIREWORK_COLORS.length],
      seed: 40 + i * 3,
    }));
  }, [centre, count]);
  return (
    <>
      {shots.map((s, i) => (
        <Firework key={i} {...s} />
      ))}
    </>
  );
};

const bannerTexture = (text: string) => {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.font = '16px "Press Start 2P"';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ff3fb4';
  ctx.fillText(text, 130, 19);
  ctx.fillStyle = '#ffe23d';
  ctx.fillText(text, 128, 17);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  return t;
};

/** "CHECKMATE!" in big pixel letters over the board, blinking in. */
export const Banner = ({ position, text }: { position: Vec3; text: string }) => {
  const material = useRef<SpriteMaterial>(null);
  const texture = useMemo(() => bannerTexture(text), [text]);
  useEffect(() => () => texture.dispose(), [texture]);
  const start = useRef<number | null>(null);
  useFrame((state) => {
    const m = material.current;
    if (!m) return;
    start.current ??= state.clock.elapsedTime;
    const t = state.clock.elapsedTime - start.current;
    m.opacity = t < 0.35 ? 0 : t < 1.1 ? Math.floor(t * 8) % 2 : 1;
  });
  const scale = useMemo(() => new Vector3(6.4, 0.8, 1), []);
  return (
    <sprite position={position} scale={scale} raycast={noRaycast} renderOrder={30}>
      <spriteMaterial
        ref={material}
        map={texture}
        transparent
        opacity={0}
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </sprite>
  );
};
