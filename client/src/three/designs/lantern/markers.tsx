import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import type { Mesh } from 'three';
import { LAYER } from '../kit/layers';
import { LastMoveLine } from '../kit/line';
import { FLOOR_DECAL } from '../kit/motion';
import { noRaycast } from '../kit/noRaycast';
import type { LastMoveMarkerProps, MarkerProps, Vec3 } from '../types';
import { CheckFlag } from './hud';
import { CHECK, FIREFLY, LACQUER, LANTERN, SELECT } from './palette';

// Lantern's marks on the paper, all of one family: rings of light, like the
// top of a paper lantern (its rim and a rib inside it) or a ripple raked
// round a stone.
//
// - A legal move: a small lantern of warm light, a rim and a rib over a
//   soft glow.
// - A capture: the same lantern opened wide round the victim's base, in red
//   lacquer, with four small seal marks toward the square's corners.
// - The selection: a lantern held under the piece, its glow swelling, four
//   arcs round it, and one ripple spreading out across the platform.
// - The last move: firefly light, a small ring where the piece left, a
//   ring round its base where it landed, and a thin thread between them.
// - Check: red lacquer under the king, a bold ring round it, and a bell
//   struck once: two rings roll out across the platform and are gone.

export const MAX_FRAME = 1 / 20;

const vertexShader = /* glsl */ `
  uniform float uQuad;
  varying vec2 vP;
  varying vec3 vWorld;
  void main() {
    vP = (uv - 0.5) * uQuad;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform vec3 uRings[3];
  uniform vec2 uGlow;
  uniform vec3 uSeals;
  uniform float uHover;
  uniform float uClip;
  uniform vec2 uDash;
  uniform vec3 uColor2;
  uniform vec3 uAlt;
  uniform vec4 uTicks;
  uniform vec3 uJewel;
  varying vec2 vP;
  varying vec3 vWorld;

  // Coverage of a filled shape of signed distance d
  float fill(float d) {
    float aa = max(fwidth(d), 1e-4);
    return 1.0 - smoothstep(-aa, aa, d);
  }
  // Paints colour c at coverage k over the premultiplied colour acc
  vec4 over(vec4 acc, vec3 c, float k) {
    return vec4(c * k + acc.rgb * (1.0 - k), k + acc.a * (1.0 - k));
  }

  // 1 on COUNT arcs, each DUTY of its share of the circle, centred on the axes
  float arcs(vec2 p, float count, float duty) {
    float t = fract(atan(p.y, p.x) / 6.2831853 * count + 0.5 * duty);
    float ta = max(fwidth(t), 1e-4) * 1.5;
    return smoothstep(0.0, ta, t) * (1.0 - smoothstep(duty - ta, duty, t));
  }

  void main() {
    if (uClip > 0.0 && (abs(vWorld.x) > uClip || abs(vWorld.z) > uClip)) discard;
    float r = length(vP);
    float a = 0.0;
    // The ring numbered uAlt.x is drawn apart, in uColor2, broken into uAlt.y arcs
    float alt = 0.0;
    for (int i = 0; i < 3; i++) {
      vec3 ring = uRings[i];
      if (ring.z <= 0.0) continue;
      float d = abs(r - ring.x) - ring.y * 0.5;
      float aa = max(fwidth(d), 1e-4);
      float ra = (1.0 - smoothstep(-aa, aa, d)) * ring.z;
      if (abs(float(i) - uAlt.x) < 0.5) alt = max(alt, ra * arcs(vP, uAlt.y, uAlt.z));
      else a = max(a, ra);
    }
    if (uTicks.x > 0.0) {
      // Short radial ribs, as on the top of a paper lantern
      float sector = 6.2831853 / uTicks.x;
      float k = floor(atan(vP.y, vP.x) / sector) * sector + sector * 0.5;
      vec2 dir = vec2(cos(k), sin(k));
      float along = clamp(dot(vP, dir), uTicks.y, uTicks.z);
      float d = length(vP - dir * along) - uTicks.w * 0.5;
      float aa = max(fwidth(d), 1e-4);
      a = max(a, 1.0 - smoothstep(-aa, aa, d));
    }
    if (uDash.x > 0.0) a *= arcs(vP, uDash.x, uDash.y);
    if (uGlow.y > 0.0) {
      float g = exp(-(r * r) / (uGlow.x * uGlow.x) * 2.4);
      // Round a jewel the heart stays clear, so the jewels of crests on the
      // levels below show through it
      if (uJewel.x > 0.0) g *= smoothstep(0.115, 0.175, r);
      a = a + g * uGlow.y * (1.0 - a);
    }
    float lift = uOpacity * (1.0 + 0.45 * uHover);
    // Layered, bottom up: the marker's own rings, ribs and glow; the ring in
    // uColor2; the seals (in uColor2 when uJewel.z is set); and the jewel
    vec4 acc = over(vec4(0.0), uColor, min(a * lift, 1.0));
    if (uJewel.x > 0.0) {
      // Seen from high above, where crests of several levels stack on one
      // square, the level's arcs would cover the jewels below: the jewels
      // alone say the level there
      float elevation = degrees(asin(clamp(normalize(cameraPosition - vWorld).y, -1.0, 1.0)));
      alt *= 1.0 - smoothstep(55.0, 72.0, elevation);
    }
    acc = over(acc, uColor2, min(alt * lift, 1.0));
    if (uSeals.z > 0.0) {
      // Four small square seals out toward the corners
      vec2 q = abs(vP) - vec2(0.70710678 * uSeals.x);
      float d = max(abs(q.x), abs(q.y)) - uSeals.y;
      acc = over(acc, uJewel.z > 0.5 ? uColor2 : uColor, fill(d) * min(uSeals.z * lift, 1.0));
    }
    if (uJewel.x > 0.0) {
      // A jewel of the level's colour at the heart, in a dark setting so it
      // holds against the gold
      acc = over(acc, vec3(0.102, 0.078, 0.133), fill(r - uJewel.x - uJewel.y) * min(lift, 1.0));
      acc = over(acc, uColor2, fill(r - uJewel.x) * min(lift, 1.0));
    }
    if (acc.a < 0.003) discard;
    gl_FragColor = vec4(acc.rgb / acc.a * (1.0 + 0.2 * uHover), min(acc.a, 1.0));
    #include <colorspace_fragment>
  }`;

