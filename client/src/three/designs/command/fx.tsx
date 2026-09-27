import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  ShaderMaterial,
} from 'three';
import type { Group, Mesh } from 'three';
import { PieceType } from '../../../engine/pieces';
import { Shards } from '../kit/fx';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import type { CaptureFxProps, CelebrationProps, MoveFxProps, PieceColor, Vec3 } from '../types';
import { CommandParts } from './pieces';
import { movePoint } from '../../movePath';
import { layout, PALETTE, PIECE_SCALE } from './shared';

// Moments of motion, all on r3f's clock so a frame-stepped recording plays
// them exactly: a move lifts off in a ring of its army's light, leaves a
// streak along its hop and lands with a bracket lock and a ripple; a captured
// piece de-rezzes into a short burst of voxels; a mate sends one red alert
// pulse across its level. Every beat is timed inside the frame loop (never by
// mounting children later), so each effect is over within about 0.75 s of the
// move, and a frame-stepped capture never catches a stale one.

const MAX_FRAME = 1 / 30;

export const RIM: Record<PieceColor, string> = { white: PALETTE.whiteRim, black: PALETTE.blackRim };
const BODY: Record<PieceColor, string> = { white: PALETTE.white, black: PALETTE.black };

/**
 * Milliseconds since mount on the frame clock; keeps frames coming until
 * `totalMs`, then unmounts the effect (by then it has faded out).
 */
const useClock = (totalMs: number) => {
  const ms = useRef(0);
  const [done, setDone] = useState(false);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => invalidate(), [invalidate]);
  useFrame((_, delta) => {
    if (done) return;
    ms.current += Math.min(delta, MAX_FRAME) * 1000;
    if (ms.current >= totalMs) setDone(true);
    else invalidate();
  });
  return { ms, done };
};

/** Progress through a beat that starts at `delayMs` and lasts `lifeMs`: <0 before, >1 after. */
const beat = (ms: number, delayMs: number, lifeMs: number) => (ms - delayMs) / lifeMs;

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1);

const floorOf = (centre: Vec3): Vec3 => [centre[0], centre[1] + layout.floorY, centre[2]];

// --- The streak a moving piece leaves -------------------------------------------------

const TRAIL_SAMPLES = 48;

const trailVertex = /* glsl */ `
  attribute vec3 aTangent;
  attribute float aSide;
  attribute float aS;
  uniform float uWidth;
  uniform float uHead;
  uniform float uTail;
  varying float vS;
  varying float vAcross;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 t = normalize(mat3(modelMatrix) * aTangent);
    vec3 toCamera = normalize(cameraPosition - world.xyz);
    vec3 across = cross(t, toCamera);
    float l = length(across);
    across = l > 1e-4 ? across / l : vec3(1.0, 0.0, 0.0);
    // Tapers from the head back to a point
    float k = clamp((aS - (uHead - uTail)) / max(uTail, 1e-3), 0.0, 1.0);
    world.xyz += across * aSide * uWidth * 0.5 * k;
    vS = aS;
    vAcross = aSide;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const trailFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uHead;
  uniform float uTail;
  uniform float uFade;
  varying float vS;
  varying float vAcross;
  void main() {
    if (vS > uHead) discard;
    float k = clamp((vS - (uHead - uTail)) / max(uTail, 1e-3), 0.0, 1.0);
    float core = 1.0 - abs(vAcross);
    float a = k * k * (0.35 + 0.65 * core) * uFade;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * (1.0 + core * 0.6), a);
    #include <colorspace_fragment>
  }`;

const TRAIL_FADE_MS = 220;

