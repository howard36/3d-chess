import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import type { Mesh } from 'three';
import { prefersReducedMotion } from '../../motion';
import { LAYER } from '../kit/layers';
import { LastMoveLine } from '../kit/line';
import { noRaycast } from '../kit/noRaycast';
import type { LastMoveMarkerProps, MarkerProps, Vec3 } from '../types';
import { LEVEL_COLORS, MOTION, PALETTE, levelAt } from './palette';

// The marker language is the notation cursor: a diamond (a square turned
// 45°) of light lying on the pane, one shape for every mark of play.
//
// - A legal move: a thin amber diamond, its inside faintly lit in the
//   square's level colour (brighter toward its edge, like light in glass),
//   with a small diamond of that colour at its heart. Under the pointer the
//   fill deepens and the diamond grows a little, eased.
// - A capture: the same diamond in red, opened round the victim's base, with
//   one slow mote of amber light travelling round its edge.
// - The selection is written in by the piece itself (pieces.tsx): a line
//   round its base and a soft cone of light.
// - The last move: pale phosphor diamonds on both squares, the one it left a
//   smaller copy of the one it reached, joined by a thin dashed line flowing
//   slowly toward the destination. Where a destination of the piece now held
//   falls on one of them, the last move's diamond gives way to it, so the two
//   never stack.
// - Check: a crown of light. A red diamond plate under the king with four
//   short blades of light rising at its corners; it arrives with one strong
//   pulse (the plate flares, an echo of the diamond sweeps out, the blades
//   shoot up past their height and settle), then a slow shimmer climbs the
//   blades while the check lasts.
//
// Every flat mark is one quad shaded by signed distances, crisp at any angle
// and distance, drawn after every pane (LAYER) so a mark three levels down
// reads as clearly as one on top.

const MODE = { quiet: 0, capture: 1, trace: 2, check: 3 } as const;
type Mode = keyof typeof MODE;

