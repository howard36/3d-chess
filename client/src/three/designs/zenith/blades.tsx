import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import type { Group, IUniform } from 'three';
import { prefersReducedMotion } from '../../motion';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import type { Vec3 } from '../types';
import { PALETTE, PIECE_SCALE, RING_RADIUS } from './palette';
import type { BladeStyle } from './settings-markers';

// The blades round a king in check: threat, not glare. Every style is drawn
// as dark shapes with keen red edges (dark red cores, thin bright edges, low
// alpha, silhouette over glow), moving slowly and deliberately, so the king,
// red from cross to foot and lit from below, stays the brightest thing
// there. They come in with the check's strike (as strongly as the check
// pulse setting says), and at mate they settle: they sink, fold or fade as
// the king falls.
//
// - shards: eight keen shards of obsidian, solid black glass with a cool
//   sheen, standing up from the points of the crown on the glass, tall and
//   short in turn, leaning a little outward, red hairlines up their ridges
//   and a slow glint climbing one after another;
// - clusters: the same obsidian, broken through the glass in four clusters
//   on the diagonals, a tall shard and two short ones splaying from each;
// - teeth: the same obsidian as a ring of sixteen low, jagged teeth round
//   the crown, their points leaning in;
// - thorns: an iron maiden, fourteen thin spikes round the king leaning in
//   toward him, drawing slowly tighter as they rise, the ring turning very
//   slowly;
// - scythes: four curved blades rising round him, swelling as they sweep
//   up and hooking in over him, keen at the point, turning slowly round;
// - cracks: the glass round his foot splits, jagged fractures running out
//   from under the crown to the edge of his square, dark with red light in
//   them, a slow gleam travelling out along each;
// - needles: four long needles aimed at him from his square's corners,
//   sliding in and stopping short, a glint running down each to its point.
//
// Every style keeps within the king's own square, clear of the squares his
// escape moves are marked on.

const EDGE = new Color(PALETTE.check);
const BODY = new Color('#1c0406');
/** Where the points of the crown on the glass reach (markers.tsx, Check). */
const CROWN_TIPS = RING_RADIUS * PIECE_SCALE + 0.01 + 0.085;
/** How long the check's strike lasts (markers.tsx). */
const STRIKE_S = 0.95;
/** How long the blades take to settle at mate. */
const SETTLE_S = 0.7;

type Uniforms = Record<string, IUniform>;

/**
 * The clock every style runs on: time since the check arrived (held still
 * while settled or under reduced motion), how far they have come in (eased
 * over `enterS`), the strike's flare, and how far they have settled at
 * mate. Requests frames while anything moves.
 */
const useLife = (mated: boolean, strength: number, enterS: number) => {
  const invalidate = useThree((s) => s.invalidate);
  const u = useMemo<Uniforms>(
    () => ({
      uTime: { value: 0 },
      uEnter: { value: 0 },
      uSettle: { value: 0 },
      uFlare: { value: 0 },
      uPx: { value: 0.002 },
    }),
    [],
  );
  const since = useRef(0);
  const still = prefersReducedMotion();
  useEffect(() => invalidate(), [mated, strength, invalidate]);
  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 20);
    since.current += dt;
    const k = still ? 1 : Math.min(since.current / enterS, 1);
    u.uEnter.value = 1 - (1 - k) ** 3;
    u.uFlare.value = still ? 0 : strength * Math.max(0, 1 - since.current / STRIKE_S) ** 2;
    const settle = Math.min(1, Math.max(0, u.uSettle.value + ((mated ? 1 : -1) * dt) / SETTLE_S));
    u.uSettle.value = settle;
    if (!still && settle < 1) u.uTime.value += dt;
    // A world unit's size in pixels at unit distance, for lines kept at
    // least about a pixel wide
    const cam = state.camera as { projectionMatrix: { elements: number[] } };
    u.uPx.value = 2 / (cam.projectionMatrix.elements[5] * state.size.height * state.viewport.dpr);
    const settled = mated && settle >= 1;
    if (!settled && (!still || k < 1 || u.uFlare.value > 0)) invalidate();
  });
  return u;
};

// --- Ribbons: shards, thorns, scythes, needles --------------------------------------------------------

