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
  ShaderMaterial,
  Vector3,
} from 'three';
import type { Group, Mesh } from 'three';
import { PieceType } from '../../engine/pieces';
import { prefersReducedMotion } from '../motion';
import { pieceSet, pieceTop } from '../pieces';
import { LAYER } from './layers';
import { LastMoveLine } from './line';
import { tracePath, tubeData } from './markerGeometry';
import { noRaycast } from '../noRaycast';
import { useSettings } from '../settings';
import type { LastMoveMarkerProps, MarkerProps, Vec3 } from '../types';
import { claimed, heldAt, useClaim, useHeld } from './claims';
import type { ClaimKind } from './claims';
import { LEVEL_COLORS, levelAt, MOTION, PALETTE, PIECE_SCALE, RING_RADIUS } from './palette';
import { Blades } from './blades';
import { BLADE_STYLES, CAPTURE_STYLES, useMarkSetting } from './settings-markers';
import type { BladeStyle, CaptureStyle } from './settings-markers';
import { pieceLift } from './settings-pieces';

// The marks of play, one family of thin circles of light lying on the glass:
//
// - where a piece may go: a thin circle of soft gold (a colour no level
//   uses, so it never reads as a level ring) round a slight fill tinted with
//   its level's colour. Under the pointer the fill deepens (fuller, a deeper
//   colour at its heart) and the circle grows a little, eased over 200 ms;
//   the outline itself does not brighten. Straight above or below the held
//   piece, as the view comes round to top-down, it widens and gives up its
//   rim for a soft pool, so it never rings the piece.
// - a capture: the same circle in red, drawn in place of the victim's own
//   level ring (which steps aside, claims.ts), so two circles never stack;
//   its one idea is a setting (settings-markers.ts): four arcs of one
//   radius and length turning slowly and evenly round the victim (the
//   default), a short wall of red light rising round the victim's foot like
//   a threat, sparks of heat glowing up and dying away in a dark fill, a
//   glow drawing in tight onto its rim from outside, or one mote circling
//   it.
//   Hover as above (the rising glow also stands a little taller).
// - the last move: a thin continuous line of deep mint light, a soft glow
//   of white travelling calmly along it, from a small circle where the piece
//   started to the same circle, larger, round the piece where it landed,
//   meeting that circle on the glass beside the piece (never running into
//   it; pieces hide the line wherever it passes behind them).
// - check: a crown of red light lying round the king in place of his ring, a
//   band with eight points. It strikes when check arrives (it lands a little
//   large, flashes and sends one strong wave out), then breathes slowly,
//   one faint ripple leaving it with each breath (reaching further when it
//   stands alone). Round him stand dark, keen blades with red edges, in a
//   style of the player's choosing (blades.tsx), and a small crown of red
//   light can float over his cross, turning slowly. At mate it all settles
//   as the king falls.
//
// Every flat mark is one quad shaded by a signed distance, crisp at any
// angle, and drawn over every level (LAYER), so a mark three levels down
// reads as clearly as one on top.

const KIND = { quiet: 0, capture: 1, trace: 2, check: 3 } as const;
type Kind = keyof typeof KIND;
const STYLE_ID: Record<CaptureStyle, number> = { ember: 0, close: 1, arcs: 2, rise: 3, orbit: 4 };