const vertexShader = /* glsl */ `
  varying vec2 vP;
  void main() {
    // The quad lies on the floor (its geometry turned flat): x across, -z up
    vP = vec2(position.x, -position.z);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const fragmentShader = /* glsl */ `
  uniform int uMode;
  uniform vec3 uColor;
  uniform vec3 uLevelColor;
  uniform vec3 uMoteColor;
  uniform float uR;
  uniform float uWidth;
  uniform float uFill;
  uniform float uCue;
  uniform float uHover;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uPulse;
  uniform float uEcho;
  varying vec2 vP;

  // Signed distance to a diamond of vertex radius r (a square of half side
  // r / sqrt 2 turned 45°): exact, rounded outside its corners
  float diamond(vec2 p, float r) {
    vec2 q = abs(vec2(p.x + p.y, p.x - p.y)) * 0.70710678;
    vec2 d = q - vec2(r * 0.70710678);
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  }
  // The point a share s (0 to 1) of the way round a diamond, from its right corner
  vec2 roundDiamond(float s, float r) {
    float e = floor(s * 4.0);
    float t = fract(s * 4.0);
    vec2 a = e < 0.5 ? vec2(r, 0.0) : e < 1.5 ? vec2(0.0, r) : e < 2.5 ? vec2(-r, 0.0) : vec2(0.0, -r);
    vec2 b = e < 0.5 ? vec2(0.0, r) : e < 1.5 ? vec2(-r, 0.0) : e < 2.5 ? vec2(0.0, -r) : vec2(r, 0.0);
    return mix(a, b, t);
  }
  // Coverage of a shape from its signed distance, never thinner than about
  // a pixel: where it would be, it fades instead of breaking up
  float cover(float d, float size) {
    float fw = max(fwidth(d), 1e-5);
    float grow = max(0.0, fw * 0.8 - size);
    return (1.0 - smoothstep(-fw, fw, d - grow)) * size / (size + grow);
  }

  void main() {
    // Under the pointer a mark grows a little
    vec2 p = vP / (1.0 + 0.1 * uHover);
    float d = diamond(p, uR);
    float line = cover(abs(d) - uWidth * 0.5, uWidth * 0.5);
    float inside = 1.0 - smoothstep(-0.004, 0.004, d);
    // Light in glass: the fill is stronger toward the edge, and under the
    // pointer it gains weight and depth (deeper, and reaching further in)
    float reach = mix(0.07, 0.16, uHover);
    float edgeLit = exp(min(d, 0.0) / reach);
    float fill = inside * (uFill + 0.3 * uHover) * (0.4 + 0.6 * edgeLit);
    // A soft halo just outside the stroke
    float halo = exp(-max(d, 0.0) * max(d, 0.0) / (0.025 * 0.025)) * 0.18 * (1.0 - inside);

    // The fill: the marker's own light at the rim, the level's colour within
    vec3 col = mix(uLevelColor, uColor, edgeLit * 0.6);
    float a = fill;
    // The level's small diamond at the heart
    if (uCue > 0.0) {
      float cue = cover(diamond(p, uCue * (1.0 + 0.25 * uHover)), uCue);
      col = mix(col, uLevelColor * 1.1, cue);
      a = max(a, cue * 0.92);
    }
    float stroke = max(line, halo);
    col = mix(col, uColor, stroke / max(stroke + a * (1.0 - stroke), 1e-4));
    a = stroke + a * (1.0 - stroke);

    if (uMode == 1) {
      // The capture's mote, travelling slowly round the edge
      vec2 m = roundDiamond(fract(uTime / 6.5), uR);
      float md = length(p - m);
      float bead = cover(md - uWidth * 0.95, uWidth);
      float glow = exp(-md * md / (0.035 * 0.035)) * 0.55;
      float l = max(bead, glow);
      col = mix(col, uMoteColor, l / max(a + l * (1.0 - a), 1e-4));
      a = a + l * (1.0 - a);
    }
    if (uMode == 3) {
      // Check: the plate flares with the entry pulse, and an echo of the
      // diamond sweeps out once
      a = min(a * (1.0 + 2.4 * uPulse), 1.0);
      float er = uR * (1.0 + 0.7 * uEcho);
      float echo = cover(abs(diamond(vP, er)) - uWidth * 0.6, uWidth * 0.6) * (1.0 - uEcho) * step(0.001, uEcho);
      col = mix(col, uColor, echo / max(a + echo, 1e-4));
      a = max(a, echo * 0.9);
    }
    a *= uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(col, min(a, 1.0));
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

// Every mark that moves reads one clock
const clock = { value: 0 };

interface GlyphStyle {
  mode: Mode;
  color: string;
  levelColor?: string;
  /** Vertex radius of the diamond (world units). */
  radius: number;
  width: number;
  fill: number;
  /** Vertex radius of the level's small diamond at the heart (0: none). */
  cue?: number;
  opacity?: number;
}

const makeMaterial = (s: GlyphStyle) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: {
      uMode: { value: MODE[s.mode] },
      uColor: { value: new Color(s.color) },
      uLevelColor: { value: new Color(s.levelColor ?? s.color) },
      uMoteColor: { value: new Color('#ffe6b8') },
      uR: { value: s.radius },
      uWidth: { value: s.width },
      uFill: { value: s.fill },
      uCue: { value: s.cue ?? 0 },
      uHover: { value: 0 },
      uOpacity: { value: s.opacity ?? 1 },
      uTime: clock,
      uPulse: { value: 0 },
      uEcho: { value: 0 },
    },
    vertexShader,
    fragmentShader,
  });

/** Eases a 0–1 value toward its goal over `ms`, smoothly at both ends. */
const useEased = (goal: number, ms: number, apply: (v: number) => void) => {
  const invalidate = useThree((s) => s.invalidate);
  const linear = useRef(goal);
  useEffect(() => invalidate(), [goal, invalidate]);
  useFrame((_, delta) => {
    if (linear.current === goal) return;
    const step = Math.min(delta, 1 / 20) / (ms / 1000);
    linear.current =
      goal > linear.current
        ? Math.min(goal, linear.current + step)
        : Math.max(goal, linear.current - step);
    const t = linear.current;
    apply(t * t * (3 - 2 * t));
    invalidate();
  });
};

const Glyph = ({
  at,
  style,
  hovered = false,
  lift = 0.012,
  onMaterial,
}: {
  at: Vec3;
  style: GlyphStyle;
  hovered?: boolean;
  lift?: number;
  onMaterial?: (m: ShaderMaterial) => void;
}) => {
  const material = useMemo(
    () => makeMaterial(style),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one material per mark
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => onMaterial?.(material), [material, onMaterial]);
  material.uniforms.uOpacity.value = style.opacity ?? 1;
  useEased(hovered ? 1 : 0, 200, (v) => {
    material.uniforms.uHover.value = v;
  });
  const quad = Math.ceil((style.radius * (style.mode === 'check' ? 3.6 : 2.6) + 0.1) * 10) / 10;
  return (
    <mesh
      geometry={planeFor(quad)}
      material={material}
      position={[at[0], at[1] + lift, at[2]]}
      renderOrder={LAYER.marker}
      raycast={noRaycast}
    />
  );
};

