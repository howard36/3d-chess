import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  CapsuleGeometry,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import type { Group, InstancedMesh, Mesh } from 'three';
import type { PieceType } from '../../../engine/pieces';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import { rng } from '../kit/textures';
import type { CaptureFxProps, CelebrationProps, MoveFxProps, PieceColor, Vec3 } from '../types';
import { CANDY, layout, PIECE_SCALE } from './palette';
import { ToyPiece } from './pieces';

// Candy Tower's moments. All run on r3f's clock with the frame step clamped,
// so a frame-stepped recording plays them exactly, and all end: nothing is
// left moving once a move has played out.
// - A move: the toy bounces over (Board's squash-and-stretch hop) and lands
//   with a soft ring of sugar dust and a ripple across the glass.
// - A capture: the victim flinches as the attacker drops in, gets boinked off
//   the board spinning, and pops in a puff of sprinkles.
// - Mate: the king topples and a short burst of sprinkles pops from its
//   square, then all is calm.

const MAX_FRAME = 1 / 30;
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1);

/** A local clock that starts after `delayMs` and reports when `lifeMs` is up. */
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

// --- Sugar dust ---------------------------------------------------------------------

const puffGeometry = new SphereGeometry(1, 10, 7);
const puffMaterial = new MeshStandardMaterial({
  color: '#ffffff',
  roughness: 1,
  emissive: '#e8e4ff',
  emissiveIntensity: 0.5,
});