/** A tapering streak of light that follows a moving piece along its path, then fades. */
const MoveTrail = ({
  from,
  to,
  color,
  durationMs,
  arc,
  height,
  width,
}: {
  from: Vec3;
  to: Vec3;
  color: string;
  durationMs: number;
  /** The move's arc (MoveFxProps.arc). */
  arc: number;
  height: number;
  width: number;
}) => {
  const { ms, done } = useClock(durationMs + TRAIL_FADE_MS);
  const key = JSON.stringify([from, to, arc, height]);
  const geometry = useMemo(() => {
    const pos: number[] = [];
    const tan: number[] = [];
    const side: number[] = [];
    const s: number[] = [];
    // The same path MoveGlide takes, raised to the piece's middle
    const at = (e: number): Vec3 => {
      const [x, y, z] = movePoint(from, to, e, arc);
      return [x, y + height, z];
    };
    for (let i = 0; i <= TRAIL_SAMPLES; i++) {
      const e = i / TRAIL_SAMPLES;
      const p = at(e);
      const a = at(Math.max(e - 0.01, 0));
      const b = at(Math.min(e + 0.01, 1));
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      for (const sd of [-1, 1]) {
        pos.push(...p);
        tan.push(...d);
        side.push(sd);
        s.push(e);
      }
    }
    const index: number[] = [];
    for (let i = 0; i < TRAIL_SAMPLES; i++) {
      const v = i * 2;
      index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('aTangent', new BufferAttribute(new Float32Array(tan), 3));
    g.setAttribute('aSide', new BufferAttribute(new Float32Array(side), 1));
    g.setAttribute('aS', new BufferAttribute(new Float32Array(s), 1));
    g.setIndex(index);
    g.computeBoundingSphere();
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the values themselves
  }, [key]);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        uniforms: {
          uColor: { value: new Color(color).multiplyScalar(1.3) },
          uWidth: { value: width },
          uHead: { value: 0 },
          uTail: { value: 0.55 },
          uFade: { value: 1 },
        },
        vertexShader: trailVertex,
        fragmentShader: trailFragment,
      }),
    [color, width],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useFrame(() => {
    const k = clamp01(ms.current / durationMs);
    const after = clamp01((ms.current - durationMs) / TRAIL_FADE_MS);
    material.uniforms.uHead.value = easeInOutCubic(k);
    // The tail catches up with the head as the piece lands
    material.uniforms.uTail.value = 0.55 * (1 - after);
    material.uniforms.uFade.value = 1 - after;
  });
  if (done) return null;
  return (
    <mesh
      geometry={geometry}
      material={material}
      renderOrder={LAYER.trace + 0.5}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

// --- Brackets snapping onto a square ---------------------------------------------------

const lockVertex = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const lockFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uTeeth;
  varying vec2 vP;
  float roundBox(vec2 p, float b, float r) {
    vec2 q = abs(p) - vec2(b - r);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  void main() {
    vec2 q = abs(vP);
    float stroke = abs(roundBox(vP, 0.42, 0.05)) - 0.03;
    stroke = max(stroke, 0.24 - min(q.x, q.y));
    if (uTeeth > 0.5) {
      float tooth = max(min(q.x, q.y) - 0.03, max(q.x, q.y) - 0.42);
      tooth = max(tooth, 0.26 - max(q.x, q.y));
      stroke = min(stroke, tooth);
    }
    float aa = max(fwidth(stroke), 1e-4);
    float a = (1.0 - smoothstep(-aa, aa, stroke)) * uAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }`;

const lockPlane = new PlaneGeometry(1, 1);

/** Target brackets closing in on a square from wide, then fading: a lock. */
const BracketLock = ({
  floor,
  color,
  delayMs,
  lifeMs,
  teeth = false,
  from = 1.7,
}: {
  floor: Vec3;
  color: string;
  delayMs: number;
  lifeMs: number;
  teeth?: boolean;
  from?: number;
}) => {
  const group = useRef<Group>(null);
  const { ms, done } = useClock(delayMs + lifeMs);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        uniforms: {
          uColor: { value: new Color(color).multiplyScalar(1.2) },
          uAlpha: { value: 0 },
          uTeeth: { value: teeth ? 1 : 0 },
        },
        vertexShader: lockVertex,
        fragmentShader: lockFragment,
      }),
    [color, teeth],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame(() => {
    const k = beat(ms.current, delayMs, lifeMs);
    const on = k >= 0 && k < 1;
    const close = easeOut(clamp01(k / 0.45));
    group.current?.scale.setScalar(from + (1 - from) * close);
    material.uniforms.uAlpha.value = on
      ? Math.min(k / 0.12, 1) * (k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45)
      : 0;
  });
  if (done) return null;
  return (
    <group ref={group} position={[floor[0], floor[1] + 0.02, floor[2]]} scale={from}>
      <mesh
        geometry={lockPlane}
        material={material}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={LAYER.marker}
        raycast={noRaycast}
      />
    </group>
  );
};

// --- A ripple across the glass ----------------------------------------------------------

/** A flat ring of light racing outward over a platform and fading. */
const Ripple = ({
  position,
  color,
  radius,
  delayMs = 0,
  lifeMs,
  width = 0.06,
  strength = 1,
}: {
  position: Vec3;
  color: string;
  radius: number;
  delayMs?: number;
  lifeMs: number;
  width?: number;
  strength?: number;
}) => {
  const mesh = useRef<Mesh>(null);
  const { ms, done } = useClock(delayMs + lifeMs);
  const geometry = useMemo(() => new RingGeometry(1 - width, 1, 72), [width]);
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        color: new Color(color).multiplyScalar(strength),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
        side: DoubleSide,
      }),
    [color, strength],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useFrame(() => {
    const k = beat(ms.current, delayMs, lifeMs);
    mesh.current?.scale.setScalar(0.2 + easeOut(clamp01(k)) * radius);
    material.opacity = k >= 0 && k < 1 ? (1 - k) ** 1.5 : 0;
  });
  if (done) return null;
  return (
    <mesh
      ref={mesh}
      position={[position[0], position[1] + 0.02, position[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
      scale={0.2}
      geometry={geometry}
      material={material}
      renderOrder={LAYER.marker}
      raycast={noRaycast}
    />
  );
};

// --- A ring of light lifting off the square a piece leaves ---------------------------------

const liftRing = new RingGeometry(0.3, 0.34, 48);

const LiftOff = ({ floor, color, lifeMs }: { floor: Vec3; color: string; lifeMs: number }) => {
  const mesh = useRef<Mesh>(null);
  const { ms, done } = useClock(lifeMs);
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
        side: DoubleSide,
      }),
    [color],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame(() => {
    const k = clamp01(ms.current / lifeMs);
    const m = mesh.current;
    if (m) {
      m.position.y = floor[1] + 0.02 + easeOut(k) * 0.55;
      m.scale.setScalar(1 - 0.45 * k);
    }
    material.opacity = (1 - k) * 0.9;
  });
  if (done) return null;
  return (
    <mesh
      ref={mesh}
      position={[floor[0], floor[1] + 0.02, floor[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
      geometry={liftRing}
      material={material}
      renderOrder={LAYER.marker}
      raycast={noRaycast}
    />
  );
};

/** Plays alongside a move's glide: lift-off, a streak of light, and a bracket lock on landing. */
export const MoveFx = ({ from, to, color, capture, durationMs, arc = 0 }: MoveFxProps) => {
  const rim = RIM[color];
  const f = useMemo(() => floorOf(from), [from]);
  const t = useMemo(() => floorOf(to), [to]);
  const land = durationMs * 0.82;
  return (
    <>
      <LiftOff floor={f} color={rim} lifeMs={durationMs * 0.8} />
      <MoveTrail
        from={f}
        to={t}
        color={rim}
        durationMs={durationMs}
        arc={arc}
        height={0.26}
        width={0.26}
      />
      {!capture && <BracketLock floor={t} color={rim} delayMs={land} lifeMs={340} />}
      <Ripple
        position={t}
        color={rim}
        radius={0.95}
        delayMs={land}
        lifeMs={360}
        width={0.07}
        strength={0.9}
      />
    </>
  );
};

// --- A column of light flaring up from a square ------------------------------------------

const flareGeometry = new CylinderGeometry(1, 1, 1, 32, 1, true);

/** A column of light that flares up from a square and fades (an impact, an alert). */
const Flare = ({
  floor,
  lifeMs,
  delayMs = 0,
  color = PALETTE.check,
  radius = 0.4,
  height = 1.8,
}: {
  floor: Vec3;
  lifeMs: number;
  delayMs?: number;
  color?: string;
  radius?: number;
  height?: number;
}) => {
  const { ms, done } = useClock(delayMs + lifeMs);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        uniforms: { uColor: { value: new Color(color) }, uK: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uK; varying vec2 vUv;
          void main() {
            float env = uK <= 0.0 ? 0.0 : sin(3.14159 * min(uK * 1.6, 1.0)) * (1.0 - uK);
            float a = pow(1.0 - vUv.y, 1.6) * env * 0.75;
            gl_FragColor = vec4(uColor, a);
            #include <colorspace_fragment>
          }`,
      }),
    [color],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame(() => {
    material.uniforms.uK.value = Math.min(beat(ms.current, delayMs, lifeMs), 1);
  });
  if (done) return null;
  return (
    <mesh
      geometry={flareGeometry}
      material={material}
      position={[floor[0], floor[1] + height / 2, floor[2]]}
      scale={[radius, height, radius]}
      renderOrder={LAYER.trace}
      raycast={noRaycast}
    />
  );
};

