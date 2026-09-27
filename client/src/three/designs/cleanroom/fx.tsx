import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, DoubleSide, PlaneGeometry, ShaderMaterial } from 'three';
import { PieceType } from '../../../engine/pieces';
import { Burst } from '../kit/fx';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import type { CaptureFxProps, CelebrationProps, MoveFxProps, Vec3 } from '../types';
import { PIECE_SCALE, frame, layout } from './layout';
import { CAPTURE, CHECK, INK, LEVEL_LED } from './palette';
import { DissolvePiece, Footprint, setDissolve } from './pieces';

// Motion. Pieces glide (Board's straight line); these add the moments:
//
// - a landing: the tray registers the piece with a ripple of its level's LED
//   colour inside a graphite ring, as a sensor pad would;
// - a capture: the victim is cut away from the top down by a red-hot line
//   while the attacker glides in, shedding a few sparks, and a red ring
//   flashes out as it lands;
// - mate: the king topples (Board) and three slow red rings roll out across
//   its tray.
//
// All of it runs on r3f's clock and ends on its own.

const MAX_STEP = 1 / 20;

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

const ripplePlane = new PlaneGeometry(3, 3);

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
  const materials = useMemo(
    () =>
      rings.map(
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
    // Specs are literals made per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);
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
          geometry={ripplePlane}
          material={m}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={LAYER.marker}
          raycast={noRaycast}
        />
      ))}
    </group>
  );
};

/** The level (0 = A) whose tray is at this world height. */
const levelAt = (y: number) =>
  Math.max(
    0,
    Math.min(
      frame.levelY.length - 1,
      Math.round((y - frame.levelY[0]) / Math.max(frame.gap, 1e-3)),
    ),
  );

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
                life: 560,
                from: 0.36,
                to: 0.85,
                width: 0.024,
                alpha: 0.9,
              },
            ]
          : []),
      ]}
    />
  );
};

export const CaptureFx = ({ floor, victim, durationMs, victimFacing }: CaptureFxProps) => {
  const invalidate = useThree((s) => s.invalidate);
  const elapsed = useRef(0);
  const [gone, setGone] = useState(false);
  const level = levelAt(floor[1]);
  // Cut away while the attacker glides in, the last of it as it lands
  const cutMs = Math.max(durationMs + 120, 300);
  useEffect(() => {
    setDissolve(victim.type, 1);
    invalidate();
  }, [victim.type, invalidate]);
  useFrame((_, delta) => {
    if (gone) return;
    elapsed.current += Math.min(delta, MAX_STEP) * 1000;
    const k = Math.min(elapsed.current / cutMs, 1);
    setDissolve(victim.type, 1 - k);
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
      <Burst
        position={[floor[0], floor[1] + 0.35, floor[2]]}
        colors={[CAPTURE, '#ff9a7a', '#39414b']}
        count={22}
        speed={1.6}
        gravity={4}
        lifeMs={620}
        size={0.07}
        additive={false}
        upward={0.35}
        delayMs={durationMs * 0.25}
      />
    </>
  );
};

export const Celebration = ({ floor }: CelebrationProps) => (
  <Ripples
    floor={floor}
    rings={[0, 1, 2].map((i) => ({
      color: CHECK,
      delay: 380 + i * 420,
      life: 1400,
      from: 0.42,
      to: 2.4,
      width: 0.02,
      alpha: 0.85 - i * 0.2,
    }))}
  />
);
