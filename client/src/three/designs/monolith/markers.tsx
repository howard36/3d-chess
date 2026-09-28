import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, DoubleSide, PlaneGeometry, ShaderMaterial, Vector3 } from 'three';
import { prefersReducedMotion } from '../../motion';
import { LAYER } from '../kit/layers';
import { LastMoveLine } from '../kit/line';
import { noRaycast } from '../kit/noRaycast';
import type { LastMoveMarkerProps, MarkerProps, Vec3 } from '../types';
import { claimed, useClaim } from './claims';
import { LEVEL_COLORS, levelAt, MOTION, PALETTE, PIECE_SCALE, RING_RADIUS } from './palette';

// The marks of play, one family of thin rings of light lying on the glass:
//
// - where a piece may go: a thin ring of its level's light, lifted toward
//   white, round a slight fill of the level's colour. Under the pointer the
//   fill deepens (fuller, a deeper colour at its heart) and the ring grows a
//   little, eased over 200 ms; the ring itself does not brighten.
// - a capture: the same ring in coral red, taking the place of the victim's
//   own level ring (which steps aside, claims.ts), so the two never stack;
//   one small mote of white light circles it slowly. Hover as above.
// - the last move: a dashed ring of white light laid over the level ring of
//   the piece that moved, the same dashed ring smaller on the square it left,
//   and a thin dashed white line between them, flowing slowly.
// - check: a crown of red light lying round the king in place of his ring,
//   a band with eight points; it strikes once when check arrives (a flash
//   and one strong wave), then slow ripples keep leaving it.
// - the held piece: its cone of light and glow are the piece's own
//   (pieces.tsx), so they ease out when it is put down; here it is only
//   noted where it stands, for the destination straight below or above it.
//
// Every mark is one quad shaded by a signed distance, crisp at any angle,
// and drawn over every level (LAYER), so a mark three levels down reads as
// clearly as one on top.

const KIND = { quiet: 0, capture: 1, trace: 2, check: 3 } as const;
type Kind = keyof typeof KIND;

