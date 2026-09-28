import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  TorusGeometry,
} from 'three';
import type { BufferGeometry, Mesh } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { prefersReducedMotion } from '../../motion';
import { LAYER } from '../kit/layers';
import { LastMoveLine } from '../kit/line';
import { noRaycast } from '../kit/noRaycast';
import type { LastMoveMarkerProps, MarkerProps, Vec3 } from '../types';
import { FRAME, LEVEL_COLORS, LIFT, MOTION, PALETTE, PIECE_SCALE } from './palette';
import { held, steepness } from './plates';

// Every mark of play is a square of light lying on the board, one family:
//
// - where a piece may go, a rounded square lit from beneath, filled faintly
//   with the colour of its level (the level cue: there is no ring at the
//   pieces' feet) and edged in the same light. Under the pointer its fill
//   deepens, shading toward its edge like a lit well, and it grows a little,
//   eased; its edge does not brighten;
// - a capture, the same square in deep red, with one slow bright mote
//   tracing its edge (after Abyss's lure);
// - the last move, the same square in warm white where the piece landed and
//   a smaller one where it left, joined by a thin solid line of the same
//   light with a slow flow along it. A destination on either square takes
//   its place while it is shown, so two squares never nest;
// - check, a warm-red plate under the king that keeps time like a chess
//   clock: twelve fine ticks round its edge, a thin hand of red light that
//   steps round once every twelve seconds, a faint ripple breathing out of
//   it every other step, and a low glow rising from its edge so it reads
//   from low down. It arrives with a sharp flash that settles.
//
// The selection is the piece's own lamp (pieces.tsx): it lives with the
// piece, so it can go out when the piece is put down.

const MAX_STEP = 1 / 20;

/**
 * Set while a mate is on the board (by the Celebration): the checked king's
 * clock stops, its hand still and its crown going out.
 */
export const mate = { over: false };

/** The level (engine z) a floor height belongs to. */
const levelAt = (y: number) => {
  let best = 0;
  FRAME.levelY.forEach((ly, z) => {
    if (Math.abs(ly - y) < Math.abs(FRAME.levelY[best] - y)) best = z;
  });
  return best;
};

const floorKey = (floor: Vec3) => floor.map((v) => v.toFixed(2)).join(',');

/**
 * Squares a destination marker is on right now: the last move's squares
 * give way to it there, so the two never nest.
 */
const destinations = new Map<string, number>();
const useDestination = (floor: Vec3) => {
  const key = floorKey(floor);
  useEffect(() => {
    destinations.set(key, (destinations.get(key) ?? 0) + 1);
    return () => {
      const n = (destinations.get(key) ?? 1) - 1;
      if (n > 0) destinations.set(key, n);
      else destinations.delete(key);
    };
  }, [key]);
};

