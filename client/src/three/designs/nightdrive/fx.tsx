import '@fontsource/orbitron/900.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  RingGeometry,
  SRGBColorSpace,
  ShaderMaterial,
  SpriteMaterial,
  TetrahedronGeometry,
} from 'three';
import type { Group, Mesh, PerspectiveCamera, Sprite } from 'three';
import { easeInOutCubic } from '../../motion';
import { Shards } from '../kit/fx';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import { dotTexture } from '../kit/textures';
import type { CaptureFxProps, CelebrationProps, MoveFxProps, PieceColor, Vec3 } from '../types';
import { PieceType } from '../../../engine/pieces';
import { MOTION } from './motion';
import { CHECK, INK_RIM, PIECE_SCALE, frame, layout, levelAt } from './palette';
import { PieceWithBand } from './pieces';

// The moments of motion. A move is a quick hop that leaves a light trail
// along its arc (pearl or pink, the mover's neon), and lands with a ring of
// light racing out across the glass. A capture: the victim glitches as the
// attacker comes in, then shatters into a handful of neon shards, with a red
// ring and a small jolt. Mate: the king topples and a neon CHECKMATE sign
// flickers on once above the tower, then holds. All timed on r3f's clock.

const MAX_FRAME = 1 / 30;
/** Each army's neon, for its trails, rings and shards. */
export const NEON: Record<PieceColor, string> = { white: '#e6f4ff', black: INK_RIM };

/**
 * Seconds since mount on the frame clock; `done` once `endMs` have passed.
 * Effects hide themselves on the frame clock too (unmounting waits for a
 * React commit, which a frame-stepped recording may not give them in time).
 */
const useLife = (endMs: number) => {
  const t = useRef(0);
  const [done, setDone] = useState(false);
  const invalidate = useThree((s) => s.invalidate);
  useFrame((_, delta) => {
    if (done) return;
    t.current += Math.min(delta, MAX_FRAME);
    if (t.current * 1000 >= endMs) setDone(true);
    else invalidate();
  });
  return { t, done };
};

// --- The light trail ----------------------------------------------------------------------

const trailVertex = /* glsl */ `
  attribute vec3 aTangent;
  attribute float aSide;
  attribute float aAlong;
  uniform float uWidth;
  uniform float uHead;
  uniform float uTail;
  varying float vK;
  varying float vAcross;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 t = normalize(aTangent);
    vec3 toCamera = normalize(cameraPosition - world.xyz);
    vec3 across = cross(t, toCamera);
    float l = length(across);
    across = l > 1e-4 ? across / l : vec3(1.0, 0.0, 0.0);
    // 0 at the tail, 1 at the head; outside the lit span the ribbon collapses
    float span = max(uHead - uTail, 1e-4);
    vK = (aAlong - uTail) / span;
    float lit = step(uTail, aAlong) * step(aAlong, uHead);
    float w = uWidth * (0.25 + 0.75 * clamp(vK, 0.0, 1.0)) * lit;
    world.xyz += across * aSide * w * 0.5;
    vAcross = aSide;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const trailFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vK;
  varying float vAcross;
  void main() {
    float k = clamp(vK, 0.0, 1.0);
    float edge = 1.0 - abs(vAcross);
    float a = pow(k, 1.4) * smoothstep(0.0, 0.6, edge) * uOpacity;
    if (a < 0.003) discard;
    // A white-hot core down the middle
    vec3 col = mix(uColor, vec3(1.0), smoothstep(0.55, 1.0, edge) * 0.6);
    gl_FragColor = vec4(col, a);
  }`;

/** Where the hop puts the piece's waist at spatial progress `s` (0 at the source). */
const hopPoint = (from: Vec3, to: Vec3, lift: number, s: number, waist: number): Vec3 => [
  from[0] + (to[0] - from[0]) * s,
  from[1] + (to[1] - from[1]) * s + lift * 4 * s * (1 - s) + waist,
  from[2] + (to[2] - from[2]) * s,
];

