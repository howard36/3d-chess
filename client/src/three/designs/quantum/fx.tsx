import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AdditiveBlending, Color, DoubleSide, ShaderMaterial } from 'three';
import type { Group, Mesh } from 'three';
import { ChessPiece } from '../../pieces';
import { easeInOutCubic } from '../../motion';
import { movePoint } from '../../movePath';
import { PieceType } from '../../../engine/pieces';
import { Burst } from '../kit/fx';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import type { CaptureFxProps, CelebrationProps, MoveFxProps, PieceColor, Vec3 } from '../types';
import { FRAME, KNIGHT_YAW, layout, PALETTE, PIECE_SCALE } from './palette';
import { armyMaterials, echoMaterial, footMaterial, viewRight, wholePiece } from './pieces';

// Motion: a moving piece travels as a wave packet, trailed by fading mint
// echoes of itself, and lands with a ripple across the wafer. A captured
// piece decoheres: it splits into two echoes that drift apart and fade, in a
// spray of cold sparks, while a red ripple spreads from its square. Mate
// sends slow interference rings out across the mated king's wafer.

const FLOOR = layout.floorY;
const MAX_DT = 1 / 20;

/** Board's yaw for a knight of `color` seen from `orientation`'s seat. */
const knightYaw = (type: PieceType, color: PieceColor, orientation: PieceColor) =>
  type === PieceType.Knight ? (color === orientation ? 1 : -1) * (Math.PI / 2 - KNIGHT_YAW) : 0;

/** Counts time on r3f's clock from mount, requesting frames until `untilMs`. */
const useAge = (untilMs: number) => {
  const invalidate = useThree((s) => s.invalidate);
  const age = useRef(0);
  const [done, setDone] = useState(false);
  useEffect(() => invalidate(), [invalidate]);
  useFrame((_, delta) => {
    if (done) return;
    age.current += Math.min(delta, MAX_DT) * 1000;
    if (age.current >= untilMs) setDone(true);
    else invalidate();
  });
  return { age, done };
};