const planes = new Map<number, PlaneGeometry>();
const planeFor = (size: number) => {
  let g = planes.get(size);
  if (!g) {
    g = new PlaneGeometry(size, size);
    planes.set(size, g);
  }
  return g;
};

/** A ring: radius, stroke width, opacity. */
export type Ring = [number, number, number];

export interface MarkUniforms {
  uColor: { value: Color };
  uOpacity: { value: number };
  uRings: { value: Vector3[] };
  uGlow: { value: Vector2 };
  uSeals: { value: Vector3 };
  uHover: { value: number };
  uClip: { value: number };
  uQuad: { value: number };
  uDash: { value: Vector2 };
  uColor2: { value: Color };
  uAlt: { value: Vector3 };
  uTicks: { value: Vector4 };
  uJewel: { value: Vector3 };
}

export interface MarkProps {
  /** Centre of the mark, on the floor. */
  floor: Vec3;
  color: string;
  opacity?: number;
  rings?: Ring[];
  /** A soft glow under the rings: radius and opacity at its centre. */
  glow?: [number, number];
  /** Break the rings into this many arcs, each this share of its period (e.g. [4, 0.6]). */
  dashes?: [number, number];
  /**
   * Draw one ring apart, in its own colour, broken into arcs: the ring's
   * index, the colour, how many arcs and each one's share of its period.
   */
  alt?: { ring: number; color: string; arcs: number; duty: number };
  /** Radial ribs: how many, from and to which radius, how wide. */
  ticks?: [number, number, number, number];
  /** A filled jewel in `alt`'s colour at the centre: its radius and its dark setting's width. */
  jewel?: [number, number];
  /** Draw the seals in `alt`'s colour. */
  altSeals?: boolean;
  /** Four square seals toward the corners: distance from centre, half size, opacity. */
  seals?: [number, number, number];
  hovered?: boolean;
  /** Size of the quad drawn (world units): at least twice the largest radius. */
  quad?: number;
  /** Keep the mark within the platform (|x|, |z| up to this); 0 for none. */
  clip?: number;
  additive?: boolean;
  renderOrder?: number;
  lift?: number;
  /**
   * Plays an entrance (or a one-off effect): called each frame with the
   * mark's uniforms and the time since it mounted (ms, after `delayMs`);
   * return true while it still has frames to play.
   */
  animate?: (u: MarkUniforms, ms: number) => boolean;
  delayMs?: number;
  /** A floor decal inside a piece body: hidden when a mated king topples. */
  decal?: boolean;
}

