import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import { GRID_SIZE } from '../layout';
import { useLevelFocus } from './focus';
import { LAYER } from './layers';
import { noRaycast } from '../noRaycast';
import { FRAME, LEVEL_COLORS, MARGIN } from './palette';
import { useEnvSetting } from './settings-env';

// The levels: five sheets of clear glass, each edged by one thin square of
// light in its level's colour. On the glass, the 3D chess checker (dark
// where x + y + z is even, so a bishop keeps to its colour through the
// levels): the light squares faintly frosted with the level's light, the
// dark squares left clear with a breath of smoke. Crisp hairlines of the
// level's colour divide the 25 squares, running whole from edge to edge and
// joined where they cross by taking the brighter of the two (never summed),
// so no crossing ever shows a dot. The checker holds from any side. Looking
// straight down, where the five would average into a grey plaid, the lead
// level (the one attended to, else the top one) keeps its checker whole and
// the others ease back part of the way, still clearly there, their inner
// hairlines thinner; each level's frost leans toward its own hue, so the
// nested checkers part by colour. The level the player is attending to
// (pointed at, or holding the selected piece) brightens its lines and edge;
// the others step back a little.

const vertexShader = /* glsl */ `
  uniform float uHalf;
  uniform float uPitch;
  varying vec2 vCell;
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    // Squares from the board's corner: lines fall on whole numbers, 0 to 5
    vCell = (w.xz * vec2(1.0, -1.0) + uHalf) / uPitch;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uFrost;
  uniform vec3 uSmoke;
  uniform float uCells;
  uniform float uLevel;
  uniform float uReach;
  uniform float uFill;
  uniform float uFrostA;
  uniform float uSmokeA;
  uniform float uLine;
  uniform float uWidth;
  uniform float uFocus;
  uniform float uDim;
  uniform float uLead;
  varying vec2 vCell;
  varying vec3 vWorld;

  vec4 over(vec4 dst, vec3 c, float a) {
    return vec4(c * a + dst.rgb * (1.0 - a), a + dst.a * (1.0 - a));
  }

  void main() {
    vec2 uv = vCell;
    vec3 v = normalize(cameraPosition - vWorld);
    // 1 looking straight down the stack, 0 from the side
    float above = smoothstep(0.8, 0.97, abs(v.y));
    float grazing = pow(1.0 - abs(v.y), 2.0);
    // The glass runs out under the edge's square of light, and so does the
    // checker: the outer squares reach the border whole, never stopping
    // short of it in a thin dark seam (the glass used to end at the outer
    // squares, a margin inside the edge)
    float inside = step(-uFill, uv.x) * step(uv.x, uCells + uFill)
      * step(-uFill, uv.y) * step(uv.y, uCells + uFill);

    // The checker: dark where x + y + z is even, as in 3D chess.
    // Every level keeps it from any side. Looking straight down all five
    // ease back a little (so pieces three levels down keep their own
    // colour), the lead level least, so one clear 5 x 5 reads through the
    // rest; each level's frost leans toward its own hue there
    vec2 sq = floor(clamp(uv, 0.0, uCells - 0.001));
    float light = mod(sq.x + sq.y + uLevel, 2.0);
    float back = above * (1.0 - uLead);
    float keep = (1.0 - mix(0.15, 0.3, back) * above) * mix(1.0, 0.5, back) * (1.0 + 0.35 * grazing);
    // The level attended to (pointed at, or holding the selection) a little more
    float focus = (1.0 + 0.25 * uFocus) * (1.0 - 0.15 * uDim);
    vec3 frost = mix(uFrost, uColor, 0.5 * above);
    vec4 c = vec4(0.0);
    c = over(c, uSmoke, (1.0 - light) * uSmokeA * inside * keep);
    c = over(c, frost, light * uFrostA * inside * keep * focus);

    // Hairlines between the squares, coverage-correct at any distance (Ben
    // Golus's pristine grid), running out to the edge of the light
    vec4 dd = vec4(dFdx(uv), dFdy(uv));
    vec2 deriv = max(vec2(length(dd.xz), length(dd.yw)), vec2(1e-6));
    vec2 target = vec2(uWidth);
    vec2 draw = clamp(target, deriv, vec2(0.5));
    vec2 aa = deriv * 1.5;
    vec2 g = 1.0 - abs(fract(uv) * 2.0 - 1.0);
    vec2 lines = smoothstep(draw + aa, draw - aa, g);
    lines *= clamp(target / draw, 0.0, 1.0);
    lines = mix(lines, target, clamp(deriv * 2.0 - 1.0, 0.0, 1.0));
    vec2 nearest = floor(uv + 0.5);
    vec2 innerLine = step(0.5, nearest) * step(nearest, vec2(uCells - 0.5));
    vec2 span = vec2(
      step(-uReach, uv.y) * step(uv.y, uCells + uReach),
      step(-uReach, uv.x) * step(uv.x, uCells + uReach)
    );
    lines *= innerLine * span;
    // The brighter of the two where they cross: an even line, never a dot
    float line = max(lines.x, lines.y) * uLine * (1.0 - 0.15 * above) * (1.0 - 0.5 * back);
    line *= (1.0 + 0.4 * uFocus) * (1.0 - 0.2 * uDim);
    c = over(c, uColor, min(line, 1.0));

    if (c.a < 0.002) discard;
    gl_FragColor = vec4(c.rgb / c.a, c.a);
    #include <colorspace_fragment>
  }`;