/** A ring spreading out over the wafer from `floor`: one ripple. */
const Ripple = ({
  floor,
  color,
  delayMs = 0,
  ms = 480,
  from = 0.18,
  to = 0.62,
  width = 0.018,
}: {
  floor: Vec3;
  color: string;
  delayMs?: number;
  ms?: number;
  from?: number;
  to?: number;
  width?: number;
}) => {
  const { age, done } = useAge(delayMs + ms);
  const mesh = useRef<Mesh>(null);
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const k = Math.min(Math.max((age.current - delayMs) / ms, 0), 1);
    const e = 1 - (1 - k) ** 2;
    m.visible = age.current >= delayMs;
    const r = from + (to - from) * e;
    m.scale.setScalar(r);
    const mat = m.material as unknown as { uniforms: Record<string, { value: number }> };
    mat.uniforms.uOpacity.value = (1 - k) ** 1.5;
    mat.uniforms.uWidth.value = width / r;
  });
  const material = useMemo(() => rippleMaterial(color), [color]);
  useEffect(() => () => material.dispose(), [material]);
  if (done) return null;
  return (
    <mesh
      ref={mesh}
      material={material}
      position={[floor[0], floor[1] + 0.014, floor[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={LAYER.marker}
      raycast={noRaycast}
      visible={false}
    >
      <planeGeometry args={[2.2, 2.2]} />
    </mesh>
  );
};

const rippleMaterial = (color: string) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    uniforms: {
      uColor: { value: new Color(color) },
      uOpacity: { value: 1 },
      uWidth: { value: 0.03 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        vP = (uv - 0.5) * 2.2;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uWidth;
      varying vec2 vP;
      void main() {
        float d = abs(length(vP) - 1.0);
        float aa = max(fwidth(d), 1e-4);
        float a = (1.0 - smoothstep(uWidth - aa, uWidth + aa, d)) * uOpacity;
        // A soft glow either side of the crest
        a += exp(-d / (uWidth * 3.0)) * 0.25 * uOpacity;
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor, min(a, 1.0));
        #include <colorspace_fragment>
      }`,
  });

// --- The move -----------------------------------------------------------------------

const ECHOES = [
  { lag: 0.09, opacity: 0.5 },
  { lag: 0.18, opacity: 0.32 },
  { lag: 0.27, opacity: 0.18 },
];

/**
 * The wave packet: echoes of the moving piece trailing it along its path
 * (the same eased path Board glides it along), fading as it lands; then a
 * mint ripple from the destination.
 */
export const MoveFx = ({
  from,
  to,
  color,
  piece,
  durationMs,
  arc = 0,
  orientation,
}: MoveFxProps) => {
  const total = durationMs * 1.35;
  const { age, done } = useAge(total + 520);
  const refs = useRef<(Group | null)[]>([]);
  const materials = useMemo(() => ECHOES.map((e) => echoMaterial(PALETTE.lastMove, e.opacity)), []);
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);
  const geometry = wholePiece(piece);
  const yaw = knightYaw(piece, color, orientation);

  useFrame(() => {
    const t = age.current / durationMs;
    ECHOES.forEach((e, i) => {
      const g = refs.current[i];
      if (!g) return;
      const k = Math.min(Math.max(t - e.lag, 0), 1);
      const [x, y, z] = movePoint(from, to, easeInOutCubic(k), arc);
      g.position.set(x, y + FLOOR, z);
      // Fade in as it separates from the piece, out as it catches up
      const apart = Math.min(t / (e.lag + 0.05), 1);
      const land = 1 - Math.min(Math.max((t - 1) / 0.3, 0), 1);
      materials[i].uniforms.uOpacity.value = e.opacity * apart * land;
      g.visible = t < 1.3;
    });
  });

  if (done) return null;
  return (
    <>
      {ECHOES.map((_, i) => (
        <group
          key={i}
          ref={(g) => {
            refs.current[i] = g;
          }}
          rotation={[0, yaw, 0]}
          scale={PIECE_SCALE}
        >
          <mesh geometry={geometry} material={materials[i]} raycast={noRaycast} />
        </group>
      ))}
      <Ripple
        floor={[to[0], to[1] + FLOOR, to[2]]}
        color={PALETTE.lastMove}
        delayMs={durationMs * 0.92}
      />
    </>
  );
};

// --- The capture --------------------------------------------------------------------

/**
 * The victim holds its ground while the capturer glides in, then decoheres:
 * it vanishes into two echoes that drift apart, rise and fade, in a spray
 * of sparks of its army's colours, with a red ripple under it.
 */
export const CaptureFx = ({ floor, victim, durationMs, victimFacing }: CaptureFxProps) => {
  const hit = durationMs * 0.62;
  const fade = 520;
  const { age, done } = useAge(hit + fade + 200);
  const solid = useRef<Group>(null);
  const echoA = useRef<Group>(null);
  const echoB = useRef<Group>(null);
  const tint = victim.color === 'white' ? PALETTE.gold : PALETTE.frost;
  const material = useMemo(() => echoMaterial(tint, 0.6), [tint]);
  useEffect(() => () => material.dispose(), [material]);
  const geometry = wholePiece(victim.type);
  const m = armyMaterials(victim.color, 'rest');
  // The level it stood on: the wafer nearest its floor
  const level = FRAME.levelY.reduce(
    (best, y, z) => (Math.abs(y - floor[1]) < Math.abs(FRAME.levelY[best] - floor[1]) ? z : best),
    0,
  );
  const yaw = victim.type === PieceType.Knight ? (victimFacing ?? 0) : 0;
  const [burst, setBurst] = useState(false);
  const camera = useThree((s) => s.camera);

  useFrame(() => {
    const t = age.current;
    const s = solid.current;
    if (s) {
      // Shrinks away in a blink at the moment of measurement
      const k = Math.min(Math.max((t - hit) / 90, 0), 1);
      s.scale.setScalar(PIECE_SCALE * Math.max(1 - k, 1e-4));
      s.visible = k < 1;
    }
    const k = Math.min(Math.max((t - hit) / fade, 0), 1);
    const e = 1 - (1 - k) ** 2;
    for (const [g, side] of [
      [echoA.current, 1],
      [echoB.current, -1],
    ] as const) {
      if (!g) continue;
      g.visible = t >= hit && k < 1;
      // Apart across the view, and rising
      g.position.copy(viewRight(camera, g.parent)).multiplyScalar(side * 0.3 * e);
      g.position.y = 0.16 * e;
    }
    material.uniforms.uOpacity.value = 0.65 * (1 - k);
    if (t >= hit && !burst) setBurst(true);
  });

  if (done) return null;
  return (
    <group position={floor}>
      <group ref={solid} rotation={[0, yaw, 0]} scale={PIECE_SCALE}>
        <ChessPiece
          type={victim.type}
          parts={{
            body: m.body,
            collar: m.collar,
            accent: m.accent,
            foot: footMaterial(level),
          }}
        />
      </group>
      {[echoA, echoB].map((ref, i) => (
        <group key={i} ref={ref} visible={false}>
          <group rotation={[0, yaw, 0]} scale={PIECE_SCALE}>
            <mesh geometry={geometry} material={material} raycast={noRaycast} />
          </group>
        </group>
      ))}
      {burst && (
        <Burst
          position={[0, 0.3, 0]}
          colors={victim.color === 'white' ? ['#ffd27a', '#fff0c8'] : ['#a9d8ff', '#e6f4ff']}
          count={46}
          speed={1.5}
          gravity={0.6}
          lifeMs={700}
          size={0.07}
          upward={0.25}
        />
      )}
      <Ripple floor={[0, 0, 0]} color={PALETTE.capture} delayMs={hit} ms={560} to={0.75} />
    </group>
  );
};

// --- Mate ---------------------------------------------------------------------------

/**
 * Interference rings roll slowly out across the mated king's wafer, three
 * of them, in the colour of check, and the winner's sparks rise once.
 */
export const Celebration = ({ floor, winner }: CelebrationProps) => (
  <>
    {[0, 1, 2].map((i) => (
      <Ripple
        key={i}
        floor={floor}
        color={PALETTE.check}
        delayMs={300 + i * 420}
        ms={1500}
        from={0.35}
        to={2.9}
        width={0.02}
      />
    ))}
    <Burst
      position={[floor[0], floor[1] + 0.4, floor[2]]}
      colors={winner === 'black' ? ['#a9d8ff', '#e6f4ff'] : ['#ffd27a', '#fff0c8']}
      count={70}
      speed={1.2}
      gravity={-0.25}
      lifeMs={1600}
      size={0.07}
      upward={0.85}
      delayMs={250}
    />
  </>
);