const vertexShader = /* glsl */ `
  uniform float uQuad;
  varying vec2 vP;
  varying vec3 vWorld;
  void main() {
    vP = (uv - 0.5) * uQuad;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const fragmentShader = /* glsl */ `
  uniform int uKind;
  uniform int uStyle;
  uniform vec3 uColor;
  uniform vec3 uFill;
  uniform vec3 uDeep;
  uniform vec3 uHot;
  uniform vec3 uMote;
  uniform float uRadius;
  uniform float uWidth;
  uniform float uFillA;
  uniform float uWashA;
  uniform float uHover;
  uniform float uGrow;
  uniform float uTime;
  uniform float uPulse;
  uniform float uStrength;
  uniform float uReveal;
  uniform float uAmount;
  uniform float uOpacity;
  uniform float uSettle;
  uniform float uSoft;
  uniform float uSoftRadius;
  uniform float uLoud;
  varying vec2 vP;
  varying vec3 vWorld;

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

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  // Embers: sparks of heat scattered through the fill (q in units of the
  // radius), each glowing up and dying away on its own slow beat
  float embers(vec2 q, float t) {
    const float CELL = 0.3;
    vec2 g = q / CELL;
    vec2 cell = floor(g);
    float sum = 0.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 c = cell + vec2(float(i), float(j));
        float h1 = hash(c);
        float h2 = hash(c + 17.3);
        float h3 = hash(c + 41.7);
        vec2 at = c + 0.2 + 0.6 * vec2(h1, h2);
        float d = length(g - at) * CELL;
        float beat = pow(0.5 + 0.5 * sin(t * (0.7 + 0.9 * h3) + h1 * TAU), 2.0);
        sum += exp(-d * d / (0.085 * 0.085)) * beat * step(0.25, h3);
      }
    }
    return min(sum, 1.0);
  }

  // Distance to four arcs on a circle of radius ra, each spanning this share
  // of its quarter, turned by this angle; round-ended, nothing inside
  float arcs(vec2 p, float ra, float span, float turn) {
    float q = TAU / 4.0;
    float phi = mod(atan(p.y, p.x) + turn + q * 0.5, q) - q * 0.5;
    float hs = span * q * 0.5;
    float r = length(p);
    if (abs(phi) < hs) return abs(r - ra);
    vec2 local = r * vec2(cos(phi), sin(phi));
    return length(local - ra * vec2(cos(hs), sign(phi) * sin(hs)));
  }

  void main() {
    vec4 c = vec4(0.0);
    if (uKind == 0 || uKind == 1) {
      // Grows in on arrival, and a little under the pointer
      float s = mix(0.86, 1.0, uGrow) * (1.0 + 0.11 * uHover);
      vec2 p = vP / s;
      float r = length(p);
      // Straight above or below the held piece (uSoft), as the view comes
      // round to top-down it widens and gives up its rim for a soft-edged
      // pool, so it never rings the piece's own circle; from the side it is
      // a circle like the rest
      float soft = uSoft * smoothstep(0.75, 0.95, abs(normalize(cameraPosition - vWorld).y));
      float R = mix(uRadius, uSoftRadius, soft);
      float k = r / R;
      bool capture = uKind == 1;
      float inside = mix(fillOf(r - R), 1.0 - smoothstep(0.55 * R, R, r), soft);
      // The fill: slight at rest; under the pointer fuller and deeper at the
      // heart, like light pooling in glass
      float rest = uFillA * (0.75 + 0.25 * k) * (1.0 + 0.9 * soft);
      float held = uHover * (0.2 + 0.1 * (1.0 - k));
      vec3 fc = mix(uFill, uDeep, uHover * (1.0 - k * k));
      float sparks = 0.0;
      if (capture && uStyle == 0) {
        // Embers: sparks of heat glowing up and dying away through a dark
        // red fill, drifting slowly round
        float cs = cos(uTime * 0.05);
        float sn = sin(uTime * 0.05);
        sparks = embers(mat2(cs, -sn, sn, cs) * (p / R), uTime) * smoothstep(1.0, 0.8, k);
      }
      c = over(c, fc, inside * (rest + held));
      c = over(c, uHot, inside * sparks * (0.85 - 0.35 * uHover));
      // A move: a faint wash of its own colour just inside the rim, so it
      // reads as a gold circle from afar, whatever the tint of its fill
      c = over(c, uColor, exp(-max(R - r, 0.0) / (0.2 * R)) * fillOf(r - R) * uWashA * (1.0 - soft));
      float line = stroke(r - R, uWidth);
      if (capture && uStyle == 2) {
        // Turning arcs: four arcs of one radius and one length, turning
        // round the victim at one slow, even speed
        line = stroke(arcs(p, R, 0.62, uTime * TAU / 16.0), uWidth * 1.4);
      }
      c = over(c, uColor, line * uOpacity * (1.0 - soft));
      if (capture && uStyle == 1) {
        // Closing in: a glow held to the outside of the rim, wide and faint
        // at first, drawing in tighter and brighter onto the rim (one
        // figure with it, never a second ring), and the fill tightens as
        // it arrives; then it lets go and gathers again
        float ph = fract(uTime / 2.6);
        float w = R * (0.02 + 0.5 * pow(1.0 - ph, 1.6));
        float a = (0.12 + 0.3 * ph) * smoothstep(0.0, 0.2, ph) * (1.0 - smoothstep(0.88, 1.0, ph));
        float outside = step(R, r) * exp(-(r - R) / w);
        c = over(c, uColor, outside * a * (1.0 - soft));
        float tight = exp(-pow((ph - 0.9) / 0.1, 2.0));
        c = over(c, fc, inside * tight * 0.12 * smoothstep(0.4, 1.0, k));
      }
      if (capture && uStyle == 4) {
        // One mote of light, circling slowly
        float a0 = uTime * TAU / 7.5;
        float d = length(p - R * vec2(cos(a0), sin(a0)));
        c = over(c, uColor, exp(-d * d / (0.035 * 0.035)) * 0.55 * (1.0 - soft));
        c = over(c, uMote, fillOf(d - 0.017) * (1.0 - soft));
      }
    } else if (uKind == 2) {
      // The last move: a thin circle with a faint fill, drawn in round from
      // its far side
      float r = length(vP);
      float along = fract(atan(vP.y, vP.x) / TAU + 0.25);
      float shown = step(along, uReveal);
      c = over(c, uColor, fillOf(r - uRadius) * uFillA * min(uReveal * 2.0, 1.0));
      c = over(c, uColor, stroke(r - uRadius, uWidth) * uOpacity * shown);
    } else {
      // Check: a crown of red light round the king, a band with eight points.
      // It lands a little large and closes onto him as the strike fades
      float S = uStrength;
      float strike = uPulse * uPulse;
      vec2 p = vP / (1.0 + 0.2 * S * strike);
      float r = length(p);
      float R = uRadius;
      float seg = TAU / 8.0;
      float phi = mod(atan(p.y, p.x) + seg * 0.5, seg) - seg * 0.5;
      float tine = max(0.0, 1.0 - abs(phi) / (seg * 0.32));
      float outer = R + 0.085 * tine;
      float inner = R - 0.05;
      // While check lasts it breathes; at mate it settles, dimmer and still
      float live = 1.0 - uSettle;
      float breath = 0.5 - 0.5 * cos(uTime * TAU / 3.2);
      float glow = (0.86 + 0.28 * breath * live) * (1.0 + 2.2 * S * strike) * (1.0 - 0.45 * uSettle);
      float band = fillOf(r - outer) * (1.0 - fillOf(r - inner));
      c = over(c, uColor, band * 0.22 * glow);
      c = over(c, uColor, fillOf(r - inner) * 0.07);
      c = over(c, uColor, stroke(r - outer, uWidth) * min(uOpacity * glow, 1.0));
      c = over(c, uColor, stroke(r - inner, uWidth * 0.7) * 0.6 * uOpacity);
      // One faint ripple leaves it at the height of each breath
      float ph = fract(uTime / 3.2 - 0.5);
      // (reaching further, and a little stronger, when it stands alone)
      float rr = mix(R + 0.1, 0.72 + 0.26 * uLoud, 1.0 - (1.0 - ph) * (1.0 - ph));
      float fade = (1.0 - ph) * (1.0 - ph) * smoothstep(0.0, 0.08, ph) * (0.45 + 0.3 * uLoud)
        * live * step(1.6, uTime);
      c = over(c, uColor, stroke(r - rr, 0.008 + 0.004 * uLoud) * fade);
      // The strike: one strong wave out, trailing a soft glow
      float e = 1.0 - (1.0 - uPulse) * (1.0 - uPulse);
      float wave = mix(0.8, R + 0.06, e);
      float wa = min(S * uPulse, 1.0);
      c = over(c, uColor, stroke(r - wave, 0.018) * wa * 0.95);
      c = over(c, uColor, exp(-max(wave - r, 0.0) / 0.1) * step(r, wave) * step(R, r) * 0.3 * wa);
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

interface MarkProps {
  floor: Vec3;
  kind: Kind;
  color: string;
  radius: number;
  width: number;
  fill?: string;
  deep?: string;
  /** Capture: the colour its embers glow toward. */
  hot?: string;
  fillA?: number;
  /** A faint wash of the outline's colour just inside it (moves). */
  washA?: number;
  opacity?: number;
  hovered?: boolean;
  /** Capture only: its one idea. */
  style?: CaptureStyle;
  /** Grow in over this long when mounted (0: at once). */
  growMs?: number;
  /** Draw in round the circle over this long, after `delayMs` (0: whole at once). */
  drawMs?: number;
  delayMs?: number;
  /** Strike once on mount, this strongly (check; 0: none). */
  pulse?: number;
  /** Keep frames coming while up (a capture's idea, the check's breath). */
  animate?: boolean;
  /** Step aside while a marker of one of these kinds has taken this floor. */
  yieldTo?: ClaimKind[];
  /** Step aside while the held piece stands here (its own circle is there). */
  yieldHeld?: boolean;
  /** Settle (check at mate): dim a little and hold still. */
  settle?: boolean;
  /** From high above, a soft-edged fill with no rim (a destination stacked on the held piece). */
  soft?: boolean;
  /** With `soft`, the radius it widens to as the view comes round to top-down. */
  softRadius?: number;
  /** Check: the plate stands alone (no crown), so its ripples reach further. */
  loud?: boolean;
  /** Step back a little seen from high above (a destination off the held piece's level). */
  dimAbove?: boolean;
  renderOrder?: number;
  lift?: number;
}

const HOVER_MS = 200;
/** How long the check's strike takes to fade. */
const STRIKE_MS = 950;

/** One mark flat on the glass at a cell's floor. */
const Mark = ({
  floor,
  kind,
  color,
  radius,
  width,
  fill,
  deep,
  hot,
  fillA = 0,
  washA = 0,
  opacity = 1,
  hovered = false,
  style = 'ember',
  growMs = 160,
  drawMs = 0,
  delayMs = 0,
  pulse = 0,
  animate = false,
  yieldTo,
  yieldHeld = false,
  settle = false,
  soft = false,
  softRadius,
  loud = false,
  dimAbove = false,
  renderOrder = LAYER.marker,
  lift = 0.012,
}: MarkProps) => {
  const invalidate = useThree((s) => s.invalidate);
  const widest = Math.max(radius, softRadius ?? radius);
  const quad =
    kind === 'check' ? 2.1 : kind === 'capture' ? widest * 3.3 + 0.08 : (widest * 1.25 + 0.1) * 2;
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
          uStyle: { value: 0 },
          uColor: { value: new Color(color) },
          uFill: { value: new Color() },
          uDeep: { value: new Color() },
          uHot: { value: new Color() },
          uMote: { value: new Color('#fff8f0') },
          uRadius: { value: radius },
          uWidth: { value: width },
          uFillA: { value: fillA },
          uWashA: { value: washA },
          uHover: { value: 0 },
          uGrow: { value: growMs > 0 ? 0 : 1 },
          uTime: { value: 0 },
          uPulse: { value: pulse > 0 && !prefersReducedMotion() ? 1 : 0 },
          uStrength: { value: pulse },
          uReveal: { value: drawMs > 0 ? 0 : 1 },
          uAmount: { value: 1 },
          uOpacity: { value: opacity },
          uSettle: { value: 0 },
          uSoft: { value: soft ? 1 : 0 },
          uSoftRadius: { value: softRadius ?? radius },
          uLoud: { value: loud ? 1 : 0 },
          uQuad: { value: quad },
        },
        vertexShader,
        fragmentShader,
      }),
    // Made once; the uniforms follow the props below
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const u = material.uniforms;
  (u.uColor.value as Color).set(color);
  (u.uFill.value as Color).set(fill ?? color);
  (u.uDeep.value as Color).set(deep ?? fill ?? color);
  (u.uHot.value as Color).set(hot ?? color);
  u.uStyle.value = STYLE_ID[style];
  u.uRadius.value = radius;
  u.uWidth.value = width;
  u.uFillA.value = fillA;
  u.uWashA.value = washA;
  u.uOpacity.value = opacity;
  u.uStrength.value = pulse;
  u.uQuad.value = quad;
  u.uSoft.value = soft ? 1 : 0;
  u.uSoftRadius.value = softRadius ?? radius;
  u.uLoud.value = loud ? 1 : 0;
  // A setting changed, or the pointer came or went: draw a frame for it
  useEffect(() => invalidate());

  const age = useRef(0);
  const hover = useRef(0);
  const still = prefersReducedMotion();
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
      u.uPulse.value = Math.max(0, 1 - age.current / STRIKE_MS);
      moving = true;
    }
    if (drawMs > 0 && u.uReveal.value < 1) {
      const k = Math.min(Math.max((age.current - delayMs) / drawMs, 0), 1);
      u.uReveal.value = 1 - (1 - k) ** 2;
      moving = true;
    }
    if (settle && u.uSettle.value < 1) {
      u.uSettle.value = Math.min(1, u.uSettle.value + dt / 0.6);
      moving = true;
    }
    if (animate && !still && u.uSettle.value < 1) {
      u.uTime.value += dt;
      moving = true;
    }
    let amount = 1;
    if (yieldTo) {
      probe.x = floor[0];
      probe.y = floor[1];
      probe.z = floor[2];
      if (claimed(probe, yieldTo)) amount = 0;
    }
    if (yieldHeld) {
      const held = heldAt();
      if (held && Math.abs(held[0] - floor[0]) < 1e-3 && Math.abs(held[2] - floor[2]) < 1e-3) {
        if (Math.abs(held[1] - floor[1]) < 0.3) amount = 0;
      }
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

// --- The marker set -----------------------------------------------------------------------

/** Radius of the level ring at a piece's foot (world units). */
const FOOT_RING = RING_RADIUS * PIECE_SCALE;
const QUIET_RADIUS = 0.2;
/**
 * Straight below or above the held piece, seen from high above, a move widens
 * to this, wide enough to show round the piece, and becomes a soft pool with
 * no rim (so it never rings the piece's own circle); from the side it is a
 * circle like the rest.
 */
const QUIET_STACKED = 0.33;
const CAPTURE_RADIUS = FOOT_RING + 0.035;
const TRACE_TO = FOOT_RING;
/** The last move's circle where it started: the same circle, smaller. */
const TRACE_FROM_SCALE = 0.64;
/**
 * The line itself: the circles' mint a little deeper, so it weighs less and
 * the shimmer travelling along it (Shimmer) shows.
 */
const TRACE_LINE = `#${new Color(PALETTE.trace).multiplyScalar(0.72).getHexString()}`;
const FROM_YIELDS: ClaimKind[] = ['quiet', 'capture'];
const TO_YIELDS: ClaimKind[] = ['capture'];

/** Whether two floors are in the same column (straight above or below each other). */
const isStacked = (a: Vec3, b: Vec3) =>
  Math.abs(a[0] - b[0]) < 1e-3 && Math.abs(a[2] - b[2]) < 1e-3;

const levelDeep = LEVEL_COLORS.map((c) => `#${new Color(c).multiplyScalar(0.62).getHexString()}`);

export const Quiet = ({ floor, hovered }: MarkerProps) => {
  // The small circle where the last move started steps aside for it
  useClaim('quiet', floor);
  const level = levelAt(floor[1]);
  const held = useHeld();
  const offLevel = !!held && levelAt(held[1]) !== level;
  const stacked = !!held && isStacked(held, floor);
  return (
    <Mark
      floor={floor}
      kind="quiet"
      color={PALETTE.move}
      fill={LEVEL_COLORS[level]}
      deep={levelDeep[level]}
      fillA={0.16}
      washA={0.1}
      radius={QUIET_RADIUS}
      softRadius={QUIET_STACKED}
      width={0.0095}
      opacity={0.85}
      soft={stacked}
      hovered={hovered}
      dimAbove={offLevel}
    />
  );
};

// A capture's rising glow: a short wall of red light standing on its circle
// round the victim's foot, brightest at the glass and fading upward, with
// slow bands of heat climbing it. Seen from above it lies on the circle.
const RISE_H = 0.2;
const riseGeometry = new CylinderGeometry(1, 1, 1, 64, 1, true).translate(0, 0.5, 0);
const riseMaterial = () =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    uniforms: {
      uColor: { value: new Color(PALETTE.capture) },
      uTime: { value: 0 },
      uHover: { value: 0 },
      uAmount: { value: 0 },
      uSoft: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vW;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uHover;
      uniform float uAmount;
      uniform float uSoft;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vW;
      void main() {
        float h = vUv.y;
        vec3 v = normalize(cameraPosition - vW);
        // Straight above or below the held piece, it gives way from high above
        float soft = uSoft * smoothstep(0.75, 0.95, abs(v.y));
        float facing = abs(dot(normalize(vN), v));
        // Seen edge-on (its sides, or from above) a little brighter
        float edge = 0.4 + 0.6 * (1.0 - facing);
        float fall = pow(1.0 - h, 1.7);
        float bands = 0.72 + 0.28 * sin((h * 1.6 - uTime * 0.3) * 6.2831853);
        float a = fall * edge * bands * (0.6 + 0.25 * uHover) * uAmount * (1.0 - soft);
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor * a, a);
        #include <colorspace_fragment>
      }`,
  });

const Rise = ({ floor, hovered, soft }: { floor: Vec3; hovered: boolean; soft: boolean }) => {
  const invalidate = useThree((s) => s.invalidate);
  const material = useMemo(riseMaterial, []);
  useEffect(() => () => material.dispose(), [material]);
  const wall = useRef<Mesh>(null);
  const age = useRef(0);
  const hover = useRef(0);
  const still = prefersReducedMotion();
  useEffect(() => invalidate(), [hovered, soft, invalidate]);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    age.current += dt;
    const goal = hovered ? 1 : 0;
    const step = (dt * 1000) / HOVER_MS;
    hover.current =
      goal > hover.current
        ? Math.min(goal, hover.current + step)
        : Math.max(goal, hover.current - step);
    const e = hover.current * hover.current * (3 - 2 * hover.current);
    const u = material.uniforms;
    if (!still) u.uTime.value = age.current;
    u.uHover.value = e;
    u.uSoft.value = soft ? 1 : 0;
    // It rises as it appears, breathes a little, and stands taller under the pointer
    const rise = 1 - (1 - Math.min(age.current / 0.35, 1)) ** 3;
    const breath = still ? 0 : 0.5 - 0.5 * Math.cos((age.current * Math.PI * 2) / 3.4);
    u.uAmount.value = rise;
    const m = wall.current;
    if (m) {
      const r = CAPTURE_RADIUS * (1 + 0.11 * e);
      m.scale.set(r, RISE_H * rise * (0.9 + 0.12 * breath) * (1 + 0.3 * e), r);
    }
    // Held still (reduced motion), it needs frames only while it rises or eases
    if (!still || rise < 1 || hover.current !== goal) invalidate();
  });
  return (
    <mesh
      ref={wall}
      geometry={riseGeometry}
      material={material}
      position={[floor[0], floor[1] + 0.012, floor[2]]}
      renderOrder={LAYER.trace}
      raycast={noRaycast}
    />
  );
};

export const Capture = ({ floor, hovered = false }: MarkerProps) => {
  useClaim('capture', floor);
  const chosen = useMarkSetting<CaptureStyle>('mark.captureStyle');
  const style = (CAPTURE_STYLES as readonly string[]).includes(chosen) ? chosen : 'rise';
  // Straight above or below the held piece: from high above, a soft red pool
  // with no rim, so it never rings the held piece's own circle
  const held = useHeld();
  const stacked = !!held && isStacked(held, floor);
  return (
    <>
      <Mark
        floor={floor}
        kind="capture"
        style={style}
        color={PALETTE.capture}
        fill={PALETTE.capture}
        deep="#8a1712"
        hot="#ff6a4f"
        fillA={style === 'ember' ? 0.08 : style === 'rise' ? 0.14 : 0.1}
        radius={CAPTURE_RADIUS}
        width={0.008}
        opacity={0.92}
        hovered={hovered}
        soft={stacked}
        animate
      />
      {style === 'rise' && <Rise floor={floor} hovered={hovered} soft={stacked} />}
    </>
  );
};

// The Selection marker lives in selection.tsx (the pieces agent's), with the held piece's light.

/**
 * The last move: a thin circle of pale mint round the piece where it landed
 * (in place of its level ring; drawn in as it lands), the same circle
 * smaller where it started, and a thin continuous line between them with a
 * calm shimmer travelling along it. The circle where it started steps aside
 * for a destination on that square; the one where it landed for a capture,
 * or for the held piece's own circle.
 */
export const LastMove = ({ from, to, fresh = false, arc = 0 }: LastMoveMarkerProps) => {
  useClaim('trace', to.floor);
  const strength = useMarkSetting<number>('mark.lineStrength');
  const shimmer = useMarkSetting<boolean>('mark.lineShimmer');
  const radius = 0.005 + 0.0045 * strength;
  return (
    <>
      <Mark
        floor={from.floor}
        kind="trace"
        color={PALETTE.trace}
        fillA={0.05}
        radius={TRACE_TO * TRACE_FROM_SCALE}
        width={0.0085}
        opacity={0.8}
        growMs={0}
        yieldTo={FROM_YIELDS}
      />
      <Mark
        floor={to.floor}
        kind="trace"
        color={PALETTE.trace}
        fillA={0.05}
        radius={TRACE_TO}
        width={0.0085}
        opacity={0.8}
        growMs={0}
        drawMs={fresh ? 320 : 0}
        delayMs={fresh ? MOTION.durationMs * 0.8 : 0}
        yieldTo={TO_YIELDS}
        yieldHeld
        renderOrder={LAYER.marker + 0.1}
      />
      <LastMoveLine
        from={from.floor}
        to={to.floor}
        arc={arc}
        color={TRACE_LINE}
        radius={radius}
        lift={LINE_LIFT}
        inset={LINE_LANDING}
        insetFront={SEAT_SIDE}
        opacity={strength}
        pulse={0}
        flowSpeed={0}
        shade={0.3}
        drawInMs={fresh ? LINE_DRAW_MS : 0}
        drawInDelayMs={fresh ? lineDelay : 0}
      />
      {shimmer && (
        <Shimmer
          from={from.floor}
          to={to.floor}
          arc={arc}
          radius={radius}
          delayMs={fresh ? lineDelay + LINE_DRAW_MS : 0}
        />
      )}
    </>
  );
};

// The shimmer on the last-move line: a soft glow of white light, a little
// wider than the line, travelling along it from where the move started to
// where it ended, one at a time, added to the line's light so it shows
// while the line itself stays faint.
const LINE_LIFT = 0.02;
/**
 * The line lands on the destination's floor at its circle, on the side
 * facing where the move came from: just outside the footprint of the piece
 * that moved, so it meets the glass in plain view, and the piece, which
 * narrows above its base, never stands in its way. Where that side is the
 * far side seen from the player's seat (the board is laid out so the seat
 * always looks from +z), or for a move straight up or down, it lands on the
 * piece's side instead (on the viewer's right, for a vertical move), so the
 * piece never hides the landing.
 */
const LINE_LANDING = TRACE_TO;
const SEAT_SIDE = [0, 1] as const;
const LINE_DRAW_MS = 380;
const lineDelay = MOTION.durationMs * 0.3;
const SHIMMER = { speed: 0.45, spacing: 1.8, length: 0.32, peak: 0.75 };

const shimmerMaterial = () =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uColor: { value: new Color('#f4fff9') },
      uTime: { value: 0 },
      uFade: { value: 0 },
      uSpeed: { value: SHIMMER.speed },
      uSpacing: { value: SHIMMER.spacing },
      uLength: { value: SHIMMER.length },
      uPeak: { value: SHIMMER.peak },
    },
    vertexShader: /* glsl */ `
      attribute float aAlong;
      varying float vAlong;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vAlong = aAlong;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vView = cameraPosition - w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uFade;
      uniform float uSpeed;
      uniform float uSpacing;
      uniform float uLength;
      uniform float uPeak;
      varying float vAlong;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        // One soft pulse per spacing, the first entering at the start
        float f = fract((vAlong - uTime * uSpeed + uLength) / uSpacing + 0.5);
        float x = (f - 0.5) * uSpacing / uLength;
        float glow = exp(-x * x * 4.0);
        // Soft across: brightest down the middle, nothing at the edges
        float facing = abs(dot(normalize(vNormal), normalize(vView)));
        float a = glow * facing * facing * uPeak * uFade;
        if (a < 0.002) discard;
        gl_FragColor = vec4(uColor * a, a);
        #include <colorspace_fragment>
      }`,
  });

const Shimmer = ({
  from,
  to,
  arc,
  radius,
  delayMs,
}: {
  from: Vec3;
  to: Vec3;
  arc: number;
  radius: number;
  delayMs: number;
}) => {
  const invalidate = useThree((s) => s.invalidate);
  const key = JSON.stringify([from, to, arc, radius]);
  const geometry = useMemo(() => {
    const data = tubeData(
      tracePath(from, to, {
        lift: LINE_LIFT,
        arc,
        inset: LINE_LANDING,
        insetFront: SEAT_SIDE,
      }),
      {
        radius: radius * 2.4,
        radialSegments: 8,
        capSegments: 2,
      },
    );
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(data.position, 3));
    g.setAttribute('normal', new BufferAttribute(data.normal, 3));
    g.setAttribute('aAlong', new BufferAttribute(data.along, 1));
    g.setIndex(new BufferAttribute(data.index, 1));
    g.computeBoundingSphere();
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the values themselves
  }, [key]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useMemo(shimmerMaterial, []);
  useEffect(() => () => material.dispose(), [material]);
  const since = useRef(-delayMs / 1000);
  const still = prefersReducedMotion();
  useEffect(() => invalidate(), [invalidate]);
  useFrame((_, delta) => {
    if (still) return;
    since.current += Math.min(delta, 1 / 20);
    const u = material.uniforms;
    u.uTime.value = Math.max(since.current, 0);
    u.uFade.value = Math.min(Math.max(since.current / 0.4, 0), 1);
    invalidate();
  });
  if (still) return null;
  return (
    <mesh
      geometry={geometry}
      material={material}
      renderOrder={LAYER.trace + 0.2}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

// --- Check --------------------------------------------------------------------------------

// The crown over the king: a short open band of red light with eight tines,
// floating over his cross at a height of its own (a setting), turning
// slowly. Drawn by its shader on an open cylinder.
const CROWN_R = 0.13;
const CROWN_H = 0.08;
const crownGeometry = new CylinderGeometry(CROWN_R, CROWN_R * 0.92, CROWN_H, 64, 1, true).translate(
  0,
  CROWN_H / 2,
  0,
);
/** The top of the king's cross, standing on his floor (world units). */
const KING_HEIGHT = pieceTop(pieceSet(), PieceType.King) * PIECE_SCALE;

const crownMaterial = () =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    uniforms: {
      uColor: { value: new Color(PALETTE.check) },
      uOpacity: { value: 0 },
      uFlash: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uFlash;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main() {
        // Eight tines rising from a band
        float t = 1.0 - abs(fract(vUv.x * 8.0) - 0.5) * 2.0;
        float top = 0.38 + 0.62 * pow(t, 1.6);
        float y = vUv.y;
        float fy = max(fwidth(y), 1e-4);
        float inside = 1.0 - smoothstep(top - fy, top + fy, y);
        // Its edges bright, its body a soft glow
        float edge = exp(-pow((top - y) / 0.06, 2.0)) + exp(-pow(y / 0.07, 2.0));
        vec3 v = normalize(cameraPosition - vWorld);
        float facing = abs(dot(normalize(vNormal), v));
        float body = 0.25 + 0.35 * (1.0 - facing);
        float a = inside * (body + 0.9 * edge) * uOpacity * (1.0 + uFlash);
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor * a, 1.0);
        #include <colorspace_fragment>
      }`,
  });