/** A camera-facing ribbon along the whole hop; uniforms light the span behind the piece. */
const trailGeometry = (from: Vec3, to: Vec3, lift: number, waist: number) => {
  const n = 40;
  const pts = Array.from({ length: n + 1 }, (_, i) => hopPoint(from, to, lift, i / n, waist));
  const position = new Float32Array((n + 1) * 2 * 3);
  const tangent = new Float32Array((n + 1) * 2 * 3);
  const side = new Float32Array((n + 1) * 2);
  const along = new Float32Array((n + 1) * 2);
  pts.forEach((p, i) => {
    const a = pts[Math.max(i - 1, 0)];
    const b = pts[Math.min(i + 1, n)];
    const t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    for (let s = 0; s < 2; s++) {
      const v = i * 2 + s;
      position.set(p, v * 3);
      tangent.set(t, v * 3);
      side[v] = s === 0 ? -1 : 1;
      along[v] = i / n;
    }
  });
  const index: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(position, 3));
  g.setAttribute('aTangent', new BufferAttribute(tangent, 3));
  g.setAttribute('aSide', new BufferAttribute(side, 1));
  g.setAttribute('aAlong', new BufferAttribute(along, 1));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
};

const LightTrail = ({
  from,
  to,
  color,
  durationMs,
}: {
  from: Vec3;
  to: Vec3;
  color: string;
  durationMs: number;
}) => {
  const floorY = layout.floorY;
  const geometry = useMemo(
    () =>
      trailGeometry(
        [from[0], from[1] + floorY, from[2]],
        [to[0], to[1] + floorY, to[2]],
        MOTION.lift,
        0.3,
      ),
    [from, to, floorY],
  );
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        uniforms: {
          uColor: { value: new Color(color) },
          uOpacity: { value: 1 },
          uWidth: { value: 0.22 },
          uHead: { value: 0 },
          uTail: { value: 0 },
        },
        vertexShader: trailVertex,
        fragmentShader: trailFragment,
      }),
    [color],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  const life = durationMs * 1.8;
  const { t, done } = useLife(life);
  useFrame(() => {
    const ms = t.current * 1000;
    const k = Math.min(ms / durationMs, 1);
    const u = material.uniforms;
    u.uHead.value = easeInOutCubic(k);
    // The tail chases the head and drains into the destination after landing
    u.uTail.value = easeInOutCubic(
      Math.min(Math.max((ms - durationMs * 0.3) / (life * 0.7), 0), 1),
    );
    u.uOpacity.value = 1 - Math.max(0, (ms - durationMs) / (life - durationMs)) ** 2;
  });
  if (done) return null;
  return (
    <mesh
      geometry={geometry}
      material={material}
      renderOrder={LAYER.trace}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

// --- Rings and flashes ------------------------------------------------------------------

const ringGeometry = new RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2);

/** A thin ring of light racing out across the platform. */
const Shockwave = ({
  floor,
  color,
  radius,
  lifeMs,
  delayMs = 0,
}: {
  floor: Vec3;
  color: string;
  radius: number;
  lifeMs: number;
  delayMs?: number;
}) => {
  const mesh = useRef<Mesh>(null);
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        color,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
        side: DoubleSide,
      }),
    [color],
  );
  useEffect(() => () => material.dispose(), [material]);
  const { t, done } = useLife(delayMs + lifeMs);
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const local = t.current * 1000 - delayMs;
    const k = Math.min(Math.max(local / lifeMs, 0), 1);
    m.visible = local >= 0 && k < 1;
    const e = 1 - (1 - k) ** 3;
    m.scale.setScalar(0.2 + e * radius);
    material.opacity = 0.9 * (1 - k) ** 1.6;
  });
  if (done) return null;
  return (
    <mesh
      ref={mesh}
      geometry={ringGeometry}
      material={material}
      position={[floor[0], floor[1] + 0.02, floor[2]]}
      renderOrder={LAYER.trace}
      raycast={noRaycast}
      visible={false}
    />
  );
};

const flashMap = dotTexture(0.8);

