import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import type { Mesh } from 'three';
import { LAYER } from '../kit/layers';
import { ribbonData, tracePath } from '../kit/markerGeometry';
import { noRaycast } from '../kit/noRaycast';
import { prefersReducedMotion } from '../../motion';
import type { LastMoveMarkerProps, MarkerProps, Vec3 } from '../types';
import { PAL } from './palette';

// Atelier's markers are one family: a slim ring lying on the platform where a
// piece stands.
//
//   can move    a graphite ring with a faint graphite spot inside
//   capture     the same ring in vermilion, crossed by four reticle ticks
//   last move   the same ring in amber on both squares, joined by an amber
//               ribbon with an arrowhead that draws itself along the flight
//   check       the ring in crimson, doubled, over a crimson spot
//   selection   a fine warm-white halo over a soft pool of light
//
// Each is one quad shaded by a signed distance, crisp at any angle. They pop
// in over a fifth of a second and are still after that.

const markerVertex = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = vec2(position.x, -position.z);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const markerFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uFill;
  uniform float uRing;
  uniform float uLine;
  uniform float uRing2;
  uniform float uLine2;
  uniform float uTicks;
  uniform float uTickIn;
  uniform float uTickOut;
  uniform float uBezel;
  uniform float uBezelIn;
  uniform float uBezelOut;
  uniform float uBezelWidth;
  uniform float uRot;
  uniform vec3 uKeyColor;
  uniform float uKey;
  uniform float uGlow;
  uniform float uGlowRadius;
  uniform vec3 uGlowColor;
  uniform float uHover;
  uniform float uScale;
  uniform float uFade;
  varying vec2 vP;

  float segment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }

  void main() {
    vec2 p = vP / uScale;
    float r = length(p);
    float line = uLine * (1.0 + 0.3 * uHover);
    float stroke = abs(r - uRing) - line * 0.5;
    if (uRing2 > 0.0) stroke = min(stroke, abs(r - uRing2) - uLine2 * 0.5);
    if (uTicks > 0.5) {
      // A reticle: four ticks across the ring, on the axes
      vec2 q = abs(p);
      float t = min(
        segment(q, vec2(uTickIn, 0.0), vec2(uTickOut, 0.0)),
        segment(q, vec2(0.0, uTickIn), vec2(0.0, uTickOut))
      ) - line * 0.5;
      stroke = min(stroke, t);
    }
    if (uBezel > 0.5) {
      // A watch bezel: fine radial ticks round the ring, turning slowly
      float sector = 6.2831853 / uBezel;
      float a = atan(p.y, p.x) + uRot;
      float local = (mod(a, sector) - 0.5 * sector) * r;
      float radial = abs(r - 0.5 * (uBezelIn + uBezelOut)) - 0.5 * (uBezelOut - uBezelIn);
      float tick = max(abs(local) - uBezelWidth * 0.5, radial);
      stroke = min(stroke, tick);
    }
    float aa = max(fwidth(stroke), 1e-4);
    float ink = 1.0 - smoothstep(-aa, aa, stroke);
    // A dark keyline round light strokes, so they read on light acrylic
    float key = uKey > 0.0 ? 1.0 - smoothstep(-aa, aa, stroke - uKey) : 0.0;
    float ia = max(fwidth(r), 1e-4);
    float area = 1.0 - smoothstep(uRing - ia, uRing + ia, r);
    float strength = uOpacity * (1.0 + 0.35 * uHover);
    float fill = uFill + 0.1 * uHover;
    vec3 col = uColor;
    float a = max(ink * strength, area * fill);
    if (uGlow > 0.0) {
      // A soft pool of light under the ring
      float g = 1.0 - smoothstep(0.0, uGlowRadius, r);
      float pool = uGlow * g * g;
      col = mix(uGlowColor, uColor, ink);
      a = max(a, pool);
    }
    if (uKey > 0.0) {
      col = mix(uKeyColor, col, max(ink, 1.0 - key));
      a = max(a, key * 0.55 * strength);
    }
    a *= uFade;
    if (a < 0.003) discard;
    gl_FragColor = vec4(col, min(a, 1.0));
    #include <colorspace_fragment>
  }`;

export interface RingStyle {
  color: string;
  opacity?: number;
  fill?: number;
  /** Ring radius and stroke width, in pitches. */
  ring?: number;
  line?: number;
  /** A second, outer ring (0 for none). */
  ring2?: number;
  line2?: number;
  /** Reticle ticks across the ring (the capture cue). */
  ticks?: boolean;
  tickIn?: number;
  tickOut?: number;
  /** Watch-bezel ticks round the ring: how many (0 for none), where, how wide. */
  bezel?: number;
  bezelIn?: number;
  bezelOut?: number;
  bezelWidth?: number;
  /** Bezel turn, radians a second. */
  bezelSpin?: number;
  /** A dark keyline this wide round every stroke (0 for none). */
  keyline?: number;
  keyColor?: string;
  /** A soft pool of light under the ring. */
  glow?: number;
  glowRadius?: number;
  glowColor?: string;
  /** Pop-in: how long, and how long to wait first (ms). */
  popMs?: number;
  delayMs?: number;
}

const QUAD = 1;
const quad = new PlaneGeometry(QUAD, QUAD).rotateX(-Math.PI / 2);
// Pop-in with a little overshoot
const easeOutBack = (t: number) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;

/** One ring-family marker, flat on the floor at `floor`. */
export const Ring = ({
  floor,
  hovered = false,
  color,
  opacity = 0.8,
  fill = 0,
  ring = 0.3,
  line = 0.07,
  ring2 = 0,
  line2 = 0.03,
  ticks = false,
  tickIn = 0.22,
  tickOut = 0.44,
  bezel = 0,
  bezelIn = 0.4,
  bezelOut = 0.46,
  bezelWidth = 0.014,
  bezelSpin = 0,
  keyline = 0,
  keyColor = '#2a2419',
  glow = 0,
  glowRadius = 0.5,
  glowColor = '#ffffff',
  popMs = 200,
  delayMs = 0,
  lift = 0.012,
}: RingStyle & { floor: Vec3; hovered?: boolean; lift?: number }) => {
  const invalidate = useThree((s) => s.invalidate);
  const elapsed = useRef(-delayMs / 1000);
  const done = useRef(false);
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
          uFill: { value: 0 },
          uRing: { value: 0.3 },
          uLine: { value: 0.07 },
          uRing2: { value: 0 },
          uLine2: { value: 0.03 },
          uTicks: { value: 0 },
          uTickIn: { value: 0.2 },
          uTickOut: { value: 0.44 },
          uBezel: { value: 0 },
          uBezelIn: { value: 0.4 },
          uBezelOut: { value: 0.46 },
          uBezelWidth: { value: 0.014 },
          uRot: { value: 0 },
          uKeyColor: { value: new Color() },
          uKey: { value: 0 },
          uGlow: { value: 0 },
          uGlowRadius: { value: 0.5 },
          uGlowColor: { value: new Color() },
          uHover: { value: 0 },
          uScale: { value: popMs > 0 ? 0.001 : 1 },
          uFade: { value: popMs > 0 ? 0 : 1 },
        },
        vertexShader: markerVertex,
        fragmentShader: markerFragment,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the pop state is set on mount only
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const u = material.uniforms;
  (u.uColor.value as Color).set(color);
  u.uOpacity.value = opacity;
  u.uFill.value = fill;
  u.uRing.value = ring;
  u.uLine.value = line;
  u.uRing2.value = ring2;
  u.uLine2.value = line2;
  u.uTicks.value = ticks ? 1 : 0;
  u.uTickIn.value = tickIn;
  u.uTickOut.value = tickOut;
  u.uBezel.value = bezel;
  u.uBezelIn.value = bezelIn;
  u.uBezelOut.value = bezelOut;
  u.uBezelWidth.value = bezelWidth;
  (u.uKeyColor.value as Color).set(keyColor);
  u.uKey.value = keyline;
  u.uGlow.value = glow;
  u.uGlowRadius.value = glowRadius;
  (u.uGlowColor.value as Color).set(glowColor);
  u.uHover.value = hovered ? 1 : 0;

  const spin = prefersReducedMotion() ? 0 : bezelSpin;
  useFrame((_, delta) => {
    if (done.current && spin === 0) return;
    const dt = Math.min(delta, 1 / 30);
    elapsed.current += dt;
    u.uRot.value = (u.uRot.value + dt * spin) % (Math.PI * 2);
    if (!done.current) {
      const t = popMs > 0 ? Math.min(Math.max(elapsed.current / (popMs / 1000), 0), 1) : 1;
      u.uScale.value = Math.max(0.55 + 0.45 * easeOutBack(t), 0.001);
      u.uFade.value = Math.min(t * 1.6, 1);
      if (t >= 1) done.current = true;
    }
    invalidate();
  });

  return (
    <mesh
      geometry={quad}
      material={material}
      position={[floor[0], floor[1] + lift, floor[2]]}
      renderOrder={LAYER.marker}
      raycast={noRaycast}
    />
  );
};

// --- The family ----------------------------------------------------------------------

export const QUIET: RingStyle = {
  color: PAL.graphite,
  opacity: 0.78,
  fill: 0.09,
  ring: 0.3,
  line: 0.065,
};

export const CAPTURE: RingStyle = {
  ...QUIET,
  color: PAL.vermilion,
  opacity: 0.95,
  fill: 0.14,
  line: 0.07,
  ticks: true,
  tickIn: 0.24,
  tickOut: 0.45,
};

export const Quiet = ({ floor, hovered }: MarkerProps) => (
  <Ring floor={floor} hovered={hovered} {...QUIET} />
);

export const Capture = ({ floor, hovered }: MarkerProps) => (
  <Ring floor={floor} hovered={hovered} {...CAPTURE} />
);

export const Selection = ({ floor }: MarkerProps) => (
  <Ring
    floor={floor}
    color={PAL.halo}
    opacity={1}
    ring={0.35}
    line={0.05}
    bezel={24}
    bezelIn={0.405}
    bezelOut={0.475}
    bezelWidth={0.026}
    bezelSpin={0.3}
    keyline={0.014}
    keyColor="#2f2616"
    glow={0.62}
    glowRadius={0.5}
    glowColor={PAL.pool}
    popMs={340}
    lift={0.014}
  />
);

export const Check = ({ floor }: MarkerProps) => (
  <Ring
    floor={floor}
    color={PAL.crimson}
    opacity={1}
    fill={0.26}
    ring={0.33}
    line={0.075}
    ring2={0.43}
    line2={0.03}
    popMs={260}
    lift={0.016}
  />
);

// --- The last move ---------------------------------------------------------------------

const traceVertex = /* glsl */ `
  attribute vec3 aTangent;
  attribute float aSide;
  attribute float aHalf;
  attribute float aAlong;
  varying float vAcross;
  varying float vHalf;
  varying float vAlong;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 t = normalize(mat3(modelMatrix) * aTangent);
    vec3 toCamera = normalize(cameraPosition - world.xyz);
    vec3 across = cross(t, toCamera);
    float l = length(across);
    across = l > 1e-4 ? across / l : vec3(1.0, 0.0, 0.0);
    world.xyz += across * aSide * aHalf;
    vAcross = aSide * aHalf;
    vHalf = aHalf;
    vAlong = aAlong;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const traceFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uEdge;
  uniform float uOpacity;
  uniform float uEdgeWidth;
  uniform float uChevron;
  uniform float uShaftEnd;
  uniform float uReveal;
  varying float vAcross;
  varying float vHalf;
  varying float vAlong;
  void main() {
    if (vAlong > uReveal) discard;
    float d = abs(vAcross);
    float aa = max(fwidth(vAcross), 1e-4);
    float body = 1.0 - smoothstep(vHalf - aa, vHalf + aa * 0.5, d);
    float rim = smoothstep(vHalf - uEdgeWidth - aa, vHalf - uEdgeWidth + aa, d);
    vec3 col = uColor;
    if (uChevron > 0.0 && vAlong < uShaftEnd - uChevron * 0.4) {
      // Chevrons pointing ahead, a shade deeper than the ribbon
      float phase = fract((vAlong - d * 1.2) / uChevron);
      float ab = max(fwidth(phase), 1e-4);
      float band = smoothstep(0.0, ab, phase) * (1.0 - smoothstep(0.3 - ab, 0.3, phase));
      col = mix(col, uEdge, band * 0.32);
    }
    col = mix(col, uEdge, rim);
    float a = body * uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }`;

/**
 * The last move's path, a camera-facing ribbon with a dark keyline and an
 * arrowhead beside the piece that moved. It draws itself from the source to
 * the destination over `revealMs` (the piece's flight), then holds still.
 */
export const Trace = ({
  from,
  to,
  revealMs,
  color = PAL.amber,
  edgeColor = PAL.amberEdge,
  width = 0.085,
  headLength = 0.3,
  headWidth = 0.28,
  chevrons = 0.4,
}: {
  from: Vec3;
  to: Vec3;
  revealMs: number;
  color?: string;
  edgeColor?: string;
  width?: number;
  headLength?: number;
  headWidth?: number;
  chevrons?: number;
}) => {
  const invalidate = useThree((s) => s.invalidate);
  const key = JSON.stringify([from, to, width, headLength, headWidth]);
  const { geometry, length, shaftEnd } = useMemo(() => {
    const data = ribbonData(tracePath(from, to, { arc: 0.5, endInset: 0.38, lift: 0.05 }), {
      width,
      headLength,
      headWidth,
    });
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(data.position, 3));
    g.setAttribute('aTangent', new BufferAttribute(data.tangent, 3));
    g.setAttribute('aSide', new BufferAttribute(data.side, 1));
    g.setAttribute('aHalf', new BufferAttribute(data.halfWidth, 1));
    g.setAttribute('aAlong', new BufferAttribute(data.along, 1));
    g.setIndex(data.index);
    g.computeBoundingSphere();
    return {
      geometry: g,
      length: data.length,
      shaftEnd: data.length - Math.min(headLength, data.length * 0.6),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the values themselves
  }, [key]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        uniforms: {
          uColor: { value: new Color(color) },
          uEdge: { value: new Color(edgeColor) },
          uOpacity: { value: 1 },
          uEdgeWidth: { value: Math.min(width * 0.2, 0.03) },
          uChevron: { value: chevrons },
          uShaftEnd: { value: 1 },
          uReveal: { value: revealMs > 0 ? 0 : 1e6 },
        },
        vertexShader: traceVertex,
        fragmentShader: traceFragment,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one trace per move (keyed by its parent)
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  material.uniforms.uShaftEnd.value = shaftEnd;

  const elapsed = useRef(0);
  const done = useRef(revealMs <= 0);
  const mesh = useRef<Mesh>(null);
  useFrame((_, delta) => {
    if (done.current) return;
    elapsed.current += Math.min(delta, 1 / 30) * 1000;
    const t = Math.min(elapsed.current / revealMs, 1);
    // Ease in and out, like the piece's own glide
    const e = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
    material.uniforms.uReveal.value = t >= 1 ? 1e6 : e * length;
    if (t >= 1) done.current = true;
    invalidate();
  });

  return (
    <mesh
      ref={mesh}
      geometry={geometry}
      material={material}
      renderOrder={LAYER.trace}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

const LAST_FROM: RingStyle = {
  color: PAL.amber,
  opacity: 0.85,
  fill: 0.08,
  ring: 0.3,
  line: 0.06,
};
const LAST_TO: RingStyle = { ...LAST_FROM, opacity: 1, fill: 0.12, line: 0.075 };

/** Both squares of the last move, and the path between them, animated once per move. */
const LastMoveOnce = ({ from, to, flightMs }: LastMoveMarkerProps & { flightMs: number }) => (
  <>
    <Ring floor={from.floor} {...LAST_FROM} popMs={160} />
    <Ring floor={to.floor} {...LAST_TO} popMs={260} delayMs={flightMs * 0.85} />
    <Trace from={from.floor} to={to.floor} revealMs={prefersReducedMotion() ? 0 : flightMs} />
  </>
);

/** The last-move marker set for a design whose pieces take `flightMs` to move. */
export const lastMoveMarker = (flightMs: number) => {
  const LastMove = ({ from, to }: LastMoveMarkerProps) => (
    // A new move remounts the set, so its entrance plays once per move
    <LastMoveOnce
      key={JSON.stringify([from.floor, to.floor])}
      from={from}
      to={to}
      flightMs={flightMs}
    />
  );
  return LastMove;
};
