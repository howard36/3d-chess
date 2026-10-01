import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AdditiveBlending, Color, DoubleSide, PlaneGeometry, Vector3 } from 'three';
import type { IUniform } from 'three';
import { prefersReducedMotion } from '../motion';
import { LAYER } from './layers';
import { LastMoveLine, tubeGeometry, tubeVertex } from './line';
import { tracePath } from './markerGeometry';
import { noRaycast } from '../noRaycast';
import type { LastMoveMarkerProps, MarkerProps, Vec3 } from '../types';
import { claimed, heldAt, useClaim, useHeld } from './claims';
import type { ClaimKind } from './claims';
import { clamp01, easeOutCubic, easeOutQuad, smooth, toward } from './ease';
import { overlayMaterial } from './overlay';
import { LEVEL_COLORS, levelAt, MOTION, PALETTE, PIECE_SCALE, RING_RADIUS } from './palette';
import { Blades } from './blades';
import { useRetireOnUnmount } from './programs';

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
//   its one idea is four arcs of one radius and length turning slowly and
//   evenly round the victim. Hover as above.
// - the last move: a thin continuous line of deep mint light, a soft glow
//   of white travelling calmly along it, from a small circle where the piece
//   started to the same circle, larger, round the piece where it landed,
//   running from the centre of one square to the centre of the other (pieces
//   hide the line wherever it passes behind them, and the piece that moved
//   stands on its end).
// - check: a crown of red light lying round the king in place of his ring, a
//   band with eight points. It strikes when check arrives (it lands a little
//   large, flashes and sends one strong wave out), then breathes slowly,
//   one faint ripple leaving it with each breath. Round him stand dark, keen
//   blades with red edges (blades.tsx). At mate it all settles as the king
//   falls.
//
// Every flat mark is one quad shaded by a signed distance, crisp at any
// angle, and drawn over every level (LAYER), so a mark three levels down
// reads as clearly as one on top.

const KIND = { quiet: 0, capture: 1, trace: 2, check: 3 } as const;
type Kind = keyof typeof KIND;

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
  uniform vec3 uColor;
  uniform vec3 uFill;
  uniform vec3 uDeep;
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
      c = over(c, fc, inside * (rest + held));
      // A move: a faint wash of its own colour just inside the rim, so it
      // reads as a gold circle from afar, whatever the tint of its fill
      c = over(c, uColor, exp(-max(R - r, 0.0) / (0.2 * R)) * fillOf(r - R) * uWashA * (1.0 - soft));
      float line;
      if (capture) {
        // Turning arcs: four arcs of one radius and one length, turning
        // round the victim at one slow, even speed
        line = stroke(arcs(p, R, 0.62, uTime * TAU / 16.0), uWidth * 1.4);
      } else {
        line = stroke(r - R, uWidth);
      }
      c = over(c, uColor, line * uOpacity * (1.0 - soft));
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
      float fade = (1.0 - ph) * (1.0 - ph) * smoothstep(0.0, 0.08, ph) * 0.45 * live * step(1.6, uTime);
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

interface MarkProps {
  floor: Vec3;
  kind: Kind;
  color: string;
  radius: number;
  width: number;
  fill?: string;
  deep?: string;
  fillA?: number;
  /** A faint wash of the outline's colour just inside it (moves). */
  washA?: number;
  opacity?: number;
  hovered?: boolean;
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
  /** Step back a little seen from high above (a destination off the held piece's level). */
  dimAbove?: boolean;
  renderOrder?: number;
}

const HOVER_MS = 200;
/** How long the check's strike takes to fade. */
const STRIKE_MS = 950;
/** How strongly the strike lands, and the blades come in with it. */
const CHECK_PULSE = 0.9;