// --- The tile shader --------------------------------------------------------------------

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
  uniform vec3 uCore;
  uniform float uHalf;
  uniform float uRadius;
  uniform float uWidth;
  uniform float uOpacity;
  uniform float uFillA;
  uniform float uHover;
  uniform float uGrow;
  uniform float uTime;
  uniform float uSince;
  varying vec2 vP;

  const float PI = 3.14159265;

  float roundBox(vec2 p, float b, float r) {
    vec2 q = abs(p) - vec2(b - r);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  float cover(float d) {
    float aa = max(fwidth(d), 1e-5);
    return 1.0 - smoothstep(-aa, aa, d);
  }
  float segment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }
  // The point at arc length s round a rounded square (half side b, corner
  // radius r), from the middle of its right side, anticlockwise
  vec2 perimeter(float s, float b, float r) {
    float L = b - r;
    float A = 0.5 * PI * r;
    float side = 2.0 * L + A;
    s = mod(s + L, 4.0 * side);
    float k = floor(s / side);
    float u = s - k * side;
    vec2 q = u < 2.0 * L
      ? vec2(b, -L + u)
      : vec2(L, L) + r * vec2(cos((u - 2.0 * L) / r), sin((u - 2.0 * L) / r));
    float c = cos(k * 0.5 * PI);
    float sn = sin(k * 0.5 * PI);
    return vec2(c * q.x - sn * q.y, sn * q.x + c * q.y);
  }
  // Composites a layer over what is below (premultiplied)
  void over(inout vec4 acc, vec3 c, float a) {
    acc.rgb = c * a + acc.rgb * (1.0 - a);
    acc.a = a + acc.a * (1.0 - a);
  }

  void main() {
    // Under the pointer a square grows a little (and fills, below)
    vec2 p = vP / max(uGrow * (1.0 + 0.1 * uHover), 1e-3);
    vec4 acc = vec4(0.0);
    float box = roundBox(p, uHalf, uRadius);
    float edge = cover(abs(box) - uWidth * 0.5);
    float inside = cover(box);

    if (uKind <= 2) {
      // Lit from beneath: an even glow, a touch stronger toward the edge.
      // Under the pointer the fill gains weight and depth: denser, and
      // shading from a lit middle into a deeper edge, like a well of light
      float toEdge = clamp(1.0 + box / uHalf, 0.0, 1.0);
      float rest = uFillA * (0.8 + 0.4 * toEdge * toEdge);
      float deep = 0.3 + 0.16 * (1.0 - toEdge);
      over(acc, uFill, inside * mix(rest, deep, uHover) * uOpacity);
      // The well's shaded rim, only under the pointer
      over(acc, uFill * 0.3, inside * uHover * 0.4 * smoothstep(0.5, 1.0, toEdge) * uOpacity);
      over(acc, uColor, edge * uOpacity);
    }

    if (uKind == 1) {
      // The capture's mote: a bright bead tracing the edge, slowly, the
      // edge behind it glowing in a short, continuous tail
      float b = uHalf;
      float r = uRadius;
      float L = b - r;
      float side = 2.0 * L + 0.5 * PI * r;
      float P = 4.0 * side;
      float head = mod(uTime / 3.6 * P, P);
      // Where along the edge this point lies (its nearest point's arc length)
      float k = mod(floor(atan(p.y, p.x) / (0.5 * PI) + 0.5), 4.0);
      float c = cos(-k * 0.5 * PI);
      float sn = sin(-k * 0.5 * PI);
      vec2 q = vec2(c * p.x - sn * p.y, sn * p.x + c * p.y);
      float sl = q.y > L
        ? L + atan(q.y - L, q.x - L) * r
        : q.y < -L ? -L + atan(q.y + L, q.x - L) * r : q.y;
      float behind = mod(head - (k * side + sl), P);
      float tail = exp(-behind / (0.09 * P)) * (1.0 - smoothstep(0.0, 0.004 * P, P - behind - 0.001));
      float band = cover(abs(box) - uWidth * 0.9);
      vec2 at = perimeter(head, b, r);
      float d = length(p - at);
      float bead = 1.0 - smoothstep(uWidth * 0.7, uWidth * 1.5, d);
      float glow = exp(-d * d / (uWidth * uWidth * 7.0)) * 0.5;
      over(acc, uCore, min(max(tail * band * 0.85, max(bead, glow)), 1.0) * uOpacity);
    }

    if (uKind == 3) {
      // Check: the plate, its edge, the ticks and the hand of a clock
      float flash = exp(-uSince / 0.2);
      over(acc, uFill, inside * (uFillA + 0.55 * flash));
      over(acc, uColor, edge * (0.9 + 0.1 * flash));
      // Twelve ticks round the edge, the quarters a little longer
      float ang = atan(p.y, p.x);
      float k = floor(ang / (PI / 6.0) + 0.5);
      float ta = k * PI / 6.0;
      vec2 d = vec2(cos(ta), sin(ta));
      float reach = uHalf / max(abs(d.x), abs(d.y));
      float quarter = step(abs(mod(k, 3.0)), 0.01);
      float tick = segment(p, d * (reach - 0.05 - 0.035 * quarter), d * (reach - 0.018)) - 0.006;
      over(acc, uColor, cover(tick) * 0.8);
      // The hand steps round clockwise once a second, twelve steps a turn,
      // each step a quick eased tick
      float T = uTime;
      float step1 = min(fract(T) / 0.16, 1.0);
      float eased = 1.0 - pow(1.0 - step1, 3.0);
      float ha = PI * 0.5 - (floor(T) + eased) * PI / 6.0;
      vec2 hd = vec2(cos(ha), sin(ha));
      float hreach = uHalf / max(abs(hd.x), abs(hd.y));
      float hand = segment(p, hd * 0.27, hd * (hreach - 0.02)) - 0.009;
      // A faint sweep of light trailing the hand, a sixth of a turn
      float behind = mod(ang - ha, 2.0 * PI);
      float trail = (1.0 - smoothstep(0.0, PI / 3.0, behind)) * smoothstep(0.26, 0.3, length(p)) * inside;
      over(acc, uColor, trail * 0.18);
      over(acc, uCore, cover(hand));
      // A faint ripple breathes out of the plate every other step
      float ph = fract(T / 2.0);
      float rip = roundBox(p, uHalf + 0.11 * ph, uRadius + 0.05 * ph);
      over(acc, uColor, cover(abs(rip) - 0.006) * 0.35 * (1.0 - ph) * (1.0 - ph));
      // The arrival: a crisp square thrown out once, fast
      float out1 = min(uSince / 0.4, 1.0);
      float ring = roundBox(p, uHalf + 0.3 * (1.0 - pow(1.0 - out1, 3.0)), uRadius);
      over(acc, uCore, cover(abs(ring) - 0.01) * (1.0 - out1) * 0.9);
    }

    if (acc.a < 0.003) discard;
    gl_FragColor = vec4(acc.rgb / acc.a, min(acc.a, 1.0));
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

interface TileProps {
  floor: Vec3;
  kind: Kind;
  color: string;
  fill?: string;
  core?: string;
  /** Half side of the square, to the middle of its edge (world units). */
  half: number;
  radius?: number;
  width?: number;
  fillOpacity?: number;
  opacity?: number;
  hovered?: boolean;
  /** Grow in from 70% over this long when mounted, after `delayMs`. */
  growMs?: number;
  delayMs?: number;
  /** Give way while a destination marker is on this square. */
  yields?: boolean;
  /** Keeps asking for frames (a mote, a clock). */
  animated?: boolean;
  /**
   * From above, off the held piece's level, draw smaller and a little
   * fainter, so the destinations of one square on several levels nest.
   */
  nests?: boolean;
  quad?: number;
  renderOrder?: number;
}

/** One flat mark on the board at a cell's floor. */
const Tile = ({
  floor,
  kind,
  color,
  fill = color,
  core = color,
  half,
  radius = 0.1,
  width = 0.022,
  fillOpacity = 0.12,
  opacity = 1,
  hovered = false,
  growMs = 0,
  delayMs = 0,
  yields = false,
  animated = false,
  nests = false,
  quad = FRAME.pitch,
  renderOrder = LAYER.marker,
}: TileProps) => {
  const invalidate = useThree((s) => s.invalidate);
  const mesh = useRef<Mesh>(null);
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
          uColor: { value: new Color() },
          uFill: { value: new Color() },
          uCore: { value: new Color() },
          uHalf: { value: half },
          uRadius: { value: radius },
          uWidth: { value: width },
          uOpacity: { value: 0 },
          uFillA: { value: fillOpacity },
          uHover: { value: 0 },
          uGrow: { value: 1 },
          uTime: { value: 0 },
          uSince: { value: 0 },
          uQuad: { value: quad },
        },
        vertexShader,
        fragmentShader,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one material per mark
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const u = material.uniforms;
  (u.uColor.value as Color).set(color);
  (u.uFill.value as Color).set(fill);
  (u.uCore.value as Color).set(core);
  u.uHalf.value = half;
  u.uRadius.value = radius;
  u.uWidth.value = width;
  u.uFillA.value = fillOpacity;

  const still = prefersReducedMotion();
  const state = useRef({ since: growMs > 0 && !still ? -delayMs : 1e6, hover: 0, shown: 1 });
  const key = floorKey(floor);
  const level = levelAt(floor[1]);
  useEffect(() => invalidate(), [hovered, invalidate]);
  useFrame((_, delta) => {
    const st = state.current;
    const dt = Math.min(delta, MAX_STEP);
    let moving = animated && !still;
    st.since += dt * 1000;
    // The entrance: in from 70%, eased
    const g = growMs > 0 ? Math.min(Math.max(st.since / growMs, 0), 1) : 1;
    if (g < 1) moving = true;
    const e = 1 - (1 - g) ** 3;
    // Nested from above (follows the view: frames come with the camera)
    const nest = nests && held.level !== null && held.level !== level ? steepness.value : 0;
    u.uGrow.value = (0.7 + 0.3 * e) * (1 - 0.3 * nest);
    // Hover: toward 1 over about 180 ms, eased in and out
    const goal = hovered ? 1 : 0;
    st.hover =
      goal > st.hover ? Math.min(goal, st.hover + dt / 0.18) : Math.max(goal, st.hover - dt / 0.18);
    if (st.hover !== goal) moving = true;
    u.uHover.value = st.hover * st.hover * (3 - 2 * st.hover);
    // Giving way to a destination on the same square
    const shownGoal = yields && destinations.has(key) ? 0 : 1;
    st.shown =
      shownGoal > st.shown ? Math.min(1, st.shown + dt / 0.15) : Math.max(0, st.shown - dt / 0.15);
    if (st.shown !== shownGoal) moving = true;
    u.uOpacity.value = opacity * e * st.shown * (1 - 0.25 * nest);
    if (mesh.current) mesh.current.visible = g > 0 && st.shown > 0;
    // A clock stops at mate
    if (!still && !(kind === 'check' && mate.over)) u.uTime.value += dt;
    u.uSince.value = Math.max(st.since, 0) / 1000;
    if (moving) invalidate();
  });
  return (
    <mesh
      ref={mesh}
      geometry={planeFor(quad)}
      material={material}
      position={[floor[0], floor[1] + 0.006, floor[2]]}
      renderOrder={renderOrder}
      raycast={noRaycast}
    />
  );
};

