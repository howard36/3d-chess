import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  PlaneGeometry,
  PointsMaterial,
  ShaderMaterial,
} from 'three';
import type { Points } from 'three';
import { prefersReducedMotion } from '../../motion';
import { LAYER } from '../kit/layers';
import { LastMoveLine } from '../kit/line';
import { noRaycast } from '../kit/noRaycast';
import { dotTexture, rng } from '../kit/textures';
import type { LastMoveMarkerProps, MarkerProps, Vec3 } from '../types';
import { BEAM, CAPTURE, CHECK, DOCK, TRAIL } from './palette';

// Orbital's marker language is a ring of small lights on the glass, like the
// lights round a docking port:
//
// - a legal destination: eight ice-white lights where the piece would stand;
// - a capture: the same ring in red, opened out round the victim's base,
//   pulsing once as it appears and then holding steady;
// - the selection: a brighter ring under the piece, and a tractor beam, a
//   soft cone of pale light with motes drifting up inside it;
// - the last move: violet rings on both squares (the one left behind small
//   and dim, the one arrived at full) and the thin violet line between them;
// - check: a ring of red caution chevrons pointing in at the king.
//
// Everything lies flat on the deck and is drawn over every deck (LAYER), so
// a marker three decks down reads as clearly as one on top.

const vertex = /* glsl */ `
  uniform float uQuad;
  varying vec2 vP;
  void main() {
    vP = (uv - 0.5) * uQuad;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const fragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uCount;
  uniform float uRadius;
  uniform float uDot;
  uniform float uHalo;
  uniform float uLine;
  uniform float uFill;
  uniform float uChevron;
  uniform float uPulse;
  varying vec2 vP;

  float segment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }

  void main() {
    vec2 p = vP;
    float rho = length(p);
    float sector = 6.2831853 / uCount;
    float k = floor(atan(p.y, p.x) / sector + 0.5);
    float a0 = k * sector;
    vec2 dir = vec2(cos(a0), sin(a0));
    // This light's frame: out from the centre, and across
    vec2 q = vec2(dot(p, dir) - uRadius, dot(p, vec2(-dir.y, dir.x)));
    float size = uDot * (1.0 + 0.6 * uPulse);
    float dist;
    if (uChevron > 0.5) {
      // A caution chevron pointing in at the centre
      float h = size * 1.6;
      float w = size * 2.0;
      dist = min(segment(q, vec2(-h * 0.5, 0.0), vec2(h * 0.5, w)),
                 segment(q, vec2(-h * 0.5, 0.0), vec2(h * 0.5, -w))) - size * 0.42;
    } else {
      dist = length(q) - size;
    }
    float fw = max(fwidth(dist), 1e-4);
    float core = 1.0 - smoothstep(-fw, fw, dist);
    float halo = exp(-max(dist, 0.0) * max(dist, 0.0) / (size * size * 3.0)) * uHalo;
    // The faint ring the lights sit on, and a faint pad inside it
    float lr = abs(rho - uRadius) - 0.0035;
    float lfw = max(fwidth(lr), 1e-4);
    float ring = (1.0 - smoothstep(-lfw, lfw, lr)) * uLine;
    float pad = (1.0 - smoothstep(uRadius - 0.03, uRadius, rho)) * uFill;
    float strength = uOpacity * (1.0 + 0.8 * uPulse);
    float a = max(max(core, halo), max(ring, pad)) * strength;
    if (a < 0.003) discard;
    // Each light's core runs hot, toward white
    vec3 col = mix(uColor, vec3(1.0), core * 0.35);
    gl_FragColor = vec4(col, min(a, 1.0));
    #include <colorspace_fragment>
  }`;

const planes = new Map<number, PlaneGeometry>();
const planeFor = (size: number) => {
  let g = planes.get(size);
  if (!g) {
    g = new PlaneGeometry(size, size).rotateX(-Math.PI / 2);
    planes.set(size, g);
  }
  return g;
};