// --- Capture: the target de-rezzes -----------------------------------------------------

const dissolveVertex = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vec4 mv = viewMatrix * w;
    vV = -mv.xyz;
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }`;

const dissolveFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uRim;
  uniform vec3 uBurn;
  uniform float uK;
  uniform float uBase;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vW;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  void main() {
    // Breaks into voxels, from the top down
    float h = hash(floor(vW * 24.0));
    float order = h * 0.8 + (1.0 - clamp((vW.y - uBase) / 0.75, 0.0, 1.0)) * 0.2;
    if (order < uK) discard;
    vec3 n = normalize(vN);
    vec3 v = normalize(vV);
    float key = 0.45 + 0.55 * max(dot(n, normalize(vec3(0.3, 0.8, 0.5))), 0.0);
    float rim = pow(1.0 - abs(dot(n, v)), 2.4);
    float burn = (1.0 - smoothstep(0.0, 0.1, order - uK)) * step(0.001, uK);
    vec3 col = uColor * key + uRim * rim + uBurn * burn * 2.2;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const Victim = ({
  floor,
  type,
  color,
  facing,
  delayMs,
  lifeMs,
}: {
  floor: Vec3;
  type: PieceType;
  color: PieceColor;
  /** A knight's yaw, as Board gave it on the board. */
  facing: number;
  delayMs: number;
  lifeMs: number;
}) => {
  const group = useRef<Group>(null);
  const { ms, done } = useClock(delayMs + lifeMs);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uColor: { value: new Color(BODY[color]).multiplyScalar(0.85) },
          uRim: { value: new Color(RIM[color]) },
          uBurn: { value: new Color(PALETTE.capture) },
          uK: { value: 0 },
          uBase: { value: floor[1] },
        },
        vertexShader: dissolveVertex,
        fragmentShader: dissolveFragment,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a victim is configured once
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame(() => {
    const since = ms.current - delayMs;
    const k = clamp01(since / lifeMs);
    material.uniforms.uK.value = since <= 0 ? 0 : 0.05 + k;
    const g = group.current;
    if (g) {
      g.visible = k < 1;
      g.position.y = floor[1] + k * 0.18;
      // A jolt on impact
      const jolt = since > 0 ? Math.sin(since * 0.09) * 0.02 * Math.exp(-since / 120) : 0;
      g.position.x = floor[0] + jolt;
    }
  });
  if (done) return null;
  return (
    <group ref={group} position={floor}>
      <group scale={PIECE_SCALE} rotation={[0, type === PieceType.Knight ? facing : 0, 0]}>
        <CommandParts type={type} body={material} accent={material} />
      </group>
    </group>
  );
};

const voxel = new BoxGeometry(0.06, 0.06, 0.06);
const voxelMaterial = new MeshBasicMaterial({ color: '#ffffff', toneMapped: false });

/** The captured piece stands until the capturer lands, then de-rezzes into voxels. */
export const CaptureFx = ({ floor, victim, victimFacing = 0, durationMs }: CaptureFxProps) => {
  const impact = durationMs * 0.8;
  const colors = useMemo(
    () => [BODY[victim.color], RIM[victim.color], RIM[victim.color], PALETTE.capture],
    [victim.color],
  );
  return (
    <>
      <Victim
        floor={floor}
        type={victim.type}
        color={victim.color}
        facing={victimFacing}
        delayMs={impact}
        lifeMs={300}
      />
      <Shards
        position={[floor[0], floor[1] + 0.2, floor[2]]}
        geometry={voxel}
        material={voxelMaterial}
        colors={colors}
        count={46}
        speed={2.3}
        gravity={2.6}
        upward={0.55}
        spread={0.22}
        spin={7}
        lifeMs={380}
        seed={13}
        delayMs={impact}
      />
      <BracketLock
        floor={floor}
        color={PALETTE.capture}
        delayMs={impact}
        lifeMs={360}
        teeth
        from={1.45}
      />
      <Ripple
        position={floor}
        color={PALETTE.capture}
        radius={1.15}
        delayMs={impact}
        lifeMs={380}
        width={0.06}
      />
      <Flare
        floor={floor}
        color={PALETTE.capture}
        delayMs={impact}
        lifeMs={300}
        radius={0.34}
        height={1.1}
      />
    </>
  );
};

// --- Mate: one red alert pulse -------------------------------------------------------------

/** Checkmate: one red alert pulse across the king's level, then the winner's light. */
export const Celebration = ({ floor, winner }: CelebrationProps) => (
  <>
    <Flare floor={floor} lifeMs={1100} />
    <Ripple position={floor} color={PALETTE.check} radius={3.6} lifeMs={1300} width={0.03} />
    <Ripple
      position={floor}
      color={PALETTE.check}
      radius={2.4}
      delayMs={180}
      lifeMs={1000}
      width={0.05}
    />
    {winner && (
      <Ripple
        position={floor}
        color={RIM[winner]}
        radius={4.2}
        delayMs={650}
        lifeMs={1500}
        width={0.02}
      />
    )}
  </>
);
