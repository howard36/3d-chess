import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  ShaderMaterial,
} from 'three';
import type { Mesh } from 'three';
import { LAYER } from '../kit/layers';
import { LastMoveTrace } from '../kit/markers';
import { noRaycast } from '../kit/noRaycast';
import type { LastMoveMarkerProps, MarkerProps, Vec3 } from '../types';
import { MOTION } from './motion';
import { CAPTURE, CHECK, LAST_MOVE, MOVE, SELECT, frame, pitch } from './palette';

// Every marker is a neon tube laid flat on the glass: one rounded-square
// outline drawn by a signed-distance shader, a hot white core inside a
// saturated stroke and a tight halo, crisp at any angle. The family:
//
// - can go: a cyan outline, still;
// - can take: the same outline in red, doubled by an inner line, with four
//   gunsight ticks across both lines (all of it outside the victim's base);
// - last move: the same outline in amber on both squares (dimmer where the
//   piece came from), set just outside the destination outline so a square
//   that is both nests cleanly, joined by the kit's trace ribbon with
//   chevrons drifting toward the destination; it appears as the piece lands;
// - check: the capture's red double outline, filled faintly, with a still
//   red light column rising through the king;
// - selection: a cyan ring round the piece's base that snaps out once when
//   picked, and a soft cyan column of light, open at the top, with faint
//   bands rising slowly through it.

const vertex = /* glsl */ `
  varying vec2 vP;
  uniform float uQuad;
  void main() {
    vP = (uv - 0.5) * uQuad;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const fragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uFill;
  uniform float uHalf;
  uniform float uLine;
  uniform float uRadius;
  uniform float uInner;
  uniform float uTeeth;
  uniform float uRing;
  uniform float uGlow;
  uniform float uHover;
  uniform float uBreathe;
  uniform float uTime;
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

  void main() {
    vec2 p = vP;
    vec2 q = abs(p);
    // Under the pointer the tube thickens as well as brightening
    float hw = uLine * 0.5 * (1.0 + 0.4 * uHover);
    float stroke;
    float inside;
    if (uRing > 0.0) {
      stroke = abs(length(p) - uRing) - hw;
      inside = length(p) - uRing;
    } else {
      float box = roundBox(p, uHalf, uRadius);
      stroke = abs(box) - hw;
      inside = box;
      if (uInner > 0.0) {
        // A second, thinner line inside the first
        float inner = roundBox(p, uHalf - uInner, max(uRadius - uInner * 0.6, 0.02));
        stroke = min(stroke, abs(inner) - hw * 0.7);
        if (uTeeth > 0.0) {
          // Four ticks across both lines at the middle of each side, like a
          // gunsight's, reaching in only just past the inner line so they
          // stay clear of the victim's base
          float e = uHalf - uInner;
          float t = min(
            segment(q, vec2(e - uTeeth, 0.0), vec2(uHalf + hw, 0.0)),
            segment(q, vec2(0.0, e - uTeeth), vec2(0.0, uHalf + hw))
          ) - hw * 0.8;
          stroke = min(stroke, t);
        }
      }
    }
    float aa = max(fwidth(stroke), 1e-4);
    float line = 1.0 - smoothstep(-aa, aa, stroke);
    // The tube's hot core: whiter toward the middle of the stroke
    float core = clamp(-stroke / hw, 0.0, 1.0);
    float glow = exp(-max(stroke, 0.0) / uGlow) * 0.32;
    float ia = max(fwidth(inside), 1e-4);
    float area = 1.0 - smoothstep(-ia, ia, inside);
    float breath = 1.0 - uBreathe * 0.5 + uBreathe * 0.5 * cos(6.2831853 * uTime / 3.0);
    float strength = uOpacity * breath * (1.0 + 0.35 * uHover);
    float a = max(max(line, glow * (1.0 + 2.2 * uHover)) * strength, area * (uFill + 0.2 * uHover) * breath);
    if (a < 0.004) discard;
    vec3 col = mix(uColor, vec3(1.0), line * core * core * (0.45 + 0.25 * uHover));
    gl_FragColor = vec4(col, min(a, 1.0));
    #include <colorspace_fragment>
  }`;

