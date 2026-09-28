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
import { PieceType } from '../../../engine/pieces';
import { prefersReducedMotion } from '../../motion';
import { pieceSet, pieceTop } from '../../pieces';
import { LAYER } from '../kit/layers';
import { LastMoveLine } from '../kit/line';
import { noRaycast } from '../kit/noRaycast';
import { useDesignSetting } from '../settings';
import type { LastMoveMarkerProps, MarkerProps, Vec3 } from '../types';
import { claimed, heldAt, useClaim, useHeld } from './claims';
import type { ClaimKind } from './claims';
import { LEVEL_COLORS, levelAt, MOTION, PALETTE, PIECE_SCALE, RING_RADIUS } from './palette';
import { CAPTURE_STYLES, useMarkSetting } from './settings-markers';
import type { CaptureStyle, MoveColor } from './settings-markers';

// The marks of play, one family of thin circles of light lying on the glass:
//
// - where a piece may go: a thin circle of soft gold (a colour no level
//   uses, so it never reads as a level ring) round a slight fill tinted with
//   its level's colour. Under the pointer the fill deepens (fuller, a deeper
//   colour at its heart) and the circle grows a little, eased over 200 ms;
//   the outline itself does not brighten. Straight above or below the held
//   piece, seen from high above, it gives up its rim for a soft pool, so it
//   never rings the piece.
// - a capture: the same circle in red, drawn in place of the victim's own
//   level ring (which steps aside, claims.ts), so two circles never stack;
//   its one idea is a setting (settings-markers.ts): a short wall of red
//   light rising from it round the victim's foot like a threat (the
//   default), embers of heat drifting through its fill, a ripple closing in
//   on it, four arcs closing in and breathing, or one mote circling it.
//   Hover as above (the rising glow also stands a little taller).
// - the last move: a thin continuous line of pale mint light, a calm
//   shimmer travelling along it, from a small circle where the piece started
//   to the same circle, larger, round the piece where it landed.
// - check: a crown of red light lying round the king in place of his ring, a
//   band with eight points. It strikes when check arrives (it lands a little
//   large, flashes and sends one strong wave out), then breathes slowly,
//   one faint ripple leaving it with each breath. Over the king floats a
//   small crown of red light, turning slowly; four tall blades of red light
//   can rise round him too. At mate it all settles as the king falls.
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
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) {
      v += a * noise(p);
      p = p * 2.03 + vec2(1.7, 9.2);
      a *= 0.5;
    }
    return v;
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
      float R = uRadius;
      float k = r / R;
      // Straight above or below the held piece (uSoft), seen from high above,
      // it gives up its rim for a soft-edged pool, so it never rings the
      // piece's own circle; from the side it is a circle like the rest
      float soft = uSoft * smoothstep(0.75, 0.95, abs(normalize(cameraPosition - vWorld).y));
      bool capture = uKind == 1;
      // Closing arcs: the circle draws in and out, slowly
      float breath = 0.5 - 0.5 * cos(uTime * TAU / 3.6);
      float rim = capture && uStyle == 2 ? R * (1.05 - 0.07 * breath) : R;
      float inside = mix(fillOf(r - rim), 1.0 - smoothstep(0.55 * R, R, r), soft);
      // The fill: slight at rest; under the pointer fuller and deeper at the
      // heart, like light pooling in glass
      float rest = uFillA * (0.75 + 0.25 * k) * (1.0 + 0.9 * soft);
      float held = uHover * (0.2 + 0.1 * (1.0 - k));
      vec3 fc = mix(uFill, uDeep, uHover * (1.0 - k * k));
      if (capture && uStyle == 0) {
        // Embers: heat drifting slowly through the fill, gathering toward
        // the rim, in reds only (never toward the gold of a move)
        float t = uTime;
        float cs = cos(t * 0.06);
        float sn = sin(t * 0.06);
        vec2 q = mat2(cs, -sn, sn, cs) * (p / R);
        float n = fbm(q * 2.4 + vec2(0.0, -t * 0.14)) * 0.7
          + fbm(q * 5.2 + vec2(t * 0.08, t * 0.05) + 3.0) * 0.45;
        float heat = smoothstep(0.4, 0.76, n) * (0.35 + 0.65 * smoothstep(0.2, 1.0, k));
        fc = mix(fc, uHot, heat * (1.0 - 0.6 * uHover));
        rest = uFillA * (0.45 + 3.0 * heat);
      }
      c = over(c, fc, inside * (rest + held));
      // A move: a faint wash of its own colour just inside the rim, so it
      // reads as a gold circle from afar, whatever the tint of its fill
      c = over(c, uColor, exp(-max(R - r, 0.0) / (0.2 * R)) * fillOf(r - R) * uWashA * (1.0 - soft));
      float line = stroke(r - R, uWidth);
      if (capture && uStyle == 2) {
        line = stroke(arcs(p, rim, mix(0.5, 0.78, breath), uTime * 0.11), uWidth * 1.4);
      }
      c = over(c, uColor, line * uOpacity * (1.0 - soft));
      if (capture && uStyle == 1) {
        // Closing ripples: one ring at a time gathers on the rim from
        // outside, quickening as it closes in, and the fill tightens as it
        // arrives
        float ph = fract(uTime / 2.8);
        float rr = R * (1.42 - 0.42 * ph * ph);
        float a = smoothstep(0.0, 0.45, ph) * (1.0 - smoothstep(0.88, 1.0, ph)) * 0.45;
        c = over(c, uColor, stroke(r - rr, uWidth * 0.75) * a * (1.0 - soft));
        float tight = exp(-pow((ph - 0.98) / 0.08, 2.0)) + exp(-pow((ph + 0.02) / 0.08, 2.0));
        c = over(c, fc, inside * tight * 0.1 * smoothstep(0.4, 1.0, k));
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
      float rr = mix(R + 0.1, 0.72, 1.0 - (1.0 - ph) * (1.0 - ph));
      float fade = (1.0 - ph) * (1.0 - ph) * smoothstep(0.0, 0.08, ph) * 0.45 * live
        * step(1.6, uTime);
      c = over(c, uColor, stroke(r - rr, 0.008) * fade);
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

const white = new Color('#ffffff');

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
  dimAbove = false,
  renderOrder = LAYER.marker,
  lift = 0.012,
}: MarkProps) => {
  const invalidate = useThree((s) => s.invalidate);
  const quad =
    kind === 'check' ? 1.7 : kind === 'capture' ? radius * 3.3 + 0.08 : (radius * 1.25 + 0.1) * 2;
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
 * Straight below or above the held piece: wide enough to show round it from
 * above, where it becomes a soft pool with no rim (so it never rings the
 * piece's own circle); from the side, a circle like the rest.
 */
const QUIET_STACKED = 0.33;
const CAPTURE_RADIUS = FOOT_RING + 0.035;
const TRACE_TO = FOOT_RING;
/** The last move's circle where it started: the same circle, smaller. */
const TRACE_FROM_SCALE = 0.64;
const FROM_YIELDS: ClaimKind[] = ['quiet', 'capture'];
const TO_YIELDS: ClaimKind[] = ['capture'];

/** Whether two floors are in the same column (straight above or below each other). */
const isStacked = (a: Vec3, b: Vec3) =>
  Math.abs(a[0] - b[0]) < 1e-3 && Math.abs(a[2] - b[2]) < 1e-3;

const levelLight = LEVEL_COLORS.map((c) => `#${new Color(c).lerp(white, 0.42).getHexString()}`);
const levelDeep = LEVEL_COLORS.map((c) => `#${new Color(c).multiplyScalar(0.62).getHexString()}`);

/** The outline of a move, and the wash inside it, by the player's choice. */
const moveOutline = (choice: MoveColor, level: number) =>
  choice === 'white'
    ? { color: PALETTE.light, wash: 0.07, opacity: 0.8 }
    : choice === 'level'
      ? { color: levelLight[level], wash: 0, opacity: 0.9 }
      : { color: PALETTE.move, wash: 0.1, opacity: 0.85 };

export const Quiet = ({ floor, hovered }: MarkerProps) => {
  // The small circle where the last move started steps aside for it
  useClaim('quiet', floor);
  const choice = useMarkSetting<MoveColor>('mark.moveColor');
  const level = levelAt(floor[1]);
  const held = useHeld();
  const offLevel = !!held && levelAt(held[1]) !== level;
  const stacked = !!held && isStacked(held, floor);
  const outline = moveOutline(choice, level);
  return (
    <Mark
      floor={floor}
      kind="quiet"
      color={outline.color}
      fill={LEVEL_COLORS[level]}
      deep={levelDeep[level]}
      fillA={0.16}
      washA={outline.wash}
      radius={stacked ? QUIET_STACKED : QUIET_RADIUS}
      width={0.0095}
      opacity={outline.opacity}
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
    invalidate();
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
        fillA={style === 'ember' ? 0.12 : style === 'rise' ? 0.14 : 0.1}
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
        color={PALETTE.trace}
        pulseColor="#ffffff"
        pattern="solid"
        radius={0.0075}
        opacity={strength}
        pulse={shimmer ? 0.8 : 0}
        pulseLength={0.4}
        spacing={1.7}
        flowSpeed={shimmer ? 0.42 : 0}
        shade={0.3}
        drawInMs={fresh ? 380 : 0}
        drawInDelayMs={fresh ? MOTION.durationMs * 0.3 : 0}
      />
    </>
  );
};

// --- Check --------------------------------------------------------------------------------

// The crown over the king: a short open band of red light with eight tines,
// floating just over his cross (clear of it even held up), turning slowly.
// Drawn by its shader on an open cylinder.
const CROWN_R = 0.13;
const CROWN_H = 0.08;
const crownGeometry = new CylinderGeometry(CROWN_R, CROWN_R * 0.92, CROWN_H, 64, 1, true).translate(
  0,
  CROWN_H / 2,
  0,
);
const KING_TOP = pieceTop(pieceSet(), PieceType.King) * PIECE_SCALE;
/**
 * Over the cross with the king held up (Board lifts a held piece 0.05 above
 * its hover height, piece.hoverLift in settings-pieces.ts), and a little air.
 */
const crownHeight = (hoverLift: number) => KING_TOP + (hoverLift + 0.05) * PIECE_SCALE + 0.035;

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
  const height = crownHeight(useDesignSetting<number>('piece.hoverLift') ?? 0.08);
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
    if (fall.current < 1 || since.current * 1000 < STRIKE_MS) invalidate();
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

// The blades: four tall slivers of red light rising from the points of the
// crown round the king (after Codex), each turned to face the viewer, a slow
// shimmer climbing them in turn. They shoot up past their height when check
// arrives and settle; at mate they fold down.
const BLADE_R = FOOT_RING + 0.01 + 0.085;
const BLADE_H = 0.42;
const BLADE_W = 0.085;

const bladeGeometry = (() => {
  const g = new BufferGeometry();
  const pos: number[] = [];
  const corner: number[] = [];
  const phase: number[] = [];
  const index: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const [x, z] = [BLADE_R * Math.cos(a), BLADE_R * Math.sin(a)];
    for (const [cx, cy] of [
      [-1, 0],
      [1, 0],
      [1, 1],
      [-1, 1],
    ]) {
      pos.push(x, 0, z);
      corner.push(cx, cy);
      phase.push(i * 0.25);
    }
    const o = i * 4;
    index.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aCorner', new BufferAttribute(new Float32Array(corner), 2));
  g.setAttribute('aPhase', new BufferAttribute(new Float32Array(phase), 1));
  g.setIndex(index);
  return g;
})();

const bladeMaterial = () =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    uniforms: {
      uColor: { value: new Color(PALETTE.check) },
      uTime: { value: 0 },
      uFlare: { value: 0 },
      uGrow: { value: 0 },
      uHeight: { value: BLADE_H },
      uWidth: { value: BLADE_W / 2 },
    },
    vertexShader: /* glsl */ `
      attribute vec2 aCorner;
      attribute float aPhase;
      uniform float uGrow;
      uniform float uHeight;
      uniform float uWidth;
      varying vec2 vUv;
      varying float vPhase;
      void main() {
        // Each blade turns about its own upright to face the viewer
        vec4 base = modelMatrix * vec4(position, 1.0);
        vec2 toCam = cameraPosition.xz - base.xz;
        vec2 across = length(toCam) > 1e-4 ? normalize(vec2(-toCam.y, toCam.x)) : vec2(1.0, 0.0);
        vec3 world = base.xyz + vec3(across.x, 0.0, across.y) * aCorner.x * uWidth
          + vec3(0.0, aCorner.y * uHeight * uGrow, 0.0);
        vUv = aCorner;
        vPhase = aPhase;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uFlare;
      varying vec2 vUv;
      varying float vPhase;
      void main() {
        float h = vUv.y;
        // A sliver tapering to its point, with a bright core
        float hw = 1.0 - pow(h, 0.8);
        float x = abs(vUv.x) / max(hw, 1e-3);
        if (x > 1.0) discard;
        float core = exp(-x * x * 9.0) + 0.35 * exp(-x * x * 1.6);
        // The slow shimmer climbing each blade in turn
        float band = fract(uTime / 2.6 + vPhase);
        float shimmer = exp(-pow((h - band * 1.3 + 0.15) / 0.14, 2.0));
        float a = core * mix(1.0, 0.3, h) * (0.85 + 0.8 * shimmer + 2.2 * uFlare);
        gl_FragColor = vec4(uColor * a, a);
        #include <colorspace_fragment>
      }`,
  });

