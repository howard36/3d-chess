import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  Color,
  DoubleSide,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import type { Group, InstancedMesh, PointLight } from 'three';
import { ScreenShake, Shards } from '../kit/fx';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import { rng } from '../kit/textures';
import type { CaptureFxProps, CelebrationProps, MoveFxProps, PieceColor, Vec3 } from '../types';
import { PieceType } from '../../../engine/pieces';
import { ContactShadow } from '../kit/plates';
import { PAL } from './palette';
import { restingGlaze, StillPiece } from './pieces';

// Atelier's moments of motion, all on r3f's clock (clamped per frame, so a
// recorded, frame-stepped run plays them exactly) and all gone within a
// second or two: a ripple across the acrylic where a piece lands; a captured
// piece knocked over and shattering into porcelain or lacquer shards that
// skitter on the platform and vanish; and, at mate, a slow wave of light and
// a fall of gold leaf.

const MAX_FRAME = 1 / 30;

/** A local clock that starts after `delayMs`; `done` once `lifeMs` is up. */
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

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

// --- Ripple --------------------------------------------------------------------------

const rippleVertex = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = vec2(position.x, -position.z);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const rippleFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uRadius;
  uniform float uLine;
  uniform float uAlpha;
  uniform float uWake;
  varying vec2 vP;
  void main() {
    float r = length(vP);
    float d = abs(r - uRadius) - uLine * 0.5;
    float aa = max(fwidth(d), 1e-4);
    float ink = 1.0 - smoothstep(-aa, aa, d);
    // A faint wake inside the wave front
    float wake = uWake * smoothstep(uRadius - 0.3, uRadius, r) * (1.0 - step(uRadius, r));
    float a = max(ink, wake) * uAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }`;

const rippleQuads = new Map<number, PlaneGeometry>();
const rippleQuad = (size: number) => {
  let g = rippleQuads.get(size);
  if (!g) {
    g = new PlaneGeometry(size, size).rotateX(-Math.PI / 2);
    rippleQuads.set(size, g);
  }
  return g;
};

/** A ring that spreads across a platform from `floor` and fades. */
export const Ripple = ({
  floor,
  color,
  from = 0.28,
  to = 0.8,
  line = 0.04,
  alpha = 0.9,
  wake = 0.18,
  lifeMs = 560,
  delayMs = 0,
}: {
  floor: Vec3;
  color: string;
  from?: number;
  to?: number;
  line?: number;
  alpha?: number;
  wake?: number;
  lifeMs?: number;
  delayMs?: number;
}) => {
  const { done, tick } = useLifetime(delayMs, lifeMs);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        uniforms: {
          uColor: { value: new Color(color) },
          uRadius: { value: from },
          uLine: { value: line },
          uAlpha: { value: 0 },
          uWake: { value: wake },
        },
        vertexShader: rippleVertex,
        fragmentShader: rippleFragment,
      }),
    [color, from, line, wake],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame((_, delta) => {
    if (done) return;
    const t = tick(delta);
    const k = Math.min(Math.max(t / (lifeMs / 1000), 0), 1);
    const e = easeOutCubic(k);
    material.uniforms.uRadius.value = from + (to - from) * e;
    material.uniforms.uLine.value = line * (1 - 0.6 * k);
    material.uniforms.uAlpha.value = t < 0 ? 0 : alpha * (1 - k) ** 1.4;
  });
  if (done) return null;
  return (
    <mesh
      geometry={rippleQuad(Math.ceil(to * 2 + 0.4))}
      material={material}
      position={[floor[0], floor[1] + 0.016, floor[2]]}
      renderOrder={LAYER.marker}
      raycast={noRaycast}
    />
  );
};

// --- Moves ---------------------------------------------------------------------------

/** Builds the design's effects for its piece scale, floor offset and platform size. */
export const atelierFx = ({
  pieceScale,
  floorY,
  platformHalf,
}: {
  pieceScale: number;
  floorY: number;
  platformHalf: number;
}) => {
  /** Where a quiet move lands, the acrylic ripples (a capture has its own payoff). */
  const MoveFx = ({ to, capture, durationMs }: MoveFxProps) => {
    if (capture) return null;
    const floor: Vec3 = [to[0], to[1] + floorY, to[2]];
    return (
      <>
        <Ripple floor={floor} color={PAL.amber} delayMs={durationMs * 0.92} />
        <Ripple
          floor={floor}
          color={PAL.amber}
          delayMs={durationMs * 0.92 + 110}
          alpha={0.45}
          to={0.62}
          wake={0}
        />
      </>
    );
  };

  const CaptureFx = ({ floor, victim, victimFacing, durationMs }: CaptureFxProps) => (
    <>
      <Knockdown
        floor={floor}
        type={victim.type}
        color={victim.color}
        facing={victim.type === PieceType.Knight ? (victimFacing ?? 0) : 0}
        scale={pieceScale}
        durationMs={durationMs}
        platformHalf={platformHalf}
      />
      <Ripple
        floor={floor}
        color={PAL.vermilion}
        delayMs={durationMs * 0.92}
        to={0.95}
        line={0.05}
        lifeMs={620}
      />
    </>
  );

  const Celebration = ({ floor }: CelebrationProps) => <Finale floor={floor} />;

  return { MoveFx, CaptureFx, Celebration };
};

// --- Capture: knocked over, then shattered -------------------------------------------

const shardGeometry = new TetrahedronGeometry(0.1, 0).scale(1, 0.45, 0.8);
const SHARDS = 20;

const Knockdown = ({
  floor,
  type,
  color,
  facing,
  scale,
  durationMs,
  platformHalf,
}: {
  floor: Vec3;
  type: PieceType;
  color: PieceColor;
  /** The yaw Board gave the victim (a knight faces its seat's way). */
  facing: number;
  scale: number;
  durationMs: number;
  platformHalf: number;
}) => {
  // Hit as the attacker comes down; gone as it lands
  const hitAt = (durationMs * 0.6) / 1000;
  const breakAt = (durationMs * 0.93) / 1000;
  // Shards settle and are gone within a third of a second or so
  const LIFE = breakAt + 0.42;
  const piece = useRef<Group>(null);
  const tipper = useRef<Group>(null);
  const shards = useRef<InstancedMesh>(null);
  const { done, tick } = useLifetime(0, LIFE * 1000);
  const [impact, setImpact] = useState(false);

  // Knocked outward from the tower's axis (toward the viewer when central)
  const { push, axis } = useMemo(() => {
    const d = new Vector3(floor[0], 0, floor[2] + 0.6);
    if (d.lengthSq() < 1e-4) d.set(0, 0, 1);
    d.normalize();
    return { push: d, axis: new Vector3(d.z, 0, -d.x) };
  }, [floor]);

  const parts = useMemo(() => {
    const random = rng(Math.round((floor[0] + 7) * 131 + (floor[2] + 7) * 17 + floor[1] * 5));
    return Array.from({ length: SHARDS }, () => {
      const a = random() * Math.PI * 2;
      const s = 0.7 + random() * 1.2;
      return {
        p: new Vector3((random() - 0.5) * 0.2, 0.04 + random() * 0.3, (random() - 0.5) * 0.2),
        v: new Vector3(
          Math.cos(a) * s + push.x * 0.6,
          0.9 + random() * 1.3,
          Math.sin(a) * s + push.z * 0.6,
        ),
        r: new Vector3(random() * 6, random() * 6, random() * 6),
        w: new Vector3(random() - 0.5, random() - 0.5, random() - 0.5).multiplyScalar(22),
        size: 0.55 + random() * 0.7,
        resting: false,
      };
    });
  }, [floor, push]);

  const dummy = useMemo(() => new Object3D(), []);
  const q = useMemo(() => new Vector3(), []);

  useFrame((_, delta) => {
    if (done) return;
    const t = tick(delta);
    const dt = Math.min(delta, MAX_FRAME);
    const p = piece.current;
    const tip = tipper.current;
    if (p && tip) {
      if (t < breakAt) {
        const k = Math.min(Math.max((t - hitAt) / (breakAt - hitAt), 0), 1);
        // Rocked back by the hit, then over onto its side, skidding away
        tip.quaternion.setFromAxisAngle(axis, k * k * 1.25);
        p.position.set(floor[0] + push.x * k * 0.18, floor[1], floor[2] + push.z * k * 0.18);
        p.visible = true;
      } else {
        p.visible = false;
      }
    }
    const m = shards.current;
    if (!m) return;
    if (t < breakAt) {
      m.visible = false;
      return;
    }
    if (!impact) setImpact(true);
    m.visible = true;
    const life = t - breakAt;
    const shrink = life < 0.22 ? 1 : Math.max(1 - (life - 0.22) / 0.2, 0);
    parts.forEach((s, i) => {
      if (!s.resting) {
        s.v.y -= 9.5 * dt;
        s.p.addScaledVector(s.v, dt);
        s.r.addScaledVector(s.w, dt);
        // Bounce on the platform while over it; off the edge, fall away
        q.set(floor[0] + s.p.x, 0, floor[2] + s.p.z);
        const over = Math.abs(q.x) < platformHalf && Math.abs(q.z) < platformHalf;
        if (over && s.p.y < 0.012 && s.v.y < 0) {
          s.p.y = 0.012;
          s.v.y *= -0.32;
          s.v.x *= 0.55;
          s.v.z *= 0.55;
          s.w.multiplyScalar(0.5);
          if (Math.abs(s.v.y) < 0.25) s.resting = true;
        }
      }
      dummy.position.set(floor[0] + s.p.x, floor[1] + s.p.y, floor[2] + s.p.z);
      dummy.rotation.set(s.r.x, s.resting ? 0 : s.r.y, s.resting ? 0 : s.r.z);
      dummy.scale.setScalar(Math.max(s.size * shrink * scale, 1e-4));
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });

  if (done) return null;
  return (
    <>
      <group ref={piece} position={floor}>
        <group scale={scale}>
          <ContactShadow radius={0.32} opacity={0.58} color="#241e17" />
          <group ref={tipper}>
            <group rotation={[0, facing, 0]}>
              <StillPiece type={type} color={color} />
            </group>
          </group>
        </group>
      </group>
      <instancedMesh
        ref={shards}
        args={[shardGeometry, restingGlaze(color), SHARDS]}
        raycast={noRaycast}
        frustumCulled={false}
        visible={false}
      />
      {impact && <ScreenShake intensity={2.2} durationMs={220} />}
    </>
  );
};

// --- Mate ------------------------------------------------------------------------------

const leaf = new PlaneGeometry(0.07, 0.05);
const leafMaterial = new MeshStandardMaterial({
  color: PAL.gold,
  metalness: 0.9,
  roughness: 0.35,
  side: DoubleSide,
});

/** A slow wave of amber light across the mated king's platform, a light swell, gold leaf. */
const Finale = ({ floor }: { floor: Vec3 }) => {
  const light = useRef<PointLight>(null);
  const { done, tick } = useLifetime(300, 3200);
  useFrame((_, delta) => {
    if (done) return;
    const t = Math.max(tick(delta), 0);
    const l = light.current;
    // Swell up over half a second, then settle back over two
    if (l) l.intensity = t < 0.5 ? (t / 0.5) * 7 : 7 * Math.exp(-(t - 0.5) * 1.6);
  });
  return (
    <>
      {!done && (
        <pointLight
          ref={light}
          position={[floor[0], floor[1] + 1.4, floor[2] + 0.6]}
          color="#ffd89a"
          intensity={0}
          distance={7}
          decay={1.4}
        />
      )}
      <Ripple
        floor={floor}
        color={PAL.amber}
        from={0.35}
        to={3.4}
        line={0.06}
        lifeMs={1800}
        delayMs={250}
      />
      <Ripple
        floor={floor}
        color={PAL.amber}
        from={0.35}
        to={2.6}
        line={0.04}
        lifeMs={1700}
        delayMs={520}
        alpha={0.6}
      />
      <Ripple
        floor={floor}
        color={PAL.halo}
        from={0.35}
        to={1.8}
        line={0.03}
        lifeMs={1500}
        delayMs={780}
        alpha={0.5}
        wake={0}
      />
      <Shards
        position={[floor[0], floor[1] + 0.7, floor[2]]}
        geometry={leaf}
        material={leafMaterial}
        count={48}
        speed={1.4}
        gravity={0.8}
        upward={0.85}
        spread={0.8}
        lifeMs={3000}
        spin={6}
        flutter
        delayMs={450}
      />
    </>
  );
};
