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
} from 'three';
import type { Mesh } from 'three';
import { LAYER } from '../kit/layers';
import { LastMoveLine } from '../kit/line';
import { noRaycast } from '../kit/noRaycast';
import type { LastMoveMarkerProps, MarkerProps, Vec3 } from '../types';
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
  varying vec2 vP;
  varying vec3 vWorld;
  void main() {
    if (uClip > 0.0 && (abs(vWorld.x) > uClip || abs(vWorld.z) > uClip)) discard;
    float r = length(vP);
    float a = 0.0;
    for (int i = 0; i < 3; i++) {
      vec3 ring = uRings[i];
      if (ring.z <= 0.0) continue;
      float d = abs(r - ring.x) - ring.y * 0.5;
      float aa = max(fwidth(d), 1e-4);
      a = max(a, (1.0 - smoothstep(-aa, aa, d)) * ring.z);
    }
    if (uDash.x > 0.0) {
      // Broken into arcs, centred on the axes
      float t = fract(atan(vP.y, vP.x) / 6.2831853 * uDash.x + 0.5 * uDash.y);
      float ta = max(fwidth(t), 1e-4) * 1.5;
      a *= smoothstep(0.0, ta, t) * (1.0 - smoothstep(uDash.y - ta, uDash.y, t));
    }
    if (uGlow.y > 0.0) {
      float g = exp(-(r * r) / (uGlow.x * uGlow.x) * 2.4);
      a = a + g * uGlow.y * (1.0 - a);
    }
    if (uSeals.z > 0.0) {
      // Four small square seals out toward the corners
      vec2 q = abs(vP) - vec2(0.70710678 * uSeals.x);
      float d = max(abs(q.x), abs(q.y)) - uSeals.y;
      float aa = max(fwidth(d), 1e-4);
      a = max(a, (1.0 - smoothstep(-aa, aa, d)) * uSeals.z);
    }
    a *= uOpacity * (1.0 + 0.45 * uHover);
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * (1.0 + 0.25 * uHover), min(a, 1.0));
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
  hovered = false,
  quad = 1,
  clip = 0,
  additive = false,
  renderOrder = LAYER.marker,
  lift = 0.012,
  animate,
  delayMs = 0,
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
}: {
  pitch: number;
  clip: number;
  moveMs: number;
}): LanternMarkers => {
  const s = pitch;

  /** A legal destination: a small paper lantern's light, rim and rib. */
  const Quiet = ({ floor, hovered }: MarkerProps) => (
    <Mark
      floor={floor}
      color={LANTERN}
      rings={[
        [0.3 * s, 0.062 * s, 1],
        [0.18 * s, 0.026 * s, 0.7],
      ]}
      glow={[0.3 * s, hovered ? 0.42 : 0.22]}
      hovered={hovered}
      quad={0.7 * s}
    />
  );

  /** A capture: the lantern opened round the victim, in red lacquer, sealed at the corners. */
  const Capture = ({ floor, hovered }: MarkerProps) => (
    <Mark
      floor={floor}
      color={LACQUER}
      rings={[
        [0.435 * s, 0.05 * s, 1],
        [0.37 * s, 0.018 * s, 0.55],
      ]}
      glow={[0.42 * s, hovered ? 0.34 : 0.2]}
      seals={[0.56 * s, 0.035 * s, 0.95]}
      hovered={hovered}
      quad={1 * s}
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
