import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, DoubleSide, PlaneGeometry, ShaderMaterial } from 'three';
import type { Group } from 'three';
import { PieceType } from '../../../engine/pieces';
import { ChessPiece } from '../../pieces';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import type { CaptureFxProps, CelebrationProps } from '../types';
import { KNIGHT_YAW, PALETTE, PIECE_SCALE } from './palette';
import { erasable } from './pieces';

// A capture strikes the piece out of the book: as the attacker arrives, the
// victim is erased line by line from its crown down, like type struck from a
// page, the erasing edge glowing in its army's light, while a red diamond
// (the capture's mark) flares once on the floor and fades. At mate, two
// diamonds of pale light sweep out across the mated king's pane, one after
// the other, and fade: the book closes on the line.

/** A frame's step of time, clamped so a stall resumes smoothly. */
const MAX_STEP_MS = 50;

/** Runs `step(ms)` on r3f's clock for `lifeMs`; false once it has run its course. */
const useLife = (lifeMs: number, step: (ms: number) => void) => {
  const invalidate = useThree((s) => s.invalidate);
  const elapsed = useRef(0);
  const [alive, setAlive] = useState(true);
  useEffect(() => invalidate(), [invalidate]);
  useFrame((_, delta) => {
    if (!alive) return;
    elapsed.current += Math.min(delta * 1000, MAX_STEP_MS);
    if (elapsed.current >= lifeMs) {
      step(lifeMs);
      setAlive(false);
      invalidate();
      return;
    }
    step(elapsed.current);
    invalidate();
  });
  return alive;
};

// --- A flat diamond ripple on the pane -------------------------------------------------------

const rippleVertex = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = vec2(position.x, -position.z);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const rippleFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uR;
  uniform float uWidth;
  uniform float uOpacity;
  uniform float uFill;
  varying vec2 vP;
  float diamond(vec2 p, float r) {
    vec2 q = abs(vec2(p.x + p.y, p.x - p.y)) * 0.70710678;
    vec2 d = q - vec2(r * 0.70710678);
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  }
  void main() {
    float d = diamond(vP, uR);
    float aa = max(fwidth(d), 1e-4);
    float line = 1.0 - smoothstep(-aa, aa, abs(d) - uWidth * 0.5);
    float halo = exp(-d * d / (0.05 * 0.05)) * 0.35;
    float inside = (1.0 - smoothstep(-aa, aa, d)) * uFill;
    float a = max(max(line, halo), inside) * uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor, min(a, 1.0));
    #include <colorspace_fragment>
  }`;

const rippleMaterial = (color: string, width: number) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: {
      uColor: { value: new Color(color) },
      uR: { value: 0.4 },
      uWidth: { value: width },
      uOpacity: { value: 0 },
      uFill: { value: 0 },
    },
    vertexShader: rippleVertex,
    fragmentShader: rippleFragment,
  });

const smallPlane = new PlaneGeometry(1.4, 1.4).rotateX(-Math.PI / 2);
const widePlane = new PlaneGeometry(7, 7).rotateX(-Math.PI / 2);

// --- Capture: struck from the book ----------------------------------------------------------

const ERASE_MS = 760;
const FLARE_MS = 620;

export const CaptureFx = ({
  floor,
  victim,
  durationMs,
  victimFacing,
  orientation,
}: CaptureFxProps) => {
  const materials = useMemo(() => erasable(victim.color, victim.type), [victim.color, victim.type]);
  const flare = useMemo(() => rippleMaterial(PALETTE.capture, 0.026), []);
  useEffect(
    () => () => {
      materials.body.dispose();
      materials.accent.dispose();
      flare.dispose();
    },
    [materials, flare],
  );
  const body = useRef<Group>(null);
  // The attacker is on its way: the victim holds, then is struck out as it arrives
  const start = durationMs * 0.5;
  const alive = useLife(start + Math.max(ERASE_MS, FLARE_MS), (ms) => {
    const k = Math.max(ms - start, 0) / ERASE_MS;
    const cut = ms < start ? -1 : -0.01 + Math.min(k, 1) * 1.05;
    materials.body.uniforms.uCut.value = cut;
    materials.accent.uniforms.uCut.value = cut;
    if (body.current) body.current.visible = k < 1;
    const f = Math.max(ms - start, 0) / FLARE_MS;
    const u = flare.uniforms;
    u.uR.value = 0.47 + 0.12 * (1 - (1 - Math.min(f, 1)) ** 2);
    u.uOpacity.value = ms < start ? 0 : Math.max(0, 1 - f) ** 1.5;
    u.uFill.value = 0.18 * Math.max(0, 1 - f) ** 2;
  });
  if (!alive) return null;
  // The yaw Board gives a knight of the victim's colour (see knightFacing)
  const yaw =
    victimFacing ??
    (victim.type === PieceType.Knight
      ? (victim.color === orientation ? 1 : -1) * (Math.PI / 2 - KNIGHT_YAW)
      : 0);
  return (
    <group position={floor}>
      <group rotation={[0, victim.type === PieceType.Knight ? yaw : 0, 0]} scale={PIECE_SCALE}>
        <group ref={body}>
          <ChessPiece
            type={victim.type}
            parts={{ body: materials.body, accent: materials.accent }}
          />
        </group>
      </group>
      <mesh
        geometry={smallPlane}
        material={flare}
        position={[0, 0.016, 0]}
        renderOrder={LAYER.marker}
        raycast={noRaycast}
      />
    </group>
  );
};

// --- Mate ------------------------------------------------------------------------------------

const MATE_MS = 1600;

/**
 * Mate, one calm beat: two diamonds of pale light sweep out across the mated
 * king's pane, a quick one and a slower one behind it, and fade.
 */
export const Celebration = ({ floor }: CelebrationProps) => {
  const rings = useMemo(
    () => [rippleMaterial(PALETTE.trace, 0.02), rippleMaterial(PALETTE.select, 0.03)],
    [],
  );
  useEffect(() => () => rings.forEach((m) => m.dispose()), [rings]);
  const alive = useLife(MATE_MS, (ms) => {
    const t = ms / MATE_MS;
    const [fast, slow] = rings.map((m) => m.uniforms);
    fast.uR.value = 0.5 + 2.6 * (1 - (1 - t) ** 2);
    fast.uOpacity.value = Math.min(1, 1.2 * (1 - t) ** 1.4);
    const k = Math.max(t - 0.15, 0) / 0.85;
    slow.uR.value = 0.4 + 1.8 * (1 - (1 - k) ** 2);
    slow.uOpacity.value = k > 0 ? 0.8 * Math.min(k * 5, 1) * (1 - k) ** 1.3 : 0;
  });
  if (!alive) return null;
  return (
    <group position={floor}>
      {rings.map((m, i) => (
        <mesh
          key={i}
          geometry={widePlane}
          material={m}
          position={[0, 0.018, 0]}
          renderOrder={LAYER.marker}
          raycast={noRaycast}
        />
      ))}
    </group>
  );
};