/** How long the crown takes to sink away at mate. */
const SETTLE_S = 0.6;

const Crown = ({ floor, mated, strength }: { floor: Vec3; mated: boolean; strength: number }) => {
  const invalidate = useThree((s) => s.invalidate);
  const material = useMemo(crownMaterial, []);
  useEffect(() => () => material.dispose(), [material]);
  const spin = useRef<Group>(null);
  const since = useRef(0);
  const time = useRef(0);
  const fall = useRef(0);
  // A fixed height: the setting's gap over his cross as he stands held up
  // (the held height the lift settings give), so he never reaches it; it
  // does not follow his lift as it moves
  const gap = useMarkSetting<number>('mark.crownGap');
  const held = pieceLift(useSettings()).selected;
  const height = KING_HEIGHT + (held + gap) * PIECE_SCALE;
  const still = prefersReducedMotion();
  useEffect(() => invalidate(), [mated, strength, height, invalidate]);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 8);
    since.current += dt;
    if (mated) fall.current = Math.min(1, fall.current + dt / SETTLE_S);
    else if (!still) time.current += dt;
    const f = 1 - (1 - fall.current) ** 2;
    const t = still ? 1 : Math.min((since.current * 1000) / STRIKE_MS, 1);
    // It drops in and flashes with the strike, then breathes with the plate
    // below and turns very slowly
    const c = still ? 1 : Math.min(since.current / 0.45, 1);
    const breath = 0.5 - 0.5 * Math.cos((time.current * Math.PI * 2) / 3.2);
    const u = material.uniforms;
    u.uOpacity.value = (0.82 + 0.16 * breath) * (1 - (1 - c) ** 2) * (1 - f);
    u.uFlash.value = 1.4 * strength * (1 - t) ** 2;
    const g = spin.current;
    if (g) {
      g.rotation.y = time.current * 0.25;
      g.position.y =
        (height + 0.08 * (1 - c) ** 2 + 0.005 * Math.sin(time.current * 1.6)) * (1 - 0.6 * f);
      g.visible = f < 1;
    }
    const turning = !still && !mated;
    if (turning || (mated && fall.current < 1) || since.current * 1000 < STRIKE_MS) invalidate();
  });
  return (
    <group position={floor}>
      <group ref={spin} position={[0, height, 0]}>
        <mesh
          geometry={crownGeometry}
          material={material}
          renderOrder={LAYER.trace}
          raycast={noRaycast}
        />
      </group>
    </group>
  );
};

/**
 * Check: a crown of red light lying round the king in place of his ring; it
 * strikes when check arrives, then breathes slowly. Dark blades stand round
 * him (blades.tsx) and a small crown can float over him (both settings). At
 * mate it all settles as the king falls.
 */
export const Check = ({ floor, mated = false }: MarkerProps) => {
  useClaim('check', floor);
  const crown = useMarkSetting<boolean>('mark.checkCrown');
  const chosen = useMarkSetting<string>('mark.checkBlades');
  const blades = (BLADE_STYLES as readonly string[]).includes(chosen)
    ? (chosen as BladeStyle)
    : null;
  const strength = useMarkSetting<number>('mark.checkPulse');
  return (
    <>
      <Mark
        floor={floor}
        kind="check"
        color={PALETTE.check}
        radius={FOOT_RING + 0.01}
        width={0.008}
        opacity={0.95}
        growMs={0}
        pulse={strength}
        loud={!crown && !blades}
        animate
        settle={mated}
        renderOrder={LAYER.marker + 0.2}
      />
      {crown && <Crown floor={floor} mated={mated} strength={strength} />}
      {blades && <Blades floor={floor} mated={mated} strength={strength} style={blades} />}
    </>
  );
};
