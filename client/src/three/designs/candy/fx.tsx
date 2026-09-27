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
import type { Orientation } from '../../layout';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import { rng } from '../kit/textures';
import type { CaptureFxProps, CelebrationProps, MoveFxProps, PieceColor, Vec3 } from '../types';
import { bubbleTexture, KingBubble, markMated } from './markers';
import { CANDY, frame, INK, layout, ORCHID, PIECE_SCALE, SPARKLE } from './palette';
import { ToyPiece } from './pieces';

// Candy Tower's moments. All run on r3f's clock with the frame step clamped,
// so a frame-stepped recording plays them exactly, and all end: nothing is
// left moving once a move has played out.
// - A move: the toy bounces over (Board's squash-and-stretch hop) and lands
//   with a soft ring of sugar dust and a ripple across the glass.
// - A capture: the victim flinches as the attacker drops in, is squashed,
//   pops straight up spinning and bursts into sprinkles, all inside its own
//   square and gone 0.56 s after the impact.
// - Mate: the king topples, a short burst of sprinkles pops from its square,
//   and a "seeing stars" bubble replaces the check bubble; then all is calm.

const MAX_FRAME = 1 / 30;
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1);

/** The level whose floor is at world height `y`. */
const levelAt = (y: number) => {
  let best = 0;
  frame.levelY.forEach((ly, z) => {
    if (Math.abs(ly - y) < Math.abs(frame.levelY[best] - y)) best = z;
  });
  return best;
};

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
  emissive: '#fff0e6',
  emissiveIntensity: 0.5,
});

