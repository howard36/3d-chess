import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BackSide,
  Color,
  CylinderGeometry,
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
import { LEVEL_COLORS, levelAt, MOTION, PALETTE, RING_WORLD } from './palette';

// Meridian's marks are discs of light lying on the deck, one family:
//
// - a legal destination: a small disc in its level's colour, a crisp rim over
//   a soft inner fill (the level cue is the disc itself). Under the pointer
//   it swells a little and its fill deepens toward the centre, like a shallow
//   bowl of light, eased; the rim never brightens.
// - a capture: the same disc in crimson, as wide as the victim's base ring
//   and laid exactly over it, so the ring is retinted rather than joined by a
//   second one, with one slow comet circling it. Under the pointer its rim
//   stays as it is: the disc swells as a soft skirt of fill just past the
//   rim, and its fill deepens toward the rim, in the band the victim's base
//   leaves in view.
// - the last move: a pale gold disc of the same kind at each end, the one
//   left behind smaller (always), joined by a thin dashed gold line flowing
//   slowly from origin to destination. The arrival's disc lies over the
//   piece's ring, retinting it gold.
// - check: a red hexagon under the king, its ring retinted red inside it (a
//   circle in a hexagon: one figure), with light shining up from it. Check
//   arrives with one flare up the light and a flash of the hexagon, then the
//   light shimmers slowly upward and the hexagon breathes while it lasts. At
//   mate the light goes down as the king topples, leaving a quiet hexagon.
// - the selection is the held piece's own column of starlight (pieces.tsx),
//   so its release can fade where the piece stands.
//
// Everything is drawn over every deck (LAYER), so a mark three decks down
// reads as clearly as one on top.

// --- Where the destinations are ------------------------------------------------------

// The last move's discs step aside for a destination on the same square (a
// legal move back to where a piece came from, a capture of the piece that
// just moved), so no square ever shows two discs, one inside the other
const marked = new Map<string, number>();
const listeners = new Set<() => void>();
let version = 0;
const keyOf = (floor: Vec3) => floor.map((v) => v.toFixed(2)).join(',');
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const notify = () => {
  version++;
  listeners.forEach((l) => l());
};
const useMarks = (floor: Vec3) => {
  const key = keyOf(floor);
  useLayoutEffect(() => {
    marked.set(key, (marked.get(key) ?? 0) + 1);
    notify();
    return () => {
      const n = (marked.get(key) ?? 1) - 1;
      if (n > 0) marked.set(key, n);
      else marked.delete(key);
      notify();
    };
  }, [key]);
};
const useIsMarked = (floor: Vec3) => {
  useSyncExternalStore(subscribe, () => version);
  return marked.has(keyOf(floor));
};

// --- The disc -------------------------------------------------------------------------

