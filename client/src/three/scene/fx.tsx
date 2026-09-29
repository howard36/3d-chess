import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AdditiveBlending, Color, DoubleSide, PlaneGeometry, ShaderMaterial } from 'three';
import type { Group } from 'three';
import { PieceType } from '../../engine/pieces';
import { MOVE_ANIMATION, prefersReducedMotion } from '../motion';
import { LAYER } from './layers';
import { noRaycast } from '../noRaycast';
import type { CaptureFxProps, CelebrationProps, PieceColor } from '../types';
import { FRAME, KNIGHT_YAW, LEVEL_COLORS, levelAt, MARGIN, PALETTE, PIECE_SCALE } from './palette';
import { usePieceMaterial, wholePiece } from './pieces';
import { gardenBoost } from './stage';

// Motion in light, kept brief. A captured piece burns away from the crown
// down behind a thin edge of white light, and its outline, drawn in light
// as the garden's sculptures are, rises a little from it and fades. At mate,
// as the king starts to fall, one pulse of light spreads from his foot
// across his own level, and the colossal pieces in the garden brighten for a
// breath and settle back.

/** A frame's step of loose time: once a glide is over, a slow frame may take up to this much. */
const LOOSE_MS = 125;

/**
 * Advances a one-shot effect on r3f's clock; returns false once it has run
 * its course. Until `tightUntil` (the piece's glide) time is clamped as the
 * glide's is; after it loosely, so what follows a landing clears in about
 * its own time even on a machine drawing a frame a second.
 */
const useLife = (lifeMs: number, step: (ms: number) => void, tightUntil = 0) => {
  const invalidate = useThree((s) => s.invalidate);
  const elapsed = useRef(0);
  const [alive, setAlive] = useState(true);
  useEffect(() => invalidate(), [invalidate]);
  useFrame((_, delta) => {
    if (!alive) return;
    const clamp = elapsed.current < tightUntil ? MOVE_ANIMATION.maxFrameMs : LOOSE_MS;
    elapsed.current += Math.min(delta * 1000, clamp);
    if (elapsed.current >= lifeMs) {
      step(lifeMs);
      invalidate();
      setAlive(false);
      return;
    }
    step(elapsed.current);
    invalidate();
  });
  return alive;
};

/** The yaw Board gives a knight of this colour (see knightFacing in Board.tsx). */
const knightYaw = (piece: PieceType, color: PieceColor, orientation: PieceColor) =>
  piece === PieceType.Knight ? (color === orientation ? 1 : -1) * (Math.PI / 2 - KNIGHT_YAW) : 0;

// --- Capture ------------------------------------------------------------------------------

