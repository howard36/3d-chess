import { useMemo } from 'react';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, ShaderMaterial } from 'three';
import { PROFILES } from '../pieces';
import { noRaycast } from '../noRaycast';
import { GRID_LINES } from './gridLines';
import { SHADE_AT_VERTEX, shadeUniforms } from './mask';
import { BOARD_DETAIL, GROUND_Y } from './palette';
import { useDisposeOnUnmount } from './dispose';
import {
  GARDEN,
  gardenBoost,
  gardenDim,
  gardenTurn,
  gardenWhole,
  SCALE,
  SQUARE,
  WHOLE_SLOTS,
} from './stage';

// The light each colossal sculpture throws on the stone round its foot. A
// disc lying on the ground, round in the world, so the camera sees it
// foreshortened as it sees the board: no screen-facing oval. Its light is a
// broad, even bell with no hot centre, a little brighter in a soft band just
// past the base ring (the ring lighting the stone) and fading to nothing
// over about a base's width and a half; the board's lines a little brighter
// where it lies on them. Faint and cool, the tubes' own white; dimmed with
// the sculptures (the lobby), barely brighter at mate, turned for Black, and
// gone with a sculpture the camera stands behind (gardenWhole). On the
// floor, so it has no reflection.
//
// All twelve discs are one mesh, one draw. The tower's shade (a loop over
// its outline's edges) is worked out per vertex, the mesh fine enough for
// it; the light's fall per pixel from the point's distance to the axis
// (exact between vertices), a few operations, cheaper in software than the
// rings of vertices it would take to draw it as smoothly.

/** How far out the glow reaches, in base radii (the base ring is at 1). */
export const GLOW_REACH = 4;
/** Its soft band just past the base ring: where, how wide, how much brighter. */
const BAND = { at: 1.12, width: 0.32, lift: 0.18 };
/** The light under the base as a share of the band's edge. */
const GLOW_CORE = 0.8;
/** Its brightness at the brightest (linear light, before the sculptures' brightness). */
const INTENSITY = 0.008;
/** The board's lines' share of light added where the glow lies on them, at its brightest. */
const LIFT = 0.1;
/** How much brighter it grows at mate (gardenBoost), as a share of the boost. */
const BOOST = 0.25;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** The glow's light at u base radii from the axis, before normalising. */
const rawGlow = (u: number) => {
  const inner = GLOW_CORE + (1 - GLOW_CORE) * smoothstep(0, 1.05, u);
  const s = 1 - smoothstep(1, GLOW_REACH, u);
  const band = BAND.lift * Math.exp(-(((u - BAND.at) / BAND.width) ** 2));
  return (inner + band) * s * s;
};

/** Its brightest (over u from 0 to the reach). */
const PEAK = (() => {
  let m = 0;
  for (let u = 0; u <= GLOW_REACH; u += 0.001) m = Math.max(m, rawGlow(u));
  return m;
})();

/** The glow's light, 0–1, at u base radii from a sculpture's axis (the shader's glow()). */
export const glowProfile = (u: number) => rawGlow(u) / PEAK;

const f = (x: number) => (Number.isInteger(x) ? x.toFixed(1) : String(+x.toPrecision(6)));

/** GLSL: `float glow(float u)`, glowProfile. */
const GLOW_GLSL = /* glsl */ `
  float glow(float u) {
    float inner = ${f(GLOW_CORE)} + ${f(1 - GLOW_CORE)} * smoothstep(0.0, 1.05, u);
    float s = 1.0 - smoothstep(1.0, ${f(GLOW_REACH)}, u);
    float b = (u - ${f(BAND.at)}) / ${f(BAND.width)};
    float band = ${f(BAND.lift)} * exp(-b * b);
    return (inner + band) * s * s * ${f(1 / PEAK)};
  }`;

/** Rings of the disc's mesh, as shares of its radius (for the shade per vertex), and its segments. */
const RINGS = [0.3, 0.55, 0.78, 1];
const SEGMENTS = 24;

/** The base's radius of each sculpture (world units). */
export const baseRadius = (i: number) => PROFILES.radius[GARDEN[i].type] * SCALE;

/**
 * Every sculpture's disc: a fan round its axis out to GLOW_REACH base
 * radii, each vertex its point about the axis (`position`, world units,
 * lying flat), its sculpture's foot (`aAnchor`), base radius (`aBase`) and
 * slot (`aSculpt`).
 */