/** Keeps the shared clock on r3f's time while a moving mark is up. */
const useClock = () => {
  const invalidate = useThree((s) => s.invalidate);
  const still = prefersReducedMotion();
  useFrame((state) => {
    if (still) return;
    clock.value = state.clock.elapsedTime;
    invalidate();
  });
};

// --- Where destinations lie, so the last move's marks give way to them ------------------

const occupied = new Map<string, number>();
let version = 0;
const listeners = new Set<() => void>();
const keyOf = (v: Vec3) => v.map((n) => n.toFixed(2)).join(',');
const bump = () => {
  version++;
  listeners.forEach((l) => l());
};
const useOccupy = (floor: Vec3) => {
  const key = keyOf(floor);
  useLayoutEffect(() => {
    occupied.set(key, (occupied.get(key) ?? 0) + 1);
    bump();
    return () => {
      const n = (occupied.get(key) ?? 1) - 1;
      if (n <= 0) occupied.delete(key);
      else occupied.set(key, n);
      bump();
    };
  }, [key]);
};
const useOccupied = (floor: Vec3) => {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
  return occupied.has(keyOf(floor));
};

// --- Destinations -----------------------------------------------------------------------------

const QUIET = { radius: 0.34, width: 0.022, fill: 0.13, cue: 0.065 };
const CAPTURE = { radius: 0.47, width: 0.028, fill: 0.11 };

export const Quiet = ({ floor, hovered }: MarkerProps) => {
  useOccupy(floor);
  return (
    <Glyph
      at={floor}
      hovered={hovered}
      style={{
        mode: 'quiet',
        color: PALETTE.move,
        levelColor: LEVEL_COLORS[levelAt(floor[1])],
        opacity: 0.9,
        ...QUIET,
      }}
    />
  );
};

export const Capture = ({ floor, hovered }: MarkerProps) => {
  useOccupy(floor);
  useClock();
  return (
    <Glyph
      at={floor}
      hovered={hovered}
      style={{
        mode: 'capture',
        color: PALETTE.capture,
        levelColor: LEVEL_COLORS[levelAt(floor[1])],
        opacity: 1,
        ...CAPTURE,
      }}
    />
  );
};

/** The selection is written in by the piece itself (pieces.tsx). */
export const Selection = () => null;

// --- The last move ------------------------------------------------------------------------

const TRACE_TO = 0.44;
const TRACE_FROM = 0.26;

const TRACE_OPACITY = 0.85;

/**
 * One end of the last move. A fresh move writes its destination's diamond
 * in as the piece lands (after `delayMs`); either end gives way, quickly, to
 * a destination of the piece now held on the same square.
 */
const TraceMark = ({
  floor,
  radius,
  delayMs = 0,
}: {
  floor: Vec3;
  radius: number;
  delayMs?: number;
}) => {
  const yielded = useOccupied(floor);
  const invalidate = useThree((s) => s.invalidate);
  const material = useRef<ShaderMaterial | null>(null);
  const since = useRef(0);
  const shown = useRef(delayMs > 0 ? 0 : 1);
  useEffect(() => invalidate(), [yielded, invalidate]);
  useFrame((_, delta) => {
    const m = material.current;
    if (!m) return;
    const dt = Math.min(delta, 1 / 20) * 1000;
    since.current += dt;
    const goal = yielded || since.current < delayMs ? 0 : 1;
    const step = dt / (goal > shown.current ? 220 : 100);
    const next =
      goal > shown.current
        ? Math.min(goal, shown.current + step)
        : Math.max(goal, shown.current - step);
    shown.current = next;
    m.uniforms.uOpacity.value = TRACE_OPACITY * next * next * (3 - 2 * next);
    if (next !== goal || since.current < delayMs) invalidate();
  });
  return (
    <Glyph
      at={floor}
      onMaterial={(m) => {
        material.current = m;
      }}
      style={{
        mode: 'trace',
        color: PALETTE.trace,
        levelColor: PALETTE.trace,
        radius,
        width: 0.02,
        fill: 0.05,
        opacity: 0,
      }}
    />
  );
};

export const LastMove = ({ from, to, fresh = false, arc = 0 }: LastMoveMarkerProps) => (
  <>
    <TraceMark floor={from.floor} radius={TRACE_FROM} />
    <TraceMark floor={to.floor} radius={TRACE_TO} delayMs={fresh ? MOTION.durationMs * 0.8 : 0} />
    <LastMoveLine
      from={from.floor}
      to={to.floor}
      arc={arc}
      color={PALETTE.trace}
      pulseColor="#ffffff"
      opacity={0.85}
      radius={0.012}
      pattern="dashed"
      spacing={0.15}
      dash={0.55}
      pulse={0.5}
      flowSpeed={0.3}
      shade={0.3}
      drawInMs={fresh ? 380 : 0}
    />
  </>
);