export interface NeonStyle {
  color: string;
  opacity?: number;
  fill?: number;
  /** How far inside the square's edge the outline sits (fraction of the pitch). */
  inset?: number;
  /** Stroke width (fraction of the pitch). */
  line?: number;
  radius?: number;
  /** Gap to a second, inner outline (fraction of the pitch; 0 for none). */
  inner?: number;
  /** Length of the four inward teeth off the inner outline (fraction of the pitch). */
  teeth?: number;
  /** Draw a ring of this radius instead of a square (fraction of the pitch). */
  ring?: number;
  /** Width of the halo (world units). */
  glow?: number;
  hovered?: boolean;
  breathe?: number;
  lift?: number;
}

const plane = new PlaneGeometry(pitch, pitch);
// Breathing markers share one clock
const clock = { value: 0 };

/** A neon outline lying on the platform at `floor`. */
export const NeonMarker = ({
  floor,
  color,
  opacity = 0.95,
  fill = 0,
  inset = 0.1,
  line = 0.055,
  radius = 0.09,
  inner = 0,
  teeth = 0,
  ring = 0,
  glow = 0.022,
  hovered = false,
  breathe = 0,
  lift = 0.014,
}: NeonStyle & { floor: Vec3 }) => {
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
          uQuad: { value: pitch },
          uHalf: { value: 0.4 },
          uLine: { value: 0.05 },
          uRadius: { value: 0.1 },
          uInner: { value: 0 },
          uTeeth: { value: 0 },
          uRing: { value: 0 },
          uGlow: { value: 0.02 },
          uHover: { value: 0 },
          uBreathe: { value: 0 },
          uTime: clock,
        },
        vertexShader: vertex,
        fragmentShader: fragment,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const u = material.uniforms;
  const lw = line * pitch;
  (u.uColor.value as Color).set(color);
  u.uOpacity.value = opacity;
  u.uFill.value = fill;
  u.uLine.value = lw;
  u.uHalf.value = pitch / 2 - inset * pitch - lw / 2;
  u.uRadius.value = radius * pitch;
  u.uInner.value = inner * pitch;
  u.uTeeth.value = teeth * pitch;
  u.uRing.value = ring * pitch;
  u.uGlow.value = glow;
  u.uHover.value = hovered ? 1 : 0;
  u.uBreathe.value = breathe;
  useFrame((state) => {
    if (breathe > 0) clock.value = state.clock.elapsedTime;
  });
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

// --- Light columns ---------------------------------------------------------------------

const columnVertex = /* glsl */ `
  varying vec2 vUv;
  varying float vEdge;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 n = normalize(mat3(modelMatrix) * normal);
    vec3 v = normalize(cameraPosition - world.xyz);
    // Bright where the wall is seen edge-on, clear where it faces the camera
    vEdge = 1.0 - abs(dot(n, v));
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const columnFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uBands;
  uniform float uTime;
  varying vec2 vUv;
  varying float vEdge;
  void main() {
    // A soft volume of light rather than a tube: densest through its middle,
    // thinning to nothing at its sides, its foot and its open top
    float fall = pow(1.0 - vUv.y, 1.6) * smoothstep(0.0, 0.08, vUv.y);
    float body = pow(1.0 - vEdge, 0.8);
    float bands = 1.0;
    if (uBands > 0.0) {
      float b = fract(vUv.y * 3.0 - uTime * 0.35);
      bands = 0.8 + 0.4 * smoothstep(0.0, 0.1, b) * (1.0 - smoothstep(0.2, 0.4, b));
    }
    float a = fall * body * bands * uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor, a);
  }`;

const columnGeometry = new CylinderGeometry(1, 1, 1, 40, 1, true).translate(0, 0.5, 0);

/**
 * A column of light standing on the floor, fading upward: open at the top and
 * seen through, so the piece inside stays clear. Additive and depth-tested,
 * so pieces in front still cover it.
 */
const LightColumn = ({
  floor,
  color,
  radius,
  height,
  opacity,
  bands = false,
}: {
  floor: Vec3;
  color: string;
  radius: number;
  height: number;
  opacity: number;
  bands?: boolean;
}) => {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        uniforms: {
          uColor: { value: new Color(color) },
          uOpacity: { value: opacity },
          uBands: { value: bands ? 1 : 0 },
          uTime: { value: 0 },
        },
        vertexShader: columnVertex,
        fragmentShader: columnFragment,
      }),
    [color, opacity, bands],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame((state) => {
    if (bands) material.uniforms.uTime.value = state.clock.elapsedTime;
  });
  return (
    <mesh
      geometry={columnGeometry}
      material={material}
      position={[floor[0], floor[1] + 0.01, floor[2]]}
      scale={[radius, height, radius]}
      renderOrder={LAYER.trace}
      raycast={noRaycast}
    />
  );
};

