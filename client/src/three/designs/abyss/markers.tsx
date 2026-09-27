import { useEffect, useMemo, useRef } from 'react';
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
import type { Group } from 'three';
import { LAYER } from '../kit/layers';
import { LastMoveLine } from '../kit/line';
import { noRaycast } from '../kit/noRaycast';
import type { LastMoveMarkerProps, MarkerProps, Vec3 } from '../types';
import { CHECK, LAST_MOVE, LEVELS, LURE, PLANKTON } from './palette';
import { inPlay, view } from './view';

// Every mark of play is a creature of light lying on the glass:
//
// - where a piece may go, a ring of plankton light breathing very slowly,
//   with a dot at its heart in the colour of the square's level; the rings of
//   the level in play lead, those on other levels are drawn smaller and
//   dimmer, and one straight above or below the selected piece opens wide
//   round it, so from above it never hides under the piece;
// - a capture, the same ring in an anglerfish's red round the victim's base,
//   with its lure circling;
// - the selection, a swirl of plankton round the piece's base that settles
//   into an even ring of beads (dots, never a ring stroke);
// - the last move, in a comb jelly's violet: a dashed ring where the piece
//   left, a whole ring round it where it landed, the thin line between them;
// - check, a red pulse that spreads from the king once, then a steady ring.
//
// Seen from above, every ring gets a dark keyline so nested rings separate.

/** Longest step an animation takes in one frame, so a stall resumes smoothly. */
const MAX_STEP = 0.25;

/** Every mark reads one clock (seconds, advanced only while frames render), so they breathe together. */
const clock = { value: 0 };
/** How many animated marks are up: while any is, the clock asks for frames. */
const animated = { count: 0 };
/** Where the selected piece stands (x, z of its floor), while one is. */
const selection = { active: false, x: 0, z: 0 };

const useAnimated = (active = true) => {
  useEffect(() => {
    if (!active) return;
    animated.count++;
    return () => {
      animated.count--;
    };
  }, [active]);
};

/**
 * Keeps the marks' clock on r3f's time and asks for frames only while an
 * animated mark is up, so an idle board stops rendering. Mounted once, by the
 * Stage.
 */
export const MarkerClock = () => {
  const invalidate = useThree((s) => s.invalidate);
  useFrame((_, delta) => {
    clock.value += Math.min(delta, MAX_STEP);
    if (animated.count > 0) invalidate();
  });
  return null;
};

export interface RingStyle {
  color: string;
  /** Ring radius, world units. */
  radius: number;
  /** Stroke width, world units. */
  width: number;
  opacity?: number;
  /** Soft light round the stroke: strength and reach (world units). */
  glow?: number;
  glowWidth?: number;
  /** A faint luminous disc inside the ring. */
  fill?: number;
  /** How much the ring breathes (0: still). */
  breathe?: number;
  /** Dashes round the ring (0: whole). */
  dashes?: number;
  /** A filled dot of this colour at the ring's heart (the level cue), `dotRadius` world units. */
  dotColor?: string;
  dotRadius?: number;
  /** The level the ring lies on: off the level in play it is drawn smaller and dimmer. */
  level?: number;
  /**
   * Radius to take instead when the ring lies straight above or below the
   * selected piece, so from above it shows round the piece rather than under it.
   */
  stackRadius?: number;
  /** An anglerfish lure: a bright bead circling the ring. */
  lure?: boolean;
  lureColor?: string;
  hovered?: boolean;
  lift?: number;
}