/**
 * A flat mark lying on the paper at a cell's floor: up to three rings over
 * a soft glow, and optional seals, each an antialiased signed-distance
 * shape, crisp at any angle. Static unless `animate` is given.
 */
export const Mark = ({
  floor,
  color,
  opacity = 1,
  rings = [],
  glow = [0.3, 0],
  seals = [0, 0, 0],
  dashes = [0, 0],
  alt,
  ticks = [0, 0, 0, 0],
  jewel = [0, 0],
  altSeals = false,
  hovered = false,
  quad = 1,
  clip = 0,
  additive = false,
  renderOrder = LAYER.marker,
  lift = 0.012,
  animate,
  delayMs = 0,
  decal = false,
}: MarkProps) => {
  const invalidate = useThree((s) => s.invalidate);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: additive ? AdditiveBlending : NormalBlending,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        uniforms: {
          uColor: { value: new Color() },
          uOpacity: { value: 1 },
          uRings: { value: [new Vector3(), new Vector3(), new Vector3()] },
          uGlow: { value: new Vector2() },
          uSeals: { value: new Vector3() },
          uHover: { value: 0 },
          uClip: { value: 0 },
          uQuad: { value: 1 },
          uDash: { value: new Vector2() },
          uColor2: { value: new Color() },
          uAlt: { value: new Vector3(-1, 0, 0) },
          uTicks: { value: new Vector4() },
          uJewel: { value: new Vector3() },
        },
        vertexShader,
        fragmentShader,
      }),
    [additive],
  );
  useEffect(() => () => material.dispose(), [material]);
  const u = material.uniforms as unknown as MarkUniforms;
  u.uColor.value.set(color);
  u.uOpacity.value = opacity;
  u.uRings.value.forEach((v, i) => v.set(...(rings[i] ?? [0, 0, 0])));
  u.uGlow.value.set(glow[0], glow[1]);
  u.uSeals.value.set(...seals);
  u.uDash.value.set(...dashes);
  u.uAlt.value.set(alt ? alt.ring : -1, alt?.arcs ?? 0, alt?.duty ?? 0);
  if (alt) u.uColor2.value.set(alt.color);
  u.uTicks.value.set(...ticks);
  u.uJewel.value.set(jewel[0], jewel[1], altSeals ? 1 : 0);
  u.uHover.value = hovered ? 1 : 0;
  u.uClip.value = clip;
  u.uQuad.value = quad;

  const mesh = useRef<Mesh>(null);
  const elapsed = useRef(-delayMs);
  const playing = useRef(!!animate);
  const latest = useRef(animate);
  latest.current = animate;
  // An entrance's first frame is set before the mark is ever drawn; a
  // delayed one stays hidden until it starts
  const waiting = !!animate && delayMs > 0;
  if (animate && !waiting && elapsed.current === 0) animate(u, 0);
  useEffect(() => invalidate(), [invalidate]);
  useFrame((_, delta) => {
    if (!playing.current || !latest.current) return;
    elapsed.current += Math.min(delta, MAX_FRAME) * 1000;
    invalidate();
    if (mesh.current) mesh.current.visible = elapsed.current >= 0;
    if (elapsed.current < 0) return;
    playing.current = latest.current(u, elapsed.current);
  });

  return (
    <mesh
      ref={mesh}
      visible={!waiting}
      {...(decal ? { userData: FLOOR_DECAL } : {})}
      geometry={planeFor(quad)}
      material={material}
      position={[floor[0], floor[1] + lift, floor[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={renderOrder}
      raycast={noRaycast}
    />
  );
};

// --- The marker set ---------------------------------------------------------------------

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * One ripple rolling out from a point across the platform and fading, as
 * from a stone dropped in still water: from radius `from` to `to` over
 * `ms`. Returns the animate callback for a Mark with one ring.
 */
export const ripple =
  (from: number, to: number, ms: number, width: number, alpha: number) =>
  (u: MarkUniforms, t: number) => {
    const k = Math.min(t / ms, 1);
    const e = easeOut(k);
    u.uRings.value[0].set(from + (to - from) * e, width * (1 - 0.6 * e), alpha * (1 - k) ** 1.4);
    return k < 1;
  };

export interface LanternMarkers {
  Quiet: (props: MarkerProps) => React.JSX.Element;
  Capture: (props: MarkerProps) => React.JSX.Element;
  Selection: (props: MarkerProps) => React.JSX.Element;
  LastMove: (props: LastMoveMarkerProps) => React.JSX.Element;
  Check: (props: MarkerProps) => React.JSX.Element;
}

/**
 * The whole marker set, for a tower of this pitch whose platforms reach
 * `clip` from the centre, and a move of `moveMs`.
 */
export const lanternMarkers = ({
  pitch,
  clip,
  moveMs,
  levelY,
  levels,
}: {
  pitch: number;
  clip: number;
  moveMs: number;
  /** Height of each level's floor, A to E, to tell which level a mark lies on. */
  levelY: number[];
  /** Each level's colour, A to E. */
  levels: string[];
}): LanternMarkers => {
  const s = pitch;
  /** The level (0 = A) whose floor is at this height. */
  const levelAt = (y: number) =>
    levelY.reduce((best, h, z) => (Math.abs(h - y) < Math.abs(levelY[best] - y) ? z : best), 0);
  /**
   * The jewel's radius: largest on A, smallest on E, so crests stacked on
   * one square from different levels show every jewel from above, nested
   * like a target (the nearest level's, drawn last, is the smallest).
   */
  const jewelFor = (floor: Vec3) => 0.1 - 0.015 * levelAt(floor[1]);
  /** A ring in the level's colour, broken into one arc per level (A: 1, E: 5). */
  const levelRib = (floor: Vec3, ring: number) => {
    const z = levelAt(floor[1]);
    return { ring, color: levels[z], arcs: z + 1, duty: z === 0 ? 0.86 : 0.7 };
  };

  /**
   * A legal destination: the crest of a paper lantern seen from above, a
   * gold rim with eight short ribs over a warm glow, and at its heart a
   * jewel in the destination level's colour (smaller the higher the level),
   * ringed by the same colour in one arc per level (A: 1 ... E: 5): from
   * any angle, top-down too, and however many crests stack on one square,
   * each says its level.
   */
  const Quiet = ({ floor, hovered }: MarkerProps) => (
    <Mark
      floor={floor}
      color={LANTERN}
      rings={[
        [(hovered ? 0.345 : 0.3) * s, (hovered ? 0.09 : 0.08) * s, 1],
        [0.15 * s, 0.05 * s, hovered ? 1 : 0.9],
      ]}
      alt={levelRib(floor, 1)}
      jewel={[jewelFor(floor) * s, 0.012 * s]}
      ticks={[8, 0.19 * s, 0.27 * s, 0.022 * s]}
      glow={[(hovered ? 0.36 : 0.32) * s, hovered ? 0.62 : 0.32]}
      hovered={hovered}
      quad={0.8 * s}
    />
  );

  /**
   * A capture: the lantern opened round the victim, in red lacquer, with
   * the level's ring inside it and its four corner seals in the level's
   * colour (the victim covers the heart, where a move's jewel would be).
   */
  const Capture = ({ floor, hovered }: MarkerProps) => (
    <Mark
      floor={floor}
      color={LACQUER}
      rings={[
        [(hovered ? 0.45 : 0.435) * s, 0.055 * s, 1],
        [0.37 * s, 0.026 * s, hovered ? 1 : 0.85],
      ]}
      alt={levelRib(floor, 1)}
      glow={[0.42 * s, hovered ? 0.5 : 0.2]}
      seals={[0.56 * s, 0.04 * s, 1]}
      altSeals
      hovered={hovered}
      quad={1.02 * s}
    />
  );

  /**
   * The selection: warm light pooling under the piece (added to the paper,
   * as light is), swelling as the piece is picked up; four arcs of a
   * lantern's frame holding it (broken, so it is never taken for a move's
   * ring); and one ripple spreading across the platform.
   */
  const Selection = ({ floor }: MarkerProps) => (
    <>
      <Mark
        floor={floor}
        color={SELECT}
        glow={[0.5 * s, 0.85]}
        additive
        quad={1.3 * s}
        renderOrder={LAYER.shadow + 0.5}
        lift={0.006}
        animate={(u, t) => {
          const k = Math.min(t / 520, 1);
          u.uOpacity.value =
            k < 0.5 ? 1.25 * easeOut(k / 0.5) : 1 + 0.25 * (1 - (k - 0.5) / 0.5) ** 2;
          return k < 1;
        }}
      />
      <Mark
        floor={floor}
        color={SELECT}
        rings={[[0.44 * s, 0.045 * s, 0.95]]}
        dashes={[4, 0.62]}
        quad={1 * s}
        animate={(u, t) => {
          const k = Math.min(t / 300, 1);
          u.uOpacity.value = easeOut(k);
          u.uRings.value[0].x = s * (0.36 + 0.08 * easeOut(k));
          return k < 1;
        }}
      />
      <Mark
        floor={floor}
        color={SELECT}
        quad={3.6 * s}
        clip={clip}
        animate={ripple(0.44 * s, 1.7 * s, 1300, 0.04 * s, 0.75)}
        delayMs={80}
      />
    </>
  );

  /**
   * The last move in firefly light: a small ring where the piece stood, a
   * ring round its base where it stands now, and a thin thread between
   * them with a slow pulse drifting along it. A fresh move threads the line
   * in as the piece lands.
   */
  const LastMove = ({ from, to, fresh = false, arc = 0 }: LastMoveMarkerProps) => (
    <>
      <Mark
        floor={from.floor}
        color={FIREFLY}
        rings={[[0.2 * s, 0.03 * s, 0.85]]}
        glow={[0.2 * s, 0.14]}
        quad={0.6 * s}
      />
      <Mark
        floor={to.floor}
        color={FIREFLY}
        rings={[[0.375 * s, 0.03 * s, 0.9]]}
        quad={0.9 * s}
        animate={
          fresh
            ? (u, t) => {
                const k = Math.min(t / 260, 1);
                u.uOpacity.value = easeOut(k);
                return k < 1;
              }
            : undefined
        }
        delayMs={fresh ? moveMs * 0.85 : 0}
      />
      <LastMoveLine
        from={from.floor}
        to={to.floor}
        arc={arc}
        color={FIREFLY}
        pulseColor="#fbffd8"
        opacity={0.9}
        radius={0.013}
        shade={0.3}
        flowSpeed={0.45}
        pulse={0.75}
        pulseLength={0.32}
        spacing={1.5}
        drawInMs={fresh ? 380 : 0}
        drawInDelayMs={fresh ? moveMs * 0.55 : 0}
      />
    </>
  );

  /** Check: red lacquer under the king, a bold ring round it, and a bell struck once. */
  const Check = ({ floor }: MarkerProps) => (
    <>
      <CheckFlag />
      <Mark
        floor={floor}
        color={CHECK}
        rings={[
          [0.43 * s, 0.08 * s, 1],
          [0.34 * s, 0.022 * s, 0.75],
        ]}
        glow={[0.46 * s, 0.46]}
        quad={1 * s}
      />
      {[0, 1].map((i) => (
        <Mark
          key={i}
          floor={floor}
          color={CHECK}
          quad={3.2 * s}
          clip={clip}
          animate={ripple(0.45 * s, 1.5 * s, 1400, 0.05 * s, 0.8)}
          delayMs={i * 260}
        />
      ))}
    </>
  );

  return { Quiet, Capture, Selection, LastMove, Check };
};
