import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import type { Group, Points } from 'three';
import { LAYER } from '../kit/layers';
import { LastMoveLine } from '../kit/line';
import { noRaycast } from '../kit/noRaycast';
import type { LastMoveMarkerProps, MarkerProps, Vec3 } from '../types';
import { CHECK, LAST_MOVE, LEVELS, LURE, PLANKTON } from './palette';

// Every mark of play is a creature of light lying on the glass: a small
// medusa ring (a ring with eight soft lobes, like a jellyfish's bell seen
// from above) that breathes very slowly where a piece may go; the same ring
// in an anglerfish's red, opened round the victim's base with its lure
// circling, for a capture; a swirl of plankton round the selected piece that
// settles into a slow halo; the last move's squares in a comb jelly's violet
// (a dotted ring where the piece left, a whole ring round it where it
// landed) joined by a thin violet line; and a red pulse that spreads from a
// king in check once, then holds as a steady red ring.

export interface RingStyle {
  color: string;
  /** Ring radius, world units. */
  radius: number;
  /** Stroke width, world units. */
  width: number;
  opacity?: number;
  /** Soft light round the stroke: strength and reach (world units). */
  glow?: number;
  glowWidth?: number;
  /** A faint luminous disc inside the ring. */
  fill?: number;
  /** Lobes round the ring, and how deep they are (world units). */
  lobes?: number;
  lobeDepth?: number;
  /** How much the ring breathes (0: still), seconds per breath. */
  breathe?: number;
  period?: number;
  /** Dashes round the ring (0: whole). */
  dashes?: number;
  /** Bright arcs of shimmer running slowly round the ring (0: even). */
  comb?: number;
  /** A thin inner ring in this colour (the level cue), at `innerAt` of the radius. */
  innerColor?: string;
  innerAt?: number;
  /** An anglerfish lure: a bright bead circling the ring. */
  lure?: boolean;
  lureColor?: string;
  hovered?: boolean;
  lift?: number;
}

const vertex = /* glsl */ `
  uniform float uQuad;
  varying vec2 vP;
  void main() {
    vP = (uv - 0.5) * uQuad;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const fragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uLureColor;
  uniform float uOpacity;
  uniform float uRadius;
  uniform float uWidth;
  uniform float uGlow;
  uniform float uGlowWidth;
  uniform float uFill;
  uniform float uLobes;
  uniform float uLobeDepth;
  uniform float uBreathe;
  uniform float uPeriod;
  uniform float uPhase;
  uniform float uDashes;
  uniform float uComb;
  uniform vec3 uInnerColor;
  uniform float uInner;
  uniform float uInnerWidth;
  uniform float uLure;
  uniform float uHover;
  uniform float uReveal;
  uniform float uTime;
  varying vec2 vP;

  void main() {
    vec2 p = vP;
    float r = length(p);
    float ang = atan(p.y, p.x);
    float breath = 0.5 + 0.5 * sin(6.2831853 * uTime / uPeriod + uPhase);
    float swell = 1.0 + uBreathe * 0.05 * (breath - 0.5) + 0.26 * uHover;
    float twist = uTime * 0.08;
    float R = uRadius * swell + uLobeDepth * cos(uLobes * (ang + twist));
    // A comb jelly's shimmer: soft bright arcs running slowly round the ring
    float comb = uComb > 0.5 ? 0.5 + 0.5 * cos(uComb * ang - uTime * 1.1 + uPhase) : 1.0;
    float w = uWidth * (uComb > 0.5 ? 0.65 + 0.6 * comb : 1.0);
    float d = abs(r - R) - w * 0.5;
    float aa = fwidth(d) + 1e-5;
    float line = 1.0 - smoothstep(-aa, aa, d);
    if (uDashes > 0.0) {
      float s = abs(fract(ang / 6.2831853 * uDashes + twist) - 0.5) * 2.0;
      float sa = fwidth(s) + 1e-4;
      line *= smoothstep(0.35 - sa, 0.35 + sa, s);
    }
    // Drawn in round the ring from its far side
    float along = fract(ang / 6.2831853 + 0.25);
    line *= step(along, uReveal);
    float glow = exp(-max(d, 0.0) / uGlowWidth) * uGlow * step(along, uReveal);
    float inner = uFill * smoothstep(R, 0.0, r);
    float lit = (1.0 - uBreathe * 0.35) + uBreathe * 0.35 * breath;
    float shimmer = uComb > 0.5 ? 0.5 + 0.5 * comb : 1.0;
    float a = (line * uOpacity + glow) * shimmer * lit * (1.0 + 0.45 * uHover) + inner * lit;
    vec3 c = uColor * (1.0 + 0.25 * uHover);
    if (uInner > 0.0) {
      // The level cue: a thin inner ring in the colour of the square's level
      float id = abs(r - uInner * R) - uInnerWidth * 0.5;
      float ia = fwidth(id) + 1e-5;
      float inner = (1.0 - smoothstep(-ia, ia, id)) * 0.9;
      c = mix(c, uInnerColor, inner / max(a + inner, 1e-4));
      a += inner * (1.0 - a);
    }
    if (uLure > 0.5) {
      // The lure: a bright bead that circles the ring, with its own glow
      float la = uTime * 0.9 + uPhase;
      vec2 at = vec2(cos(la), sin(la)) * R;
      float ld = length(p - at);
      float bead = 1.0 - smoothstep(uWidth * 1.1 - aa, uWidth * 1.1 + aa, ld);
      float halo = exp(-ld / (uWidth * 2.2)) * 0.8;
      float l = max(bead, halo);
      c = mix(c, uLureColor, l / max(a + l, 1e-4));
      a += l;
    }
    a = min(a, 1.0);
    if (a < 0.004) discard;
    gl_FragColor = vec4(c, a);
    #include <colorspace_fragment>
  }`;