const vertex = /* glsl */ `
  uniform float uQuad;
  varying vec2 vP;
  void main() {
    vP = (uv - 0.5) * uQuad;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const fragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uLureColor;
  uniform vec3 uDotColor;
  uniform float uOpacity;
  uniform float uRadius;
  uniform float uWidth;
  uniform float uGlow;
  uniform float uGlowWidth;
  uniform float uFill;
  uniform float uBreathe;
  uniform float uPhase;
  uniform float uDashes;
  uniform float uDot;
  uniform float uLure;
  uniform float uHover;
  uniform float uReveal;
  uniform float uScale;
  uniform float uDim;
  uniform float uSteep;
  uniform float uTime;
  varying vec2 vP;

  void main() {
    vec2 p = vP;
    float r = length(p);
    float ang = atan(p.y, p.x);
    // A slow breath, 5.5 s, a few per cent in size and a tenth in light
    float breath = sin(6.2831853 * uTime / 5.5 + uPhase);
    float R = uRadius * uScale * (1.0 + 0.025 * uBreathe * breath + 0.26 * uHover);
    float w = uWidth * mix(0.8, 1.0, uScale);
    float d = abs(r - R) - w * 0.5;
    float aa = fwidth(d) + 1e-5;
    float line = 1.0 - smoothstep(-aa, aa, d);
    if (uDashes > 0.0) {
      float s = abs(fract(ang / 6.2831853 * uDashes) - 0.5) * 2.0;
      float sa = fwidth(s) + 1e-4;
      line *= smoothstep(0.35 - sa, 0.35 + sa, s);
    }
    // Drawn in round the ring from its far side
    float along = fract(ang / 6.2831853 + 0.25);
    float shown = step(along, uReveal);
    line *= shown;
    float glow = exp(-max(d, 0.0) / uGlowWidth) * uGlow * shown;
    float inner = uFill * smoothstep(R, 0.0, r);
    float lit = (1.0 + 0.1 * uBreathe * breath) * uDim;
    float a = (line * uOpacity + glow) * lit * (1.0 + 0.45 * uHover) + inner * lit;
    vec3 c = uColor * (1.0 + 0.25 * uHover);
    if (uDot > 0.0) {
      // The level cue: a filled dot at the heart, in the colour of the square's level
      float dd = r - uDot * uScale;
      float da = fwidth(dd) + 1e-5;
      float dot = (1.0 - smoothstep(-da, da, dd)) * 0.92 * uDim;
      c = mix(c, uDotColor, dot / max(a + dot, 1e-4));
      a = a + dot * (1.0 - a);
    }
    if (uLure > 0.5) {
      // The lure: a bright bead that circles the ring, with its own glow
      float la = uTime * 0.9 + uPhase;
      vec2 at = vec2(cos(la), sin(la)) * R;
      float ld = length(p - at);
      float bead = 1.0 - smoothstep(w * 1.1 - aa, w * 1.1 + aa, ld);
      float halo = exp(-ld / (w * 2.2)) * 0.8;
      float l = max(bead, halo) * uDim;
      c = mix(c, uLureColor, l / max(a + l, 1e-4));
      a += l;
    }
    // Seen from above, a dark keyline round the stroke, so nested rings separate
    float key = (1.0 - smoothstep(-aa, aa, abs(r - R) - w * 0.5 - 0.02)) * shown * 0.6 * uSteep;
    float lineA = min(a, 1.0);
    float outA = lineA + key * (1.0 - lineA);
    vec3 outC = (c * lineA + vec3(0.004, 0.02, 0.027) * key * (1.0 - lineA)) / max(outA, 1e-4);
    if (outA < 0.004) discard;
    gl_FragColor = vec4(outC, outA);
    #include <colorspace_fragment>
  }`;

const planes = new Map<number, PlaneGeometry>();
const planeFor = (size: number) => {
  const key = Math.round(size * 1000);
  let g = planes.get(key);
  if (!g) {
    g = new PlaneGeometry(size, size);
    planes.set(key, g);
  }
  return g;
};

const ringMaterial = () =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: {
      uColor: { value: new Color() },
      uLureColor: { value: new Color() },
      uDotColor: { value: new Color() },
      uOpacity: { value: 1 },
      uRadius: { value: 0.3 },
      uWidth: { value: 0.03 },
      uGlow: { value: 0.3 },
      uGlowWidth: { value: 0.04 },
      uFill: { value: 0 },
      uBreathe: { value: 0 },
      uPhase: { value: 0 },
      uDashes: { value: 0 },
      uDot: { value: 0 },
      uLure: { value: 0 },
      uHover: { value: 0 },
      uReveal: { value: 1 },
      uQuad: { value: 1 },
      uScale: { value: 1 },
      uDim: { value: 1 },
      uSteep: view.steep,
      uTime: clock,
    },
    vertexShader: vertex,
    fragmentShader: fragment,
  });

/**
 * A ring lying on the glass at `floor`. `drawMs` draws it in round its
 * circumference after `delayMs`; `onMaterial` hands over the material for an
 * owner that animates it.
 */