const Blades = ({ floor, mated, strength }: { floor: Vec3; mated: boolean; strength: number }) => {
  const invalidate = useThree((s) => s.invalidate);
  const material = useMemo(bladeMaterial, []);
  useEffect(() => () => material.dispose(), [material]);
  const since = useRef(0);
  const settled = useRef(0);
  const still = prefersReducedMotion();
  useEffect(() => invalidate(), [mated, strength, invalidate]);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    since.current += dt;
    settled.current = Math.min(1, Math.max(0, settled.current + (mated ? 1 : -1) * (dt / 0.7)));
    const k = settled.current * settled.current * (3 - 2 * settled.current);
    const t = still ? 1 : Math.min((since.current * 1000) / STRIKE_MS, 1);
    // They shoot up past their height (as far as the strike is strong) and settle
    const over = 0.22 * Math.min(strength, 1.5);
    const grow =
      t < 0.5 ? (1 + over) * (1 - (1 - t / 0.5) ** 3) : 1 + over * Math.cos((t - 0.5) * Math.PI);
    const u = material.uniforms;
    u.uGrow.value = (t >= 1 ? 1 : grow) * (1 - k);
    u.uFlare.value = strength * (1 - t) ** 2;
    if (!still && !mated) u.uTime.value += dt;
    if (!(mated && settled.current >= 1)) invalidate();
  });
  return (
    <mesh
      geometry={bladeGeometry}
      material={material}
      position={[floor[0], floor[1] + 0.012, floor[2]]}
      renderOrder={LAYER.trace + 0.4}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

/**
 * Check: a crown of red light lying round the king in place of his ring; it
 * strikes when check arrives, then breathes slowly. A small crown floats
 * over him, and (a setting) four blades rise round him. At mate it all
 * settles as the king falls.
 */
export const Check = ({ floor, mated = false }: MarkerProps) => {
  useClaim('check', floor);
  const crown = useMarkSetting<boolean>('mark.checkCrown');
  const blades = useMarkSetting<boolean>('mark.checkBlades');
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
        animate
        settle={mated}
        renderOrder={LAYER.marker + 0.2}
      />
      {crown && <Crown floor={floor} mated={mated} strength={strength} />}
      {blades && <Blades floor={floor} mated={mated} strength={strength} />}
    </>
  );
};