/**
 * One blade from `base` to its point at `tip` (floor-relative, world units):
 * straight, or curved through `ctrl` (a quadratic curve, drawn in `segments`).
 */
interface Spike {
  base: Vec3;
  tip: Vec3;
  /** The point before it has drawn in tight (thorns), else `tip`. */
  open?: Vec3;
  /** Bends the blade toward this point (else straight). */
  ctrl?: Vec3;
  segments?: number;
  /** Half its widest width. */
  width: number;
  /** Narrow at the base, swelling, then keen at the point (a scythe), else tapering from the base. */
  swell?: boolean;
  /** Where in the glint's cycle it sits, 0–1. */
  phase: number;
}

const ribbonGeometry = (spikes: Spike[]) => {
  const g = new BufferGeometry();
  const at: Record<string, number[]> = {
    position: [],
    aTip: [],
    aOpen: [],
    aCtrl: [],
    aBent: [],
    aWidth: [],
    aSwell: [],
    aPhase: [],
    aCorner: [],
  };
  const index: number[] = [];
  let first = 0;
  for (const s of spikes) {
    const n = s.segments ?? 1;
    for (let k = 0; k <= n; k++) {
      for (const side of [-1, 1]) {
        at.position.push(...s.base);
        at.aTip.push(...s.tip);
        at.aOpen.push(...(s.open ?? s.tip));
        at.aCtrl.push(...(s.ctrl ?? s.tip));
        at.aBent.push(s.ctrl ? 1 : 0);
        at.aWidth.push(s.width);
        at.aSwell.push(s.swell ? 1 : 0);
        at.aPhase.push(s.phase);
        at.aCorner.push(side, k / n);
      }
    }
    for (let k = 0; k < n; k++) {
      const o = first + k * 2;
      index.push(o, o + 1, o + 3, o, o + 3, o + 2);
    }
    first += (n + 1) * 2;
  }
  // Positions are made in the shader (the base is the position)
  const sizes: Record<string, number> = { position: 3, aTip: 3, aOpen: 3, aCtrl: 3, aCorner: 2 };
  for (const [name, values] of Object.entries(at))
    g.setAttribute(name, new BufferAttribute(new Float32Array(values), sizes[name] ?? 1));
  g.setIndex(index);
  return g;
};

interface RibbonLook {
  /** 0: grows up from its base; 1: slides in along its length. */
  mode: 0 | 1;
  /** How far it slides in from (mode 1). */
  slide?: number;
  bodyA: number;
  edgeA: number;
  /** Seconds for one glint to run the length of a blade. */
  period: number;
}

