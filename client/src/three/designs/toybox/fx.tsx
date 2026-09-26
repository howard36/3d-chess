import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  SpriteMaterial,
  Vector3,
} from 'three';
import type { Group, InstancedMesh, Sprite } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PieceType } from '../../../engine/pieces';
import { noRaycast } from '../kit/noRaycast';
import { rng } from '../kit/textures';
import type { PieceColor, Vec3 } from '../types';
import { ToyPiece } from './pieces';
import { powTexture, TOY_COLORS } from './shared';

// The Toy Box's one-shot effects. Each runs on r3f's clock (clamped per
// frame, like the kit's), so a recorded, frame-stepped run plays it exactly.

const MAX_FRAME = 1 / 30;
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeOutBack = (t: number) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;

/** A local clock that starts after `delayMs`, and a flag once `lifeMs` is up. */
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

// --- Dust puff ---------------------------------------------------------------

const puffGeometry = new SphereGeometry(1, 12, 9);
const puffMaterial = new MeshStandardMaterial({
  color: '#ffffff',
  roughness: 1,
  emissive: '#fff8ea',
  emissiveIntensity: 0.45,
});

/** A ring of cartoon dust balls kicked out along the floor where a toy lands. */
export const Puff = ({
  position,
  delayMs = 0,
  count = 10,
  lifeMs = 620,
  radius = 0.42,
  size = 0.085,
}: {
  position: Vec3;
  delayMs?: number;
  count?: number;
  lifeMs?: number;
  radius?: number;
  size?: number;
}) => {
  const mesh = useRef<InstancedMesh>(null);
  const { done, tick } = useLifetime(delayMs, lifeMs);
  const dummy = useMemo(() => new Object3D(), []);
  const balls = useMemo(() => {
    const random = rng(count * 7 + 3);
    return Array.from({ length: count }, (_, i) => ({
      angle: ((i + random() * 0.6) / count) * Math.PI * 2,
      scale: 0.75 + random() * 0.5,
      rise: 0.5 + random(),
    }));
  }, [count]);

  useFrame((_, delta) => {
    const m = mesh.current;
    if (done || !m) return;
    const t = tick(delta);
    const k = Math.min(Math.max(t / (lifeMs / 1000), 0), 1);
    const e = easeOutCubic(k);
    balls.forEach((b, i) => {
      const r = 0.2 + radius * e;
      dummy.position.set(Math.cos(b.angle) * r, 0.05 + 0.16 * e * b.rise, Math.sin(b.angle) * r);
      const grow = k < 0.18 ? k / 0.18 : 1 - (k - 0.18) / 0.82;
      dummy.scale.setScalar(t < 0 ? 0 : Math.max(size * b.scale * grow, 1e-4));
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

// --- Capture: the victim is knocked flying ----------------------------------

/**
 * A copy of the captured toy that stands its ground until the attacker lands,
 * then is flung off the board in an arc, tumbling and shrinking away.
 */
export const TossedPiece = ({
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
  const LIFE = 1.2;
  const outer = useRef<Group>(null);
  const spinner = useRef<Group>(null);
  const { done, tick } = useLifetime(delayMs, LIFE * 1000);
  // Knocked outward from the tower's axis and toward the camera, so the
  // flight is seen rather than hidden behind the stack.
  const { dir, axis } = useMemo(() => {
    const d = new Vector3(floor[0], 0, floor[2] + 2.2);
    if (d.lengthSq() < 1e-4) d.set(0, 0, 1);
    d.normalize();
    return { dir: d, axis: new Vector3(d.z, 0.4, -d.x).normalize() };
  }, [floor]);

  useFrame((_, delta) => {
    const o = outer.current;
    const s = spinner.current;
    if (done || !o || !s) return;
    const t = Math.max(tick(delta), 0);
    o.position.set(
      floor[0] + dir.x * 2.3 * t,
      floor[1] + 3.3 * t - 5.2 * t * t,
      floor[2] + dir.z * 2.3 * t,
    );
    s.quaternion.setFromAxisAngle(axis, t * 12);
    o.scale.setScalar(Math.max(1 - (t / LIFE) ** 2, 1e-4));
  });

  if (done) return null;
  return (
    <group ref={outer} position={floor}>
      <group position={[0, 0.4, 0]}>
        <group ref={spinner}>
          <group position={[0, -0.4, 0]}>
            <ToyPiece type={type} color={color} blob={false} />
          </group>
        </group>
      </group>
    </group>
  );
};

/** A comic starburst that pops up at the moment of impact. */
export const PowFlash = ({
  position,
  delayMs,
  size = 1,
}: {
  position: Vec3;
  delayMs: number;
  size?: number;
}) => {
  const LIFE = 520;
  const sprite = useRef<Sprite>(null);
  const { done, tick } = useLifetime(delayMs, LIFE);
  const material = useMemo(
    () =>
      new SpriteMaterial({
        map: powTexture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame((_, delta) => {
    const s = sprite.current;
    if (done || !s) return;
    const t = tick(delta);
    const k = Math.min(Math.max(t / (LIFE / 1000), 0), 1);
    const pop = t < 0 ? 0 : easeOutBack(Math.min(k / 0.3, 1));
    s.scale.setScalar(Math.max(size * pop * (1 + 0.15 * k), 1e-4));
    material.rotation = -0.2 + k * 0.25;
    material.opacity = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
  });
  if (done) return null;
  return (
    <sprite
      ref={sprite}
      position={position}
      material={material}
      scale={0.0001}
      raycast={noRaycast}
      renderOrder={20}
    />
  );
};

export const confettiGeometry = new PlaneGeometry(0.075, 0.045);
export const confettiMaterial = new MeshStandardMaterial({
  roughness: 0.55,
  side: DoubleSide,
  emissive: '#ffffff',
  emissiveIntensity: 0.12,
});

// --- Balloons ----------------------------------------------------------------

const balloonGeometry = (() => {
  const body = new SphereGeometry(0.2, 24, 18).scale(1, 1.18, 1);
  const knot = new ConeGeometry(0.04, 0.07, 12).translate(0, -0.255, 0);
  const g = mergeGeometries([body, knot]);
  body.dispose();
  knot.dispose();
  return g;
})();
const stringGeometry = new CylinderGeometry(0.004, 0.004, 0.75, 4).translate(0, -0.66, 0);
const stringMaterial = new MeshStandardMaterial({ color: '#f4f4f4', roughness: 1 });
const balloonMaterials = TOY_COLORS.map(
  (color) =>
    new MeshPhysicalMaterial({
      color,
      roughness: 0.22,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      sheen: 0.4,
    }),
);

/** A bunch of party balloons that float up past the camera. */
export const Balloons = ({
  centre,
  count = 10,
  delayMs = 0,
  seed = 4,
}: {
  centre: Vec3;
  count?: number;
  delayMs?: number;
  seed?: number;
}) => {
  const LIFE = 7000;
  const refs = useRef<(Group | null)[]>([]);
  const { done, tick } = useLifetime(delayMs, LIFE);
  const specs = useMemo(() => {
    const random = rng(seed);
    return Array.from({ length: count }, (_, i) => ({
      x: centre[0] * 0.4 + (random() - 0.5) * 6.4,
      z: centre[2] * 0.4 + (random() - 0.2) * 3.6,
      y: centre[1] - 0.6 + random() * 1.4,
      speed: 1.0 + random() * 0.8,
      phase: random() * 10,
      start: i * 0.09 + random() * 0.15,
      material: balloonMaterials[i % balloonMaterials.length],
      scale: 0.9 + random() * 0.35,
    }));
  }, [centre, count, seed]);

  useFrame((_, delta) => {
    if (done) return;
    const t = tick(delta);
    specs.forEach((b, i) => {
      const g = refs.current[i];
      if (!g) return;
      const lt = t - b.start;
      if (lt < 0) {
        g.scale.setScalar(1e-4);
        return;
      }
      g.scale.setScalar(b.scale * easeOutBack(Math.min(lt / 0.45, 1)));
      g.position.set(
        b.x + Math.sin(lt * 1.6 + b.phase) * 0.18,
        b.y + b.speed * lt + 0.25 * lt * lt,
        b.z + Math.cos(lt * 1.2 + b.phase) * 0.12,
      );
      g.rotation.z = Math.sin(lt * 1.6 + b.phase + 0.8) * 0.18;
    });
  });

  if (done) return null;
  return (
    <>
      {specs.map((b, i) => (
        <group
          key={i}
          ref={(g) => {
            refs.current[i] = g;
          }}
          scale={1e-4}
        >
          <mesh geometry={balloonGeometry} material={b.material} raycast={noRaycast} />
          <mesh geometry={stringGeometry} material={stringMaterial} raycast={noRaycast} />
        </group>
      ))}
    </>
  );
};