export const glowGeometry = (): BufferGeometry => {
  const position: number[] = [];
  const anchor: number[] = [];
  const base: number[] = [];
  const sculpt: number[] = [];
  const index: number[] = [];
  GARDEN.forEach(({ at }, i) => {
    const rb = baseRadius(i);
    const reach = rb * GLOW_REACH;
    const first = position.length / 3;
    const push = (x: number, z: number) => {
      position.push(x, 0, z);
      anchor.push(...at);
      base.push(rb);
      sculpt.push(i);
    };
    push(0, 0);
    for (const ring of RINGS)
      for (let k = 0; k < SEGMENTS; k++) {
        const a = (k / SEGMENTS) * Math.PI * 2;
        push(Math.cos(a) * reach * ring, -Math.sin(a) * reach * ring);
      }
    const at0 = (r: number, k: number) => first + 1 + r * SEGMENTS + (k % SEGMENTS);
    for (let k = 0; k < SEGMENTS; k++) index.push(first, at0(0, k), at0(0, k + 1));
    for (let r = 0; r + 1 < RINGS.length; r++)
      for (let k = 0; k < SEGMENTS; k++) {
        const [a, b, c, d] = [at0(r, k), at0(r + 1, k), at0(r, k + 1), at0(r + 1, k + 1)];
        index.push(a, b, c, c, b, d);
      }
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  g.setAttribute('aAnchor', new BufferAttribute(new Float32Array(anchor), 3));
  g.setAttribute('aBase', new BufferAttribute(new Float32Array(base), 1));
  g.setAttribute('aSculpt', new BufferAttribute(new Float32Array(sculpt), 1));
  g.setIndex(index);
  return g;
};

/** The glow's material (added onto the ground, in the opaque list: backdropCache.tsx). */
export const glowMaterial = () =>
  new ShaderMaterial({
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uColor: { value: new Color(BOARD_DETAIL.glow) },
      uBoost: gardenBoost,
      uDim: gardenDim,
      ...shadeUniforms(),
      uTurn: gardenTurn,
      uWhole: gardenWhole,
      uSquare: { value: SQUARE },
    },
    vertexShader: /* glsl */ `
      uniform float uTurn;
      uniform float uDim;
      uniform float uBoost;
      uniform float uWhole[${WHOLE_SLOTS}];
      attribute vec3 aAnchor;
      attribute float aBase;
      attribute float aSculpt;
      varying vec2 vU;
      varying vec2 vBoard;
      varying float vLit;
      ${SHADE_AT_VERTEX}
      void main() {
        // Turned about for Black, as the board is (the disc is round)
        vec3 p = vec3(aAnchor.x * uTurn, ${f(GROUND_Y)} + 0.002, aAnchor.z * uTurn) + position;
        vU = position.xz / aBase;
        vBoard = p.xz * uTurn;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        vLit = uWhole[int(aSculpt + 0.5)] * uDim * (1.0 + ${f(BOOST)} * uBoost)
          * (1.0 - shadeOfClip(gl_Position));
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uSquare;
      varying vec2 vU;
      varying vec2 vBoard;
      varying float vLit;
      ${GRID_LINES}
      ${GLOW_GLSL}
      void main() {
        float g = glow(length(vU)) * vLit;
        // The board's lines caught in it (the board's own, on the board only)
        vec2 uv = vBoard / uSquare + 4.0;
        vec2 l = gridLines(uv, 0.006);
        l *= vec2(step(-0.01, uv.y) * step(uv.y, 8.01), step(-0.01, uv.x) * step(uv.x, 8.01));
        float a = g * (${f(INTENSITY)} + ${f(LIFT)} * max(l.x, l.y));
        if (a < 0.0002) discard;
        gl_FragColor = vec4(uColor * a, 1.0);
        #include <colorspace_fragment>
      }`,
  });

/** The glow under every sculpture. */
export const SculptureGlow = () => {
  const parts = useMemo(() => ({ geometry: glowGeometry(), material: glowMaterial() }), []);
  useDisposeOnUnmount(parts);
  return (
    <mesh
      name="sculpture-glow"
      geometry={parts.geometry}
      material={parts.material}
      renderOrder={-860}
      frustumCulled={false}
      raycast={noRaycast}
    />
  );
};
