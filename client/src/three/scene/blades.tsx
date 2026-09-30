import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Color, ShaderMaterial } from 'three';
import type { IUniform } from 'three';
import { prefersReducedMotion } from '../motion';
import { noRaycast } from '../noRaycast';
import type { Vec3 } from '../types';
import { clamp01, easeOutCubic } from './ease';
import { PALETTE, PIECE_SCALE, RING_RADIUS } from './palette';
import { useRetireOnUnmount } from './programs';

// The blades round a king in check: threat, not glare. Four clusters of
// obsidian, solid black glass with a cool sheen, broken through the glass on
// the diagonals: a tall shard and two short ones splaying from each, with
// keen red hairlines up their ridges and a slow glint climbing them one after
// another. They are drawn as dark shapes with keen red edges, moving slowly
// and deliberately, so the king, red from cross to foot and lit from below,
// stays the brightest thing there. They come in with the check's strike (as
// strongly as the check pulse), and at mate they sink back into the glass as
// the king falls.
//
// They keep within the king's own square, clear of the squares his escape
// moves are marked on.

const EDGE = new Color(PALETTE.check);
/** Where the points of the crown on the glass reach (markers.tsx, Check). */
const CROWN_TIPS = RING_RADIUS * PIECE_SCALE + 0.01 + 0.085;
/** How long the check's strike lasts (markers.tsx). */
const STRIKE_S = 0.95;
/** How long the blades take to rise out of the glass. */
const ENTER_S = 0.8;
/** How long the blades take to settle at mate. */
const SETTLE_S = 0.7;

type Uniforms = Record<string, IUniform>;

/**
 * The clock every style runs on: time since the check arrived (held still
 * while settled or under reduced motion), how far they have come in (eased
 * over ENTER_S), the strike's flare, and how far they have settled at
 * mate. Requests frames while anything moves.
 */
const useLife = (mated: boolean, strength: number) => {
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
    const k = still ? 1 : Math.min(since.current / ENTER_S, 1);
    u.uEnter.value = easeOutCubic(k);
    u.uFlare.value = still ? 0 : strength * Math.max(0, 1 - since.current / STRIKE_S) ** 2;
    const settle = clamp01(u.uSettle.value + ((mated ? 1 : -1) * dt) / SETTLE_S);
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

export const obsidianMaterial = (life: Uniforms) =>
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
      uniform float uPx;
      varying vec3 vBary;
      varying vec3 vNormal;
      varying vec3 vWorld;
      varying float vUp;
      varying float vPhase;
      void main() {
        vec3 n = normalize(vNormal);
        vec3 v = normalize(cameraPosition - vWorld);
        if (dot(n, v) < 0.0) n = -n;
        // How many pixels across a shard is on screen: small, at play size,
        // its red gives way to the black of its glass, but for a keen glint
        float across = 0.08 / max(uPx * length(cameraPosition - vWorld), 1e-5);
        float detail = smoothstep(5.0, 16.0, across);
        // Black glass: a dim cool sheen off a light high overhead, a keen
        // fresnel, and the check's red light from the glass below
        // (a glossy band where a face turns toward a light up and to the right
        // of the viewer: the glassy sheen that makes it read as obsidian)
        float spec = pow(max(dot(n, normalize(v + vec3(0.55, 0.25, 0.0))), 0.0), 12.0);
        float fres = pow(1.0 - abs(dot(n, v)), 5.0);
        float low = pow(1.0 - vUp, 3.0);
        // Faces turned down toward the glass catch a little of the plate's red
        float under = 0.5 + 0.5 * max(-n.y, 0.0);
        vec3 col = uBody + uSheen * (0.2 * spec + 0.04 * fres) * mix(0.3, 1.0, detail)
          + uEdge * (0.07 * low * under + 0.1 * fres) * mix(0.25, 1.0, detail);
        // The ridges running up to its point: red hairlines, a slow glint climbing
        float e = min(vBary.x, vBary.y);
        float fw = max(fwidth(e), 1e-4);
        float ridge = 1.0 - smoothstep(0.0, 1.4 * fw, e);
        float g = exp(-pow((vUp - (fract(uTime / 6.0 + vPhase) * 1.4 - 0.2)) / 0.12, 2.0));
        float keen = mix(0.03 + 0.3 * g, min(0.45 + 0.8 * g, 1.0), detail);
        col = mix(col, uEdge, ridge * min(keen + 0.8 * uFlare, 1.0) * (0.5 + 0.5 * (1.0 - vUp)));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });

/** Deterministic jitter, 0–1. */
const jitter = (i: number, salt: number) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// Four clusters of three on the diagonals, a tall shard and two short ones
// splaying out from one root, like crystals broken through the glass
const CLUSTERS: Shard[] = Array.from({ length: 12 }, (_, i) => {
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
});

/** The blades round a king in check. */
export const Blades = ({
  floor,
  mated,
  strength,
}: {
  floor: Vec3;
  mated: boolean;
  strength: number;
}) => {
  const life = useLife(mated, strength);
  const geometry = useMemo(() => shardGeometry(CLUSTERS), []);
  const material = useMemo(() => obsidianMaterial(life), [life]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useRetireOnUnmount(material);
  return (
    <mesh
      geometry={geometry}
      material={material}
      position={[floor[0], floor[1], floor[2]]}
      raycast={noRaycast}
    />
  );
};
