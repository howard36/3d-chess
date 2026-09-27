import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  PlaneGeometry,
  Points,
  ShaderMaterial,
} from 'three';
import { PieceType } from '../../../engine/pieces';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import { rng } from '../kit/textures';
import type { CaptureFxProps, CelebrationProps, MoveFxProps, Vec3 } from '../types';
import { PIECE_SCALE, layout, levelAt } from './layout';
import { CAPTURE, CHECK, INK, LEVEL_LED } from './palette';
import { DissolvePiece, Footprint, setDissolve } from './pieces';
import { powerDownTray } from './plates';

// Motion. Pieces glide (Board's straight line); these add the moments:
//
// - a landing: the tray registers the piece with a ripple of its level's LED
//   colour inside a graphite ring, as a sensor pad would;
// - a capture: a white-hot flash, then the victim is cut away from the top
//   down by a red-hot line while the attacker glides in, shedding sparks; its
//   LED foot powers down as the cut reaches it, and a red ring flashes out as
//   the attacker lands;
// - mate: the king topples (Board), its tray's LEDs power down to grey, and
//   three red rings roll out across the tray.
//
// All of it runs on r3f's clock and ends on its own. A frame never advances an
// effect by more than a quarter second, so a slow machine skips frames
// rather than playing in slow motion.

const MAX_STEP = 0.25;

const rippleFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uRadius;
  uniform float uWidth;
  uniform float uAlpha;
  varying vec2 vP;
  void main() {
    float d = abs(length(vP) - uRadius);
    float fw = max(fwidth(d), 1e-4);
    float a = (1.0 - smoothstep(uWidth - fw, uWidth + fw, d)) * uAlpha;
    a = max(a, exp(-d * d / (uWidth * uWidth * 9.0)) * uAlpha * 0.35);
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }`;

const rippleVertex = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

interface RippleSpec {
  color: string;
  /** When it starts and how long it lasts (ms). */
  delay: number;
  life: number;
  /** Radius from and to (world units). */
  from: number;
  to: number;
  width: number;
  alpha: number;
}

/** Rings that roll out across a tray from `floor` and fade, then unmount. */
const Ripples = ({ floor, rings }: { floor: Vec3; rings: RippleSpec[] }) => {
  const invalidate = useThree((s) => s.invalidate);
  const elapsed = useRef(0);
  const [done, setDone] = useState(false);
  const { materials, plane } = useMemo(
    () => ({
      materials: rings.map(
        (r) =>
          new ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            uniforms: {
              uColor: { value: new Color(r.color) },
              uRadius: { value: r.from },
              uWidth: { value: r.width },
              uAlpha: { value: 0 },
            },
            vertexShader: rippleVertex,
            fragmentShader: rippleFragment,
          }),
      ),
      // Large enough for the widest ring
      plane: new PlaneGeometry(1, 1).scale(
        ...([2, 2, 1].map((k) => k * (Math.max(...rings.map((r) => r.to)) + 0.2)) as [
          number,
          number,
          number,
        ]),
      ),
    }),
    // Specs are literals made per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(
    () => () => {
      materials.forEach((m) => m.dispose());
      plane.dispose();
    },
    [materials, plane],
  );
  const end = Math.max(...rings.map((r) => r.delay + r.life));
  useFrame((_, delta) => {
    if (done) return;
    elapsed.current += Math.min(delta, MAX_STEP) * 1000;
    const t = elapsed.current;
    rings.forEach((r, i) => {
      const k = Math.min(Math.max((t - r.delay) / r.life, 0), 1);
      const u = materials[i].uniforms;
      const ease = 1 - (1 - k) ** 3;
      u.uRadius.value = r.from + (r.to - r.from) * ease;
      u.uAlpha.value = t < r.delay ? 0 : r.alpha * (1 - k) ** 1.5;
    });
    if (t >= end) setDone(true);
    invalidate();
  });
  if (done) return null;
  return (
    <group position={[floor[0], floor[1] + 0.014, floor[2]]}>
      {materials.map((m, i) => (
        <mesh
          key={i}
          geometry={plane}
          material={m}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={LAYER.marker}
          raycast={noRaycast}
        />
      ))}
    </group>
  );
};

// --- Sparks ------------------------------------------------------------------------------

const sparkVertex = /* glsl */ `
  attribute vec3 aVel;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uGravity;
  uniform float uSize;
  varying vec3 vColor;
  varying float vFade;
  void main() {
    vColor = aColor;
    vec3 p = position + aVel * uTime + vec3(0.0, -0.5 * uGravity * uTime * uTime, 0.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vFade = 1.0 - uTime / 0.65;
    gl_PointSize = uSize * (720.0 / -mv.z) * max(vFade, 0.0);
    gl_Position = projectionMatrix * mv;
  }`;

const sparkFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vFade;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    float a = (1.0 - smoothstep(0.25, 0.5, r)) * clamp(vFade * 1.5, 0.0, 1.0);
    if (a < 0.02) discard;
    gl_FragColor = vec4(vColor, a);
    #include <colorspace_fragment>
  }`;

const SPARK_LIFE = 0.65;

/** A one-shot spray of hot sparks from a point, falling and fading, then gone. */
const Sparks = ({
  at,
  colors,
  count = 30,
  size = 0.09,
  delayMs = 0,
}: {
  at: Vec3;
  colors: string[];
  count?: number;
  size?: number;
  delayMs?: number;
}) => {
  const invalidate = useThree((s) => s.invalidate);
  const elapsed = useRef(-delayMs / 1000);
  const [done, setDone] = useState(false);
  const points = useMemo(() => {
    const random = rng(29);
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const c = new Color();
    for (let i = 0; i < count; i++) {
      const a = random() * Math.PI * 2;
      const up = 0.4 + random() * 1.2;
      const out = 0.8 + random() * 1.4;
      pos.set([at[0], at[1], at[2]], i * 3);
      vel.set([Math.cos(a) * out, up, Math.sin(a) * out], i * 3);
      c.set(colors[i % colors.length]);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('aVel', new Float32BufferAttribute(vel, 3));
    g.setAttribute('aColor', new Float32BufferAttribute(col, 3));
    const m = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uGravity: { value: 5 }, uSize: { value: size } },
      vertexShader: sparkVertex,
      fragmentShader: sparkFragment,
    });
    const p = new Points(g, m);
    p.frustumCulled = false;
    p.renderOrder = LAYER.trace;
    p.raycast = noRaycast;
    p.visible = false;
    return p;
    // Made once per capture
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(
    () => () => {
      points.geometry.dispose();
      (points.material as ShaderMaterial).dispose();
    },
    [points],
  );
  useFrame((_, delta) => {
    if (done) return;
    elapsed.current += Math.min(delta, MAX_STEP);
    const t = elapsed.current;
    points.visible = t > 0;
    (points.material as ShaderMaterial).uniforms.uTime.value = Math.max(t, 0);
    if (t > SPARK_LIFE) setDone(true);
    invalidate();
  });
  return done ? null : <primitive object={points} />;
};

// --- Moments ---------------------------------------------------------------------------

const floorOf = (centre: Vec3): Vec3 => [centre[0], centre[1] + layout.floorY, centre[2]];

export const MoveFx = ({ to, durationMs, capture }: MoveFxProps) => {
  const floor = floorOf(to);
  const led = LEVEL_LED[levelAt(floor[1])];
  const land = durationMs * 0.92;
  return (
    <Ripples
      floor={floor}
      rings={[
        { color: led, delay: land, life: 520, from: 0.3, to: 0.62, width: 0.018, alpha: 0.95 },
        { color: INK, delay: land + 60, life: 460, from: 0.34, to: 0.5, width: 0.008, alpha: 0.7 },
        ...(capture
          ? [
              {
                color: CAPTURE,
                delay: land,
                life: 600,
                from: 0.36,
                to: 1.0,
                width: 0.03,
                alpha: 1,
              },
              {
                color: CAPTURE,
                delay: land + 120,
                life: 600,
                from: 0.36,
                to: 0.75,
                width: 0.014,
                alpha: 0.8,
              },
            ]
          : []),
      ]}
    />
  );
};

/** How long the white-hot flash lasts as the cut begins. */
const FLASH_MS = 90;

export const CaptureFx = ({ floor, victim, durationMs, victimFacing }: CaptureFxProps) => {
  const invalidate = useThree((s) => s.invalidate);
  const elapsed = useRef(0);
  const [gone, setGone] = useState(false);
  const level = levelAt(floor[1]);
  // Cut away while the attacker glides in, the last of it as it lands
  const cutMs = Math.max(durationMs + 120, 300);
  useEffect(() => {
    setDissolve(victim.type, 1, level, 1);
    invalidate();
  }, [victim.type, level, invalidate]);
  useFrame((_, delta) => {
    if (gone) return;
    elapsed.current += Math.min(delta, MAX_STEP) * 1000;
    const t = elapsed.current;
    const k = Math.min(t / cutMs, 1);
    setDissolve(victim.type, 1 - k, level, Math.max(0, 1 - t / FLASH_MS));
    if (k >= 1) setGone(true);
    invalidate();
  });
  const yaw = victim.type === PieceType.Knight ? (victimFacing ?? 0) : 0;
  return (
    <>
      {!gone && (
        <group position={floor} rotation={[0, yaw, 0]} scale={PIECE_SCALE}>
          <Footprint level={level} />
          <DissolvePiece type={victim.type} color={victim.color} level={level} />
        </group>
      )}
      <Sparks
        at={[floor[0], floor[1] + 0.4, floor[2]]}
        colors={[CAPTURE, '#ffb09a', '#ffffff', '#3d454f']}
        count={30}
        size={0.09}
        delayMs={60}
      />
    </>
  );
};

const POWER_DOWN_MS = 600;

/** The mated king's tray powers down while three red rings roll out across it. */
export const Celebration = ({ floor }: CelebrationProps) => {
  const invalidate = useThree((s) => s.invalidate);
  const level = levelAt(floor[1]);
  const elapsed = useRef(0);
  const done = useRef(false);
  useEffect(() => () => powerDownTray(level, 0), [level]);
  useFrame((_, delta) => {
    if (done.current) return;
    elapsed.current += Math.min(delta, MAX_STEP) * 1000;
    const k = Math.min(Math.max((elapsed.current - 300) / POWER_DOWN_MS, 0), 1);
    powerDownTray(level, k * k * (3 - 2 * k));
    if (k >= 1) done.current = true;
    invalidate();
  });
  return (
    <Ripples
      floor={floor}
      rings={[0, 1, 2].map((i) => ({
        color: CHECK,
        delay: 380 + i * 420,
        life: 1500,
        from: 0.42,
        to: 2.6,
        width: 0.032,
        alpha: 1 - i * 0.18,
      }))}
    />
  );
};