const WHITE = new Color('#ffffff');
const FROST = 0.12;
const SMOKE = 0.06;
const LINE = 0.5;
const EDGE = 0.8;
const EDGE_WIDTH = 0.022;
/** The edge's depth below the glass at "Border height" 1.0×. */
const EDGE_HEIGHT = 0.03;
/** How far the glass runs in under the edge's light: half its width (at 1.0×). */
const FILL = EDGE_WIDTH / 2;

type V3 = [number, number, number];

/** The corners' radius on the ring's inner edge, as a share of its width. */
const CORNER = 0.5;
/** Segments round each corner. */
const CORNER_STEPS = 6;
const QUADRANTS: [number, number][] = [
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

/**
 * A square of half-side `half` with its corners rounded to radius `r`, as
 * points (x, z) round it; squares drawn with the same `half - r` share their
 * corners' centres, so their points pair up across an even band.
 */
const roundedSquare = (half: number, r: number): [number, number][] =>
  QUADRANTS.flatMap(([sx, sz], k) =>
    Array.from({ length: CORNER_STEPS + 1 }, (_, j): [number, number] => {
      const a = ((k + j / CORNER_STEPS) * Math.PI) / 2;
      return [sx * (half - r) + r * Math.cos(a), sz * (half - r) + r * Math.sin(a)];
    }),
  );

/**
 * One level's square of light as a single solid: a ring from the glass's
 * edge (`inner`) out `width`, hanging `height` below the glass, its corners
 * very slightly rounded (inner and outer edges on one centre, so the band
 * keeps its width round the bend) and nothing inside it, so no two faces
 * ever lie over each other and the ring is equally bright all the way round,
 * corners included (four overlapping bars drew their corners twice). Each
 * vertex carries its light's alpha: full along the glass, `low` along the
 * rim's lower edge. The glass it frames stays square: its corner lies
 * inside the rounded band.
 */
const rimGeometry = (inner: number, width: number, height: number, low: number) => {
  const r = CORNER * width;
  const ins = roundedSquare(inner, r);
  const outs = roundedSquare(inner + width, r + width);
  const pos: number[] = [];
  const rgba: number[] = [];
  // A quad facing `normal`, wound to face it
  const quad = (a: V3, b: V3, c: V3, d: V3, normal: V3) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const flip = n[0] * normal[0] + n[1] * normal[1] + n[2] * normal[2] < 0;
    const corners = flip ? [a, d, c, b] : [a, b, c, d];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const p = corners[i];
      pos.push(...p);
      rgba.push(1, 1, 1, p[1] < -height / 2 ? low : 1);
    }
  };
  // Face by face, the top first and the underside next, then the sides, so
  // with the ring writing depth a side seen through the top (at the rounded
  // inner corner) is never drawn over it a second time
  const n = ins.length;
  const top = 0;
  const bottom = -height;
  for (const face of ['top', 'bottom', 'outer', 'inner'] as const) {
    for (let j = 0; j < n; j++) {
      const [ix0, iz0] = ins[j];
      const [ix1, iz1] = ins[(j + 1) % n];
      const [ox0, oz0] = outs[j];
      const [ox1, oz1] = outs[(j + 1) % n];
      const out: V3 = [(ox0 + ox1) / 2, 0, (oz0 + oz1) / 2];
      if (face === 'top') {
        quad([ix0, top, iz0], [ix1, top, iz1], [ox1, top, oz1], [ox0, top, oz0], [0, 1, 0]);
      } else if (face === 'bottom') {
        quad(
          [ix0, bottom, iz0],
          [ix1, bottom, iz1],
          [ox1, bottom, oz1],
          [ox0, bottom, oz0],
          [0, -1, 0],
        );
      } else if (face === 'outer') {
        quad([ox0, top, oz0], [ox1, top, oz1], [ox1, bottom, oz1], [ox0, bottom, oz0], out);
      } else {
        quad(
          [ix0, top, iz0],
          [ix1, top, iz1],
          [ix1, bottom, iz1],
          [ix0, bottom, iz0],
          [-out[0], 0, -out[2]],
        );
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(rgba), 4));
  return g;
};

