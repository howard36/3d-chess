import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import { LAYER } from '../kit/layers';
import { LastMoveLine } from '../kit/line';
import { noRaycast } from '../kit/noRaycast';
import type { LastMoveMarkerProps, MarkerProps, Vec3 } from '../types';
import { FRAME, PALETTE } from './palette';

// The marker language: light projected onto the pane. Every glyph is one
// quad shaded by signed distances, crisp at any angle and distance.
//
// - A legal move: a small ring of eight gold light dots, quiet enough to
//   scatter across a board for a centre queen. Under the pointer the dots
//   swell and join into a ring.
// - A capture: the same dots in coral, on a wider ring round the victim's
//   base, the ring fractured: the four diagonal dots spring out as shards.
// - The selection: a hexagonal pad of pale gold under the piece, with a thin
//   column of light through every level (small marks where it crosses the
//   other panes show the same square above and below), while the piece's
//   scan shell (pieces.tsx) plays.
// - The last move: a faint ring of ice dots where the piece left, a fine ice
//   ring round where it arrived, and the thin straight line between them.
// - Check: a slow red glow ring round the king's square, breathing gently.

const MODE = {
  quiet: 0,
  capture: 1,
  select: 2,
  arrived: 3,
  left: 4,
  check: 5,
  tick: 6,
} as const;
type Mode = keyof typeof MODE;

const vertexShader = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const fragmentShader = /* glsl */ `
  uniform int uMode;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uHover;
  uniform float uTime;
  varying vec2 vP;

  // Signed distance to the nearest of n dots of radius r on a ring of radius R
  float dots(vec2 p, float R, float n, float r, float phase) {
    float a = atan(p.y, p.x) - phase;
    float sector = 6.2831853 / n;
    float k = floor(a / sector + 0.5);
    float ac = k * sector + phase;
    return length(p - R * vec2(cos(ac), sin(ac))) - r;
  }
  float ring(vec2 p, float R, float w) {
    return abs(length(p) - R) - w * 0.5;
  }
  float segment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }
  // iq's hexagon, r the inradius
  float hexagon(vec2 p, float r) {
    const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
    p = abs(p);
    p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
    p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
    return length(p) * sign(p.y);
  }
  // Coverage of a shape from its signed distance, never thinner than about a
  // pixel: where it would be, it fades instead
  float cover(float d, float size) {
    float fw = max(fwidth(d), 1e-5);
    float grow = max(0.0, fw * 0.8 - size);
    return (1.0 - smoothstep(-fw, fw, d - grow)) * size / (size + grow);
  }
  float halo(float d, float s) {
    float x = max(d, 0.0) / s;
    return exp(-x * x);
  }

  void main() {
    vec2 p = vP;
    float r = length(p);
    float shape = 0.0;
    float glow = 0.0;
    float fill = 0.0;
    if (uMode == 0) {
      // A legal move: eight dots of light; hovered, they swell and join
      // (wide enough to show round a piece lifted above it, seen from above)
      float R = 0.26 + 0.018 * uHover;
      float dr = 0.034 + 0.012 * uHover;
      float d = dots(p, R, 8.0, dr, 0.3927);
      shape = cover(d, dr);
      glow = halo(d, 0.04) * 0.45;
      shape = max(shape, cover(ring(p, R, 0.008), 0.004) * uHover * 0.8);
      fill = (1.0 - smoothstep(R + 0.04, R + 0.07, r)) * (0.07 + 0.1 * uHover);
    } else if (uMode == 1) {
      // A capture: the same dots on a wider ring round the victim's base,
      // fractured: the diagonal dots spring out as short shards
      float R = 0.405;
      float dr = 0.027 + 0.006 * uHover;
      float a = atan(p.y, p.x);
      float sector = 6.2831853 / 16.0;
      float k = floor(a / sector + 0.5);
      float onDiag = step(abs(mod(k, 4.0) - 2.0), 0.5);
      // Neighbours of a shard lean away from it, as if the ring had cracked
      float jitter = (mod(k, 2.0) - 0.5) * 0.02;
      vec2 c = (R + jitter) * vec2(cos(k * sector), sin(k * sector));
      float d = length(p - c) - dr;
      if (onDiag > 0.5) {
        vec2 dir = vec2(cos(k * sector), sin(k * sector));
        d = segment(p, dir * (R - 0.01), dir * (R + 0.075)) - 0.011;
      }
      shape = cover(d, dr);
      glow = halo(d, 0.04) * 0.4;
      fill = (1.0 - smoothstep(R, R + 0.05, r)) * smoothstep(0.2, R, r) * (0.06 + 0.08 * uHover);
    } else if (uMode == 2) {
      // The selection pad: a hexagon with a node at each corner
      float inr = 0.37;
      float d = abs(hexagon(p, inr)) - 0.007;
      float a = atan(p.y, p.x);
      float k = floor(a / 1.0471976 + 0.5);
      vec2 v = (inr / 0.866025404) * vec2(cos(k * 1.0471976), sin(k * 1.0471976));
      float node = length(p - v) - 0.028;
      shape = max(cover(d, 0.007), cover(node, 0.028));
      glow = halo(min(d, node), 0.04) * 0.35;
      fill = (1.0 - smoothstep(-0.01, 0.01, hexagon(p, inr))) * 0.09;
    } else if (uMode == 3) {
      // Where the last move arrived: a fine ring round the piece's base
      float d = ring(p, 0.43, 0.012);
      shape = cover(d, 0.006);
      glow = halo(d, 0.035) * 0.35;
    } else if (uMode == 4) {
      // Where it left: a faint ring of small dots
      float d = dots(p, 0.17, 12.0, 0.019, 0.0);
      float c = length(p) - 0.022;
      shape = max(cover(d, 0.019), cover(c, 0.022));
      glow = halo(min(d, c), 0.03) * 0.25;
      fill = (1.0 - smoothstep(0.2, 0.23, r)) * 0.05;
    } else if (uMode == 5) {
      // Check: a slow red glow ring round the king's square
      float breath = 0.72 + 0.28 * cos(6.2831853 * uTime / 3.2);
      float d = ring(p, 0.43, 0.018);
      shape = cover(d, 0.009);
      glow = halo(d, 0.07) * 0.7 * breath;
      fill = (1.0 - smoothstep(0.4, 0.45, r)) * (0.07 + 0.08 * breath);
    } else {
      // Where the selection's column crosses another pane: a small diamond
      vec2 q = abs(p);
      float d = abs(q.x + q.y - 0.075) * 0.7071 - 0.006;
      shape = cover(d, 0.006);
      glow = halo(d, 0.03) * 0.3;
    }
    float a = max(max(shape, glow), fill) * uOpacity * (1.0 + 0.3 * uHover);
    if (a < 0.003) discard;
    vec3 col = uColor * (1.0 + 0.35 * shape + 0.2 * uHover);
    gl_FragColor = vec4(col, min(a, 1.0));
    #include <colorspace_fragment>
  }`;