// --- Destinations ------------------------------------------------------------------------

/** Half side of a destination's square: well inside its square, clear of a piece's foot. */
const HALF = 0.37;
const RADIUS = 0.1;

/** A legal move: a rounded square lit from beneath in its level's colour. */
export const Quiet = ({ floor, hovered }: MarkerProps) => {
  useDestination(floor);
  const c = LEVEL_COLORS[levelAt(floor[1])];
  const edge = useMemo(
    () => `#${new Color(c).lerp(new Color('#ffffff'), 0.2).getHexString()}`,
    [c],
  );
  return (
    <Tile
      floor={floor}
      kind="quiet"
      color={edge}
      fill={c}
      half={HALF}
      radius={RADIUS}
      width={0.026}
      fillOpacity={0.19}
      opacity={1}
      hovered={hovered}
      growMs={160}
      nests
    />
  );
};

/** A capture: the same square in deep red, a slow bright mote tracing its edge. */
export const Capture = ({ floor, hovered }: MarkerProps) => {
  useDestination(floor);
  return (
    <Tile
      floor={floor}
      kind="capture"
      color={PALETTE.capture}
      fill={PALETTE.capture}
      core="#ffd9c8"
      half={HALF}
      radius={RADIUS}
      width={0.024}
      fillOpacity={0.14}
      opacity={1}
      hovered={hovered}
      growMs={160}
      nests
      animated
      renderOrder={LAYER.marker + 0.1}
    />
  );
};