export interface LightRingStyle {
  color: string;
  /** Number of lights round the ring. */
  count?: number;
  /** Radius of the ring (world units). */
  radius: number;
  /** Radius of each light. */
  dot?: number;
  opacity?: number;
  halo?: number;
  /** Opacity of the thin ring the lights sit on. */
  line?: number;
  /** Opacity of the pad inside the ring. */
  fill?: number;
  /** Chevrons pointing inward instead of round lights. */
  chevron?: boolean;
  /** Extra size and glow, 0–1 (animated by the caller). */
  pulse?: number;
  /** Order among the see-through layers. */
  renderOrder?: number;
}

/** A ring of lights lying on the floor at `floor` (see above). */
export const LightRing = ({
  floor,
  color,
  count = 8,
  radius,
  dot = 0.026,
  opacity = 1,
  halo = 0.35,
  line = 0,
  fill = 0,
  chevron = false,
  pulse = 0,
  renderOrder = LAYER.marker,
  lift = 0.012,
  materialRef,
}: LightRingStyle & {
  floor: Vec3;
  lift?: number;
  /** Receives the material, for a caller that animates its uniforms. */
  materialRef?: (m: ShaderMaterial) => void;
}) => {
  const quad = (radius + dot * 4) * 2.2;
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        uniforms: {
          uColor: { value: new Color() },
          uOpacity: { value: 1 },
          uCount: { value: 8 },
          uRadius: { value: 0.3 },
          uDot: { value: 0.03 },
          uHalo: { value: 0.3 },
          uLine: { value: 0 },
          uFill: { value: 0 },
          uChevron: { value: 0 },
          uPulse: { value: 0 },
          uQuad: { value: 1 },
        },
        vertexShader: vertex,
        fragmentShader: fragment,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => materialRef?.(material), [material, materialRef]);
  const u = material.uniforms;
  (u.uColor.value as Color).set(color);
  u.uOpacity.value = opacity;
  u.uCount.value = count;
  u.uRadius.value = radius;
  u.uDot.value = dot;
  u.uHalo.value = halo;
  u.uLine.value = line;
  u.uFill.value = fill;
  u.uChevron.value = chevron ? 1 : 0;
  u.uPulse.value = pulse;
  u.uQuad.value = quad;
  return (
    <mesh
      geometry={planeFor(quad)}
      material={material}
      position={[floor[0], floor[1] + lift, floor[2]]}
      renderOrder={renderOrder}
      raycast={noRaycast}
    />
  );
};

/**
 * Plays `envelope(t)` (t in ms since mount) into a ring's pulse uniform for
 * `ms`, then leaves it at `envelope(ms)`; frames are requested only meanwhile.
 */
const usePulse = (ms: number, envelope: (t: number) => number) => {
  const invalidate = useThree((s) => s.invalidate);
  const material = useRef<ShaderMaterial | null>(null);
  const elapsed = useRef(0);
  const done = useRef(false);
  useEffect(() => invalidate(), [invalidate]);
  useFrame((_, delta) => {
    const m = material.current;
    if (done.current || !m) return;
    elapsed.current += Math.min(delta, 1 / 30) * 1000;
    const t = Math.min(elapsed.current, ms);
    m.uniforms.uPulse.value = envelope(t);
    if (t >= ms) done.current = true;
    else invalidate();
  });
  return (m: ShaderMaterial) => {
    material.current = m;
    m.uniforms.uPulse.value = envelope(Math.min(elapsed.current, ms));
  };
};

// --- Destinations ----------------------------------------------------------------------

const QUIET_RADIUS = 0.25;
const CAPTURE_RADIUS = 0.42;