const plane = new PlaneGeometry(1.2, 1.2);
// Every breathing glyph reads the same clock
const clock = { value: 0 };

const makeMaterial = () =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: {
      uMode: { value: 0 },
      uColor: { value: new Color() },
      uOpacity: { value: 1 },
      uHover: { value: 0 },
      uTime: clock,
    },
    vertexShader,
    fragmentShader,
  });

// Shared materials for the static glyphs; hovered ones get their own
const shared = new Map<string, ShaderMaterial>();
const glyphMaterial = (mode: Mode, color: string, opacity: number, hover: boolean) => {
  const key = `${mode}/${color}/${opacity}/${hover}`;
  let m = shared.get(key);
  if (!m) {
    m = makeMaterial();
    m.uniforms.uMode.value = MODE[mode];
    (m.uniforms.uColor.value as Color).set(color);
    m.uniforms.uOpacity.value = opacity;
    m.uniforms.uHover.value = hover ? 1 : 0;
    shared.set(key, m);
  }
  return m;
};

const Glyph = ({
  at,
  mode,
  color,
  opacity = 1,
  hovered = false,
  lift = 0.012,
}: {
  at: Vec3;
  mode: Mode;
  color: string;
  opacity?: number;
  hovered?: boolean;
  lift?: number;
}) => (
  <mesh
    geometry={plane}
    material={glyphMaterial(mode, color, opacity, hovered)}
    position={[at[0], at[1] + lift, at[2]]}
    rotation={[-Math.PI / 2, 0, 0]}
    renderOrder={LAYER.marker}
    raycast={noRaycast}
  />
);