/** A brief flare of light that swells and dies. */
const Flash = ({
  at,
  color,
  size,
  lifeMs,
  delayMs = 0,
}: {
  at: Vec3;
  color: string;
  size: number;
  lifeMs: number;
  delayMs?: number;
}) => {
  const sprite = useRef<Sprite>(null);
  const material = useMemo(
    () =>
      new SpriteMaterial({
        map: flashMap,
        color,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    [color],
  );
  useEffect(() => () => material.dispose(), [material]);
  const { t, done } = useLife(delayMs + lifeMs);
  useFrame(() => {
    const s = sprite.current;
    if (!s) return;
    const local = t.current * 1000 - delayMs;
    const k = Math.min(Math.max(local / lifeMs, 0), 1);
    s.visible = local >= 0 && k < 1;
    s.scale.setScalar(size * (0.4 + 0.6 * Math.sqrt(k)));
    material.opacity = 0.8 * (1 - k) ** 2;
  });
  if (done) return null;
  return (
    <sprite ref={sprite} position={at} material={material} raycast={noRaycast} visible={false} />
  );
};

// --- Moves ---------------------------------------------------------------------------------

export const MoveFx = ({ from, to, color, durationMs }: MoveFxProps) => {
  const floor: Vec3 = [to[0], to[1] + layout.floorY, to[2]];
  return (
    <>
      <LightTrail from={from} to={to} color={NEON[color]} durationMs={durationMs} />
      <Shockwave
        floor={floor}
        color={NEON[color]}
        radius={0.55}
        lifeMs={380}
        delayMs={durationMs * 0.92}
      />
    </>
  );
};

// --- Captures ----------------------------------------------------------------------------

/** The victim, glitching harder as the attacker comes in; gone at the hit. */
const Victim = ({
  floor,
  type,
  color,
  facing,
  hitMs,
}: {
  floor: Vec3;
  type: PieceType;
  color: PieceColor;
  /** The yaw Board gives a knight of this colour. */
  facing: number | undefined;
  hitMs: number;
}) => {
  const group = useRef<Group>(null);
  const { t, done } = useLife(hitMs);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const s = t.current;
    const k = (s * 1000) / hitMs;
    // Drops out for a frame here and there, more often near the hit; gone at it
    g.visible = k < 1 && (k < 0.35 || Math.sin(s * 83) > (k > 0.7 ? 0.1 : -0.55));
    g.position.x = k > 0.5 ? Math.sin(s * 131) * 0.03 : 0;
    g.scale.set(1 + k * 0.06, 1 - k * 0.04, 1 + k * 0.06);
  });
  if (done) return null;
  const yaw = type === PieceType.Knight ? (facing ?? 0) : 0;
  return (
    <group position={floor}>
      <group ref={group}>
        <group scale={PIECE_SCALE} rotation={[0, yaw, 0]}>
          <PieceWithBand type={type} color={color} level={levelAt(floor[1])} />
        </group>
      </group>
    </group>
  );
};

const shardGeometry = new TetrahedronGeometry(0.075).scale(1, 0.35, 1.6);
const shardMaterial = new MeshBasicMaterial({ color: '#ffffff', toneMapped: false });

export const CaptureFx = ({ floor, victim, victimFacing, durationMs }: CaptureFxProps) => {
  const hit = durationMs * 0.9;
  const waist: Vec3 = [floor[0], floor[1] + 0.3, floor[2]];
  const neon = NEON[victim.color];
  const body = victim.color === 'white' ? '#f7f5fb' : '#2a1b4d';
  return (
    <>
      <Victim
        floor={floor}
        type={victim.type}
        color={victim.color}
        facing={victimFacing}
        hitMs={hit}
      />
      <Shards
        position={[floor[0], floor[1] + 0.12, floor[2]]}
        geometry={shardGeometry}
        material={shardMaterial}
        colors={[neon, neon, body, '#ffffff']}
        count={16}
        speed={2.6}
        gravity={5}
        upward={0.55}
        spread={0.3}
        spin={10}
        lifeMs={620}
        delayMs={hit}
      />
      <Flash at={waist} color={CHECK} size={1.3} lifeMs={220} delayMs={hit} />
      <Shockwave floor={floor} color={CHECK} radius={0.9} lifeMs={460} delayMs={hit} />
      <Jolt intensity={3.5} durationMs={220} delayMs={hit} />
    </>
  );
};

/**
 * A small jolt of the view at the moment of impact: shifts the projection
 * (a view offset), so the orbit controls never see a moved camera.
 */