const planes = new Map<number, PlaneGeometry>();
const planeFor = (size: number) => {
  const key = Math.round(size * 1000);
  let g = planes.get(key);
  if (!g) {
    g = new PlaneGeometry(size, size);
    planes.set(key, g);
  }
  return g;
};

/** Every mark reads one clock, so they breathe together. */
const clock = { value: 0 };

const ringMaterial = () =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: {
      uColor: { value: new Color() },
      uLureColor: { value: new Color() },
      uOpacity: { value: 1 },
      uRadius: { value: 0.3 },
      uWidth: { value: 0.03 },
      uGlow: { value: 0.3 },
      uGlowWidth: { value: 0.04 },
      uFill: { value: 0 },
      uLobes: { value: 8 },
      uLobeDepth: { value: 0 },
      uBreathe: { value: 0 },
      uPeriod: { value: 5 },
      uPhase: { value: 0 },
      uDashes: { value: 0 },
      uComb: { value: 0 },
      uInnerColor: { value: new Color() },
      uInner: { value: 0 },
      uInnerWidth: { value: 0.01 },
      uLure: { value: 0 },
      uHover: { value: 0 },
      uReveal: { value: 1 },
      uQuad: { value: 1 },
      uTime: clock,
    },
    vertexShader: vertex,
    fragmentShader: fragment,
  });

/** Keeps the shared clock on r3f's time. Mounted once, by the Stage. */
export const MarkerClock = () => {
  useFrame((state) => {
    clock.value = state.clock.elapsedTime;
  });
  return null;
};

/**
 * A medusa ring lying on the glass at `floor`. `drawMs` draws it in round
 * its circumference after `delayMs`; `onMaterial` hands over the material
 * for an owner that animates it.
 */
