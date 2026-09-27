import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, DoubleSide, PlaneGeometry, ShaderMaterial } from 'three';
import { LAYER } from '../kit/layers';
import { LastMoveLine } from '../kit/line';
import { noRaycast } from '../kit/noRaycast';
import { prefersReducedMotion } from '../../motion';
import type { LastMoveMarkerProps, MarkerProps, Vec3 } from '../types';
import { PAL } from './palette';

// Atelier's markers are one family: a slim ring lying on the platform where a
// piece stands, in hues nothing else in the scene uses.
//
//   can move    a teal ring round a faint teal landing spot
//   capture     the same ring in vermilion, wide enough to clear the
//               victim's base, with four reticle ticks out to the corners
//   last move   the same ring in amber on both squares, joined by a thin
//               amber line from centre to centre; a live move draws it along
//               the flight
//   check       the ring in crimson, doubled, round the king's base
//   selection   a fine warm-white halo and watch bezel over a pool of light
//
// Each is one quad shaded by a signed distance, crisp at any angle. They pop
// in over a fifth of a second (the last move only when it is live) and are
// still after that.

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
  uniform float uDiagonal;
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
    float line = uLine * (1.0 + 0.5 * uHover);
    float stroke = abs(r - uRing) - line * 0.5;
    if (uRing2 > 0.0) stroke = min(stroke, abs(r - uRing2) - uLine2 * 0.5);
    if (uTicks > 0.5) {
      // A reticle: four ticks on the axes, or out toward the corners
      vec2 q = abs(uDiagonal > 0.5 ? vec2(p.x + p.y, p.x - p.y) * 0.70710678 : p);
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
    float strength = min(uOpacity * (1.0 + 0.35 * uHover), 1.0);
    float fill = uFill + 0.2 * uHover;
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
  /** Reticle ticks (the capture cue): on the axes, or out to the corners. */
  ticks?: boolean;
  diagonal?: boolean;
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
  diagonal = false,
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
          uDiagonal: { value: 0 },
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
  u.uDiagonal.value = diagonal ? 1 : 0;
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
  color: PAL.teal,
  opacity: 0.9,
  fill: 0.08,
  ring: 0.36,
  line: 0.055,
};

// The victim hides whatever lies under its base, so the capture ring is wider
// and its ticks point out to the square's corners, beyond the footprint
export const CAPTURE: RingStyle = {
  ...QUIET,
  color: PAL.vermilion,
  opacity: 0.95,
  fill: 0.12,
  ring: 0.43,
  line: 0.06,
  ticks: true,
  diagonal: true,
  tickIn: 0.47,
  tickOut: 0.62,
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
    glow={0.8}
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
    fill={0.24}
    ring={0.425}
    line={0.075}
    ring2={0.48}
    line2={0.028}
    popMs={260}
    lift={0.016}
  />
);

// --- The last move ---------------------------------------------------------------------

const LAST_FROM: RingStyle = {
  color: PAL.amber,
  opacity: 0.85,
  fill: 0.08,
  ring: 0.36,
  line: 0.05,
};
const LAST_TO: RingStyle = { ...LAST_FROM, opacity: 1, fill: 0.12, line: 0.065 };

/**
 * The last-move marker set for a design whose pieces take `flightMs` to move.
 * Board keys it by move and says whether the move is live (`fresh`): only
 * then does it play its entrance (the line drawn along the flight, the
 * destination ring set down as the piece lands). A replay or a rejoin shows
 * it whole, at once.
 */
export const lastMoveMarker = (flightMs: number) => {
  const LastMove = ({ from, to, fresh = false, arc = 0 }: LastMoveMarkerProps) => {
    const live = fresh && !prefersReducedMotion();
    return (
      <>
        <Ring floor={from.floor} {...LAST_FROM} popMs={live ? 160 : 0} />
        <Ring
          floor={to.floor}
          {...LAST_TO}
          popMs={live ? 260 : 0}
          delayMs={live ? flightMs * 0.85 : 0}
        />
        <LastMoveLine
          from={from.floor}
          to={to.floor}
          arc={arc}
          color={PAL.amber}
          pulseColor="#ffe2ad"
          radius={0.02}
          // Drawn along the flight
          drawInMs={live ? flightMs : 0}
        />
      </>
    );
  };
  return LastMove;
};