const discVertex = /* glsl */ `
  uniform float uQuad;
  varying vec2 vP;
  void main() {
    vP = (uv - 0.5) * uQuad;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const discFragment = /* glsl */ `
  uniform vec3 uRimColor;
  uniform vec3 uFillColor;
  uniform vec3 uCometColor;
  uniform float uRadius;
  uniform float uWidth;
  uniform float uSkirt;
  uniform float uEdgeBowl;
  uniform float uRimA;
  uniform float uFill;
  uniform float uDepth;
  uniform float uHalo;
  uniform float uComet;
  uniform float uTime;
  uniform float uPhase;
  uniform float uOpacity;
  varying vec2 vP;

  void over(inout vec4 acc, vec3 c, float a) {
    acc.rgb = c * a + acc.rgb * (1.0 - a);
    acc.a = a + acc.a * (1.0 - a);
  }

  void main() {
    float r = length(vP);
    float fw = max(fwidth(r), 1e-4);
    float inner = uRadius - uWidth * 0.5;
    float outer = uRadius + uWidth * 0.5;
    // Never thinner than about a pixel; thinner than that, it fades instead
    float mid = 0.5 * (inner + outer);
    float hw = max(0.5 * (outer - inner), fw * 0.6);
    float cover = min(0.5 * (outer - inner) / hw, 1.0);
    float rim = (1.0 - smoothstep(hw - fw, hw + fw, abs(r - mid))) * cover;
    float inside = 1.0 - smoothstep(mid - hw - fw, mid - hw + fw, r);

    vec4 acc = vec4(0.0);
    // A faint glow just outside the rim, so it reads as light
    float glow = exp(-max(r - outer, 0.0) / 0.02) * (1.0 - inside) * uHalo;
    over(acc, uRimColor, glow);
    // The fill: even at rest; under the pointer it deepens, a shallow bowl
    // of light: toward the centre on an empty square, toward the rim round a
    // victim (the band its base leaves in view)
    float k = clamp(r / max(inner, 1e-4), 0.0, 1.0);
    float bowl = mix(1.0, mix(0.5 + 0.95 * (1.0 - k * k), 0.3 + 1.2 * k * k, uEdgeBowl), uDepth);
    over(acc, uFillColor, inside * uFill * bowl);
    // Under the pointer a victim's disc swells as a pool of light just past
    // its rim, never as a heavier line
    float skirt = (1.0 - smoothstep(outer, outer + max(uSkirt, 1e-4), r)) * step(outer, r);
    over(acc, uFillColor, skirt * uFill * 0.9 * min(uSkirt / 0.05, 1.0));
    over(acc, uRimColor, rim * uRimA);

    if (uComet > 0.5) {
      // One slow comet circling the rim: a bright head, a tail fading behind it
      float head = uTime * 0.9 + uPhase;
      float ang = atan(vP.y, vP.x);
      float behind = mod(head - ang, 6.2831853);
      float onRim = exp(-pow((r - mid) / max(hw * 1.3, fw), 2.0));
      float tail = exp(-behind / 0.9) * onRim * 0.75;
      vec2 at = vec2(cos(head), sin(head)) * mid;
      float d = length(vP - at);
      float core = 1.0 - smoothstep(hw * 1.7 - fw, hw * 1.7 + fw, d);
      float halo = exp(-d / (hw * 3.0)) * 0.6;
      over(acc, uCometColor, clamp(max(max(core, halo), tail), 0.0, 1.0));
    }

    acc *= uOpacity;
    if (acc.a < 0.003) discard;
    gl_FragColor = vec4(acc.rgb / acc.a, acc.a);
    #include <colorspace_fragment>
  }`;

const quads = new Map<number, PlaneGeometry>();
const quadFor = (size: number) => {
  const key = Math.round(size * 1000);
  let g = quads.get(key);
  if (!g) {
    g = new PlaneGeometry(size, size);
    quads.set(key, g);
  }
  return g;
};

interface DiscStyle {
  rim: string;
  fill: string;
  radius: number;
  width: number;
  rimOpacity: number;
  fillOpacity: number;
  /** Fill opacity under the pointer. */
  hoverFill?: number;
  /**
   * Growth under the pointer: the whole disc (quiet), or, round a victim
   * whose ring the rim covers, a soft skirt of fill past the rim (capture).
   */
  hoverScale?: number;
  hoverSkirt?: number;
  /** Deepen the fill toward the rim under the pointer, not toward the centre. */
  edgeBowl?: boolean;
  halo?: number;
  comet?: string;
  /** Fade in over this long when mounted, after `delayMs`. */
  revealMs?: number;
  delayMs?: number;
  renderOrder?: number;
}

const HOVER_MS = 200;

const discMaterial = () =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: {
      uRimColor: { value: new Color() },
      uFillColor: { value: new Color() },
      uCometColor: { value: new Color() },
      uRadius: { value: 0.2 },
      uWidth: { value: 0.02 },
      uSkirt: { value: 0 },
      uEdgeBowl: { value: 0 },
      uRimA: { value: 1 },
      uFill: { value: 0 },
      uDepth: { value: 0 },
      uHalo: { value: 0 },
      uComet: { value: 0 },
      uTime: { value: 0 },
      uPhase: { value: 0 },
      uOpacity: { value: 1 },
      uQuad: { value: 1 },
    },
    vertexShader: discVertex,
    fragmentShader: discFragment,
  });

/** One disc lying on the deck at `floor` (see above). */
const Disc = ({
  floor,
  hovered = false,
  style,
}: {
  floor: Vec3;
  hovered?: boolean;
  style: DiscStyle;
}) => {
  const invalidate = useThree((s) => s.invalidate);
  const material = useMemo(discMaterial, []);
  useEffect(() => () => material.dispose(), [material]);
  const mesh = useRef<Mesh>(null);
  const hover = useRef(0);
  const elapsed = useRef(0);
  const still = useMemo(prefersReducedMotion, []);
  const scaleMax = style.hoverScale ?? 1;
  const quad = (style.radius * scaleMax + style.width + (style.hoverSkirt ?? 0) + 0.08) * 2;
  const u = material.uniforms;
  u.uRimColor.value.set(style.rim);
  u.uFillColor.value.set(style.fill);
  if (style.comet) u.uCometColor.value.set(style.comet);
  u.uComet.value = style.comet ? 1 : 0;
  u.uHalo.value = style.halo ?? 0.12;
  u.uQuad.value = quad;
  // A slow wave across the board rather than every comet in step
  u.uPhase.value = (floor[0] * 1.3 + floor[2] * 0.7 + floor[1] * 0.5) % (Math.PI * 2);
  const revealMs = style.revealMs ?? 0;
  const delayMs = style.delayMs ?? 0;

  useEffect(() => invalidate(), [hovered, invalidate]);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20) * 1000;
    let moving = false;
    const goal = hovered ? 1 : 0;
    if (hover.current !== goal) {
      const step = dt / HOVER_MS;
      hover.current =
        goal > hover.current
          ? Math.min(1, hover.current + step)
          : Math.max(0, hover.current - step);
      moving = true;
    }
    // Eased both ways (smoothstep of a steady ramp)
    const h = hover.current * hover.current * (3 - 2 * hover.current);
    const scale = 1 + (scaleMax - 1) * h;
    u.uRadius.value = style.radius * scale;
    u.uWidth.value = style.width * scale;
    u.uSkirt.value = (style.hoverSkirt ?? 0) * h;
    u.uEdgeBowl.value = style.edgeBowl ? 1 : 0;
    u.uRimA.value = style.rimOpacity;
    u.uFill.value =
      style.fillOpacity + ((style.hoverFill ?? style.fillOpacity) - style.fillOpacity) * h;
    u.uDepth.value = h;
    if (revealMs > 0 && elapsed.current < delayMs + revealMs) {
      elapsed.current += dt;
      const t = Math.min(Math.max((elapsed.current - delayMs) / revealMs, 0), 1);
      u.uOpacity.value = 1 - (1 - t) ** 2;
      if (mesh.current) mesh.current.scale.setScalar(0.85 + 0.15 * (1 - (1 - t) ** 3));
      moving = true;
    }
    if (style.comet && !still) {
      u.uTime.value += dt / 1000;
      moving = true;
    }
    if (moving) invalidate();
  });

  return (
    <mesh
      ref={mesh}
      geometry={quadFor(quad)}
      material={material}
      position={[floor[0], floor[1] + 0.012, floor[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={style.renderOrder ?? LAYER.marker}
      raycast={noRaycast}
    />
  );
};

// --- Destinations -------------------------------------------------------------------------

const QUIET_RADIUS = 0.21;
const CAPTURE_WIDTH = 0.03;

/** A legal destination: a small disc of its level's light. */
export const Quiet = ({ floor, hovered }: MarkerProps) => {
  useMarks(floor);
  const tint = LEVEL_COLORS[levelAt(floor[1])];
  return (
    <Disc
      floor={floor}
      hovered={hovered}
      style={{
        rim: tint,
        fill: tint,
        radius: QUIET_RADIUS,
        width: 0.02,
        rimOpacity: 0.78,
        fillOpacity: 0.18,
        hoverFill: 0.42,
        hoverScale: 1.15,
        halo: 0.1,
      }}
    />
  );
};

/** A capture: the same disc in crimson, laid over the victim's ring, a comet circling it. */
export const Capture = ({ floor, hovered }: MarkerProps) => {
  useMarks(floor);
  return (
    <Disc
      floor={floor}
      hovered={hovered}
      style={{
        rim: PALETTE.capture,
        fill: PALETTE.capture,
        radius: RING_WORLD,
        width: CAPTURE_WIDTH,
        rimOpacity: 0.95,
        fillOpacity: 0.12,
        hoverFill: 0.3,
        // The rim keeps its width and brightness: the disc swells as a soft
        // skirt of fill past it, and its fill deepens toward the rim
        hoverSkirt: 0.05,
        edgeBowl: true,
        halo: 0.14,
        comet: PALETTE.captureMote,
        // Over the last move's disc, should the two meet for a frame
        renderOrder: LAYER.marker + 0.2,
      }}
    />
  );
};

/**
 * The selection: nothing of its own. The held piece raises its own column of
 * starlight (pieces.tsx), so that putting it down can fade the column where
 * the piece stands; every new pick-up replays the column's entrance.
 */
export const Selection = () => null;

// --- The last move ------------------------------------------------------------------------

const TRACE_FILL = 0.12;

/**
 * The last move: pale gold discs at both ends, the origin's smaller, and the
 * thin dashed gold line between them. A live move draws its line in as the
 * piece travels and lights its arrival as the piece lands.
 */
export const LastMove = ({ from, to, fresh = false, arc = 0 }: LastMoveMarkerProps) => {
  const fromTaken = useIsMarked(from.floor);
  const toTaken = useIsMarked(to.floor);
  const disc = (scale: number): DiscStyle => ({
    rim: PALETTE.trace,
    fill: PALETTE.trace,
    radius: RING_WORLD * scale,
    width: CAPTURE_WIDTH * (0.6 + 0.4 * scale),
    rimOpacity: 0.85,
    fillOpacity: TRACE_FILL,
    halo: 0.12,
  });
  return (
    <>
      {!fromTaken && <Disc floor={from.floor} style={disc(0.6)} />}
      {!toTaken && (
        <Disc
          floor={to.floor}
          style={{
            ...disc(1),
            revealMs: fresh ? 300 : 0,
            delayMs: fresh ? MOTION.durationMs * 0.8 : 0,
          }}
        />
      )}
      <LastMoveLine
        from={from.floor}
        to={to.floor}
        arc={arc}
        color={PALETTE.trace}
        pulseColor="#fff4d6"
        opacity={0.9}
        radius={0.013}
        pattern="dashed"
        spacing={0.17}
        dash={0.55}
        flowSpeed={0.3}
        pulse={0.45}
        shade={0.3}
        lift={0.03}
        drawInMs={fresh ? 380 : 0}
        drawInDelayMs={fresh ? MOTION.durationMs * 0.45 : 0}
      />
    </>
  );
};

// --- Check ---------------------------------------------------------------------------------

const HEX_APOTHEM = 0.33;
const HEX_RADIUS = HEX_APOTHEM / Math.cos(Math.PI / 6);
const ENTRY_MS = 650;
const FLARE_MS = 520;
/** At mate, the light holds a moment, then goes down over MATE_SETTLE_MS. */
const MATE_HOLD_MS = 300;
const MATE_SETTLE_MS = 900;

const hexVertex = discVertex;

const hexFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uApothem;
  uniform float uRing;
  uniform float uLine;
  uniform float uFill;
  uniform float uGlow;
  uniform float uScale;
  uniform float uOpacity;
  varying vec2 vP;

  // A regular hexagon of apothem r, flat sides across x (parallel to the ranks)
  float sdHex(vec2 p, float r) {
    const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
    p = abs(p.yx);
    p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
    p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
    return length(p) * sign(p.y);
  }
  float band(float d, float w) {
    float fw = max(fwidth(d), 1e-4);
    float h = max(w * 0.5, fw * 0.6);
    return (1.0 - smoothstep(h - fw, h + fw, abs(d))) * min(w * 0.5 / h, 1.0);
  }
  void over(inout vec4 acc, vec3 c, float a) {
    acc.rgb = c * a + acc.rgb * (1.0 - a);
    acc.a = a + acc.a * (1.0 - a);
  }
  void main() {
    vec2 p = vP / uScale;
    float hex = sdHex(p, uApothem);
    float fw = max(fwidth(hex), 1e-4);
    float inside = 1.0 - smoothstep(-fw, fw, hex);
    vec4 acc = vec4(0.0);
    float glow = exp(-max(hex, 0.0) / 0.035) * (1.0 - inside) * uGlow;
    over(acc, uColor, glow);
    over(acc, uColor, inside * uFill);
    // The king's ring, retinted: a circle held in the hexagon
    over(acc, uColor, band(length(p) - uRing, 0.026) * 0.95);
    over(acc, uColor, band(hex, uLine));
    acc *= uOpacity;
    if (acc.a < 0.003) discard;
    gl_FragColor = vec4(acc.rgb / acc.a, acc.a);
    #include <colorspace_fragment>
  }`;