/** A ring of soft dust balls kicked out along the glass, never past `radius`. */
const Puff = ({
  position,
  delayMs = 0,
  count = 9,
  lifeMs = 520,
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
      const r = radius * (0.4 + 0.6 * e);
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

/** A ring that spreads across the glass from a landing and fades, out to `reach`. */
const Ripple = ({
  position,
  delayMs = 0,
  color = '#ffffff',
  lifeMs = 520,
  reach = 0.46,
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
    m.scale.setScalar(Math.max(reach * (0.35 + 0.65 * easeOutCubic(k)), 1e-4));
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

/**
 * A burst of candy sprinkles. Each flies out to its own spot within `reach`
 * of the centre along an arc peaking at `rise`, spinning, and shrinks away
 * as it lands, so the burst never strays outside `reach`.
 */
const Sprinkles = ({
  position,
  delayMs = 0,
  count = 30,
  reach = 0.45,
  rise = 0.3,
  lifeMs = 450,
  seed = 5,
  scale = 1,
}: {
  position: Vec3;
  delayMs?: number;
  count?: number;
  reach?: number;
  rise?: number;
  lifeMs?: number;
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
      const r = reach * (0.35 + 0.65 * Math.sqrt(random()));
      return {
        to: [Math.cos(a) * r, Math.sin(a) * r] as const,
        rise: rise * (0.6 + random() * 0.6),
        axis: new Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize(),
        spin: 8 + random() * 10,
        scale: scale * (0.75 + random() * 0.5),
      };
    });
  }, [count, reach, rise, seed, scale]);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const c = new Color();
    const hidden = new Object3D();
    hidden.scale.setScalar(0);
    hidden.updateMatrix();
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
    const out = easeOutCubic(k);
    parts.forEach((p, i) => {
      dummy.position.set(p.to[0] * out, p.rise * 4 * k * (1 - k), p.to[1] * out);
      dummy.quaternion.setFromAxisAngle(p.axis, p.spin * t);
      dummy.scale.setScalar(Math.max(p.scale * (1 - k ** 3), 1e-4));
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

// Seconds after the impact: the squash, then the pop, spinning up and away
const SQUASH = 0.06;
const POP = 0.26;

/**
 * A copy of the captured toy. It stands its ground, trembling, while the
 * attacker drops in; at the impact it squashes flat, then pops straight up
 * out of its square, spinning and shrinking to nothing.
 */
const Boinked = ({
  type,
  color,
  floor,
  delayMs,
  orientation,
  knightFacing,
}: {
  type: PieceType;
  color: PieceColor;
  floor: Vec3;
  delayMs: number;
  orientation: Orientation;
  knightFacing?: number;
}) => {
  const outer = useRef<Group>(null);
  const spinner = useRef<Group>(null);
  const squash = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  const elapsed = useRef(-delayMs / 1000);
  const [gone, setGone] = useState(false);
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
    if (t < SQUASH) {
      // Squashed flat by the impact
      const k = t / SQUASH;
      q.scale.set(1 + 0.3 * k, 1 - 0.4 * k, 1 + 0.3 * k);
      return;
    }
    const f = (t - SQUASH) / POP;
    if (f >= 1) {
      setGone(true);
      return;
    }
    // Springs back from the squash as it pops up, spinning, and shrinks away
    const spring = 1 + 0.25 * Math.exp(-f * 6) * Math.cos(f * 9);
    q.scale.set(1 / Math.sqrt(spring), spring, 1 / Math.sqrt(spring));
    o.position.set(floor[0], floor[1] + 0.55 * easeOutCubic(f), floor[2]);
    s.rotation.y = f * 9;
    o.scale.setScalar(Math.max(1 - f ** 1.6, 1e-4));
  });
  if (gone) return null;
  return (
    <group ref={outer} position={floor}>
      <group scale={PIECE_SCALE}>
        <group ref={squash}>
          <group ref={spinner}>
            <ToyPiece
              type={type}
              color={color}
              orientation={orientation}
              level={levelAt(floor[1])}
              knightFacing={knightFacing}
            />
          </group>
        </group>
      </group>
    </group>
  );
};

export const CaptureFx = ({
  floor,
  victim,
  durationMs,
  orientation,
  victimFacing,
}: CaptureFxProps) => {
  const impact = durationMs * 0.96;
  // Everything is over 0.56 s after the impact (about 1 s after the move began)
  const pop = impact + (SQUASH + POP * 0.6) * 1000;
  const burst: Vec3 = [floor[0], floor[1] + 0.45, floor[2]];
  return (
    <>
      <Boinked
        type={victim.type}
        color={victim.color}
        floor={floor}
        delayMs={impact}
        orientation={orientation}
        knightFacing={victimFacing}
      />
      <Ripple position={floor} delayMs={impact} color="#ffd6de" lifeMs={420} />
      <Puff
        position={floor}
        delayMs={impact}
        count={10}
        radius={0.42}
        size={0.075}
        lifeMs={420}
        seed={9}
      />
      <Sprinkles position={burst} delayMs={pop} count={28} lifeMs={340} rise={0.12} seed={13} />
    </>
  );
};

// --- Mate ----------------------------------------------------------------------------

/** Three stars in an arc: the fallen king is seeing stars. */
const drawDizzy = (ctx: CanvasRenderingContext2D, w: number) => {
  const star = (x: number, y: number, r: number) => {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? r : r * 0.45;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.lineWidth = 5;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.fillStyle = SPARKLE;
    ctx.fill();
  };
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(w / 2, 56, 38, 16, 0, 0, Math.PI * 2);
  ctx.stroke();
  star(w / 2 - 34, 60, 15);
  star(w / 2, 40, 18);
  star(w / 2 + 34, 60, 15);
};

export const Celebration = ({ floor }: CelebrationProps) => {
  // The mate bubble replaces the check bubble on this square
  useLayoutEffect(() => {
    markMated(floor, true);
    return () => markMated(floor, false);
  }, [floor]);
  return (
    <>
      <KingBubble floor={floor} map={bubbleTexture('dizzy', ORCHID, drawDizzy)} size={1.3} />
      <Puff position={floor} delayMs={520} count={12} radius={0.5} size={0.09} lifeMs={700} />
      <Ripple position={floor} delayMs={520} color="#fff4c4" reach={1.2} lifeMs={900} />
      <Sprinkles
        position={[floor[0], floor[1] + 0.3, floor[2]]}
        delayMs={480}
        count={90}
        reach={1.1}
        rise={1.1}
        lifeMs={1400}
        seed={17}
        scale={1.3}
      />
    </>
  );
};