/** The five levels (see above). Decorative: nothing here takes a click. */
export const Levels = ({ focusLevel }: { focusLevel: number | null }) => {
  const reach = FRAME.half + MARGIN;
  // The player's border width, height and brightness (settings-env.ts): the
  // square of light widens outward from the glass's edge, never into the
  // squares, and deepens downward from it into a rim, never rising in front
  // of the pieces standing on the edge squares
  const borderWidth = useEnvSetting<number>('env.borderWidth');
  const borderHeight = useEnvSetting<number>('env.borderHeight');
  const borderBright = useEnvSetting<number>('env.borderBrightness');
  const plane = useMemo(
    // Out to the middle of the edge's light, so no seam can open between them
    () => {
      const fill = FILL * borderWidth;
      return new PlaneGeometry((reach + fill) * 2, (reach + fill) * 2).rotateX(-Math.PI / 2);
    },
    [reach, borderWidth],
  );
  const edge = useMemo(() => {
    // A deep rim is a band of light, full at the glass and fading toward its
    // lower edge (at the old default depth it is one even line, as it was)
    const k = Math.min(Math.max((borderHeight - 1) / 3, 0), 1);
    const low = 1 - 0.6 * k * k * (3 - 2 * k);
    return rimGeometry(reach, EDGE_WIDTH * borderWidth, EDGE_HEIGHT * borderHeight, low);
  }, [reach, borderWidth, borderHeight]);
  useEffect(() => () => plane.dispose(), [plane]);
  useEffect(() => () => edge.dispose(), [edge]);
  const materials = useMemo(
    () =>
      LEVEL_COLORS.map((hex, z) => {
        const tint = new Color(hex);
        return {
          glass: new ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            uniforms: {
              uColor: { value: tint.clone() },
              // The frost: the level's light, mostly white
              uFrost: { value: tint.clone().lerp(new Color('#ffffff'), 0.55) },
              uSmoke: { value: new Color('#000000') },
              uCells: { value: GRID_SIZE },
              uLevel: { value: z },
              uReach: { value: MARGIN / FRAME.pitch },
              uFill: { value: (MARGIN + FILL) / FRAME.pitch },
              uFrostA: { value: FROST },
              uSmokeA: { value: SMOKE },
              uLine: { value: LINE },
              uWidth: { value: 0.011 },
              uFocus: { value: 0 },
              uDim: { value: 0 },
              uLead: { value: z === LEVEL_COLORS.length - 1 ? 1 : 0 },
              uHalf: { value: FRAME.half },
              uPitch: { value: FRAME.pitch },
            },
            vertexShader,
            fragmentShader,
          }),
          // The edge: one thin square of the level's light, lifted toward white
          edgeColor: tint.clone().lerp(new Color('#ffffff'), 0.3),
          edge: new MeshBasicMaterial({
            color: tint.clone().lerp(new Color('#ffffff'), 0.3),
            vertexColors: true,
            transparent: true,
            opacity: EDGE,
            // Its own faces never stack (rimGeometry's order); it is drawn
            // after the glass, so the glass is never hidden by it
            depthWrite: true,
            toneMapped: false,
            fog: false,
          }),
        };
      }),
    [],
  );
  useEffect(
    () => () =>
      materials.forEach((m) => {
        m.glass.dispose();
        m.edge.dispose();
      }),
    [materials],
  );
  // The player's checker and line strengths (settings-env.ts)
  const checker = useEnvSetting<number>('env.checker');
  const lines = useEnvSetting<number>('env.gridLines');
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    for (const m of materials) {
      m.glass.uniforms.uFrostA.value = FROST * checker;
      m.glass.uniforms.uSmokeA.value = SMOKE * checker;
      m.glass.uniforms.uLine.value = LINE * lines;
      // Under the inner half of the edge's light, and inside its rounded
      // corners: the glass's square corner never shows past them
      m.glass.uniforms.uFill.value = (MARGIN + FILL * borderWidth) / FRAME.pitch;
    }
    invalidate();
  }, [materials, checker, lines, borderWidth, invalidate]);
  // Each edge's light: its focus (below) times the player's brightness. Up to
  // full opacity the light is the edge's opacity; past it, its colour, which
  // keeps its hue at full strength and then pales a little toward white, so
  // a focused edge still stands out, in its own colour, at any brightness
  const edgeLight = useRef(LEVEL_COLORS.map(() => EDGE));
  const bright = useRef(borderBright);
  bright.current = borderBright;
  const applyEdge = (z: number) => {
    const m = materials[z];
    const light = edgeLight.current[z] * bright.current;
    m.edge.opacity = Math.min(light, 1);
    const c = m.edge.color.copy(m.edgeColor).multiplyScalar(Math.max(light, 1));
    const peak = Math.max(c.r, c.g, c.b);
    if (peak > 1) {
      c.multiplyScalar(1 / peak).lerp(WHITE, Math.min((peak - 1) * 0.35, 0.4));
    }
  };
  useEffect(() => {
    materials.forEach((_, z) => applyEdge(z));
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyEdge reads refs
  }, [materials, borderBright, invalidate]);
  useLevelFocus(
    focusLevel,
    (weights, any) => {
      weights.forEach((w, z) => {
        const m = materials[z];
        if (!m) return;
        const dim = any * (1 - w);
        m.glass.uniforms.uFocus.value = w;
        m.glass.uniforms.uDim.value = dim;
        // The lead from above: the level attended to, else the top one
        const top = z === weights.length - 1 ? 1 : 0;
        m.glass.uniforms.uLead.value = Math.min(1, w + (1 - any) * top);
        edgeLight.current[z] = EDGE * (1 - 0.35 * dim) + (1 - EDGE) * w;
        applyEdge(z);
      });
    },
    { ms: 160, key: materials },
  );

  return (
    <group name="levels">
      {FRAME.levelY.map((y, z) => (
        <group key={z} position={[0, y, 0]}>
          <mesh
            geometry={plane}
            material={materials[z].glass}
            position={[0, -0.002, 0]}
            renderOrder={LAYER.plate}
            raycast={noRaycast}
          />
          <mesh
            geometry={edge}
            material={materials[z].edge}
            renderOrder={LAYER.plateEdge}
            raycast={noRaycast}
          />
        </group>
      ))}
    </group>
  );
};