// --- Check: a crown of light ------------------------------------------------------------------

const CROWN_RADIUS = 0.47;
const BLADE_HEIGHT = 0.4;
const BLADE_WIDTH = 0.1;
const PULSE_MS = 650;

const bladeVertex = /* glsl */ `
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
    vUv = vec2(aCorner.x, aCorner.y);
    vPhase = aPhase;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }`;

const bladeFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uPulse;
  varying vec2 vUv;
  varying float vPhase;
  void main() {
    float h = vUv.y;
    // A sliver tapering to its point, with a bright core
    float hw = mix(1.0, 0.0, pow(h, 0.8));
    float x = abs(vUv.x) / max(hw, 1e-3);
    if (x > 1.0) discard;
    float core = exp(-x * x * 9.0) + 0.35 * exp(-x * x * 1.6);
    // The slow shimmer climbing each blade in turn
    float band = fract(uTime / 2.4 + vPhase);
    float shimmer = exp(-pow((h - band * 1.3 + 0.15) / 0.14, 2.0));
    float fade = mix(1.0, 0.35, h);
    float a = core * fade * (1.0 + 0.9 * shimmer + 2.2 * uPulse);
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }`;

const bladeGeometry = (() => {
  const g = new BufferGeometry();
  const pos: number[] = [];
  const corner: number[] = [];
  const phase: number[] = [];
  const index: number[] = [];
  [
    [CROWN_RADIUS, 0],
    [0, CROWN_RADIUS],
    [-CROWN_RADIUS, 0],
    [0, -CROWN_RADIUS],
  ].forEach(([x, z], i) => {
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
  });
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aCorner', new BufferAttribute(new Float32Array(corner), 2));
  g.setAttribute('aPhase', new BufferAttribute(new Float32Array(phase), 1));
  g.setIndex(index);
  return g;
})();

const Blades = ({ floor, pulse }: { floor: Vec3; pulse: { grow: number; flare: number } }) => {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
        uniforms: {
          uColor: { value: new Color(PALETTE.check) },
          uTime: clock,
          uPulse: { value: 0 },
          uGrow: { value: 0 },
          uHeight: { value: BLADE_HEIGHT },
          uWidth: { value: BLADE_WIDTH / 2 },
        },
        vertexShader: bladeVertex,
        fragmentShader: bladeFragment,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const mesh = useRef<Mesh>(null);
  useFrame(() => {
    material.uniforms.uGrow.value = pulse.grow;
    material.uniforms.uPulse.value = pulse.flare;
  });
  return (
    <mesh
      ref={mesh}
      geometry={bladeGeometry}
      material={material}
      position={floor}
      renderOrder={LAYER.trace + 0.4}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

export const Check = ({ floor }: MarkerProps) => {
  useClock();
  const invalidate = useThree((s) => s.invalidate);
  const plate = useRef<ShaderMaterial | null>(null);
  const pulse = useRef({ grow: 0, flare: 1 });
  const elapsed = useRef(0);
  useEffect(() => invalidate(), [invalidate]);
  useFrame((_, delta) => {
    elapsed.current += Math.min(delta, 1 / 20) * 1000;
    const t = Math.min(elapsed.current / PULSE_MS, 1);
    // The blades shoot up past their height and settle; the plate flares once
    const grow =
      t < 0.55
        ? 1.22 * (1 - (1 - t / 0.55) ** 3)
        : 1 + 0.22 * Math.cos(((t - 0.55) / 0.45) * Math.PI * 0.5);
    pulse.current.grow = t >= 1 ? 1 : grow;
    pulse.current.flare = (1 - t) ** 2;
    const m = plate.current;
    if (m) {
      // After the pulse, the plate breathes gently while the check lasts
      const breath = 0.5 + 0.5 * Math.cos((clock.value / 3.2) * Math.PI * 2);
      m.uniforms.uPulse.value = (1 - t) ** 2 + (t >= 1 ? 0.12 * breath : 0);
      m.uniforms.uEcho.value = t < 1 ? 1 - (1 - t) ** 2 : 0;
    }
  });
  return (
    <>
      <Glyph
        at={floor}
        lift={0.014}
        onMaterial={(m) => {
          plate.current = m;
        }}
        style={{
          mode: 'check',
          color: PALETTE.check,
          levelColor: PALETTE.check,
          radius: CROWN_RADIUS,
          width: 0.038,
          fill: 0.32,
        }}
      />
      <Blades floor={floor} pulse={pulse.current} />
    </>
  );
};