const vertexShader = /* glsl */ `
  uniform float uQuad;
  varying vec2 vP;
  void main() {
    vP = (uv - 0.5) * uQuad;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const fragmentShader = /* glsl */ `
  uniform int uKind;
  uniform vec3 uColor;
  uniform vec3 uFill;
  uniform vec3 uDeep;
  uniform vec3 uMote;
  uniform float uRadius;
  uniform float uWidth;
  uniform float uFillA;
  uniform float uHover;
  uniform float uGrow;
  uniform float uTime;
  uniform float uPulse;
  uniform float uReveal;
  uniform float uDashes;
  uniform float uAmount;
  uniform float uOpacity;
  varying vec2 vP;

  const float TAU = 6.2831853;

  // A line of half-width w at signed distance d: crisp, never thinner than
  // about a pixel (fainter instead)
  float stroke(float d, float w) {
    float fw = max(fwidth(d), 1e-5);
    float ww = max(w, fw * 0.7);
    return (1.0 - smoothstep(ww - fw, ww + fw, abs(d))) * min(w / ww, 1.0);
  }
  float fillOf(float d) {
    float fw = max(fwidth(d), 1e-5);
    return 1.0 - smoothstep(-fw, fw, d);
  }
  vec4 over(vec4 dst, vec3 c, float a) {
    return vec4(c * a + dst.rgb * (1.0 - a), a + dst.a * (1.0 - a));
  }

  void main() {
    // Grows in on arrival, and a little under the pointer
    float s = mix(0.86, 1.0, uGrow) * (1.0 + 0.11 * uHover);
    vec2 p = vP / s;
    float r = length(p);
    float ang = atan(p.y, p.x);
    float R = uRadius;
    vec4 c = vec4(0.0);

    if (uKind == 0 || uKind == 1) {
      // The fill: slight at rest; under the pointer fuller and deeper at the
      // heart, like light pooling in glass
      float inside = fillOf(r - R);
      float k = r / R;
      float rest = uFillA * (0.75 + 0.25 * k);
      float held = uHover * (0.2 + 0.1 * (1.0 - k));
      vec3 fc = mix(uFill, uDeep, uHover * (1.0 - k * k));
      c = over(c, fc, inside * (rest + held));
      c = over(c, uColor, stroke(r - R, uWidth) * uOpacity);
      if (uKind == 1) {
        // One mote of light, circling slowly
        float a0 = uTime * TAU / 7.5;
        float d = length(p - R * vec2(cos(a0), sin(a0)));
        float glow = exp(-d * d / (0.035 * 0.035)) * 0.55;
        c = over(c, uColor, glow);
        c = over(c, uMote, fillOf(d - 0.017));
      }
    } else if (uKind == 2) {
      // The last move: a dashed ring, drawn in round from its far side
      float along = fract(ang / TAU + 0.25);
      float f = fract(ang / TAU * uDashes);
      float fw = max(fwidth(ang / TAU * uDashes), 1e-4);
      float dash = smoothstep(0.0, fw, f) * (1.0 - smoothstep(0.58 - fw, 0.58, f));
      float shown = step(along, uReveal);
      c = over(c, uColor, stroke(r - R, uWidth) * dash * shown * uOpacity);
    } else {
      // Check: a crown of red light round the king, a band with eight points
      float seg = TAU / 8.0;
      float phi = mod(ang + seg * 0.5, seg) - seg * 0.5;
      float tine = max(0.0, 1.0 - abs(phi) / (seg * 0.32));
      float outer = R + 0.085 * tine;
      float inner = R - 0.05;
      float strike = 1.0 + 1.4 * uPulse;
      float band = fillOf(r - outer) * (1.0 - fillOf(r - inner));
      c = over(c, uColor, band * 0.22 * strike);
      c = over(c, uColor, fillOf(r - inner) * 0.07);
      c = over(c, uColor, stroke(r - outer, uWidth) * min(uOpacity * strike, 1.0));
      c = over(c, uColor, stroke(r - inner, uWidth * 0.7) * 0.6 * uOpacity);
      // Slow ripples leave it, two at a time, fading as they spread
      for (int i = 0; i < 2; i++) {
        float ph = fract(uTime / 2.8 + float(i) * 0.5);
        float rr = mix(R + 0.1, 0.62, ph);
        c = over(c, uColor, stroke(r - rr, 0.009) * (1.0 - ph) * (1.0 - ph) * 0.7 * uGrow);
      }
      // The strike: one strong wave when check arrives
      float wave = mix(R, 0.8, 1.0 - uPulse);
      c = over(c, uColor, stroke(r - wave, 0.016) * uPulse * 0.9);
    }
    c.a *= uAmount * uGrow;
    c.rgb *= uAmount * uGrow;
    if (c.a < 0.003) discard;
    gl_FragColor = vec4(c.rgb / c.a, c.a);
    #include <colorspace_fragment>
  }`;

const planes = new Map<number, PlaneGeometry>();
const planeFor = (size: number) => {
  const key = Math.round(size * 1000);
  let g = planes.get(key);
  if (!g) {
    g = new PlaneGeometry(size, size).rotateX(-Math.PI / 2);
    planes.set(key, g);
  }
  return g;
};

const white = new Color('#ffffff');

interface MarkProps {
  floor: Vec3;
  kind: Kind;
  color: string;
  radius: number;
  width: number;
  fill?: string;
  deep?: string;
  fillA?: number;
  opacity?: number;
  hovered?: boolean;
  dashes?: number;
  /** Grow in over this long when mounted (0: at once). */
  growMs?: number;
  /** Draw in round the ring over this long, after `delayMs` (0: whole at once). */
  drawMs?: number;
  delayMs?: number;
  /** Strike once on mount (check). */
  pulse?: boolean;
  /** Keep frames coming while up (the capture's mote, the check's ripples). */
  animate?: boolean;
  /** Step aside while a capture marker has taken this floor. */
  yieldToCapture?: boolean;
  /** Step back a little seen from high above (a destination off the held piece's level). */
  dimAbove?: boolean;
  renderOrder?: number;
  lift?: number;
}

const HOVER_MS = 200;
const PULSE_MS = 750;

/** One mark flat on the glass at a cell's floor. */
const Mark = ({
  floor,
  kind,
  color,
  radius,
  width,
  fill,
  deep,
  fillA = 0,
  opacity = 1,
  hovered = false,
  dashes = 0,
  growMs = 160,
  drawMs = 0,
  delayMs = 0,
  pulse = false,
  animate = false,
  yieldToCapture = false,
  dimAbove = false,
  renderOrder = LAYER.marker,
  lift = 0.012,
}: MarkProps) => {
  const invalidate = useThree((s) => s.invalidate);
  const quad = kind === 'check' ? 1.7 : (radius * 1.25 + 0.1) * 2;
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
          uKind: { value: KIND[kind] },
          uColor: { value: new Color(color) },
          uFill: { value: new Color(fill ?? color) },
          uDeep: { value: new Color(deep ?? fill ?? color) },
          uMote: { value: new Color('#fff8f0') },
          uRadius: { value: radius },
          uWidth: { value: width },
          uFillA: { value: fillA },
          uHover: { value: 0 },
          uGrow: { value: growMs > 0 ? 0 : 1 },
          uTime: { value: 0 },
          uPulse: { value: pulse && !prefersReducedMotion() ? 1 : 0 },
          uReveal: { value: drawMs > 0 ? 0 : 1 },
          uDashes: { value: dashes },
          uAmount: { value: 1 },
          uOpacity: { value: opacity },
          uQuad: { value: quad },
        },
        vertexShader,
        fragmentShader,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- made once; uniforms follow the props below
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const u = material.uniforms;
  (u.uColor.value as Color).set(color);
  u.uRadius.value = radius;
  u.uOpacity.value = opacity;
  u.uQuad.value = quad;

  const age = useRef(0);
  const hover = useRef(0);
  const still = prefersReducedMotion();
  useEffect(() => invalidate(), [hovered, invalidate]);
  useFrame(({ camera }, delta) => {
    const dt = Math.min(delta, 1 / 8);
    age.current += dt * 1000;
    let moving = false;
    // The grow-in on arrival
    if (u.uGrow.value < 1) {
      const k = Math.min(age.current / growMs, 1);
      u.uGrow.value = 1 - (1 - k) ** 3;
      moving = true;
    }
    // Hover eases in and out over HOVER_MS (smoothstep of a steady ramp)
    const goal = hovered ? 1 : 0;
    if (hover.current !== goal) {
      const step = (Math.min(delta, 1 / 20) * 1000) / HOVER_MS;
      const h = hover.current;
      hover.current = goal > h ? Math.min(goal, h + step) : Math.max(goal, h - step);
      const e = hover.current;
      u.uHover.value = e * e * (3 - 2 * e);
      moving = true;
    }
    if (u.uPulse.value > 0) {
      u.uPulse.value = Math.max(0, 1 - age.current / PULSE_MS);
      moving = true;
    }
    if (drawMs > 0 && u.uReveal.value < 1) {
      const k = Math.min(Math.max((age.current - delayMs) / drawMs, 0), 1);
      u.uReveal.value = 1 - (1 - k) ** 2;
      moving = true;
    }
    if (animate && !still) {
      u.uTime.value += dt;
      moving = true;
    }
    let amount = 1;
    if (yieldToCapture) {
      probe.x = floor[0];
      probe.y = floor[1];
      probe.z = floor[2];
      if (claimed(probe, ['capture'])) amount = 0;
    }
    if (dimAbove) {
      // From high above, the held piece's own level leads
      camera.getWorldDirection(look);
      const k = Math.min(Math.max((-look.y - 0.8) / 0.17, 0), 1);
      amount *= 1 - 0.4 * k * k * (3 - 2 * k);
    }
    u.uAmount.value = amount;
    if (moving) invalidate();
  });

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

const probe = { x: 0, y: 0, z: 0 };
const look = new Vector3();

// --- Where the held piece stands ------------------------------------------------------

let heldFloor: Vec3 | null = null;
const heldListeners = new Set<() => void>();
const setHeld = (floor: Vec3 | null) => {
  heldFloor = floor;
  heldListeners.forEach((l) => l());
};
const subscribeHeld = (l: () => void) => {
  heldListeners.add(l);
  return () => heldListeners.delete(l);
};
const useHeld = () => useSyncExternalStore(subscribeHeld, () => heldFloor);

// --- The marker set -----------------------------------------------------------------------

/** Radius of the level ring at a piece's foot (world units). */
const FOOT_RING = RING_RADIUS * PIECE_SCALE;
const QUIET_RADIUS = 0.2;
/** Straight below or above the held piece: wide enough to show round it from above. */
const QUIET_STACKED = 0.34;
const CAPTURE_RADIUS = FOOT_RING + 0.035;
const TRACE_TO = FOOT_RING;
const TRACE_FROM = FOOT_RING * 0.66;

const levelLight = LEVEL_COLORS.map((c) => `#${new Color(c).lerp(white, 0.42).getHexString()}`);
const levelDeep = LEVEL_COLORS.map((c) => `#${new Color(c).multiplyScalar(0.62).getHexString()}`);