/** The selection is the held piece's lamp (pieces.tsx), which can fade when it is put down. */
export const Selection = () => null;

// --- The last move ---------------------------------------------------------------------

/** The square it left: the same square as where it landed, smaller. */
const FROM_SCALE = 0.7;

/**
 * The last move: a warm white square where the piece landed, a smaller one
 * where it left, and the thin solid line between them. A fresh move draws
 * its line in behind the gliding piece and its landing square as it lands.
 */
export const LastMove = ({ from, to, fresh = false, arc = 0 }: LastMoveMarkerProps) => (
  <>
    <Tile
      floor={from.floor}
      kind="trace"
      color={PALETTE.trace}
      half={HALF * FROM_SCALE}
      radius={RADIUS * FROM_SCALE}
      width={0.018}
      fillOpacity={0.06}
      opacity={0.8}
      yields
      growMs={fresh ? 200 : 0}
    />
    <Tile
      floor={to.floor}
      kind="trace"
      color={PALETTE.trace}
      half={HALF}
      radius={RADIUS}
      width={0.018}
      fillOpacity={0.05}
      opacity={0.85}
      yields
      growMs={fresh ? 240 : 0}
      delayMs={fresh ? MOTION.durationMs * 0.85 : 0}
    />
    <LastMoveLine
      from={from.floor}
      to={to.floor}
      arc={arc}
      color={PALETTE.trace}
      pulseColor="#ffffff"
      opacity={0.8}
      radius={0.016}
      pattern="solid"
      flowSpeed={0.55}
      pulse={0.55}
      pulseLength={0.4}
      drawInMs={fresh ? MOTION.durationMs : 0}
    />
  </>
);