export const Ring = ({
  floor,
  color,
  radius,
  width,
  opacity = 0.95,
  glow = 0.35,
  glowWidth = 0.04,
  fill = 0,
  breathe = 0,
  dashes = 0,
  dotColor,
  dotRadius = 0.07,
  level,
  stackRadius,
  lure = false,
  lureColor = '#fff1c9',
  hovered = false,
  lift = 0.012,
  drawMs = 0,
  delayMs = 0,
  renderOrder = LAYER.marker,
  onMaterial,
}: RingStyle & {
  floor: Vec3;
  drawMs?: number;
  delayMs?: number;
  renderOrder?: number;
  onMaterial?: (m: ShaderMaterial) => void;
}) => {
  const material = useMemo(ringMaterial, []);
  useEffect(() => () => material.dispose(), [material]);
  useAnimated(breathe > 0 || lure);
  // Room for the swell of a hovered ring, the halo and the keyline round it
  const quad =
    (Math.max(radius * 1.3, stackRadius ?? 0) + width + glowWidth * 5 + 0.04) *
    2 *
    (lure ? 1.1 : 1);
  const u = material.uniforms;
  u.uColor.value.set(color);
  u.uLureColor.value.set(lureColor);
  u.uOpacity.value = opacity;
  u.uRadius.value = radius;
  u.uWidth.value = width;
  u.uGlow.value = glow;
  u.uGlowWidth.value = glowWidth;
  u.uFill.value = fill;
  u.uBreathe.value = breathe;
  // A slow wave across the board rather than every ring in lockstep
  u.uPhase.value = (floor[0] * 0.9 + floor[2] * 0.6 + floor[1] * 0.4) % (Math.PI * 2);
  u.uDashes.value = dashes;
  u.uDot.value = dotColor ? dotRadius : 0;
  if (dotColor) u.uDotColor.value.set(dotColor);
  u.uLure.value = lure ? 1 : 0;
  u.uHover.value = hovered ? 1 : 0;
  u.uQuad.value = quad;
  onMaterial?.(material);

  const elapsed = useRef(0);
  const invalidate = useThree((s) => s.invalidate);
  if (drawMs <= 0) u.uReveal.value = 1;
  useEffect(() => {
    elapsed.current = 0;
    if (drawMs > 0) {
      material.uniforms.uReveal.value = 0;
      invalidate();
    }
  }, [drawMs, material, invalidate]);
  useFrame((_, delta) => {
    // Off the level in play, a destination steps back: smaller and dimmer
    if (level !== undefined) {
      const k = inPlay(level);
      u.uScale.value = 0.85 + 0.15 * k;
      u.uDim.value = 0.6 + 0.4 * k;
    }
    if (stackRadius !== undefined) {
      const stacked =
        selection.active &&
        Math.abs(selection.x - floor[0]) < 1e-3 &&
        Math.abs(selection.z - floor[2]) < 1e-3;
      // The level scale would shrink it back under the piece: undo it
      u.uRadius.value = stacked ? stackRadius / u.uScale.value : radius;
    }
    if (drawMs <= 0 || u.uReveal.value >= 1) return;
    elapsed.current += Math.min(delta, MAX_STEP) * 1000;
    const t = Math.min(Math.max((elapsed.current - delayMs) / drawMs, 0), 1);
    u.uReveal.value = 1 - (1 - t) ** 2;
    invalidate();
  });

  return (
    <mesh
      geometry={planeFor(quad)}
      material={material}
      position={[floor[0], floor[1] + lift, floor[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={renderOrder}
      raycast={noRaycast}
    />
  );
};

// --- The marker set ------------------------------------------------------------------

export const makeMarkers = (
  pitch: number,
  motionMs: number,
  levelAt: (floorY: number) => number,
) => {
  const MOVE_RING = 0.26 * pitch;
  const CAPTURE_RING = 0.34 * pitch;
  const STROKE = 0.034 * pitch;
  const DOT = 0.07 * pitch;
  /**
   * A destination straight above or below the selected piece: wider than the
   * piece seen from above, inside its ring of beads. (A capture ring is wide
   * enough already.)
   */
  const STACKED = 0.33 * pitch;

  /**
   * A legal destination: a ring of plankton light, breathing very slowly,
   * with a dot at its heart in the colour of its level.
   */
  const Quiet = ({ floor, hovered }: MarkerProps) => {
    const level = levelAt(floor[1]);
    return (
      <Ring
        floor={floor}
        color={PLANKTON}
        radius={MOVE_RING}
        width={STROKE}
        opacity={0.95}
        glow={0.32}
        glowWidth={0.035 * pitch}
        fill={hovered ? 0.24 : 0}
        dotColor={LEVELS[level]}
        dotRadius={DOT}
        level={level}
        stackRadius={STACKED}
        breathe={1}
        hovered={hovered}
      />
    );
  };

  /**
   * A capture: the same ring in an anglerfish's red, round the victim's base,
   * with its lure circling and the level dot at its heart.
   */
  const Capture = ({ floor, hovered }: MarkerProps) => {
    const level = levelAt(floor[1]);
    return (
      <Ring
        floor={floor}
        color={LURE}
        radius={CAPTURE_RING}
        width={STROKE * 1.1}
        opacity={1}
        glow={0.3}
        glowWidth={0.045 * pitch}
        fill={hovered ? 0.2 : 0}
        dotColor={LEVELS[level]}
        dotRadius={DOT}
        level={level}
        breathe={1}
        lure
        hovered={hovered}
      />
    );
  };

  /**
   * The selection: plankton swirls once round the piece's base and settles
   * into an even ring of beads: dots, never a ring stroke, so it cannot be
   * taken for a destination. (The piece itself takes a plankton outline,
   * pieces.tsx.)
   */
  const Selection = ({ floor }: MarkerProps) => {
    const [x, , z] = floor;
    useEffect(() => {
      Object.assign(selection, { active: true, x, z });
      return () => {
        if (selection.x === x && selection.z === z) selection.active = false;
      };
    }, [x, z]);
    return <PlanktonSwirl floor={floor} pitch={pitch} />;
  };

  /**
   * The last move: a small dashed violet ring where the piece left, a whole
   * one round it where it landed, and the thin violet line between them. A
   * live move draws its line and landing ring in as the piece arrives.
   */
  const LastMove = ({ from, to, fresh = false, arc = 0 }: LastMoveMarkerProps) => (
    <>
      <Ring
        floor={from.floor}
        color={LAST_MOVE}
        radius={0.24 * pitch}
        width={STROKE * 0.9}
        opacity={0.85}
        glow={0.25}
        glowWidth={0.03 * pitch}
        dashes={12}
      />
      <Ring
        floor={to.floor}
        color={LAST_MOVE}
        radius={0.4 * pitch}
        width={STROKE * 0.9}
        opacity={0.9}
        glow={0.3}
        glowWidth={0.035 * pitch}
        drawMs={fresh ? 360 : 0}
        delayMs={motionMs * 0.75}
      />
      <LastMoveLine
        from={from.floor}
        to={to.floor}
        arc={arc}
        color={LAST_MOVE}
        pulseColor="#f0e8ff"
        opacity={0.9}
        radius={0.013}
        pulse={0.55}
        pulseLength={0.35}
        flowSpeed={0.5}
        shade={0.3}
        lift={0.03}
        drawInMs={fresh ? 380 : 0}
        drawInDelayMs={fresh ? motionMs * 0.55 : 0}
      />
    </>
  );

  /** Check: a red pulse spreads from the king across its level once, then a steady red ring holds. */
  const Check = ({ floor }: MarkerProps) => (
    <>
      <Ring
        floor={floor}
        color={CHECK}
        radius={0.42 * pitch}
        width={STROKE * 1.3}
        opacity={1}
        glow={0.55}
        glowWidth={0.06 * pitch}
        fill={0.16}
      />
      <CheckPulse floor={floor} pitch={pitch} />
    </>
  );

  return { Quiet, Capture, Selection, LastMove, Check };
};

// --- The check's pulse --------------------------------------------------------------

const PULSE_MS = 1100;

/** One ring of red light spreading out from the king over its level, then gone. */
const CheckPulse = ({ floor, pitch }: { floor: Vec3; pitch: number }) => {
  const group = useRef<Group>(null);
  const material = useRef<ShaderMaterial | null>(null);
  const elapsed = useRef(0);
  const invalidate = useThree((s) => s.invalidate);
  const reach = 2.2 * pitch;
  useFrame((_, delta) => {
    const m = material.current;
    if (!m || !group.current || elapsed.current >= PULSE_MS) return;
    elapsed.current = Math.min(elapsed.current + Math.min(delta, MAX_STEP) * 1000, PULSE_MS);
    const t = elapsed.current / PULSE_MS;
    const e = 1 - (1 - t) ** 3;
    // The quad is sized for the full reach; the ring grows inside it
    m.uniforms.uRadius.value = 0.3 * pitch + (reach - 0.3 * pitch) * e;
    m.uniforms.uOpacity.value = 0.9 * (1 - t) ** 1.5;
    m.uniforms.uGlow.value = 0.7 * (1 - t) ** 1.5;
    m.uniforms.uWidth.value = 0.05 * pitch * (1 - 0.5 * t);
    group.current.visible = t < 1;
    invalidate();
  });
  return (
    <group ref={group}>
      <Ring
        floor={floor}
        color={CHECK}
        radius={reach}
        width={0.05 * pitch}
        opacity={0}
        glow={0}
        glowWidth={0.08 * pitch}
        lift={0.016}
        onMaterial={(m) => {
          if (material.current !== m) {
            material.current = m;
            m.uniforms.uRadius.value = 0.3 * pitch;
          }
        }}
      />
    </group>
  );
};

// --- The plankton swirl --------------------------------------------------------------

const SWIRL_MS = 1000;
/** The beads the swirl settles into, evenly spaced round the base. */
const BEADS = 14;
/** Motes that swirl with them and fade out as they settle. */
const DUST = 16;
/** Radius of the settled ring of beads, in pitches. */
const HALO = 0.36;

const swirlVertex = /* glsl */ `
  attribute float aSeed;
  attribute float aBead;
  uniform float uT;
  uniform float uTime;
  uniform float uPitch;
  uniform float uScale;
  uniform float uHalo;
  uniform float uSteep;
  varying float vAlpha;
  const float TAU = 6.2831853;
  void main() {
    float jitter = fract(aSeed * 13.7);
    float e = 1.0 - pow(1.0 - uT, 3.0);
    // Once round the base, drawing in from wide; the beads settle evenly
    // spaced on the halo and turn very slowly, the dust fades on the way
    float angle = aSeed * TAU + TAU * e + uTime * 0.1;
    // From above the halo opens wider, clear of any pieces stacked over it
    float halo = mix(uHalo, 0.46, smoothstep(0.3, 0.7, uSteep));
    float settle = aBead > 0.5 ? halo : halo + 0.05 + 0.1 * jitter;
    float radius = mix(0.66 + 0.12 * jitter, settle, e) * uPitch;
    // On the glass, never over the piece: additive light must not wash its body
    vec3 p = vec3(cos(angle) * radius, 0.02, sin(angle) * radius);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = (aBead > 0.5 ? 0.05 : 0.03 + 0.02 * jitter) * uPitch;
    gl_PointSize = max(size * uScale / -mv.z, 1.5);
    float appear = smoothstep(0.0, 0.12, uT);
    vAlpha = aBead > 0.5
      ? appear * mix(1.0, 0.8 + 0.2 * sin(uTime * 0.9 + aSeed * 20.0), smoothstep(0.8, 1.0, uT))
      : appear * (1.0 - smoothstep(0.55, 1.0, uT)) * 0.8;
  }`;

const swirlFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.35, 1.0, d)) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }`;

const swirlGeometry = (() => {
  let g: BufferGeometry | null = null;
  return () => {
    if (g) return g;
    const n = BEADS + DUST;
    const seeds = new Float32Array(n);
    const beads = new Float32Array(n);
    for (let i = 0; i < BEADS; i++) {
      seeds[i] = i / BEADS;
      beads[i] = 1;
    }
    for (let i = 0; i < DUST; i++) seeds[BEADS + i] = (i + 0.5 + ((i * 0.618) % 1) * 0.4) / DUST;
    g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aSeed', new BufferAttribute(seeds, 1));
    g.setAttribute('aBead', new BufferAttribute(beads, 1));
    return g;
  };
})();

/** Plankton that swirl once round the selected piece's base, then hold as a slow ring of beads. */
const PlanktonSwirl = ({ floor, pitch }: { floor: Vec3; pitch: number }) => {
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const camera = useThree((s) => s.camera);
  const elapsed = useRef(0);
  useAnimated();
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: {
          uColor: { value: new Color(PLANKTON) },
          uT: { value: 0 },
          uTime: clock,
          uPitch: { value: pitch },
          uScale: { value: 1 },
          uHalo: { value: HALO },
          uSteep: view.steep,
        },
        vertexShader: swirlVertex,
        fragmentShader: swirlFragment,
      }),
    [pitch],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame((_, delta) => {
    elapsed.current = Math.min(elapsed.current + Math.min(delta, MAX_STEP) * 1000, SWIRL_MS);
    material.uniforms.uT.value = elapsed.current / SWIRL_MS;
    // World size to pixels: half the drawing buffer's height over tan(fov / 2)
    const fov = 'fov' in camera ? (camera.fov as number) : 36;
    material.uniforms.uScale.value = (size.height * dpr * 0.5) / Math.tan((fov * Math.PI) / 360);
  });
  return (
    <points
      geometry={swirlGeometry()}
      material={material}
      position={floor}
      renderOrder={LAYER.trace}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};
