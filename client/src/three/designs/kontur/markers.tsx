import { useEffect, useMemo, useRef } from 'react';
import { BoxGeometry, Color, DoubleSide, PlaneGeometry, ShaderMaterial, Vector2 } from 'three';
import type { Group, Mesh } from 'three';
import type { ReactNode } from 'react';
import { LAYER } from '../kit/layers';
import { LastMoveTrace } from '../kit/markers';
import { noRaycast } from '../kit/noRaycast';
import type { LastMoveMarkerProps, MarkerProps, Vec3 } from '../types';
import { pitch } from './layout';
import { clamp01, easeOutBack, useTimeline } from './motion';
import { COBALT, INK, SIGNAL, VERMILION } from './palette';
import { inkMaterial, toonMaterial, withOutline } from './toon';

// Kontur's marks are printed on the platform where a piece stands: one
// family, a square outline inset in its square.
//
// - Where the selected piece can go: a cobalt square.
// - A capture: the same square in vermilion, with four solid teeth biting
//   inward from the middle of its sides.
// - The last move: signal-yellow squares edged in ink on both ends, joined
//   by a yellow ribbon with ink chevrons and an arrowhead.
// - Check: the capture mark, filled, under the king (whose contour turns
//   vermilion too).
// - The selection: a cobalt disc stamped under the lifted piece, with one
//   ring rippling out, and a small cube circling it while it is held.
//
// Each mark is one quad shaded by a signed-distance function, crisp at any
// angle, drawn over every platform (LAYER) so marks on lower levels read
// through the sheets above them.

const vertex = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = (uv - 0.5) * ${pitch.toFixed(4)};
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const fragment = /* glsl */ `
  uniform int uShape;
  uniform vec3 uColor;
  uniform vec3 uInk;
  uniform float uBorder;
  uniform float uOpacity;
  uniform float uFill;
  uniform float uHalf;
  uniform float uLine;
  uniform float uRadius;
  uniform float uTeeth;
  uniform float uToothLen;
  uniform float uToothHalf;
  uniform float uHover;
  uniform vec2 uDir;
  uniform float uChevron;
  varying vec2 vP;

  float roundBox(vec2 p, float b, float r) {
    vec2 q = abs(p) - vec2(b - r);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  float segment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }
  // Isosceles triangle, apex at the origin, base (half width q.x) at y = q.y
  float triangle(vec2 p, vec2 q) {
    p.x = abs(p.x);
    vec2 a = p - q * clamp(dot(p, q) / dot(q, q), 0.0, 1.0);
    vec2 b = p - q * vec2(clamp(p.x / q.x, 0.0, 1.0), 1.0);
    float s = -sign(q.y);
    vec2 d = min(vec2(dot(a, a), s * (p.x * q.y - p.y * q.x)), vec2(dot(b, b), s * (p.y - q.y)));
    return -sqrt(d.x) * sign(d.y);
  }

  void main() {
    vec2 p = vP;
    vec2 q = abs(p);
    float shape;
    float inside;
    float edge;
    if (uShape == 0) {
      float box = roundBox(p, uHalf, uRadius);
      shape = abs(box) - uLine * 0.5;
      inside = box;
      edge = uHalf;
    } else if (uShape == 1) {
      float d = length(p) - uRadius;
      shape = abs(d) - uLine * 0.5;
      inside = d;
      edge = uRadius;
    } else {
      shape = length(p) - uRadius;
      inside = shape;
      edge = uRadius;
    }
    if (uChevron > 0.0) {
      // Two chevrons across the square, pointing the way the piece came in:
      // one inside each side, so one is always in front of the piece
      vec2 d = normalize(uDir);
      vec2 r = vec2(dot(p, d), abs(dot(p, vec2(-d.y, d.x))));
      float arm = uChevron * 0.6;
      // Between the widest foot (0.21) and the square's stroke
      float c1 = segment(r - vec2(uChevron * 2.64, 0.0), vec2(0.0), vec2(-arm, arm));
      float c2 = segment(r - vec2(-uChevron * 1.72, 0.0), vec2(0.0), vec2(-arm, arm));
      shape = min(shape, min(c1, c2) - uLine * 0.42);
    }
    if (uTeeth > 0.5) {
      // Four solid teeth from the middle of each side, pointing in
      vec2 size = vec2(uToothHalf, uToothLen);
      float t = min(
        triangle(vec2(q.y, q.x - (edge - uToothLen)), size),
        triangle(vec2(q.x, q.y - (edge - uToothLen)), size)
      );
      shape = min(shape, t);
    }
    float aa = max(fwidth(shape), 1e-4);
    float core = 1.0 - smoothstep(-aa, aa, shape);
    float outer = uBorder > 0.0 ? 1.0 - smoothstep(-aa, aa, shape - uBorder) : core;
    float ia = max(fwidth(inside), 1e-4);
    float area = 1.0 - smoothstep(-ia, ia, inside);
    vec3 stroke = mix(uInk, uColor * (1.0 + 0.2 * uHover), core);
    float a = outer * min(uOpacity * (1.0 + 0.3 * uHover), 1.0);
    float f = area * (uFill + 0.2 * uHover);
    float alpha = a + f * (1.0 - a);
    if (alpha < 0.003) discard;
    vec3 c = (stroke * a + uColor * f * (1.0 - a)) / alpha;
    gl_FragColor = vec4(c, alpha);
    #include <colorspace_fragment>
  }`;