const Jolt = ({
  intensity,
  durationMs,
  delayMs,
}: {
  intensity: number;
  durationMs: number;
  delayMs: number;
}) => {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const t = useRef(0);
  const finished = useRef(false);
  useEffect(() => () => camera.clearViewOffset(), [camera]);
  useFrame((_, delta) => {
    if (finished.current) return;
    t.current += Math.min(delta, MAX_FRAME) * 1000;
    const local = t.current - delayMs;
    invalidate();
    if (local < 0) return;
    const k = local / durationMs;
    if (k >= 1) {
      finished.current = true;
      camera.clearViewOffset();
      return;
    }
    const amp = intensity * (1 - k) ** 2;
    const s = local / 1000;
    camera.setViewOffset(
      size.width,
      size.height,
      Math.sin(s * 91) * amp,
      Math.cos(s * 73) * amp,
      size.width,
      size.height,
    );
  });
  return null;
};

// --- Mate --------------------------------------------------------------------------------

/** The sign's face: neon tubes spelling CHECKMATE, pink on a hot white core. */
const drawSign = () => {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.font = 'italic 900 118px "Orbitron", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const x = 512;
  const y = 132;
  const w = ctx.measureText('CHECKMATE').width;
  const squeeze = Math.min(1, 900 / w);
  ctx.translate(x, y);
  ctx.scale(squeeze, 1);
  ctx.translate(-x, -y);
  ctx.lineJoin = 'round';
  // A dark backing so the tubes read over anything, then the glow, the tube, the core
  ctx.lineWidth = 26;
  ctx.strokeStyle = 'rgba(14, 4, 30, 0.85)';
  ctx.strokeText('CHECKMATE', x, y);
  ctx.shadowColor = INK_RIM;
  ctx.shadowBlur = 34;
  ctx.lineWidth = 10;
  ctx.strokeStyle = INK_RIM;
  ctx.strokeText('CHECKMATE', x, y);
  ctx.shadowBlur = 12;
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#fbe6ff';
  ctx.strokeText('CHECKMATE', x, y);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(40, 6, 40, 0.55)';
  ctx.fillText('CHECKMATE', x, y);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
};

/** Flickers on like a neon tube warming up, once, then holds steady. */
const flicker = (s: number) => {
  if (s < 0) return 0;
  if (s > 0.62) return 1;
  // on, off, on, off-ish, on
  const beats = [0.06, 0.12, 0.2, 0.26, 0.38, 0.44];
  let lit = 1;
  for (const b of beats) if (s >= b) lit = 1 - lit;
  return lit === 1 ? 1 : 0.12;
};

const Sign = ({ at, width, delayMs }: { at: Vec3; width: number; delayMs: number }) => {
  const sprite = useRef<Sprite>(null);
  const [fontReady, setFontReady] = useState(false);
  useEffect(() => {
    let live = true;
    const done = () => live && setFontReady(true);
    document.fonts.load('italic 900 64px "Orbitron"').then(done, done);
    return () => {
      live = false;
    };
  }, []);
  const material = useMemo(
    () =>
      fontReady
        ? new SpriteMaterial({
            map: drawSign(),
            transparent: true,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
          })
        : null,
    [fontReady],
  );
  useEffect(
    () => () => {
      material?.map?.dispose();
      material?.dispose();
    },
    [material],
  );
  const t = useRef(-delayMs / 1000);
  const invalidate = useThree((s) => s.invalidate);
  useFrame((_, delta) => {
    const s = sprite.current;
    if (!s || !material) return;
    t.current += Math.min(delta, MAX_FRAME);
    material.opacity = flicker(t.current);
    s.visible = material.opacity > 0;
    s.scale.set(width, width / 4, 1);
    if (t.current < 0.7) invalidate();
  });
  if (!material) return null;
  return (
    <sprite
      ref={sprite}
      position={at}
      material={material}
      raycast={noRaycast}
      renderOrder={LAYER.label + 10}
      visible={false}
    />
  );
};

const TOP = frame.levelY[4];

export const Celebration = ({ floor, winner }: CelebrationProps) => (
  <>
    <Shockwave floor={floor} color={CHECK} radius={1.4} lifeMs={900} />
    <Shockwave
      floor={floor}
      color={winner ? NEON[winner] : CHECK}
      radius={2.2}
      lifeMs={1100}
      delayMs={180}
    />
    <Sign at={[0, TOP + 1.25, 0]} width={3.6} delayMs={450} />
  </>
);
