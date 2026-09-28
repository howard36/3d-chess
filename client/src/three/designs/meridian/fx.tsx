import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  PlaneGeometry,
  PointsMaterial,
  ShaderMaterial,
} from 'three';
import type { Group } from 'three';
import { PieceType } from '../../../engine/pieces';
import { MOVE_ANIMATION } from '../../motion';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import { dotTexture, rng } from '../kit/textures';
import type { CaptureFxProps, CelebrationProps, PieceColor } from '../types';
import { KNIGHT_YAW, PALETTE, PIECE_SCALE } from './palette';
import { wholePiece } from './pieces';

// Two quiet effects. A captured piece dissolves from the crown down into a
// few motes of starlight that drift up and go out. At mate, once the king has
// toppled, one ring of the winner's starlight spreads slowly across the
// king's deck and a handful of motes rise: a calm, short flourish.

const BODY: Record<PieceColor, string> = { white: PALETTE.moonstone, black: PALETTE.obsidian };
const EDGE: Record<PieceColor, string> = { white: '#f4f7ff', black: '#8ea2cc' };

/** The yaw Board gives a knight of this colour (see knightFacing in Board.tsx). */
const knightYaw = (piece: PieceType, color: PieceColor, orientation: PieceColor) =>
  piece === PieceType.Knight ? (color === orientation ? 1 : -1) * (Math.PI / 2 - KNIGHT_YAW) : 0;

/** A frame's step once a glide is over: slow frames still clear in about their own time. */
const LOOSE_MS = 125;

/** Runs a one-shot effect on r3f's clock; false once it has run its course. */
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

const mote = (() => {
  let t: ReturnType<typeof dotTexture> | null = null;
  return () => (t ??= dotTexture(0.7, 32));
})();

interface Motes {
  geometry: BufferGeometry;
  start: Float32Array;
  velocity: Float32Array;
  delay: Float32Array;
}

/** Motes sampled from points (piece units), each with a slow upward drift and a start delay. */
const motesFrom = (source: BufferGeometry, count: number, seed: number, top: number): Motes => {
  const random = rng(seed);
  const pos = source.getAttribute('position');
  const start = new Float32Array(count * 3);
  const velocity = new Float32Array(count * 3);
  const delay = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const v = Math.floor(random() * pos.count);
    const x = pos.getX(v);
    const y = pos.getY(v);
    const z = pos.getZ(v);
    start.set([x, y, z], i * 3);
    const out = Math.hypot(x, z) || 1;
    velocity.set(
      [(x / out) * 0.08 * (0.3 + random()), 0.28 + random() * 0.3, (z / out) * 0.08 * random()],
      i * 3,
    );
    // Crown first, as the dissolve passes their height
    delay[i] = (1 - y / Math.max(top, 1e-3)) * 0.5 + random() * 0.1;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(start.slice(), 3));
  return { geometry, start, velocity, delay };
};