const SHAPE = { square: 0, ring: 1, disc: 2 } as const;

export interface MarkStyle {
  shape?: keyof typeof SHAPE;
  color?: string;
  /** Ink border round the stroke (0 for none). */
  border?: number;
  opacity?: number;
  /** Faint fill inside the outline. */
  fill?: number;
  /** Square: how far the outline sits inside its square's edge. */
  inset?: number;
  line?: number;
  /** Square: corner radius. Ring and disc: radius. */
  radius?: number;
  teeth?: boolean;
  toothLength?: number;
  toothWidth?: number;
  hovered?: boolean;
  /**
   * Travel direction on the floor (world x, z): draws two chevrons pointing
   * that way inside the square. Size of a chevron, 0 for none.
   */
  direction?: [number, number];
  chevron?: number;
}

const plane = new PlaneGeometry(pitch, pitch);

/** One flat mark lying on the platform at `floor` (or at the origin of its parent). */
export const Mark = ({
  floor = [0, 0, 0],
  shape = 'square',
  color = COBALT,
  border = 0,
  opacity = 0.95,
  fill = 0,
  inset = 0.1,
  line = 0.075,
  radius = 0.03,
  teeth = false,
  toothLength = 0.15,
  toothWidth = 0.2,
  hovered = false,
  direction,
  chevron = 0,
  lift = 0.012,
}: MarkStyle & { floor?: Vec3; lift?: number }) => {
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
          uShape: { value: 0 },
          uColor: { value: new Color() },
          uInk: { value: new Color(INK) },
          uBorder: { value: 0 },
          uOpacity: { value: 1 },
          uFill: { value: 0 },
          uHalf: { value: 0.4 },
          uLine: { value: 0.07 },
          uRadius: { value: 0.03 },
          uTeeth: { value: 0 },
          uToothLen: { value: 0.15 },
          uToothHalf: { value: 0.1 },
          uHover: { value: 0 },
          uDir: { value: new Vector2(1, 0) },
          uChevron: { value: 0 },
        },
        vertexShader: vertex,
        fragmentShader: fragment,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const u = material.uniforms;
  u.uShape.value = SHAPE[shape];
  (u.uColor.value as Color).set(color);
  u.uBorder.value = border * pitch;
  u.uOpacity.value = opacity;
  u.uFill.value = fill;
  // The stroke and its border stay inside the square
  // Under the pointer the stroke thickens inward
  const stroke = hovered ? line * 1.4 : line;
  u.uHalf.value = (0.5 - inset) * pitch - (stroke / 2 + border) * pitch;
  u.uLine.value = stroke * pitch;
  u.uRadius.value = radius * pitch;
  u.uTeeth.value = teeth ? 1 : 0;
  u.uToothLen.value = toothLength * pitch;
  u.uToothHalf.value = (toothWidth / 2) * pitch;
  u.uHover.value = hovered ? 1 : 0;
  // The plane lies flat with its local y along world -z
  const travel = direction && Math.hypot(direction[0], direction[1]) > 1e-3;
  u.uChevron.value = travel ? chevron * pitch : 0;
  if (travel) (u.uDir.value as Vector2).set(direction[0], -direction[1]);
  return (
    <mesh
      geometry={plane}
      material={material}
      position={[floor[0], floor[1] + lift, floor[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={LAYER.marker}
      raycast={noRaycast}
    />
  );
};

/** Scales its children from nothing, with an overshoot, after `delayMs`: a stamp. */
export const Stamp = ({
  at,
  delayMs = 0,
  durationMs = 260,
  from = 1.45,
  children,
}: {
  at: Vec3;
  delayMs?: number;
  durationMs?: number;
  /** Scale the stamp comes down from. */
  from?: number;
  children: ReactNode;
}) => {
  const group = useRef<Group>(null);
  useTimeline(delayMs + durationMs, (t) => {
    const g = group.current;
    if (!g) return;
    const k = clamp01((t * 1000 - delayMs) / durationMs);
    g.visible = t * 1000 >= delayMs;
    // Comes down large and settles with a small overshoot
    const s = from + (1 - from) * easeOutBack(k, 2.2);
    g.scale.set(s, 1, s);
  });
  return (
    <group ref={group} position={at} visible={delayMs === 0}>
      {children}
    </group>
  );
};

// --- The marker set -------------------------------------------------------------------

const QUIET: MarkStyle = { color: COBALT, opacity: 0.92, fill: 0.07, line: 0.07, inset: 0.1 };

const Quiet = ({ floor, hovered }: MarkerProps) => (
  <Mark floor={floor} {...QUIET} hovered={hovered} />
);

// The teeth stop short of the victim's base (every foot is under 0.21 in
// radius), so the whole cue shows round the piece standing there
const Capture = ({ floor, hovered }: MarkerProps) => (
  <Mark
    floor={floor}
    {...QUIET}
    color={VERMILION}
    fill={0.1}
    teeth
    toothLength={0.12}
    toothWidth={0.2}
    hovered={hovered}
  />
);

const LAST: MarkStyle = {
  color: SIGNAL,
  border: 0.022,
  opacity: 1,
  line: 0.065,
  inset: 0.08,
};

/** The move animation's length, so the destination's mark lands with the piece. */
export const MOVE_MS = 380;

/**
 * The last move. Board mounts it afresh for every move; a live move (`fresh`)
 * draws its ribbon in from the source as the piece flies and stamps the
 * destination's square down as it lands, while a replayed or rejoined game
 * shows both at rest.
 */
const LastMove = ({ from, to, fresh = false }: LastMoveMarkerProps) => {
  const arrival: MarkStyle = {
    ...LAST,
    fill: 0.14,
    direction: [to.floor[0] - from.floor[0], to.floor[2] - from.floor[2]],
    chevron: 0.125,
  };
  return (
    <>
      <Mark floor={from.floor} {...LAST} fill={0} />
      {fresh ? (
        <Stamp at={to.floor} delayMs={MOVE_MS * 0.85}>
          <Mark {...arrival} />
        </Stamp>
      ) : (
        <Mark floor={to.floor} {...arrival} />
      )}
      <LastMoveTrace
        from={from.floor}
        to={to.floor}
        color={SIGNAL}
        edgeColor={INK}
        width={0.12}
        headLength={0.36}
        headWidth={0.44}
        chevrons={0.34}
        // The head ends low, on the near edge of the destination's square,
        // clear of the piece standing in it
        lift={0.03}
        endInset={0.4}
        arc={0.5}
        drawInMs={fresh ? MOVE_MS : 0}
      />
    </>
  );
};

const Check = ({ floor }: MarkerProps) => (
  <Mark
    floor={floor}
    {...QUIET}
    color={VERMILION}
    fill={0.22}
    line={0.085}
    inset={0.06}
    teeth
    toothLength={0.17}
    toothWidth={0.24}
    opacity={1}
  />
);

// The satellite: a small cobalt cube circling the held piece
const satellite = withOutline(new BoxGeometry(0.085, 0.085, 0.085));
const satelliteFill = toonMaterial({ lit: '#5d86f0', mid: COBALT, shade: '#10318f' });
const satelliteInk = inkMaterial(INK, 1.8);

const Selection = ({ floor }: MarkerProps) => {
  const pulse = useRef<Group>(null);
  const pulseMark = useRef<Group>(null);
  const orbit = useRef<Group>(null);
  const pulseMs = 520;
  // The ripple, once
  useTimeline(pulseMs, (t) => {
    const g = pulse.current;
    if (!g) return;
    const k = clamp01((t * 1000) / pulseMs);
    const s = 1 + 0.9 * (1 - (1 - k) ** 3);
    g.scale.set(s, 1, s);
    g.visible = k < 1;
    const m = pulseMark.current?.children[0] as Mesh | undefined;
    if (m) (m.material as ShaderMaterial).uniforms.uOpacity.value = 0.8 * (1 - k) ** 1.5;
  });
  // The satellite, while the piece is held
  useTimeline(Infinity, (t) => {
    const o = orbit.current;
    if (!o) return;
    const a = t * ((Math.PI * 2) / 3.6);
    const r = 0.47;
    // A tilted orbit, so it passes in front of and behind the piece
    o.position.set(Math.cos(a) * r, 0.42 + Math.sin(a) * 0.12, Math.sin(a) * r);
    o.rotation.set(t * 1.3, t * 0.9, 0);
  });
  return (
    <group position={floor}>
      <Stamp at={[0, 0, 0]} from={0.2} durationMs={240}>
        {/* Well inside the square, so it never reads as a filled destination */}
        <Mark shape="disc" color={COBALT} radius={0.28} border={0.02} opacity={0.9} />
      </Stamp>
      <group ref={pulse}>
        <group ref={pulseMark}>
          <Mark shape="ring" color={COBALT} radius={0.28} line={0.03} opacity={0.8} />
        </group>
      </group>
      <group ref={orbit}>
        <mesh geometry={satellite} material={satelliteFill} raycast={noRaycast} />
        <mesh geometry={satellite} material={satelliteInk} raycast={noRaycast} />
      </group>
    </group>
  );
};

export const markers = { Quiet, Capture, Selection, LastMove, Check };
