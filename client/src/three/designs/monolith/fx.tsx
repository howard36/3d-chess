import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AdditiveBlending, Color, DoubleSide, PlaneGeometry, ShaderMaterial } from 'three';
import type { Group } from 'three';
import { PieceType } from '../../../engine/pieces';
import { MOVE_ANIMATION } from '../../motion';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import type { CaptureFxProps, CelebrationProps, PieceColor } from '../types';
import { KNIGHT_YAW, levelAt, PALETTE, PIECE_SCALE } from './palette';
import { bodyMaterial, ringMaterial, ringPlane, wholePiece } from './pieces';
import { gardenBoost } from './stage';

// Motion in light, kept brief. A captured piece burns away from the crown
// down behind a thin edge of white light, and its outline, drawn in light
// as the garden's sculptures are, rises a little from it and fades. At mate,
// once the king has fallen, one ring of white light sweeps out across his
// level, and the colossal pieces in the garden brighten for a breath and
// settle back.

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
  // The victim in its own glaze, standing in its own ring, until it burns
  const { body, ring, outline } = useMemo(
    () => ({
      body: bodyMaterial(victim.color, victim.type),
      ring: ringMaterial(level),
      outline: outlineMaterial(),
    }),
    [victim.color, victim.type, level],
  );
  useEffect(
    () => () => {
      body.dispose();
      ring.dispose();
      outline.dispose();
    },
    [body, ring, outline],
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
        <mesh
          geometry={ringPlane}
          material={ring}
          position={[0, 0.005, 0]}
          renderOrder={LAYER.shadow}
          raycast={noRaycast}
        />
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

const sweepFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uRadius;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * 7.0;
    float r = length(p);
    float d = r - uRadius;
    float fw = max(fwidth(r), 1e-4);
    float line = 1.0 - smoothstep(0.012, 0.012 + fw * 1.5, abs(d));
    float wake = exp(-max(-d, 0.0) / 0.35) * step(d, 0.0) * 0.18;
    float a = (line * 0.8 + wake) * uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }`;

const sweepPlane = new PlaneGeometry(7, 7).rotateX(-Math.PI / 2);
const MATE_MS = 2600;
const SWEEP_MS = 1400;

/**
 * Mate, one calm beat after the king falls: a ring of white light sweeps out
 * across his level, and the garden's colossal pieces brighten for a breath.
 */
export const Celebration = ({ floor }: CelebrationProps) => {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
        uniforms: {
          uColor: { value: new Color(PALETTE.light) },
          uRadius: { value: 0 },
          uOpacity: { value: 0 },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: sweepFragment,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useEffect(
    () => () => {
      gardenBoost.value = 0;
    },
    [],
  );
  // The king topples first (900 ms)
  const delay = 700;
  const alive = useLife(delay + MATE_MS, (ms) => {
    const t = Math.max(ms - delay, 0);
    const s = Math.min(t / SWEEP_MS, 1);
    material.uniforms.uRadius.value = 0.3 + 3.1 * (1 - (1 - s) ** 2);
    material.uniforms.uOpacity.value = t > 0 ? Math.min(s * 8, 1) * (1 - s) ** 1.3 : 0;
    const g = Math.min(t / MATE_MS, 1);
    gardenBoost.value = 0.9 * Math.sin(Math.PI * g) ** 2;
  });
  if (!alive) return null;
  return (
    <mesh
      geometry={sweepPlane}
      material={material}
      position={[floor[0], floor[1] + 0.014, floor[2]]}
      renderOrder={LAYER.marker}
      raycast={noRaycast}
    />
  );
};