// The light shining up from the hexagon: a six-sided wall of light, drawn
// before the pieces and added onto the scene, so the king (and anyone behind
// him) is drawn over it: it glows round him, never on him
const LIGHT_HEIGHT = 0.78;
const lightGeometry = new CylinderGeometry(
  HEX_RADIUS,
  HEX_RADIUS * 0.94,
  LIGHT_HEIGHT,
  6,
  1,
  true,
).translate(0, LIGHT_HEIGHT / 2, 0);

const lightVertex = /* glsl */ `
  varying float vH;
  varying float vAng;
  varying vec3 vN;
  varying vec3 vW;
  void main() {
    vH = position.y / ${LIGHT_HEIGHT.toFixed(3)};
    vAng = atan(position.z, position.x);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const lightFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uFlare;
  uniform float uStrength;
  uniform float uFade;
  varying float vH;
  varying float vAng;
  varying vec3 vN;
  varying vec3 vW;
  void main() {
    vec3 v = normalize(cameraPosition - vW);
    // Soft where a wall turns edge-on, so it never shows a hard outline
    float face = smoothstep(0.1, 0.6, abs(dot(normalize(vN), v)));
    // Rays of light, fading as they rise
    float rays = 0.45 + 0.3 * sin(vAng * 11.0 + 1.3) + 0.25 * sin(vAng * 23.0 + 4.1);
    float body = pow(1.0 - vH, 2.4) * (0.35 + 0.65 * rays);
    // A slow shimmer rising up the rays
    float shimmer = 0.7 + 0.3 * sin((vH * 2.6 - uTime * 0.3) * 6.2831853 + vAng * 2.0);
    float hem = exp(-vH / 0.05) * 0.35;
    // The entry's single flare up the light
    // (a surge up the rays themselves, not a band)
    float flare = exp(-pow((vH - uFlare) / 0.12, 2.0)) * step(0.0, uFlare) * (1.0 - vH * 0.7);
    flare *= 0.2 + 0.8 * rays;
    float a = ((body * shimmer * 0.5 + hem) * uStrength + flare * 0.75) * face;
    // Quieter from straight above, where the hexagon speaks for it
    a *= (1.0 - 0.6 * smoothstep(0.75, 0.95, abs(v.y))) * uFade;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <colorspace_fragment>
  }`;