export const Ring = ({
  floor,
  color,
  radius,
  width,
  opacity = 0.95,
  glow = 0.35,
  glowWidth = 0.04,
  fill = 0,
  lobes = 8,
  lobeDepth = 0.012,
  breathe = 0,
  period = 5.5,
  dashes = 0,
  comb = 0,
  innerColor,
  innerAt = 0.62,
  lure = false,
  lureColor = '#fff1c9',
  hovered = false,
  lift = 0.012,
  drawMs = 0,
  delayMs = 0,
  renderOrder = LAYER.marker,
  onMaterial,
}: RingStyle & {
  floor: Vec3;
  drawMs?: number;
  delayMs?: number;
  renderOrder?: number;
  onMaterial?: (m: ShaderMaterial) => void;
}) => {
  const material = useMemo(ringMaterial, []);
  useEffect(() => () => material.dispose(), [material]);
  // Room for the swell of a hovered ring and the halo round it
  const quad = (radius * 1.3 + lobeDepth + width + glowWidth * 5) * 2 * (lure ? 1.1 : 1);
  const u = material.uniforms;
  u.uColor.value.set(color);
  u.uLureColor.value.set(lureColor);
  u.uOpacity.value = opacity;
  u.uRadius.value = radius;
  u.uWidth.value = width;
  u.uGlow.value = glow;
  u.uGlowWidth.value = glowWidth;
  u.uFill.value = fill;
  u.uLobes.value = lobes;
  u.uLobeDepth.value = lobeDepth;
  u.uBreathe.value = breathe;
  u.uPeriod.value = period;
  // A slow wave across the board rather than every ring in lockstep
  u.uPhase.value = (floor[0] * 0.9 + floor[2] * 0.6 + floor[1] * 0.4) % (Math.PI * 2);
  u.uDashes.value = dashes;
  u.uComb.value = comb;
  u.uInner.value = innerColor ? innerAt : 0;
  if (innerColor) u.uInnerColor.value.set(innerColor);
  u.uInnerWidth.value = width * 0.45;
  u.uLure.value = lure ? 1 : 0;
  u.uHover.value = hovered ? 1 : 0;
  u.uQuad.value = quad;
  onMaterial?.(material);

  const elapsed = useRef(0);
  const invalidate = useThree((s) => s.invalidate);
  if (drawMs <= 0) u.uReveal.value = 1;
  useEffect(() => {
    elapsed.current = 0;
    if (drawMs > 0) {
      material.uniforms.uReveal.value = 0;
      invalidate();
    }
  }, [drawMs, material, invalidate]);
  useFrame((_, delta) => {
    if (drawMs <= 0 || u.uReveal.value >= 1) return;
    elapsed.current += Math.min(delta, 1 / 30) * 1000;
    const t = Math.min(Math.max((elapsed.current - delayMs) / drawMs, 0), 1);
    u.uReveal.value = 1 - (1 - t) ** 2;
    invalidate();
  });

  return (
    <mesh
      geometry={planeFor(quad)}
      material={material}
      position={[floor[0], floor[1] + lift, floor[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={renderOrder}
      raycast={noRaycast}
    />
  );
};

// --- The marker set ------------------------------------------------------------------

export const makeMarkers = (
  pitch: number,
  motionMs: number,
  levelAt: (floorY: number) => number,
) => {
  const MOVE_RING = 0.26 * pitch;
  const CAPTURE_RING = 0.42 * pitch;
  const STROKE = 0.034 * pitch;

  /**
   * A legal destination: a ring of plankton light, breathing very slowly,
   * with a comb jelly's shimmer running round it and a thin inner ring in the
   * colour of its level.
   */
  const Quiet = ({ floor, hovered }: MarkerProps) => (
    <Ring
      floor={floor}
      color={PLANKTON}
      radius={MOVE_RING}
      width={STROKE}
      opacity={0.95}
      glow={0.32}
      glowWidth={0.035 * pitch}
      fill={hovered ? 0.28 : 0.07}
      lobeDepth={0}
      comb={3}
      innerColor={LEVELS[levelAt(floor[1])]}
      breathe={1}
      hovered={hovered}
    />
  );

  /**
   * A capture: the same ring in an anglerfish's red, opened round the
   * victim's base, glowing, with its lure circling.
   */
  const Capture = ({ floor, hovered }: MarkerProps) => (
    <Ring
      floor={floor}
      color={LURE}
      radius={CAPTURE_RING}
      width={STROKE * 1.1}
      opacity={1}
      glow={0.5}
      glowWidth={0.05 * pitch}
      fill={hovered ? 0.24 : 0.12}
      lobeDepth={0}
      comb={3}
      innerColor={LEVELS[levelAt(floor[1])]}
      innerAt={0.84}
      breathe={1}
      lure
      hovered={hovered}
    />
  );

  /**
   * The selection: plankton swirls once round the piece's base and settles
   * into a slow halo of motes over a soft pool of light: dots and a glow,
   * never a ring, so it cannot be taken for a destination.
   */
  const Selection = ({ floor }: MarkerProps) => (
    <>
      {/* A soft pool of plankton light under the piece: no stroke, so it is never a move's ring */}
      <Ring
        floor={floor}
        color={PLANKTON}
        radius={0.44 * pitch}
        width={0}
        opacity={0}
        glow={0}
        fill={0.26}
        lobeDepth={0}
        renderOrder={LAYER.shadow}
      />
      <PlanktonSwirl floor={floor} pitch={pitch} />
    </>
  );

  /**
   * The last move: a dotted violet ring where the piece left, a whole one
   * round it where it landed, and the thin violet line between them. A live
   * move draws its line and landing ring in as the piece arrives.
   */
  const LastMove = ({ from, to, fresh = false, arc = 0 }: LastMoveMarkerProps) => (
    <>
      <Ring
        floor={from.floor}
        color={LAST_MOVE}
        radius={0.24 * pitch}
        width={STROKE * 0.9}
        opacity={0.85}
        glow={0.25}
        glowWidth={0.03 * pitch}
        lobeDepth={0}
        dashes={12}
      />
      <Ring
        floor={to.floor}
        color={LAST_MOVE}
        radius={0.4 * pitch}
        width={STROKE * 0.9}
        opacity={0.9}
        glow={0.3}
        glowWidth={0.035 * pitch}
        lobeDepth={0}
        drawMs={fresh ? 360 : 0}
        delayMs={motionMs * 0.75}
      />
      <LastMoveLine
        from={from.floor}
        to={to.floor}
        arc={arc}
        color={LAST_MOVE}
        pulseColor="#f0e8ff"
        opacity={0.9}
        radius={0.013}
        pulse={0.55}
        pulseLength={0.35}
        flowSpeed={0.5}
        shade={0.3}
        lift={0.03}
        drawInMs={fresh ? 380 : 0}
        drawInDelayMs={fresh ? motionMs * 0.55 : 0}
      />
    </>
  );

  /** Check: a red pulse spreads from the king across its level once, then a steady red ring holds. */
  const Check = ({ floor }: MarkerProps) => (
    <>
      <Ring
        floor={floor}
        color={CHECK}
        radius={0.42 * pitch}
        width={STROKE * 1.3}
        opacity={1}
        glow={0.55}
        glowWidth={0.06 * pitch}
        fill={0.16}
        lobes={16}
        lobeDepth={0.006 * pitch}
      />
      <CheckPulse floor={floor} pitch={pitch} />
    </>
  );

  return { Quiet, Capture, Selection, LastMove, Check };
};

// --- The check's pulse --------------------------------------------------------------

const PULSE_MS = 1100;

/** One ring of red light spreading out from the king over its level, then gone. */
const CheckPulse = ({ floor, pitch }: { floor: Vec3; pitch: number }) => {
  const group = useRef<Group>(null);
  const material = useRef<ShaderMaterial | null>(null);
  const elapsed = useRef(0);
  const invalidate = useThree((s) => s.invalidate);
  const reach = 2.2 * pitch;
  useFrame((_, delta) => {
    const m = material.current;
    if (!m || !group.current || elapsed.current >= PULSE_MS) return;
    elapsed.current = Math.min(elapsed.current + Math.min(delta, 1 / 30) * 1000, PULSE_MS);
    const t = elapsed.current / PULSE_MS;
    const e = 1 - (1 - t) ** 3;
    // The quad is sized for the full reach; the ring grows inside it
    m.uniforms.uRadius.value = 0.3 * pitch + (reach - 0.3 * pitch) * e;
    m.uniforms.uOpacity.value = 0.9 * (1 - t) ** 1.5;
    m.uniforms.uGlow.value = 0.7 * (1 - t) ** 1.5;
    m.uniforms.uWidth.value = 0.05 * pitch * (1 - 0.5 * t);
    group.current.visible = t < 1;
    invalidate();
  });
  return (
    <group ref={group}>
      <Ring
        floor={floor}
        color={CHECK}
        radius={reach}
        width={0.05 * pitch}
        opacity={0}
        glow={0}
        glowWidth={0.08 * pitch}
        lobeDepth={0}
        lift={0.016}
        onMaterial={(m) => {
          if (material.current !== m) {
            material.current = m;
            m.uniforms.uRadius.value = 0.3 * pitch;
          }
        }}
      />
    </group>
  );
};

// --- The plankton swirl --------------------------------------------------------------

const SWIRL_MS = 1000;
const PLANKTON_COUNT = 30;

const swirlVertex = /* glsl */ `
  attribute float aSeed;
  uniform float uT;
  uniform float uTime;
  uniform float uPitch;
  uniform float uScale;
  varying float vAlpha;
  const float TAU = 6.2831853;
  void main() {
    float phase = aSeed * TAU;
    float jitter = fract(aSeed * 13.7);
    float e = 1.0 - pow(1.0 - uT, 3.0);
    // Once round the base, drawing in from wide
    float angle = phase + TAU * e + uTime * 0.12;
    float radius = mix(0.64 + 0.12 * jitter, 0.4 + 0.035 * (jitter - 0.5), e) * uPitch;
    // On the glass, never over the piece: additive light must not wash its body
    float y = 0.02 + sin(3.14159 * uT) * 0.02 * jitter * uPitch;
    vec3 p = vec3(cos(angle) * radius, y, sin(angle) * radius);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = (0.034 + 0.026 * fract(aSeed * 7.3)) * uPitch;
    gl_PointSize = max(size * uScale / -mv.z, 1.5);
    float twinkle = 0.75 + 0.25 * sin(uTime * (1.2 + jitter) + phase * 3.0);
    vAlpha = mix(1.0, 0.85 * twinkle, smoothstep(0.7, 1.0, uT)) * smoothstep(0.0, 0.12, uT);
  }`;

const swirlFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.2, 1.0, d)) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }`;

const swirlGeometry = (() => {
  let g: BufferGeometry | null = null;
  return () => {
    if (g) return g;
    g = new BufferGeometry();
    const seeds = new Float32Array(PLANKTON_COUNT);
    for (let i = 0; i < PLANKTON_COUNT; i++)
      seeds[i] = (i + ((i * 0.618) % 1) * 0.6) / PLANKTON_COUNT;
    g.setAttribute('position', new BufferAttribute(new Float32Array(PLANKTON_COUNT * 3), 3));
    g.setAttribute('aSeed', new BufferAttribute(seeds, 1));
    return g;
  };
})();

/** Plankton that swirl once round the selected piece's base, then drift slowly round it. */
const PlanktonSwirl = ({ floor, pitch }: { floor: Vec3; pitch: number }) => {
  const points = useRef<Points>(null);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const camera = useThree((s) => s.camera);
  const elapsed = useRef(0);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: {
          uColor: { value: new Color(PLANKTON) },
          uT: { value: 0 },
          uTime: clock,
          uPitch: { value: pitch },
          uScale: { value: 1 },
        },
        vertexShader: swirlVertex,
        fragmentShader: swirlFragment,
      }),
    [pitch],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame((_, delta) => {
    elapsed.current = Math.min(elapsed.current + Math.min(delta, 1 / 30) * 1000, SWIRL_MS);
    material.uniforms.uT.value = elapsed.current / SWIRL_MS;
    // World size to pixels: half the drawing buffer's height over tan(fov / 2)
    const fov = 'fov' in camera ? (camera.fov as number) : 36;
    material.uniforms.uScale.value = (size.height * dpr * 0.5) / Math.tan((fov * Math.PI) / 360);
  });
  return (
    <points
      ref={points}
      geometry={swirlGeometry()}
      material={material}
      position={floor}
      renderOrder={LAYER.trace}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};