// --- Check ---------------------------------------------------------------------------------

const CHECK_HALF = 0.42;
const GLOW_HEIGHT = 0.24;

const glowVertex = /* glsl */ `
  uniform float uHeight;
  varying float vH;
  varying vec3 vN;
  varying vec3 vW;
  void main() {
    vH = position.y / uHeight + 0.5;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const glowFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vH;
  varying vec3 vN;
  varying vec3 vW;
  void main() {
    // Brightest at the plate, gone by the top; stronger seen edge on
    vec3 v = normalize(cameraPosition - vW);
    float side = 0.4 + 0.6 * (1.0 - abs(dot(normalize(vN), v)));
    float a = pow(1.0 - clamp(vH, 0.0, 1.0), 2.2) * side * uOpacity;
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }`;

/** The low glow rising from the plate's edge, so a check reads from low down too. */
const CheckGlow = ({ floor }: { floor: Vec3 }) => {
  const invalidate = useThree((s) => s.invalidate);
  const { geometry, material } = useMemo(() => {
    const s = CHECK_HALF * 2;
    const geometry = new BoxGeometry(s, GLOW_HEIGHT, s);
    // Only the four walls: no lid, no floor
    geometry.clearGroups();
    geometry.addGroup(0, 12, 0);
    geometry.addGroup(24, 12, 0);
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
      uniforms: {
        uColor: { value: new Color(PALETTE.check) },
        uOpacity: { value: 0 },
        uHeight: { value: GLOW_HEIGHT },
      },
      vertexShader: glowVertex,
      fragmentShader: glowFragment,
    });
    return { geometry, material };
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  const since = useRef(0);
  useFrame((_, delta) => {
    since.current += Math.min(delta, MAX_STEP);
    const t = since.current;
    // A flash on arrival that settles into a slow breath
    const flash = Math.exp(-t / 0.25);
    const breath = prefersReducedMotion() ? 0 : 0.08 * Math.sin(t * 1.6);
    material.uniforms.uOpacity.value = Math.min(1, t / 0.08) * (0.22 + 0.4 * flash + breath);
    invalidate();
  });
  return (
    <mesh
      geometry={geometry}
      material={[material]}
      position={[floor[0], floor[1] + GLOW_HEIGHT / 2 + 0.004, floor[2]]}
      renderOrder={LAYER.trace + 0.2}
      raycast={noRaycast}
    />
  );
};