export const Quiet = ({ floor, hovered }: MarkerProps) => {
  const level = levelAt(floor[1]);
  const held = useHeld();
  const offLevel = !!held && levelAt(held[1]) !== level;
  const stacked =
    !!held && Math.abs(held[0] - floor[0]) < 1e-3 && Math.abs(held[2] - floor[2]) < 1e-3;
  return (
    <Mark
      floor={floor}
      kind="quiet"
      color={levelLight[level]}
      fill={LEVEL_COLORS[level]}
      deep={levelDeep[level]}
      fillA={0.16}
      radius={stacked ? QUIET_STACKED : QUIET_RADIUS}
      width={0.0095}
      opacity={0.9}
      hovered={hovered}
      dimAbove={offLevel}
    />
  );
};

export const Capture = ({ floor, hovered }: MarkerProps) => {
  useClaim('capture', floor);
  return (
    <Mark
      floor={floor}
      kind="capture"
      color={PALETTE.capture}
      fill={PALETTE.capture}
      deep="#8a1d16"
      fillA={0.1}
      radius={CAPTURE_RADIUS}
      width={0.008}
      opacity={0.92}
      hovered={hovered}
      animate
    />
  );
};

/** Notes where the held piece stands; its light is the piece's own (pieces.tsx). */
export const Selection = ({ floor }: MarkerProps) => {
  const [x, y, z] = floor;
  useLayoutEffect(() => {
    setHeld([x, y, z]);
    return () => setHeld(null);
  }, [x, y, z]);
  return null;
};