const ribbonMaterial = (life: Uniforms, look: RibbonLook) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: {
      ...life,
      uClose: { value: 0 },
      uMode: { value: look.mode },
      uSlide: { value: look.slide ?? 0 },
      uBody: { value: BODY },
      uEdge: { value: EDGE },
      uBodyA: { value: look.bodyA },
      uEdgeA: { value: look.edgeA },
      uPeriod: { value: look.period },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aTip;
      attribute vec3 aOpen;
      attribute vec3 aCtrl;
      attribute float aBent;
      attribute float aWidth;
      attribute float aSwell;
      attribute float aPhase;
      attribute vec2 aCorner;
      uniform float uEnter;
      uniform float uSettle;
      uniform float uClose;
      uniform float uMode;
      uniform float uSlide;
      uniform float uPx;
      varying float vSide;
      varying float vT;
      varying float vPhase;
      varying float vFaint;
      vec3 curve(vec3 a, vec3 b, vec3 c, float t) {
        return (1.0 - t) * (1.0 - t) * a + 2.0 * (1.0 - t) * t * b + t * t * c;
      }
      void main() {
        float grow = uEnter * (1.0 - uSettle);
        vec3 base = position;
        vec3 tip = mix(aOpen, aTip, uClose);
        vec3 ctrl = aBent > 0.5 ? aCtrl : 0.5 * (base + tip);
        float t = aCorner.y;
        // Growing, it is drawn along its own path, keen at its leading end;
        // sliding, the whole blade comes in along its length
        float along = t;
        if (uMode < 0.5) {
          along = t * max(grow, 1e-3);
        } else {
          vec3 back = normalize(tip - base) * uSlide * (1.0 - grow);
          base -= back;
          ctrl -= back;
          tip -= back;
        }
        vec3 p = curve(base, ctrl, tip, along);
        vec3 tangent = 2.0 * (1.0 - along) * (ctrl - base) + 2.0 * along * (tip - ctrl);
        vec4 w = modelMatrix * vec4(p, 1.0);
        vec3 dir = normalize(mat3(modelMatrix) * tangent + 1e-6);
        vec3 view = normalize(cameraPosition - w.xyz);
        vec3 across = cross(dir, view);
        float l = length(across);
        across = l > 1e-4 ? across / l : vec3(1.0, 0.0, 0.0);
        // Tapering to a point (or swelling and then keen, a scythe); never
        // thinner than about a pixel (fainter instead)
        float taper = pow(1.0 - t, 0.9);
        float swell = pow(sin(3.14159 * t), 0.7) * (0.3 + 0.7 * t) + 0.12 * (1.0 - t);
        float width = aWidth * mix(taper, swell, aSwell);
        float px = uPx * length(cameraPosition - w.xyz);
        float drawn = max(width, px * 0.8);
        w.xyz += across * aCorner.x * drawn;
        vSide = aCorner.x;
        vT = t;
        vPhase = aPhase;
        vFaint = clamp(width / drawn + 0.25, 0.25, 1.0);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uBody;
      uniform vec3 uEdge;
      uniform float uBodyA;
      uniform float uEdgeA;
      uniform float uTime;
      uniform float uPeriod;
      uniform float uFlare;
      uniform float uSettle;
      uniform float uEnter;
      varying float vSide;
      varying float vT;
      varying float vPhase;
      varying float vFaint;
      void main() {
        // A dark core between two keen red edges
        float s = abs(vSide);
        float fw = max(fwidth(vSide), 1e-4);
        float edge = smoothstep(1.0 - 2.2 * fw - 0.12, 1.0 - 0.4 * fw, s);
        // A slow glint running up the blade toward its point, and a keen point
        float g = exp(-pow((vT - (fract(uTime / uPeriod + vPhase) * 1.5 - 0.25)) / 0.09, 2.0));
        float point = smoothstep(0.7, 1.0, vT) * 0.35;
        float lit = min(edge * (0.7 + 1.1 * g + point) + g * 0.25, 1.4);
        vec3 col = mix(uBody, uEdge, clamp(lit, 0.0, 1.0));
        float a = mix(uBodyA, uEdgeA, clamp(lit, 0.0, 1.0)) * (1.0 + 1.2 * uFlare);
        a *= vFaint * (1.0 - uSettle) * smoothstep(0.0, 0.25, uEnter);
        if (a < 0.004) discard;
        gl_FragColor = vec4(col, min(a, 1.0));
        #include <colorspace_fragment>
      }`,
  });

/** Deterministic jitter, 0–1. */
const jitter = (i: number, salt: number) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const around = (r: number, a: number, y: number): Vec3 => [r * Math.cos(a), y, r * Math.sin(a)];

// Fourteen thin spikes round him, leaning in, twisted a little like a cage
const THORNS: Spike[] = Array.from({ length: 14 }, (_, i) => {
  const a = (i * 2 * Math.PI) / 14;
  const h = 0.38 + jitter(i, 6) * 0.06;
  return {
    base: around(CROWN_TIPS - 0.02, a, 0),
    tip: around(0.2, a + 0.2, h),
    open: around(CROWN_TIPS - 0.01, a + 0.05, h * 0.92),
    width: 0.011,
    phase: i / 14,
  };
});

// Four scythe blades rising from between the shards' places, swelling as
// they curve up and round, hooking in over the king, keen at the point
const SCYTHES: Spike[] = Array.from({ length: 4 }, (_, i) => {
  const a = Math.PI / 4 + (i * Math.PI) / 2;
  return {
    base: around(CROWN_TIPS + 0.03, a, 0),
    ctrl: around(0.52, a + 0.3, 0.4),
    tip: around(0.17, a + 0.85, 0.6),
    segments: 16,
    width: 0.032,
    swell: true,
    phase: i / 4,
  };
});

// Four needles from the square's corners, aimed at his body, stopping short
const NEEDLES: Spike[] = Array.from({ length: 4 }, (_, i) => {
  const a = Math.PI / 4 + (i * Math.PI) / 2;
  return {
    base: around(0.62, a, 0.05),
    tip: around(0.24, a + 0.04, 0.27),
    width: 0.012,
    phase: i * 0.27,
  };
});

type RibbonStyle = 'thorns' | 'scythes' | 'needles';

const RIBBONS: Record<RibbonStyle, { spikes: Spike[]; look: RibbonLook }> = {
  thorns: { spikes: THORNS, look: { mode: 0, bodyA: 0.55, edgeA: 0.5, period: 5.5 } },
  scythes: { spikes: SCYTHES, look: { mode: 0, bodyA: 0.5, edgeA: 0.45, period: 6 } },
  needles: {
    spikes: NEEDLES,
    look: { mode: 1, slide: 0.14, bodyA: 0.45, edgeA: 0.42, period: 3.4 },
  },
};

const Ribbons = ({
  floor,
  mated,
  strength,
  style,
}: {
  floor: Vec3;
  mated: boolean;
  strength: number;
  style: RibbonStyle;
}) => {
  const { spikes, look } = RIBBONS[style];
  // Thorns rise and close slowly; needles slide in deliberately
  const life = useLife(mated, strength, 1.1);
  const geometry = useMemo(() => ribbonGeometry(spikes), [spikes]);
  const material = useMemo(() => ribbonMaterial(life, look), [life, look]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  const ring = useRef<Group>(null);
  useFrame(() => {
    const t = life.uTime.value as number;
    // The iron maiden draws tight as it rises
    const close = Math.min(t / 1.8, 1);
    material.uniforms.uClose.value = style === 'thorns' ? 1 - (1 - close) ** 2 : 1;
    // The iron maiden turns very slowly; the scythes sweep round, point first
    if (ring.current && style === 'thorns') ring.current.rotation.y = -t * 0.05;
    if (ring.current && style === 'scythes') ring.current.rotation.y = -t * 0.12;
  });
  return (
    <group ref={ring} position={floor}>
      <mesh
        geometry={geometry}
        material={material}
        renderOrder={LAYER.trace + 0.4}
        raycast={noRaycast}
        frustumCulled={false}
      />
    </group>
  );
};

// --- Obsidian: solid faceted shards ----------------------------------------------------

/** One shard of obsidian: a thin, keen pyramid standing on the glass. */
interface Shard {
  /** Where it stands (floor-relative), and which way its broad faces turn. */
  at: [number, number];
  /** Its blade's direction on the glass (radians). */
  turn: number;
  /** Half its length along the blade, and half its thickness across it. */
  half: number;
  thick: number;
  height: number;
  /** Where its point leans to, relative to its foot [x, z]. */
  lean: [number, number];
  phase: number;
}

/**
 * Flat-shaded triangles (each face its own normal), with barycentric
 * coordinates so the shader can light the ridges running up to the point.
 */
const shardGeometry = (shards: Shard[]) => {
  const pos: number[] = [];
  const nrm: number[] = [];
  const bary: number[] = [];
  const phase: number[] = [];
  const height: number[] = [];
  for (const s of shards) {
    const c = Math.cos(s.turn);
    const n = Math.sin(s.turn);
    const foot = (u: number, v: number): Vec3 => [
      s.at[0] + c * u - n * v,
      -0.004,
      s.at[1] + n * u + c * v,
    ];
    const base = [foot(-s.half, 0), foot(0, -s.thick), foot(s.half, 0), foot(0, s.thick)];
    const apex: Vec3 = [s.at[0] + s.lean[0], s.height, s.at[1] + s.lean[1]];
    for (let k = 0; k < 4; k++) {
      const a = base[k];
      const b = base[(k + 1) % 4];
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [apex[0] - a[0], apex[1] - a[1], apex[2] - a[2]];
      const nx = e1[1] * e2[2] - e1[2] * e2[1];
      const ny = e1[2] * e2[0] - e1[0] * e2[2];
      const nz = e1[0] * e2[1] - e1[1] * e2[0];
      const l = Math.hypot(nx, ny, nz) || 1;
      for (const [p, bc] of [
        [a, [1, 0, 0]],
        [b, [0, 1, 0]],
        [apex, [0, 0, 1]],
      ] as const) {
        pos.push(...p);
        nrm.push(nx / l, ny / l, nz / l);
        bary.push(...bc);
        phase.push(s.phase);
        height.push(s.height);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute('aBary', new BufferAttribute(new Float32Array(bary), 3));
  g.setAttribute('aPhase', new BufferAttribute(new Float32Array(phase), 1));
  g.setAttribute('aHeight', new BufferAttribute(new Float32Array(height), 1));
  g.computeBoundingSphere();
  return g;
};

const obsidianMaterial = (life: Uniforms) =>
  new ShaderMaterial({
    uniforms: {
      ...life,
      uEdge: { value: EDGE },
      uBody: { value: new Color('#060609') },
      uSheen: { value: new Color('#c9d6ff') },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aBary;
      attribute float aPhase;
      attribute float aHeight;
      varying vec3 vBary;
      varying vec3 vNormal;
      varying vec3 vWorld;
      varying float vUp;
      varying float vPhase;
      uniform float uEnter;
      uniform float uSettle;
      void main() {
        // They rise out of the glass, and sink back into it at mate
        vec3 p = position;
        p.y = max(p.y * uEnter * (1.0 - uSettle), -0.004);
        vec4 w = modelMatrix * vec4(p, 1.0);
        vBary = aBary;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vWorld = w.xyz;
        vUp = clamp(position.y / max(aHeight, 1e-3), 0.0, 1.0);
        vPhase = aPhase;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uEdge;
      uniform vec3 uBody;
      uniform vec3 uSheen;
      uniform float uTime;
      uniform float uFlare;
      varying vec3 vBary;
      varying vec3 vNormal;
      varying vec3 vWorld;
      varying float vUp;
      varying float vPhase;
      void main() {
        vec3 n = normalize(vNormal);
        vec3 v = normalize(cameraPosition - vWorld);
        if (dot(n, v) < 0.0) n = -n;
        // Black glass: a dim cool sheen off a light high overhead, a keen
        // fresnel, and the check's red light from the glass below
        // (a glossy band where a face turns toward a light up and to the right
        // of the viewer: the glassy sheen that makes it read as obsidian)
        float spec = pow(max(dot(n, normalize(v + vec3(0.55, 0.25, 0.0))), 0.0), 12.0);
        float fres = pow(1.0 - abs(dot(n, v)), 5.0);
        float low = pow(1.0 - vUp, 3.0);
        // Faces turned down toward the glass catch a little of the plate's red
        float under = 0.5 + 0.5 * max(-n.y, 0.0);
        vec3 col = uBody + uSheen * (0.2 * spec + 0.04 * fres)
          + uEdge * (0.07 * low * under + 0.1 * fres);
        // The ridges running up to its point: red hairlines, a slow glint climbing
        float e = min(vBary.x, vBary.y);
        float fw = max(fwidth(e), 1e-4);
        float ridge = 1.0 - smoothstep(0.0, 1.4 * fw, e);
        float g = exp(-pow((vUp - (fract(uTime / 6.0 + vPhase) * 1.4 - 0.2)) / 0.12, 2.0));
        col = mix(col, uEdge, ridge * min(0.45 + 0.8 * g + 0.8 * uFlare, 1.0) * (0.5 + 0.5 * (1.0 - vUp)));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });

/** A layout of obsidian shards round the king. */
type ObsidianLayout = 'crown' | 'clusters' | 'teeth';

const OBSIDIAN: Record<ObsidianLayout, Shard[]> = {
  // Eight on the points of the crown on the glass, tall and short in turn,
  // leaning out, their blades turned across the ring
  crown: Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4 + (jitter(i, 11) - 0.5) * 0.14;
    const r = CROWN_TIPS - 0.005;
    const tall = i % 2 === 0;
    const out = 0.04 + jitter(i, 12) * 0.05;
    const skew = (jitter(i, 13) - 0.5) * 0.06;
    return {
      at: [r * Math.cos(a), r * Math.sin(a)],
      turn: a + Math.PI / 2 + (jitter(i, 14) - 0.5) * 0.5,
      half: 0.038 + jitter(i, 15) * 0.018,
      thick: 0.01 + jitter(i, 16) * 0.006,
      height: (tall ? 0.4 : 0.24) + jitter(i, 17) * 0.08,
      lean: [out * Math.cos(a) - skew * Math.sin(a), out * Math.sin(a) + skew * Math.cos(a)],
      phase: i / 8,
    };
  }),
  // Four clusters of three on the diagonals, a tall shard and two short ones
  // splaying out from one root, like crystals broken through the glass
  clusters: Array.from({ length: 12 }, (_, i) => {
    const k = Math.floor(i / 3);
    const j = i % 3;
    const a = Math.PI / 4 + (k * Math.PI) / 2 + (j - 1) * 0.22;
    const r = CROWN_TIPS - 0.01 + (j === 1 ? 0 : 0.02);
    const splay = (j - 1) * 0.07;
    const out = 0.05 + jitter(i, 21) * 0.03;
    return {
      at: [r * Math.cos(a), r * Math.sin(a)],
      turn: a + Math.PI / 2 + (jitter(i, 22) - 0.5) * 0.6,
      half: j === 1 ? 0.045 : 0.03,
      thick: j === 1 ? 0.014 : 0.01,
      height: j === 1 ? 0.42 + jitter(i, 23) * 0.06 : 0.2 + jitter(i, 24) * 0.08,
      lean: [out * Math.cos(a) - splay * Math.sin(a), out * Math.sin(a) + splay * Math.cos(a)],
      phase: k / 4 + j * 0.08,
    };
  }),
  // A ring of sixteen low, jagged teeth hugging the crown, points leaning in
  teeth: Array.from({ length: 16 }, (_, i) => {
    const a = (i * Math.PI) / 8 + (jitter(i, 31) - 0.5) * 0.1;
    const r = CROWN_TIPS + 0.005;
    const inward = 0.03 + jitter(i, 32) * 0.03;
    return {
      at: [r * Math.cos(a), r * Math.sin(a)],
      turn: a + Math.PI / 2 + (jitter(i, 33) - 0.5) * 0.3,
      half: 0.04 + jitter(i, 34) * 0.015,
      thick: 0.012,
      height: 0.12 + jitter(i, 35) * 0.1 + (i % 2 === 0 ? 0.05 : 0),
      lean: [-inward * Math.cos(a), -inward * Math.sin(a)],
      phase: i / 16,
    };
  }),
};

const Obsidian = ({
  floor,
  mated,
  strength,
  layout,
}: {
  floor: Vec3;
  mated: boolean;
  strength: number;
  layout: ObsidianLayout;
}) => {
  const life = useLife(mated, strength, 0.8);
  const geometry = useMemo(() => shardGeometry(OBSIDIAN[layout]), [layout]);
  const material = useMemo(() => obsidianMaterial(life), [life]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh
      geometry={geometry}
      material={material}
      position={[floor[0], floor[1], floor[2]]}
      raycast={noRaycast}
    />
  );
};

// --- Cracks on the glass ---------------------------------------------------------------------------------------------

const flatVertex = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const flatCommon = /* glsl */ `
  uniform vec3 uBody;
  uniform vec3 uEdge;
  uniform float uTime;
  uniform float uEnter;
  uniform float uSettle;
  uniform float uFlare;
  varying vec2 vP;
  const float TAU = 6.2831853;
  float stroke(float d, float w) {
    float fw = max(fwidth(d), 1e-5);
    float ww = max(w, fw * 0.7);
    return (1.0 - smoothstep(ww - fw, ww + fw, abs(d))) * min(w / ww, 1.0);
  }
  float fillOf(float d) {
    float fw = max(fwidth(d), 1e-5);
    return 1.0 - smoothstep(-fw, fw, d);
  }
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }`;

// Cracks: jagged fractures in the glass running out from under the crown,
// each a dark seam with a hairline of red light in it, growing out as check
// arrives, a slow gleam travelling out along them
const crackFragment = /* glsl */ `
  ${flatCommon}
  // One jagged fracture from origin along angle, len long, shown out to
  // reveal of its length: straight runs between kinks, wandering out
  void crack(vec2 p, vec2 origin, float angle, float len, float seed, float reveal, float lead,
      inout float dark, inout float light) {
    vec2 dir = vec2(cos(angle), sin(angle));
    vec2 q = p - origin;
    float along = dot(q, dir);
    if (along < 0.0 || along > len * reveal) return;
    float lat = dot(q, vec2(-dir.y, dir.x));
    float seg = along / len * 5.0;
    float s0 = floor(seg);
    float o0 = (hash(vec2(seed, s0)) - 0.5) * 0.07 * min(s0, 1.0);
    float o1 = (hash(vec2(seed, s0 + 1.0)) - 0.5) * 0.07;
    float off = mix(o0, o1, fract(seg));
    float slope = (o1 - o0) * 5.0 / len;
    float d = abs(lat - off) / sqrt(1.0 + slope * slope);
    float taper = 1.0 - along / len;
    float start = smoothstep(0.0, 0.05, along + lead);
    dark = max(dark, stroke(d, 0.01 + 0.01 * taper) * start);
    float g = exp(-pow((along / len - fract(uTime / 5.5 + hash(vec2(seed, 9.0)))) / 0.1, 2.0));
    light = max(light, stroke(d, 0.0026 + 0.0042 * taper) * start * (0.45 + 0.5 * taper + 0.8 * g));
  }
  const int CRACKS = 9;
  void main() {
    float dark = 0.0;
    float light = 0.0;
    for (int i = 0; i < CRACKS; i++) {
      float fi = float(i);
      float a = (fi + 0.6 * (hash(vec2(fi, 1.0)) - 0.5)) * TAU / float(CRACKS);
      float len = 0.22 + 0.08 * hash(vec2(fi, 2.0));
      vec2 dir = vec2(cos(a), sin(a));
      crack(vP, dir * 0.15, a, len, fi, uEnter, 0.0, dark, light);
      // A shorter branch splitting off partway out
      float at = len * (0.35 + 0.2 * hash(vec2(fi, 5.0)));
      float turn = (hash(vec2(fi, 6.0)) < 0.5 ? -1.0 : 1.0) * (0.45 + 0.3 * hash(vec2(fi, 7.0)));
      float grown = clamp((uEnter * len - at) / (len - at), 0.0, 1.0);
      crack(vP, dir * (0.15 + at), a + turn, len * 0.4, fi + 20.0, grown, 0.05, dark, light);
    }
    vec3 col = mix(uBody, uEdge, min(light * 1.3, 1.0));
    float a = max(dark * 0.55, min(light, 1.0) * 0.9) * (1.0 + 1.2 * uFlare);
    // Within the king's own square, clear of the squares round him
    a *= 1.0 - smoothstep(0.4, 0.46, length(vP));
    a *= (1.0 - uSettle);
    if (a < 0.004) discard;
    gl_FragColor = vec4(col, min(a, 1.0));
    #include <colorspace_fragment>
  }`;

const flatMaterial = (life: Uniforms, fragmentShader: string, extra: Uniforms = {}) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: { ...life, uBody: { value: BODY }, uEdge: { value: EDGE }, ...extra },
    vertexShader: flatVertex,
    fragmentShader,
  });

const planes = new Map<number, PlaneGeometry>();
const planeOf = (size: number) => {
  let g = planes.get(size);
  if (!g) {
    g = new PlaneGeometry(size, size).rotateX(-Math.PI / 2);
    planes.set(size, g);
  }
  return g;
};

const Cracks = ({ floor, mated, strength }: { floor: Vec3; mated: boolean; strength: number }) => {
  const life = useLife(mated, strength, 1.3);
  const material = useMemo(() => flatMaterial(life, crackFragment), [life]);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh
      geometry={planeOf(1)}
      material={material}
      position={[floor[0], floor[1] + 0.011, floor[2]]}
      // Under the crown on the glass, over the platform
      renderOrder={LAYER.marker + 0.15}
      raycast={noRaycast}
    />
  );
};

/** The blades round a king in check, in the chosen style. */
export const Blades = ({
  floor,
  mated,
  strength,
  style,
}: {
  floor: Vec3;
  mated: boolean;
  strength: number;
  style: BladeStyle;
}) => {
  switch (style) {
    case 'cracks':
      return <Cracks floor={floor} mated={mated} strength={strength} />;
    case 'shards':
      return <Obsidian floor={floor} mated={mated} strength={strength} layout="crown" />;
    case 'clusters':
      return <Obsidian floor={floor} mated={mated} strength={strength} layout="clusters" />;
    case 'teeth':
      return <Obsidian floor={floor} mated={mated} strength={strength} layout="teeth" />;
    default:
      return <Ribbons key={style} floor={floor} mated={mated} strength={strength} style={style} />;
  }
};