/** A legal destination: a ring of eight ice-white lights. */
export const Quiet = ({ floor, hovered }: MarkerProps) => (
  <LightRing
    floor={floor}
    color={DOCK}
    count={8}
    radius={QUIET_RADIUS}
    dot={hovered ? 0.03 : 0.024}
    opacity={hovered ? 1 : 0.9}
    halo={hovered ? 0.55 : 0.35}
    line={hovered ? 0.5 : 0.12}
    fill={hovered ? 0.1 : 0.03}
  />
);

const CAPTURE_PULSE_MS = 700;
const capturePulse = (t: number) => {
  const k = t / CAPTURE_PULSE_MS;
  return k < 0.25 ? k / 0.25 : Math.max(0, 1 - (k - 0.25) / 0.75) ** 2;
};

/**
 * A capture: the same ring in red, opened out round the victim's base,
 * with more lights; it pulses once as it appears, then holds steady.
 */
export const Capture = ({ floor, hovered }: MarkerProps) => {
  const ref = usePulse(CAPTURE_PULSE_MS, capturePulse);
  return (
    <LightRing
      floor={floor}
      color={CAPTURE}
      count={12}
      radius={CAPTURE_RADIUS}
      dot={hovered ? 0.03 : 0.026}
      opacity={1}
      halo={hovered ? 0.6 : 0.4}
      line={hovered ? 0.55 : 0.25}
      fill={hovered ? 0.12 : 0.06}
      materialRef={ref}
    />
  );
};

// --- Selection: the tractor beam -----------------------------------------------------

const BEAM_HEIGHT = 1.05;
const beamGeometry = new CylinderGeometry(0.26, 0.36, BEAM_HEIGHT, 48, 1, true).translate(
  0,
  BEAM_HEIGHT / 2,
  0,
);

const beamVertex = /* glsl */ `
  varying float vH;
  varying vec3 vNormal;
  varying vec3 vWorld;
  uniform float uHeight;
  void main() {
    vH = position.y / uHeight;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const beamFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOpacity;
  varying float vH;
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    vec3 v = normalize(cameraPosition - vWorld);
    float facing = abs(dot(normalize(vNormal), v));
    // Bright at its edges, clear in front of the piece
    float edge = pow(1.0 - facing, 1.8);
    float fade = pow(1.0 - vH, 1.5) * smoothstep(0.0, 0.05, vH);
    // Faint bands of light rising slowly up the beam
    float bands = 0.8 + 0.2 * sin((vH * 5.0 - uTime * 0.45) * 6.2831853);
    // A brighter skirt where the beam meets the glass
    float skirt = exp(-vH / 0.06) * 0.4;
    float a = ((0.06 + 1.1 * edge) * fade * bands + skirt) * uOpacity;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }`;

const MOTES = 18;
const moteTexture = () => dotTexture(0.8);

