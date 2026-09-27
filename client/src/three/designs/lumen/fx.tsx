import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  PlaneGeometry,
  PointsMaterial,
  ShaderMaterial,
} from 'three';
import type { Group, Mesh } from 'three';
import { PieceType } from '../../../engine/pieces';
import { easeInOutCubic } from '../../motion';
import { movePoint } from '../../movePath';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import { dotTexture, rng } from '../kit/textures';
import type { CaptureFxProps, CelebrationProps, MoveFxProps, PieceColor, Vec3 } from '../types';
import { KNIGHT_YAW, layout, PALETTE, PIECE_SCALE } from './palette';
import { wholePiece } from './pieces';

// Motion in light. A moving piece trails a brief echo of itself, a few
// fading after-images of its silhouette along the straight path, and lands
// with a ripple of light on the pane. A captured piece dissolves from the
// crown down into drifting light fragments. At mate, a ring of the winner's
// light sweeps out across the mated king's pane and fragments rise.

const RIM: Record<PieceColor, string> = { white: PALETTE.whiteRim, black: PALETTE.blackRim };
const BODY: Record<PieceColor, string> = { white: PALETTE.white, black: PALETTE.black };

/** The yaw Board gives a knight of this colour (see knightFacing in Board.tsx). */
const knightYaw = (piece: PieceType, color: PieceColor, orientation: PieceColor) =>
  piece === PieceType.Knight ? (color === orientation ? 1 : -1) * (Math.PI / 2 - KNIGHT_YAW) : 0;

/** Advances a one-shot effect on r3f's clock; returns false once it has run its course. */
const useLife = (lifeMs: number, step: (ms: number) => void) => {
  const invalidate = useThree((s) => s.invalidate);
  const elapsed = useRef(0);
  const [alive, setAlive] = useState(true);
  useEffect(() => invalidate(), [invalidate]);
  useFrame((_, delta) => {
    if (!alive) return;
    elapsed.current += Math.min(delta, 1 / 20) * 1000;
    if (elapsed.current >= lifeMs) {
      setAlive(false);
      return;
    }
    step(elapsed.current);
    invalidate();
  });
  return alive;
};

// --- Echoes -------------------------------------------------------------------------------

const echoVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }`;

const echoFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    float a = (0.12 + 0.88 * pow(1.0 - facing, 1.8)) * uOpacity;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <colorspace_fragment>
  }`;

const echoMaterial = (color: string) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uColor: { value: new Color(color) }, uOpacity: { value: 0 } },
    vertexShader: echoVertex,
    fragmentShader: echoFragment,
  });