const Drift = ({
  motes,
  color,
  lifeMs,
  size,
  delayMs = 0,
}: {
  motes: Motes;
  color: string;
  lifeMs: number;
  size: number;
  delayMs?: number;
}) => {
  const material = useMemo(
    () =>
      new PointsMaterial({
        color: new Color(color),
        map: mote(),
        size,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        opacity: 0,
      }),
    [color, size],
  );
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => motes.geometry.dispose(), [motes]);
  useLife(
    delayMs + lifeMs,
    (ms) => {
      const t = Math.max(ms - delayMs, 0) / lifeMs;
      const p = motes.geometry.getAttribute('position') as BufferAttribute;
      for (let i = 0; i < motes.delay.length; i++) {
        const k = Math.max(t - motes.delay[i] * 0.6, 0) * (lifeMs / 1000);
        p.setXYZ(
          i,
          motes.start[i * 3] + motes.velocity[i * 3] * k,
          motes.start[i * 3 + 1] + motes.velocity[i * 3 + 1] * k,
          motes.start[i * 3 + 2] + motes.velocity[i * 3 + 2] * k,
        );
      }
      p.needsUpdate = true;
      material.opacity = t > 0 ? 0.8 * Math.min(t * 5, 1) * (1 - t) ** 1.3 : 0;
    },
    delayMs,
  );
  return (
    <points
      geometry={motes.geometry}
      material={material}
      renderOrder={LAYER.trace}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

// --- Capture ---------------------------------------------------------------------------

const dissolveVertex = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vLocal = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }`;

const dissolveFragment = /* glsl */ `
  uniform vec3 uBody;
  uniform vec3 uEdge;
  uniform float uTop;
  uniform float uCut;
  varying vec3 vLocal;
  varying vec3 vNormal;
  varying vec3 vView;
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  void main() {
    float v = 0.65 * (1.0 - vLocal.y / uTop) + 0.35 * noise(vLocal * 20.0);
    float edge = v - uCut;
    if (edge < 0.0) discard;
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    vec3 col = uBody * (0.4 + 0.6 * facing);
    col = mix(col, uEdge, pow(1.0 - facing, 2.4) * 0.35);
    // The dissolving edge glows faintly with starlight
    col = mix(col, uEdge, (1.0 - smoothstep(0.0, 0.05, edge)) * 0.8);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const CAPTURE_MS = 900;

/** The captured piece dissolves from the crown down into motes of starlight. */
export const CaptureFx = ({
  floor,
  victim,
  durationMs,
  victimFacing,
  orientation,
}: CaptureFxProps) => {
  const geometry = wholePiece(victim.type);
  const top = useMemo(() => {
    geometry.computeBoundingBox();
    return geometry.boundingBox?.max.y ?? 0.8;
  }, [geometry]);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uBody: { value: new Color(BODY[victim.color]) },
          uEdge: { value: new Color(EDGE[victim.color]) },
          uTop: { value: top },
          uCut: { value: -0.01 },
        },
        vertexShader: dissolveVertex,
        fragmentShader: dissolveFragment,
      }),
    [victim.color, top],
  );
  useEffect(() => () => material.dispose(), [material]);
  const motes = useMemo(() => motesFrom(geometry, 26, 11, top), [geometry, top]);
  const body = useRef<Group>(null);
  // The victim holds while the attacker comes, then dissolves as it arrives
  const start = durationMs * 0.5;
  const alive = useLife(
    start + CAPTURE_MS,
    (ms) => {
      const k = Math.max(ms - start, 0) / (CAPTURE_MS * 0.6);
      material.uniforms.uCut.value = -0.01 + Math.min(k, 1) * 1.05;
      if (body.current) body.current.visible = k < 1;
    },
    durationMs,
  );
  if (!alive) return null;
  const yaw = victimFacing ?? knightYaw(victim.type, victim.color, orientation as PieceColor);
  return (
    <group
      position={floor}
      rotation={[0, victim.type === PieceType.Knight ? yaw : 0, 0]}
      scale={PIECE_SCALE}
    >
      <group ref={body}>
        <mesh geometry={geometry} material={material} raycast={noRaycast} />
      </group>
      <Drift
        motes={motes}
        color={PALETTE.select}
        lifeMs={CAPTURE_MS}
        size={0.045}
        delayMs={start}
      />
    </group>
  );
};

// --- Mate ------------------------------------------------------------------------------

const MATE_MS = 1600;
const matePlane = new PlaneGeometry(6, 6);

const rippleMaterial = (color: string) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uColor: { value: new Color(color) },
      uRadius: { value: 0.3 },
      uOpacity: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        vP = (uv - 0.5) * 6.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uRadius;
      uniform float uOpacity;
      varying vec2 vP;
      void main() {
        float r = length(vP);
        float fw = max(fwidth(r), 1e-4);
        float ring = 1.0 - smoothstep(0.012 - fw, 0.012 + fw, abs(r - uRadius));
        float glow = exp(-pow((r - uRadius) / 0.1, 2.0)) * 0.3;
        // Held within the deck
        float deck = 1.0 - smoothstep(2.3, 2.6, max(abs(vP.x), abs(vP.y)));
        float a = (ring * 0.8 + glow) * uOpacity * deck;
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor * a, a);
        #include <colorspace_fragment>
      }`,
  });

/**
 * Mate: once the king has toppled, one ring of the winner's starlight spreads
 * slowly across his deck and a few motes rise from where he fell.
 */
export const Celebration = ({ floor, winner }: CelebrationProps) => {
  const color = winner ? EDGE[winner] : PALETTE.trace;
  const ripple = useMemo(() => rippleMaterial(color), [color]);
  useEffect(() => () => ripple.dispose(), [ripple]);
  const motes = useMemo(() => {
    const ring = new BufferGeometry();
    const n = 48;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pos.set([Math.cos(a) * 0.32, 0.02, Math.sin(a) * 0.32], i * 3);
    }
    ring.setAttribute('position', new BufferAttribute(pos, 3));
    const m = motesFrom(ring, 22, 3, 1);
    ring.dispose();
    return m;
  }, []);
  // After the topple (900 ms)
  const DELAY = 700;
  const alive = useLife(DELAY + MATE_MS, (ms) => {
    const t = Math.max(ms - DELAY, 0) / MATE_MS;
    const u = ripple.uniforms;
    u.uRadius.value = 0.3 + 2.4 * (1 - (1 - t) ** 2);
    u.uOpacity.value = t > 0 ? Math.min(t * 6, 1) * (1 - t) ** 1.3 : 0;
  });
  if (!alive) return null;
  return (
    <group position={floor}>
      <mesh
        geometry={matePlane}
        material={ripple}
        position={[0, 0.016, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={LAYER.marker}
        raycast={noRaycast}
      />
      <Drift motes={motes} color={color} lifeMs={MATE_MS} size={0.05} delayMs={DELAY} />
    </group>
  );
};