/** The beam: a soft cone of pale light over the selected piece, motes drifting up inside. */
const TractorBeam = ({ floor }: { floor: Vec3 }) => {
  const invalidate = useThree((s) => s.invalidate);
  const points = useRef<Points>(null);
  const clock = useRef(0);
  const grow = useRef(0);
  const { material, motes, seeds, moteMaterial } = useMemo(() => {
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
      uniforms: {
        uColor: { value: new Color(BEAM) },
        uTime: { value: 0 },
        uOpacity: { value: 0 },
        uHeight: { value: BEAM_HEIGHT },
      },
      vertexShader: beamVertex,
      fragmentShader: beamFragment,
    });
    const random = rng(3);
    const seeds = Array.from({ length: MOTES }, () => ({
      angle: random() * Math.PI * 2,
      radius: 0.06 + random() * 0.2,
      phase: random(),
      speed: 0.12 + random() * 0.12,
    }));
    const motes = new BufferGeometry();
    motes.setAttribute('position', new BufferAttribute(new Float32Array(MOTES * 3), 3));
    motes.setAttribute('color', new BufferAttribute(new Float32Array(MOTES * 3), 3));
    const moteMaterial = new PointsMaterial({
      size: 0.06,
      map: moteTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      sizeAttenuation: true,
    });
    return { material, motes, seeds, moteMaterial };
  }, []);
  useEffect(
    () => () => {
      material.dispose();
      motes.dispose();
      moteMaterial.dispose();
    },
    [material, motes, moteMaterial],
  );
  const beam = new Color(BEAM);
  const still = prefersReducedMotion();
  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 30);
    if (!still) clock.current += dt;
    grow.current = Math.min(1, grow.current + dt / 0.25);
    const g = 1 - (1 - grow.current) ** 3;
    material.uniforms.uTime.value = clock.current;
    material.uniforms.uOpacity.value = g;
    const pos = motes.getAttribute('position') as BufferAttribute;
    const col = motes.getAttribute('color') as BufferAttribute;
    seeds.forEach((s, i) => {
      const h = (s.phase + clock.current * s.speed) % 1;
      const y = h * BEAM_HEIGHT * 0.92;
      // The beam narrows as it rises
      const r = s.radius * (1 - 0.25 * h);
      const a = s.angle + clock.current * 0.3;
      pos.setXYZ(i, Math.cos(a) * r, y, Math.sin(a) * r);
      const f = Math.sin(Math.PI * h) * 1.2 * g;
      col.setXYZ(i, beam.r * f, beam.g * f, beam.b * f);
    });
    pos.needsUpdate = true;
    col.needsUpdate = true;
    if (!still || grow.current < 1) invalidate();
  });
  return (
    <group position={floor}>
      <mesh
        geometry={beamGeometry}
        material={material}
        renderOrder={LAYER.trace + 0.5}
        raycast={noRaycast}
      />
      <points
        ref={points}
        geometry={motes}
        material={moteMaterial}
        renderOrder={LAYER.trace + 0.6}
        raycast={noRaycast}
        frustumCulled={false}
      />
    </group>
  );
};

/** The selection: a bright ring of lights under the piece, in a tractor beam. */
export const Selection = ({ floor }: MarkerProps) => (
  <>
    <LightRing
      floor={floor}
      color={BEAM}
      count={12}
      radius={0.36}
      dot={0.022}
      opacity={1}
      halo={0.5}
      line={0.45}
      fill={0.1}
    />
    <TractorBeam floor={floor} />
  </>
);

// --- The last move -------------------------------------------------------------------

/**
 * The last move: a small dim ring where the piece left, a full ring where it
 * arrived, both violet, and the thin violet line between them, drawn in
 * behind the piece as it travels.
 */
export const makeLastMove = (durationMs: number) => {
  const LastMove = ({ from, to, fresh = false, arc = 0 }: LastMoveMarkerProps) => (
    <>
      <LightRing
        floor={from.floor}
        color={TRAIL}
        count={6}
        radius={0.16}
        dot={0.02}
        opacity={0.8}
        halo={0.3}
        line={0.25}
      />
      <LightRing
        floor={to.floor}
        color={TRAIL}
        count={10}
        radius={0.36}
        dot={0.027}
        opacity={1}
        halo={0.5}
        line={0.45}
        fill={0.05}
      />
      <LastMoveLine
        from={from.floor}
        to={to.floor}
        arc={arc}
        color={TRAIL}
        pulseColor="#f1e4ff"
        radius={0.013}
        opacity={0.9}
        shade={0.3}
        pulse={0.65}
        pulseLength={0.35}
        flowSpeed={0.55}
        drawInMs={fresh ? durationMs : 0}
      />
    </>
  );
  return LastMove;
};

// --- Check -----------------------------------------------------------------------------

/** Check: a ring of red caution chevrons pointing in at the king, on a faint red pad. */
export const Check = ({ floor }: MarkerProps) => (
  <LightRing
    floor={floor}
    color={CHECK}
    count={8}
    radius={0.45}
    dot={0.04}
    chevron
    opacity={1}
    halo={0.35}
    line={0.4}
    fill={0.14}
  />
);