/** Check: a red hexagon under the king with light shining up (see above). */
export const Check = ({ floor, mated = false }: MarkerProps) => {
  const invalidate = useThree((s) => s.invalidate);
  const still = useMemo(prefersReducedMotion, []);
  const quad = (HEX_RADIUS + 0.12) * 2 * 1.1;
  const { hex, light } = useMemo(
    () => ({
      hex: new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        uniforms: {
          uColor: { value: new Color(PALETTE.check) },
          uApothem: { value: HEX_APOTHEM },
          uRing: { value: RING_WORLD },
          uLine: { value: 0.026 },
          uFill: { value: 0.16 },
          uGlow: { value: 0.3 },
          uScale: { value: 1 },
          uOpacity: { value: 1 },
          uQuad: { value: quad },
        },
        vertexShader: hexVertex,
        fragmentShader: hexFragment,
      }),
      light: new ShaderMaterial({
        transparent: false,
        depthWrite: false,
        side: BackSide,
        blending: AdditiveBlending,
        uniforms: {
          uColor: { value: new Color(PALETTE.check) },
          uTime: { value: 0 },
          uFlare: { value: -1 },
          uStrength: { value: 0 },
          uFade: { value: 1 },
        },
        vertexShader: lightVertex,
        fragmentShader: lightFragment,
      }),
    }),
    [quad],
  );
  useEffect(
    () => () => {
      hex.dispose();
      light.dispose();
    },
    [hex, light],
  );
  const elapsed = useRef(0);
  // Time since the check became mate: the light goes down and the hexagon
  // holds still while the king topples
  const sinceMate = useRef(0);
  const lightMesh = useRef<Mesh>(null);
  useEffect(() => invalidate(), [mated, invalidate]);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20) * 1000;
    elapsed.current += dt;
    const t = elapsed.current;
    if (mated) sinceMate.current += dt;
    const settle = Math.min(Math.max((sinceMate.current - MATE_HOLD_MS) / MATE_SETTLE_MS, 0), 1);
    const m = settle * settle * (3 - 2 * settle);
    // Entry: the hexagon flashes and settles open; one flare runs up the light
    const e = Math.min(t / ENTRY_MS, 1);
    const flash = Math.exp(-t / 220) * 1.1;
    const open = 1 - (1 - e) ** 3;
    // Passive: the hexagon breathes, gently
    const breath = still ? 0 : Math.sin((t / 1000) * ((Math.PI * 2) / 3.4));
    const alive = (1 - m) * e;
    const h = hex.uniforms;
    h.uScale.value = (0.82 + 0.18 * open) * (1 + 0.022 * breath * alive);
    h.uOpacity.value = Math.min(1, t / 120);
    h.uFill.value = (0.16 + 0.03 * breath * alive + 0.22 * flash) * (1 - 0.35 * m);
    h.uGlow.value = (0.3 + 0.05 * breath * alive + 0.6 * flash) * (1 - 0.5 * m);
    const l = light.uniforms;
    if (!still) l.uTime.value += dt / 1000;
    l.uFlare.value = t < FLARE_MS ? (t / FLARE_MS) * 1.1 : -1;
    l.uStrength.value = Math.min(1, t / 300);
    l.uFade.value = 1 - m;
    if (lightMesh.current) lightMesh.current.visible = m < 1;
    // Mated and settled: a quiet hexagon, and nothing left to animate
    if (!(mated && m >= 1 && t > ENTRY_MS)) invalidate();
  });
  return (
    <>
      <mesh
        geometry={quadFor(quad)}
        material={hex}
        position={[floor[0], floor[1] + 0.014, floor[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={LAYER.marker + 0.3}
        raycast={noRaycast}
      />
      <mesh
        ref={lightMesh}
        geometry={lightGeometry}
        material={light}
        position={floor}
        // Before the pieces, added on: they are drawn over it
        renderOrder={-1}
        raycast={noRaycast}
      />
    </>
  );
};