/** A mark's material (Mark), with these uniforms. */
export const markMaterial = (uniforms: Record<string, IUniform> = {}) =>
  overlayMaterial({
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms,
    vertexShader,
    fragmentShader,
  });

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
  washA = 0,
  opacity = 1,
  hovered = false,
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
  dimAbove = false,
  renderOrder = LAYER.marker,
}: MarkProps) => {
  const invalidate = useThree((s) => s.invalidate);
  // The quad holds what the mark draws: the soft pool's reach only while it
  // is soft (a fragment shaded outside it costs as much as one inside)
  const widest = soft ? Math.max(radius, softRadius ?? radius) : radius;
  const quad =
    kind === 'check' ? 2.1 : kind === 'capture' ? widest * 3.3 + 0.08 : (widest * 1.25 + 0.1) * 2;
  const material = useMemo(
    () =>
      markMaterial({
        uKind: { value: KIND[kind] },
        uColor: { value: new Color(color) },
        uFill: { value: new Color() },
        uDeep: { value: new Color() },
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
        uQuad: { value: quad },
      }),
    // Made once; the uniforms follow the props below
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useRetireOnUnmount(material);
  const u = material.uniforms;
  (u.uColor.value as Color).set(color);
  (u.uFill.value as Color).set(fill ?? color);
  (u.uDeep.value as Color).set(deep ?? fill ?? color);
  u.uRadius.value = radius;
  u.uWidth.value = width;
  u.uFillA.value = fillA;
  u.uWashA.value = washA;
  u.uOpacity.value = opacity;
  u.uStrength.value = pulse;
  u.uQuad.value = quad;
  u.uSoft.value = soft ? 1 : 0;
  u.uSoftRadius.value = softRadius ?? radius;
  // The pointer came or went, or the mark changed: draw a frame for it (and
  // only then: a board render that changes nothing here draws nothing)
  const [fx, fy, fz] = floor;
  useEffect(
    () => invalidate(),
    [
      invalidate,
      hovered,
      color,
      fill,
      deep,
      radius,
      width,
      fillA,
      washA,
      opacity,
      pulse,
      quad,
      soft,
      softRadius,
      settle,
      dimAbove,
      yieldHeld,
      fx,
      fy,
      fz,
    ],
  );

  const age = useRef(0);
  const hover = useRef(0);
  const still = prefersReducedMotion();
  useFrame(({ camera }, delta) => {
    const dt = Math.min(delta, 1 / 8);
    age.current += dt * 1000;
    let moving = false;
    // The grow-in on arrival
    if (u.uGrow.value < 1) {
      u.uGrow.value = easeOutCubic(Math.min(age.current / growMs, 1));
      moving = true;
    }
    // Hover eases in and out over HOVER_MS (smoothstep of a steady ramp)
    const goal = hovered ? 1 : 0;
    if (hover.current !== goal) {
      hover.current = toward(hover.current, goal, (Math.min(delta, 1 / 20) * 1000) / HOVER_MS);
      u.uHover.value = smooth(hover.current);
      moving = true;
    }
    if (u.uPulse.value > 0) {
      u.uPulse.value = Math.max(0, 1 - age.current / STRIKE_MS);
      moving = true;
    }
    if (drawMs > 0 && u.uReveal.value < 1) {
      u.uReveal.value = easeOutQuad(clamp01((age.current - delayMs) / drawMs));
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
      if (held && isStacked(held, floor) && Math.abs(held[1] - floor[1]) < 0.3) amount = 0;
    }
    if (dimAbove) {
      // From high above, the held piece's own level leads
      camera.getWorldDirection(look);
      const k = clamp01((-look.y - 0.8) / 0.17);
      amount *= 1 - 0.4 * k * k * (3 - 2 * k);
    }
    u.uAmount.value = amount;
    if (moving) invalidate();
  });

  return (
    <mesh
      geometry={planeFor(quad)}
      material={material}
      position={[floor[0], floor[1] + 0.012, floor[2]]}
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

export const Capture = ({ floor, hovered = false }: MarkerProps) => {
  useClaim('capture', floor);
  // Straight above or below the held piece: from high above, a soft red pool
  // with no rim, so it never rings the held piece's own circle
  const held = useHeld();
  const stacked = !!held && isStacked(held, floor);
  return (
    <Mark
      floor={floor}
      kind="capture"
      color={PALETTE.capture}
      fill={PALETTE.capture}
      deep="#8a1712"
      fillA={0.1}
      radius={CAPTURE_RADIUS}
      width={0.008}
      opacity={0.92}
      hovered={hovered}
      soft={stacked}
      animate
    />
  );
};

// The Selection marker lives in selection.tsx, with the held piece's light.

/**
 * The last move: a thin circle of pale mint round the piece where it landed
 * (in place of its level ring; drawn in as it lands), the same circle
 * smaller where it started, and a thin continuous line between them with a
 * calm shimmer travelling along it. The circle where it started steps aside
 * for a destination on that square; the one where it landed for a capture,
 * or for the held piece's own circle.
 */
export const LastMove = ({ from, to, fresh = false }: LastMoveMarkerProps) => {
  useClaim('trace', to.floor);
  const radius = 0.005 + 0.0045 * LINE_STRENGTH;
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
        color={TRACE_LINE}
        radius={radius}
        lift={LINE_LIFT}
        opacity={LINE_STRENGTH}
        drawInMs={fresh ? LINE_DRAW_MS : 0}
        drawInDelayMs={fresh ? lineDelay : 0}
      />
      <Shimmer
        from={from.floor}
        to={to.floor}
        radius={radius}
        delayMs={fresh ? lineDelay + LINE_DRAW_MS : 0}
      />
    </>
  );
};

/** How bright and thick the last-move line is, 0–1. */
const LINE_STRENGTH = 0.7;

// The shimmer on the last-move line: a soft glow of white light, a little
// wider than the line, travelling along it from where the move started to
// where it ended, one at a time, added to the line's light so it shows
// while the line itself stays faint.
const LINE_LIFT = 0.02;
const LINE_DRAW_MS = 380;
const lineDelay = MOTION.durationMs * 0.3;
const SHIMMER = { speed: 0.45, spacing: 1.8, length: 0.32, peak: 0.75 };

export const shimmerMaterial = () =>
  overlayMaterial({
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
    vertexShader: tubeVertex,
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
  radius,
  delayMs,
}: {
  from: Vec3;
  to: Vec3;
  radius: number;
  delayMs: number;
}) => {
  const invalidate = useThree((s) => s.invalidate);
  const key = JSON.stringify([from, to, radius]);
  const geometry = useMemo(() => {
    return tubeGeometry(tracePath(from, to, { lift: LINE_LIFT }), {
      radius: radius * 2.4,
      radialSegments: 8,
      capSegments: 2,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the values themselves
  }, [key]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useMemo(shimmerMaterial, []);
  useRetireOnUnmount(material);
  const since = useRef(-delayMs / 1000);
  const still = prefersReducedMotion();
  useEffect(() => invalidate(), [invalidate]);
  useFrame((_, delta) => {
    if (still) return;
    since.current += Math.min(delta, 1 / 20);
    const u = material.uniforms;
    u.uTime.value = Math.max(since.current, 0);
    u.uFade.value = clamp01(since.current / 0.4);
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

/**
 * Check: a crown of red light lying round the king in place of his ring; it
 * strikes when check arrives, then breathes slowly. Dark blades stand round
 * him (blades.tsx). At mate it all settles as the king falls.
 */
export const Check = ({ floor, mated = false }: MarkerProps) => {
  useClaim('check', floor);
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
        pulse={CHECK_PULSE}
        animate
        settle={mated}
        renderOrder={LAYER.marker + 0.2}
      />
      <Blades floor={floor} mated={mated} strength={CHECK_PULSE} />
    </>
  );
};