/**
 * Check: a warm-red plate under the king that keeps time like a chess clock
 * (see the top of this file), with a low glow rising from its edge.
 */
// --- The crown over a king in check ----------------------------------------------------

/** How far above the floor the crown floats: just clear of a king held up. */
const CROWN_Y = (0.87 + LIFT.selected) * PIECE_SCALE + 0.025;
const CROWN_R = 0.13;

/** A thin ring of light set with twelve upright ticks: a crown, and a clock's dial. */
const crownGeometry = (() => {
  const parts: BufferGeometry[] = [new TorusGeometry(CROWN_R, 0.007, 5, 36).rotateX(Math.PI / 2)];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const tall = i % 3 === 0 ? 0.05 : 0.032;
    parts.push(
      new BoxGeometry(0.012, tall, 0.012)
        .rotateY(-a)
        .translate(Math.cos(a) * CROWN_R, tall / 2, Math.sin(a) * CROWN_R),
    );
  }
  for (const p of parts) {
    for (const name of Object.keys(p.attributes)) if (name !== 'position') p.deleteAttribute(name);
  }
  const merged = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
  parts.forEach((p) => p.dispose());
  return merged;
})();

/**
 * A small crown of red light floating over the king: it arrives with the
 * plate's flash (settling down from a little higher and wider) and keeps
 * time with its hand, brightening briefly at every step.
 */
const CheckCrown = ({ floor }: { floor: Vec3 }) => {
  const invalidate = useThree((s) => s.invalidate);
  const mesh = useRef<Mesh>(null);
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        color: new Color(PALETTE.check),
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
        fog: false,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const since = useRef(0);
  const out = useRef(mate.over ? 1 : 0);
  useFrame((_, delta) => {
    const dt = Math.min(delta, MAX_STEP);
    since.current += dt;
    const t = since.current;
    const still = prefersReducedMotion();
    const arrive = 1 - (1 - Math.min(t / 0.35, 1)) ** 3;
    const flash = Math.exp(-t / 0.25);
    const tick = still || mate.over ? 0 : Math.exp(-(t % 1) / 0.18) * 0.25;
    // At mate the crown sinks a little and goes out
    if (mate.over) out.current = Math.min(1, out.current + dt / 0.7);
    const o = out.current;
    material.opacity = Math.min(1, t / 0.06) * (0.62 + 0.38 * flash + tick) * (1 - o);
    const m = mesh.current;
    if (m) {
      m.visible = o < 1;
      m.scale.setScalar(1.35 - 0.35 * arrive);
      m.position.set(floor[0], floor[1] + CROWN_Y + 0.12 * (1 - arrive) - 0.15 * o, floor[2]);
    }
    if (o < 1) invalidate();
  });
  return (
    <mesh
      ref={mesh}
      geometry={crownGeometry}
      material={material}
      position={[floor[0], floor[1] + CROWN_Y, floor[2]]}
      renderOrder={LAYER.trace + 0.3}
      raycast={noRaycast}
    />
  );
};

export const Check = ({ floor }: MarkerProps) => (
  <>
    <CheckCrown floor={floor} />
    <Tile
      floor={floor}
      kind="check"
      color={PALETTE.check}
      fill={PALETTE.check}
      core="#ffa58c"
      half={CHECK_HALF}
      radius={0.07}
      width={0.022}
      fillOpacity={0.2}
      opacity={1}
      animated
      quad={FRAME.pitch * 1.8}
      renderOrder={LAYER.marker + 0.2}
    />
    <CheckGlow floor={floor} />
  </>
);
