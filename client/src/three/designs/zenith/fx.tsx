import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AdditiveBlending, Color, DoubleSide, PlaneGeometry, ShaderMaterial } from 'three';
import type { Group } from 'three';
import { PieceType } from '../../../engine/pieces';
import { MOVE_ANIMATION, prefersReducedMotion } from '../../motion';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import type { CaptureFxProps, CelebrationProps, PieceColor } from '../types';
import { FRAME, KNIGHT_YAW, LEVEL_COLORS, levelAt, MARGIN, PALETTE, PIECE_SCALE } from './palette';
import { ringMaterial, ringPlane, useLevelCue, usePieceMaterial, wholePiece } from './pieces';
import { gardenBoost } from './stage';
import { useMarkSetting } from './settings-markers';

// Motion in light, kept brief. A captured piece burns away from the crown
// down behind a thin edge of white light, and its outline, drawn in light
// as the garden's sculptures are, rises a little from it and fades. At mate,
// as the king starts to fall, one pulse of light spreads from his foot
// through all five levels, and the colossal pieces in the garden brighten
// for a breath and settle back.

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
  // It stands in its level ring only where pieces wear one (settings-pieces.ts)
  const ringed = useLevelCue().ring;
  // The victim in its own glaze (the live piece's, settings and all),
  // standing in its own ring, until it burns
  const body = usePieceMaterial(victim.color, victim.type, level);
  const { ring, outline } = useMemo(
    () => ({ ring: ringMaterial(level), outline: outlineMaterial() }),
    [level],
  );
  useEffect(
    () => () => {
      ring.dispose();
      outline.dispose();
    },
    [ring, outline],
  );
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
      ring.uniforms.uAmount.value = 1 - burn;
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
        {ringed && (
          <mesh
            geometry={ringPlane}
            material={ring}
            position={[0, 0.005, 0]}
            renderOrder={LAYER.shadow}
            raycast={noRaycast}
          />
        )}
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
// spreads out through the whole tower: a sphere of light growing from him,
// drawn where it meets each level's glass, so it crosses his own level first
// and reaches the levels above and below as it grows, a white front with a
// glow of that level's colour behind it. It takes a few seconds to cross
// every level (a setting), time to take the result in. The garden's colossal
// pieces brighten for a breath with it.

const pulseFragment = /* glsl */ `
  uniform vec3 uFront;
  uniform vec3 uTint;
  uniform vec2 uFrom;
  uniform float uDy;
  uniform float uRadius;
  uniform float uOpacity;
  uniform float uReach;
  varying vec3 vWorld;
  void main() {
    // Only on the glass: nothing past its edge
    if (max(abs(vWorld.x), abs(vWorld.z)) > uReach) discard;
    // Where the sphere of light meets this level
    float h2 = uRadius * uRadius - uDy * uDy;
    if (h2 <= 0.0) discard;
    float r = length(vWorld.xz - uFrom);
    float d = r - sqrt(h2);
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

/**
 * Mate: one pulse of light from the king's foot through all five levels as
 * he falls, and the garden's colossal pieces brighten for a breath.
 */
export const Celebration = ({ floor }: CelebrationProps) => {
  const seconds = useMarkSetting<number>('mark.mateSeconds');
  const [kx, ky, kz] = floor;
  // As far as the pulse must go: the farthest corner of any level's glass
  const farthest = useMemo(
    () =>
      Math.max(
        ...FRAME.levelY.flatMap((y) =>
          [-1, 1].flatMap((sx) =>
            [-1, 1].map((sz) => Math.hypot(sx * REACH - kx, y - ky, sz * REACH - kz)),
          ),
        ),
      ),
    [kx, ky, kz],
  );
  const materials = useMemo(
    () =>
      FRAME.levelY.map(
        (y, level) =>
          new ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            blending: AdditiveBlending,
            uniforms: {
              uFront: { value: new Color(PALETTE.light) },
              uTint: { value: new Color(LEVEL_COLORS[level]) },
              uFrom: { value: [kx, kz] },
              uDy: { value: y - ky },
              uRadius: { value: 0 },
              uOpacity: { value: 0 },
              uReach: { value: REACH },
            },
            vertexShader: pulseVertex,
            fragmentShader: pulseFragment,
          }),
      ),
    [kx, ky, kz],
  );
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);
  useEffect(
    () => () => {
      gardenBoost.value = 0;
    },
    [],
  );
  const lifeMs = seconds * 1000;
  const still = prefersReducedMotion();
  const alive = useLife(PULSE_DELAY_MS + lifeMs, (ms) => {
    if (still) return;
    const x = Math.min(Math.max(ms - PULSE_DELAY_MS, 0) / lifeMs, 1);
    // It spreads at a nearly even pace, so every level has its moment, and
    // reaches the farthest corner just before it has faded
    const radius = (farthest + 0.15) * (1 - (1 - Math.min(x / 0.95, 1)) ** 1.15);
    const opacity = x > 0 ? Math.min(x * 14, 1) * (1 - x) ** 0.5 : 0;
    for (const m of materials) {
      m.uniforms.uRadius.value = radius;
      m.uniforms.uOpacity.value = opacity;
    }
    gardenBoost.value = 0.9 * Math.sin(Math.PI * x) ** 2;
  });
  if (!alive) return null;
  return (
    <>
      {FRAME.levelY.map((y, level) => (
        <mesh
          key={level}
          geometry={levelPlane}
          material={materials[level]}
          position={[0, y + 0.014, 0]}
          renderOrder={LAYER.marker - 0.2}
          raycast={noRaycast}
        />
      ))}
    </>
  );
};