/**
 * The last move: a dashed ring of white light over the level ring of the
 * piece that moved (drawn in as it lands), the same ring smaller where it
 * started, and the thin dashed line between them, flowing slowly on.
 */
export const LastMove = ({ from, to, fresh = false, arc = 0 }: LastMoveMarkerProps) => (
  <>
    <Mark
      floor={from.floor}
      kind="trace"
      color={PALETTE.trace}
      radius={TRACE_FROM}
      width={0.0105}
      opacity={0.85}
      dashes={12}
      growMs={0}
    />
    <Mark
      floor={to.floor}
      kind="trace"
      color={PALETTE.trace}
      radius={TRACE_TO}
      width={0.0115}
      opacity={0.95}
      dashes={12}
      growMs={0}
      drawMs={fresh ? 320 : 0}
      delayMs={fresh ? MOTION.durationMs * 0.8 : 0}
      yieldToCapture
      renderOrder={LAYER.marker + 0.1}
    />
    <LastMoveLine
      from={from.floor}
      to={to.floor}
      arc={arc}
      color={PALETTE.trace}
      pulseColor="#ffffff"
      pattern="dashed"
      radius={0.0105}
      opacity={0.72}
      spacing={0.15}
      dash={0.55}
      pulse={0.35}
      flowSpeed={0.22}
      shade={0.25}
      drawInMs={fresh ? 380 : 0}
      drawInDelayMs={fresh ? MOTION.durationMs * 0.3 : 0}
    />
  </>
);

/** Check: a crown of red light round the king, striking once, then rippling slowly. */
export const Check = ({ floor }: MarkerProps) => {
  useClaim('check', floor);
  return (
    <Mark
      floor={floor}
      kind="check"
      color={PALETTE.check}
      radius={FOOT_RING + 0.01}
      width={0.008}
      opacity={0.95}
      growMs={220}
      pulse
      animate
      renderOrder={LAYER.marker + 0.2}
    />
  );
};