export const Quiet = ({ floor, hovered }: MarkerProps) => (
  <Glyph at={floor} mode="quiet" color={PALETTE.move} opacity={0.95} hovered={hovered} />
);

export const Capture = ({ floor, hovered }: MarkerProps) => (
  <Glyph at={floor} mode="capture" color={PALETTE.capture} hovered={hovered} />
);

// --- The selection's column of light -----------------------------------------------------

const columnVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vY;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vY = world.y;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vView = cameraPosition - world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const columnFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uFrom;
  uniform float uReach;
  uniform float uStrength;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vY;
  void main() {
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    // A fine bright core with a soft falloff: a beam, not a tube
    float beam = pow(facing, 6.0) + 0.25 * pow(facing, 1.5);
    float dy = abs(vY - uFrom);
    if (dy > uReach) discard;
    float fade = exp(-dy / 2.6) * (1.0 - smoothstep(uReach - 0.4, uReach, dy));
    float a = beam * fade * uStrength;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <colorspace_fragment>
  }`;

const COLUMN_BOTTOM = FRAME.levelY[0] - 0.25;
const COLUMN_TOP = FRAME.levelY[4] + 1.1;
const column = new CylinderGeometry(0.05, 0.05, 1, 16, 1, true).translate(0, 0.5, 0);
const COLUMN_MS = 380;

const LightColumn = ({ floor }: { floor: Vec3 }) => {
  const invalidate = useThree((s) => s.invalidate);
  const elapsed = useRef(0);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: {
          uColor: { value: new Color(PALETTE.select) },
          uFrom: { value: floor[1] },
          uReach: { value: 0 },
          uStrength: { value: 0.55 },
        },
        vertexShader: columnVertex,
        fragmentShader: columnFragment,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one column per selection
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => invalidate(), [invalidate]);
  const full = Math.max(floor[1] - COLUMN_BOTTOM, COLUMN_TOP - floor[1]);
  useFrame((_, delta) => {
    if (elapsed.current >= COLUMN_MS) return;
    elapsed.current = Math.min(elapsed.current + Math.min(delta, 1 / 20) * 1000, COLUMN_MS);
    const t = elapsed.current / COLUMN_MS;
    material.uniforms.uReach.value = (1 - (1 - t) ** 3) * full;
    invalidate();
  });
  return (
    <mesh
      geometry={column}
      material={material}
      position={[floor[0], COLUMN_BOTTOM, floor[2]]}
      scale={[1, COLUMN_TOP - COLUMN_BOTTOM, 1]}
      renderOrder={LAYER.trace}
      raycast={noRaycast}
    />
  );
};

export const Selection = ({ floor }: MarkerProps) => (
  <>
    <Glyph at={floor} mode="select" color={PALETTE.select} />
    <LightColumn floor={floor} />
    {FRAME.levelY
      .filter((y) => Math.abs(y - floor[1]) > 0.1)
      .map((y) => (
        <Glyph
          key={y}
          at={[floor[0], y, floor[2]]}
          mode="tick"
          color={PALETTE.select}
          opacity={0.7}
        />
      ))}
  </>
);

// --- Last move and check ---------------------------------------------------------------

export const LastMove = ({ from, to, fresh = false, arc = 0 }: LastMoveMarkerProps) => (
  <>
    <Glyph at={from.floor} mode="left" color={PALETTE.trace} opacity={0.75} />
    <Glyph at={to.floor} mode="arrived" color={PALETTE.trace} opacity={0.85} />
    <LastMoveLine
      from={from.floor}
      to={to.floor}
      arc={arc}
      color={PALETTE.trace}
      pulseColor="#ffffff"
      opacity={0.85}
      radius={0.011}
      pulse={0.7}
      pulseLength={0.35}
      spacing={1.5}
      flowSpeed={0.55}
      shade={0.3}
      drawInMs={fresh ? 360 : 0}
    />
  </>
);

export const Check = ({ floor }: MarkerProps) => {
  const invalidate = useThree((s) => s.invalidate);
  // The breath runs on r3f's clock while a king is in check
  useFrame((state) => {
    clock.value = state.clock.elapsedTime;
    invalidate();
  });
  return <Glyph at={floor} mode="check" color={PALETTE.check} lift={0.014} />;
};