// --- The marker set ---------------------------------------------------------------------

const Quiet = ({ floor, hovered }: MarkerProps) => (
  <NeonMarker floor={floor} color={MOVE} fill={0.05} hovered={hovered} />
);

const CAPTURE_STYLE = { inner: 0.075, teeth: 0.035 } as const;

const Capture = ({ floor, hovered }: MarkerProps) => (
  <NeonMarker floor={floor} color={CAPTURE} fill={0.07} {...CAPTURE_STYLE} hovered={hovered} />
);

/** Below the platform above, whatever the level gap. */
const COLUMN_HEIGHT = Math.min(frame.gap * 0.78, 1.05);

/**
 * A ring of light that snaps out from the base once when a piece is picked
 * up (and again when the pick moves to another piece), then is gone.
 */
const PickPulse = ({ floor }: { floor: Vec3 }) => {
  const mesh = useRef<Mesh>(null);
  const t = useRef(0);
  const at = floor.join();
  useLayoutEffect(() => {
    t.current = 0;
  }, [at]);
  useFrame((_, delta) => {
    const m = mesh.current;
    if (!m) return;
    t.current += Math.min(delta, 1 / 30);
    const k = Math.min(t.current / 0.45, 1);
    const e = 1 - (1 - k) ** 3;
    m.visible = k < 1;
    m.scale.setScalar(0.3 + e * 0.42 * pitch);
    pulseMaterial.opacity = 0.9 * (1 - k) ** 1.5;
  });
  return (
    <mesh
      ref={mesh}
      geometry={pulseRing}
      material={pulseMaterial}
      position={[floor[0], floor[1] + 0.02, floor[2]]}
      renderOrder={LAYER.trace}
      raycast={noRaycast}
    />
  );
};
const pulseRing = new RingGeometry(0.86, 1, 64).rotateX(-Math.PI / 2);
const pulseMaterial = new MeshBasicMaterial({
  color: SELECT,
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  toneMapped: false,
  side: DoubleSide,
});

const Selection = ({ floor }: MarkerProps) => (
  <>
    <NeonMarker floor={floor} color={SELECT} ring={0.34} line={0.06} fill={0.14} lift={0.016} />
    <LightColumn
      floor={floor}
      color={SELECT}
      radius={0.33 * pitch}
      height={COLUMN_HEIGHT}
      opacity={0.95}
      bands
    />
    <PickPulse floor={floor} />
  </>
);

/**
 * The last move's squares and trace. A live move keeps them back until the
 * piece lands (its own light trail tells the story in flight), then the
 * trace draws in from the source; a move replayed from history or on a
 * rejoin shows them at once. Board mounts one per move.
 */
const LastMove = ({ from, to, fresh = false }: LastMoveMarkerProps) => {
  const [landed, setLanded] = useState(!fresh);
  const t = useRef(0);
  useFrame((_, delta) => {
    if (landed) return;
    t.current += Math.min(delta, 1 / 30) * 1000;
    if (t.current >= MOTION.durationMs * 0.85) setLanded(true);
  });
  if (!landed) return null;
  return (
    <>
      <NeonMarker
        floor={from.floor}
        color={LAST_MOVE}
        opacity={0.8}
        inset={0.025}
        line={0.06}
        fill={0.05}
      />
      <NeonMarker floor={to.floor} color={LAST_MOVE} inset={0.025} line={0.07} fill={0.11} />
      <LastMoveTrace
        from={from.floor}
        to={to.floor}
        color={LAST_MOVE}
        edgeColor="#2a0b1c"
        width={0.1}
        // A big head that ends on the floor at the destination square's near
        // edge, where the piece standing on it cannot hide it
        headLength={0.38}
        headWidth={0.36}
        endInset={0.44}
        chevrons={0.36}
        flowSpeed={0.3}
        drawInMs={fresh ? 240 : 0}
      />
    </>
  );
};

const Check = ({ floor }: MarkerProps) => (
  <>
    <NeonMarker
      floor={floor}
      color={CHECK}
      fill={0.16}
      inset={0.06}
      line={0.065}
      inner={0.075}
      breathe={0.25}
    />
    <LightColumn
      floor={floor}
      color={CHECK}
      radius={0.34 * pitch}
      height={COLUMN_HEIGHT}
      opacity={0.8}
    />
  </>
);

export const markers = { Quiet, Capture, Selection, LastMove, Check };