const outlineMaterial = () =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uColor: { value: new Color(PALETTE.neon) }, uOpacity: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0);
        gl_FragColor = vec4(uColor * (1.5 * f) * uOpacity, 1.0);
        #include <colorspace_fragment>
      }`,
  });

const CAPTURE_MS = 820;

export const CaptureFx = ({
  floor,
  victim,
  durationMs,
  victimFacing,
  orientation,
}: CaptureFxProps) => {
  const geometry = wholePiece(victim.type);
  const level = levelAt(floor[1]);
  // The victim in its own glaze (the live piece's) until it burns
  const body = usePieceMaterial(victim.color, victim.type, level);
  const outline = useMemo(outlineMaterial, []);
  useEffect(() => () => outline.dispose(), [outline]);
  const whole = useRef<Group>(null);
  const ghost = useRef<Group>(null);
  // The attacker is on its way: the victim holds, then burns away as it arrives
  const start = durationMs * 0.5;
  const alive = useLife(
    start + CAPTURE_MS,
    (ms) => {
      const k = Math.max(ms - start, 0) / CAPTURE_MS;
      const burn = Math.min(k / 0.65, 1);
      body.uniforms.uCut.value = k > 0 ? burn * 1.05 : -1;
      if (whole.current) whole.current.visible = burn < 1;
      // Its outline in light rises a little from it and fades
      outline.uniforms.uOpacity.value = k > 0 ? 0.45 * Math.sin(Math.PI * Math.min(k, 1)) : 0;
      if (ghost.current) ghost.current.position.y = 0.16 * (1 - (1 - k) ** 2);
    },
    durationMs,
  );
  if (!alive) return null;
  const yaw = victimFacing ?? knightYaw(victim.type, victim.color, orientation as PieceColor);
  return (
    <group position={floor} scale={PIECE_SCALE}>
      <group ref={whole}>
        <mesh
          geometry={geometry}
          material={body}
          rotation={[0, victim.type === PieceType.Knight ? yaw : 0, 0]}
          raycast={noRaycast}
        />
      </group>
      <group ref={ghost} rotation={[0, victim.type === PieceType.Knight ? yaw : 0, 0]}>
        <mesh
          geometry={geometry}
          material={outline}
          renderOrder={LAYER.trace}
          raycast={noRaycast}
        />
      </group>
    </group>
  );
};

// --- Mate ---------------------------------------------------------------------------------

// One pulse of light leaves the mated king's foot as he starts to fall and
// spreads across his own level's glass: a ring growing from him, a white
// front with a glow of the level's colour behind it, at an even speed, so it takes longer from a corner than from the middle. The
// result card doesn't wait for it; it plays on behind the card. The garden's
// colossal pieces brighten for a breath with it.

const pulseFragment = /* glsl */ `
  uniform vec3 uFront;
  uniform vec3 uTint;
  uniform vec2 uFrom;
  uniform float uRadius;
  uniform float uOpacity;
  uniform float uReach;
  varying vec3 vWorld;
  void main() {
    // Only on the glass: nothing past its edge
    if (max(abs(vWorld.x), abs(vWorld.z)) > uReach) discard;
    float r = length(vWorld.xz - uFrom);
    float d = r - uRadius;
    float fw = max(fwidth(r), 1e-4);
    float line = 1.0 - smoothstep(0.012, 0.012 + fw * 1.5, abs(d));
    float halo = exp(-d * d / (0.06 * 0.06)) * 0.35;
    float wake = exp(min(d, 0.0) / 0.45) * step(d, 0.0) * 0.2;
    vec3 col = mix(uTint, uFront, clamp(line + halo, 0.0, 1.0));
    float a = (line * 0.85 + halo + wake) * uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(col * a, a);
    #include <colorspace_fragment>
  }`;

const pulseVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const REACH = FRAME.half + MARGIN;
const levelPlane = new PlaneGeometry(REACH * 2, REACH * 2).rotateX(-Math.PI / 2);
/** The pulse leaves this soon after the king starts to fall. */
const PULSE_DELAY_MS = 60;
/** How fast the pulse's front spreads (world units, one per square, a second). */
export const PULSE_SPEED = 4.2;

/** How far the pulse must spread from `(x, z)`: to the farthest corner of the level's glass. */
const farthestCorner = (x: number, z: number) =>
  Math.max(
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => Math.hypot(sx * REACH - x, sz * REACH - z))),
  );

/** How long the pulse from `(x, z)` lasts (seconds). */
export const pulseSeconds = (x: number, z: number) =>
  // The front reaches the far corner at 95% of the pulse's life, as it fades
  (farthestCorner(x, z) + 0.15) / PULSE_SPEED / 0.95;

/**
 * Mate: one pulse of light from the king's foot across his level as he
 * falls, and the garden's colossal pieces brighten for a breath.
 */
export const Celebration = ({ floor }: CelebrationProps) => {
  const [kx, ky, kz] = floor;
  const level = levelAt(ky);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
        uniforms: {
          uFront: { value: new Color(PALETTE.light) },
          uTint: { value: new Color(LEVEL_COLORS[level]) },
          uFrom: { value: [kx, kz] },
          uRadius: { value: 0 },
          uOpacity: { value: 0 },
          uReach: { value: REACH },
        },
        vertexShader: pulseVertex,
        fragmentShader: pulseFragment,
      }),
    [kx, kz, level],
  );
  useEffect(() => () => material.dispose(), [material]);
  useEffect(
    () => () => {
      gardenBoost.value = 0;
    },
    [],
  );
  const reach = farthestCorner(kx, kz) + 0.15;
  const lifeMs = pulseSeconds(kx, kz) * 1000;
  const still = prefersReducedMotion();
  // (With reduced motion nothing crosses the board, so it is over at once)
  const alive = useLife(PULSE_DELAY_MS + (still ? 0 : lifeMs), (ms) => {
    if (still) return;
    const x = Math.min(Math.max(ms - PULSE_DELAY_MS, 0) / lifeMs, 1);
    // An even pace, reaching the farthest corner just before it has faded
    material.uniforms.uRadius.value = reach * Math.min(x / 0.95, 1);
    material.uniforms.uOpacity.value = x > 0 ? Math.min(x * 14, 1) * (1 - x) ** 0.5 : 0;
    gardenBoost.value = 0.9 * Math.sin(Math.PI * x) ** 2;
  });
  if (!alive) return null;
  return (
    <mesh
      geometry={levelPlane}
      material={material}
      position={[0, FRAME.levelY[level] + 0.014, 0]}
      renderOrder={LAYER.marker - 0.2}
      raycast={noRaycast}
    />
  );
};