/** A ring of soft dust balls kicked out along the glass. */
const Puff = ({
  position,
  delayMs = 0,
  count = 9,
  lifeMs = 560,
  radius = 0.36,
  size = 0.07,
  seed = 3,
}: {
  position: Vec3;
  delayMs?: number;
  count?: number;
  lifeMs?: number;
  radius?: number;
  size?: number;
  seed?: number;
}) => {
  const mesh = useRef<InstancedMesh>(null);
  const { done, tick } = useLifetime(delayMs, lifeMs);
  const dummy = useMemo(() => new Object3D(), []);
  const balls = useMemo(() => {
    const random = rng(seed + count * 7);
    return Array.from({ length: count }, (_, i) => ({
      angle: ((i + random() * 0.6) / count) * Math.PI * 2,
      scale: 0.7 + random() * 0.6,
      rise: 0.4 + random(),
    }));
  }, [count, seed]);
  useFrame((_, delta) => {
    const m = mesh.current;
    if (done || !m) return;
    const t = tick(delta);
    const k = clamp01(t / (lifeMs / 1000));
    const e = easeOutCubic(k);
    balls.forEach((b, i) => {
      const r = 0.16 + radius * e;
      dummy.position.set(Math.cos(b.angle) * r, 0.04 + 0.12 * e * b.rise, Math.sin(b.angle) * r);
      const grow = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
      dummy.scale.setScalar(t < 0 ? 1e-4 : Math.max(size * b.scale * grow, 1e-4));
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  if (done) return null;
  return (
    <instancedMesh
      ref={mesh}
      args={[puffGeometry, puffMaterial, count]}
      position={position}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

// --- Ripple on the glass ------------------------------------------------------------

const rippleGeometry = new RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2);

/** A ring that spreads across the glass from a landing and fades. */
const Ripple = ({
  position,
  delayMs = 0,
  color = '#ffffff',
  lifeMs = 520,
  reach = 0.62,
}: {
  position: Vec3;
  delayMs?: number;
  color?: string;
  lifeMs?: number;
  reach?: number;
}) => {
  const mesh = useRef<Mesh>(null);
  const { done, tick } = useLifetime(delayMs, lifeMs);
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
      }),
    [color],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame((_, delta) => {
    const m = mesh.current;
    if (done || !m) return;
    const t = tick(delta);
    const k = clamp01(t / (lifeMs / 1000));
    m.scale.setScalar(Math.max(0.2 + reach * easeOutCubic(k), 1e-4));
    material.opacity = t < 0 ? 0 : 0.75 * (1 - k) ** 1.5;
  });
  if (done) return null;
  return (
    <mesh
      ref={mesh}
      geometry={rippleGeometry}
      material={material}
      position={[position[0], position[1] + 0.02, position[2]]}
      renderOrder={LAYER.trace}
      raycast={noRaycast}
    />
  );
};

// --- Sprinkles ------------------------------------------------------------------------

const sprinkleGeometry = new CapsuleGeometry(0.018, 0.06, 2, 6);
const sprinkleMaterial = new MeshStandardMaterial({ roughness: 0.45 });
const hidden = new Object3D();
hidden.scale.setScalar(0);
hidden.updateMatrix();

/** A burst of candy sprinkles thrown up and falling back under gravity. */
const Sprinkles = ({
  position,
  delayMs = 0,
  count = 40,
  speed = 2.4,
  lifeMs = 1100,
  upward = 0.7,
  seed = 5,
  scale = 1,
}: {
  position: Vec3;
  delayMs?: number;
  count?: number;
  speed?: number;
  lifeMs?: number;
  upward?: number;
  seed?: number;
  scale?: number;
}) => {
  const mesh = useRef<InstancedMesh>(null);
  const { done, tick } = useLifetime(delayMs, lifeMs);
  const dummy = useMemo(() => new Object3D(), []);
  const parts = useMemo(() => {
    const random = rng(seed);
    return Array.from({ length: count }, () => {
      const a = random() * Math.PI * 2;
      const up = upward + random() * (1 - upward);
      const out = Math.sqrt(1 - up * up);
      const v = speed * (0.55 + random() * 0.45);
      return {
        v: new Vector3(Math.cos(a) * out * v, up * v, Math.sin(a) * out * v),
        axis: new Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize(),
        spin: 6 + random() * 10,
        scale: scale * (0.75 + random() * 0.5),
      };
    });
  }, [count, speed, upward, seed, scale]);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const c = new Color();
    parts.forEach((_, i) => {
      m.setColorAt(i, c.set(CANDY[i % CANDY.length]));
      m.setMatrixAt(i, hidden.matrix);
    });
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.instanceMatrix.needsUpdate = true;
  }, [parts]);
  useFrame((_, delta) => {
    const m = mesh.current;
    if (done || !m) return;
    const t = tick(delta);
    if (t < 0) return;
    const k = clamp01(t / (lifeMs / 1000));
    parts.forEach((p, i) => {
      const drag = (1 - Math.exp(-2 * t)) / 2;
      dummy.position.set(p.v.x * drag, p.v.y * drag - 2.6 * t * t, p.v.z * drag);
      dummy.quaternion.setFromAxisAngle(p.axis, p.spin * t);
      dummy.scale.setScalar(Math.max(p.scale * (1 - k ** 4), 1e-4));
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  if (done) return null;
  return (
    <instancedMesh
      ref={mesh}
      args={[sprinkleGeometry, sprinkleMaterial, count]}
      position={position}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

// --- A move lands ------------------------------------------------------------------

export const MoveFx = ({ to, durationMs, capture }: MoveFxProps) => {
  const floor: Vec3 = [to[0], to[1] + layout.floorY, to[2]];
  if (capture) return null;
  return (
    <>
      <Puff position={floor} delayMs={durationMs * 0.97} />
      <Ripple position={floor} delayMs={durationMs * 0.97} />
    </>
  );
};

// --- A capture: boink! -------------------------------------------------------------

/**
 * A copy of the captured toy. It stands its ground, trembling, while the
 * attacker drops in; at the impact it squashes, then is knocked off in a
 * spinning arc away from the tower and toward the camera, shrinking, and
 * pops in a puff of sprinkles.
 */
const Boinked = ({
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
  const FLIGHT = 0.62;
  const outer = useRef<Group>(null);
  const spinner = useRef<Group>(null);
  const squash = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  const elapsed = useRef(-delayMs / 1000);
  const [gone, setGone] = useState(false);
  const { dir, axis } = useMemo(() => {
    const d = new Vector3(floor[0], 0, floor[2] + 2.5);
    if (d.lengthSq() < 1e-4) d.set(0, 0, 1);
    d.normalize();
    return { dir: d, axis: new Vector3(d.z, 0.35, -d.x).normalize() };
  }, [floor]);
  useEffect(() => invalidate(), [invalidate]);
  useFrame((_, delta) => {
    const o = outer.current;
    const s = spinner.current;
    const q = squash.current;
    if (gone || !o || !s || !q) return;
    elapsed.current += Math.min(delta, MAX_FRAME);
    const t = elapsed.current;
    invalidate();
    if (t < 0) {
      // Trembling as the attacker comes down
      const near = clamp01(1 + t / 0.3);
      o.position.set(floor[0] + Math.sin(t * 70) * 0.012 * near, floor[1], floor[2]);
      return;
    }
    if (t < 0.07) {
      // Squashed flat by the impact
      const k = t / 0.07;
      q.scale.set(1 + 0.25 * k, 1 - 0.35 * k, 1 + 0.25 * k);
      o.position.set(floor[0], floor[1], floor[2]);
      return;
    }
    const f = t - 0.07;
    if (f >= FLIGHT) {
      setGone(true);
      return;
    }
    q.scale.set(1, 1, 1);
    o.position.set(
      floor[0] + dir.x * 2.6 * f,
      floor[1] + 3.2 * f - 5.5 * f * f,
      floor[2] + dir.z * 2.6 * f,
    );
    s.quaternion.setFromAxisAngle(axis, f * 13);
    o.scale.setScalar(Math.max(1 - (f / FLIGHT) ** 2 * 0.65, 1e-4));
  });
  if (gone) return null;
  return (
    <group ref={outer} position={floor}>
      <group scale={PIECE_SCALE}>
        <group ref={squash}>
          <group position={[0, 0.35, 0]}>
            <group ref={spinner}>
              <group position={[0, -0.35, 0]}>
                <ToyPiece type={type} color={color} turnKnight />
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
};

/** Where a boinked toy pops: its flight's end. */
const popPoint = (floor: Vec3): Vec3 => {
  const d = new Vector3(floor[0], 0, floor[2] + 2.5);
  if (d.lengthSq() < 1e-4) d.set(0, 0, 1);
  d.normalize();
  const f = 0.62;
  return [
    floor[0] + d.x * 2.6 * f,
    floor[1] + 3.2 * f - 5.5 * f * f + 0.3,
    floor[2] + d.z * 2.6 * f,
  ];
};

export const CaptureFx = ({ floor, victim, durationMs }: CaptureFxProps) => {
  const impact = durationMs * 0.96;
  return (
    <>
      <Boinked type={victim.type} color={victim.color} floor={floor} delayMs={impact} />
      <Ripple position={floor} delayMs={impact} color="#ffd6de" reach={0.8} lifeMs={600} />
      <Puff position={floor} delayMs={impact} count={11} radius={0.46} size={0.08} seed={9} />
      <Sprinkles
        position={popPoint(floor)}
        delayMs={impact + 690}
        count={34}
        speed={2}
        lifeMs={900}
        upward={0.35}
        seed={13}
      />
      <Puff
        position={popPoint(floor)}
        delayMs={impact + 690}
        count={8}
        radius={0.3}
        size={0.1}
        lifeMs={480}
        seed={21}
      />
    </>
  );
};

// --- Mate ----------------------------------------------------------------------------

export const Celebration = ({ floor }: CelebrationProps) => (
  <>
    <Puff position={floor} delayMs={520} count={12} radius={0.6} size={0.09} lifeMs={700} />
    <Ripple position={floor} delayMs={520} color="#fff4c4" reach={1.4} lifeMs={900} />
    <Sprinkles
      position={[floor[0], floor[1] + 0.4, floor[2]]}
      delayMs={480}
      count={120}
      speed={4.2}
      lifeMs={2300}
      upward={0.75}
      seed={17}
      scale={1.3}
    />
  </>
);