// A flat ring of light on the pane, grown and faded by its uniforms
const rippleFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uRadius;
  uniform float uOpacity;
  uniform float uWidth;
  varying vec2 vP;
  void main() {
    float d = abs(length(vP) - uRadius);
    float a = exp(-d * d / (uWidth * uWidth)) * uOpacity;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <colorspace_fragment>
  }`;

const rippleVertex = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const ripplePlane = new PlaneGeometry(3, 3);
const matePlane = new PlaneGeometry(7, 7);
const rippleMaterial = (color: string, width: number) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    uniforms: {
      uColor: { value: new Color(color) },
      uRadius: { value: 0 },
      uOpacity: { value: 0 },
      uWidth: { value: width },
    },
    vertexShader: rippleVertex,
    fragmentShader: rippleFragment,
  });

const ECHOES = [0.07, 0.14, 0.22];
const RIPPLE_MS = 380;

export const MoveFx = ({
  from,
  to,
  color,
  piece,
  durationMs,
  arc = 0,
  orientation,
}: MoveFxProps) => {
  const floorY = layout.floorY;
  const echoes = useRef<(Mesh | null)[]>([]);
  const ripple = useRef<Mesh>(null);
  const mats = useMemo(
    () => ({
      echo: ECHOES.map(() => echoMaterial(RIM[color])),
      ripple: rippleMaterial(PALETTE.trace, 0.05),
    }),
    [color],
  );
  useEffect(
    () => () => {
      mats.echo.forEach((m) => m.dispose());
      mats.ripple.dispose();
    },
    [mats],
  );
  const alive = useLife(durationMs + RIPPLE_MS + 40, (ms) => {
    const t = ms / durationMs;
    ECHOES.forEach((lag, k) => {
      const mesh = echoes.current[k];
      if (!mesh) return;
      const s = Math.min(Math.max(t - lag, 0), 1);
      const [x, y, z] = movePoint(from, to, easeInOutCubic(s), arc);
      mesh.position.set(x, y + floorY, z);
      // Bright while the piece is travelling, gone as it lands
      const travel = Math.sin(Math.PI * Math.min(t, 1));
      mats.echo[k].uniforms.uOpacity.value =
        t - lag > 0 ? 0.42 * (1 - k / ECHOES.length) * travel : 0;
    });
    const r = (ms - durationMs * 0.92) / RIPPLE_MS;
    const u = mats.ripple.uniforms;
    if (r > 0 && r < 1) {
      u.uRadius.value = 0.3 + 0.5 * (1 - (1 - r) ** 2);
      u.uOpacity.value = 0.8 * (1 - r) ** 1.5;
    } else u.uOpacity.value = 0;
  });
  if (!alive) return null;
  const yaw = knightYaw(piece, color, orientation);
  const geometry = wholePiece(piece);
  return (
    <>
      {ECHOES.map((_, k) => (
        <group key={k}>
          <mesh
            ref={(m) => {
              echoes.current[k] = m;
            }}
            geometry={geometry}
            material={mats.echo[k]}
            position={[from[0], from[1] + floorY, from[2]]}
            rotation={[0, yaw, 0]}
            scale={PIECE_SCALE}
            renderOrder={LAYER.trace}
            raycast={noRaycast}
          />
        </group>
      ))}
      <mesh
        ref={ripple}
        geometry={ripplePlane}
        material={mats.ripple}
        position={[to[0], to[1] + floorY + 0.015, to[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={LAYER.marker}
        raycast={noRaycast}
      />
    </>
  );
};

// --- Light fragments ------------------------------------------------------------------------

const spark = (() => {
  let t: ReturnType<typeof dotTexture> | null = null;
  return () => (t ??= dotTexture(0.7, 32));
})();

interface Fragments {
  geometry: BufferGeometry;
  start: Float32Array;
  velocity: Float32Array;
  delay: Float32Array;
}

/** Points sampled from a piece's surface (piece units), each with a drift and a start delay. */
const fragmentsOf = (
  source: BufferGeometry,
  count: number,
  seed: number,
  spread: number,
  top: number,
): Fragments => {
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
      [
        (x / out) * spread * (0.4 + random()),
        0.35 + random() * 0.55,
        (z / out) * spread * (0.4 + random()),
      ],
      i * 3,
    );
    // Crown first: fragments leave as the dissolve passes their height
    delay[i] = (1 - y / top) * 0.55 + random() * 0.1;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(start.slice(), 3));
  return { geometry, start, velocity, delay };
};

const Drift = ({
  fragments,
  color,
  lifeMs,
  size,
  delayMs = 0,
}: {
  fragments: Fragments;
  color: string;
  lifeMs: number;
  size: number;
  /** Wait this long before the fragments start to leave. */
  delayMs?: number;
}) => {
  const material = useMemo(
    () =>
      new PointsMaterial({
        color: new Color(color),
        map: spark(),
        size,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        opacity: 0,
      }),
    [color, size],
  );
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => fragments.geometry.dispose(), [fragments]);
  useLife(delayMs + lifeMs, (ms) => {
    const t = Math.max(ms - delayMs, 0) / lifeMs;
    const p = fragments.geometry.getAttribute('position') as BufferAttribute;
    const n = fragments.delay.length;
    for (let i = 0; i < n; i++) {
      const s = Math.max(t - fragments.delay[i] * 0.6, 0);
      const k = s * (lifeMs / 1000);
      p.setXYZ(
        i,
        fragments.start[i * 3] + fragments.velocity[i * 3] * k,
        fragments.start[i * 3 + 1] + fragments.velocity[i * 3 + 1] * k,
        fragments.start[i * 3 + 2] + fragments.velocity[i * 3 + 2] * k,
      );
    }
    p.needsUpdate = true;
    material.opacity = t > 0 ? 0.9 * Math.min(t * 6, 1) * (1 - t) ** 1.2 : 0;
  });
  return (
    <points
      geometry={fragments.geometry}
      material={material}
      renderOrder={LAYER.trace}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

// --- Capture: the victim dissolves --------------------------------------------------------------

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
  uniform vec3 uRim;
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
    // Crown first, broken up by noise
    float v = 0.62 * (1.0 - vLocal.y / uTop) + 0.38 * noise(vLocal * 22.0);
    float edge = v - uCut;
    if (edge < 0.0) discard;
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    vec3 col = uBody * (0.35 + 0.65 * facing);
    col = mix(col, uRim, pow(1.0 - facing, 2.2) * 0.8);
    // The dissolving edge burns with the army's light
    col = mix(col, uRim * 1.6, 1.0 - smoothstep(0.0, 0.06, edge));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const CAPTURE_MS = 900;

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
          uRim: { value: new Color(RIM[victim.color]) },
          uTop: { value: top },
          uCut: { value: -0.01 },
        },
        vertexShader: dissolveVertex,
        fragmentShader: dissolveFragment,
      }),
    [victim.color, top],
  );
  useEffect(() => () => material.dispose(), [material]);
  const fragments = useMemo(() => fragmentsOf(geometry, 46, 7, 0.35, top), [geometry, top]);
  const body = useRef<Group>(null);
  // The attacker is on its way: the victim holds, then dissolves as it arrives
  const start = durationMs * 0.45;
  const alive = useLife(start + CAPTURE_MS, (ms) => {
    const k = Math.max(ms - start, 0) / (CAPTURE_MS * 0.6);
    material.uniforms.uCut.value = -0.01 + Math.min(k, 1) * 1.05;
    if (body.current) body.current.visible = k < 1;
  });
  if (!alive) return null;
  const yaw = victimFacing ?? knightYaw(victim.type, victim.color, orientation as PieceColor);
  const at: Vec3 = [floor[0], floor[1], floor[2]];
  return (
    <group
      position={at}
      rotation={[0, victim.type === PieceType.Knight ? yaw : 0, 0]}
      scale={PIECE_SCALE}
    >
      <group ref={body}>
        <mesh geometry={geometry} material={material} raycast={noRaycast} />
      </group>
      <Drift
        fragments={fragments}
        color={RIM[victim.color]}
        lifeMs={CAPTURE_MS}
        size={0.06}
        delayMs={start}
      />
    </group>
  );
};

// --- Mate ---------------------------------------------------------------------------------------

const MATE_MS = 1300;

export const Celebration = ({ floor, winner }: CelebrationProps) => {
  const color = winner ? RIM[winner] : PALETTE.trace;
  const material = useMemo(() => rippleMaterial(color, 0.08), [color]);
  useEffect(() => () => material.dispose(), [material]);
  const fragments = useMemo(() => {
    const ring = new BufferGeometry();
    const n = 64;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pos.set([Math.cos(a) * 0.4, 0.02, Math.sin(a) * 0.4], i * 3);
    }
    ring.setAttribute('position', new BufferAttribute(pos, 3));
    return fragmentsOf(ring, 40, 3, 0.25, 1);
  }, []);
  const alive = useLife(MATE_MS, (ms) => {
    const t = ms / MATE_MS;
    material.uniforms.uRadius.value = 0.4 + 2.6 * (1 - (1 - t) ** 2);
    material.uniforms.uOpacity.value = 0.9 * (1 - t) ** 1.4;
  });
  if (!alive) return null;
  return (
    <group position={floor}>
      <mesh
        geometry={matePlane}
        material={material}
        position={[0, 0.016, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={LAYER.marker}
        raycast={noRaycast}
      />
      <Drift fragments={fragments} color={color} lifeMs={MATE_MS} size={0.07} />
    </group>
  );
};
