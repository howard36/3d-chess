import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useFrame } from '@react-three/fiber';
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
import { LEVEL_FOCUS_MS, useLevelFocus } from './focus';
import { getStepBack, subscribeStepBack } from '../../tuning';
import { LAYER } from './layers';
import { noRaycast } from '../noRaycast';
import { GRID_LINES } from './gridLines';
import { FRAME, LEVEL_COLORS, MARGIN } from './palette';
import { useIntro } from '../intro/clock';
import { levelBuild } from '../intro/timeline';

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
// nested checkers part by colour. The level the pointer is on brightens its
// lines and edge; the others step back well behind it (the share of their light in getStepBack, tuning.ts), glass,
// lines and edge.

// How a level builds itself in the game's entrance (intro/timeline.ts: its
// uBuild runs from 0 to 1): its edge first, growing out of its four corners
// along its sides to meet in their middles, then its hairlines running in
// across it, then the glass flooding in from the edge; each drawn as a line
// of light with a white-hot tip, a little brighter than it settles to. At 1
// (the default) a level is simply there: every step of it is skipped.
const EDGE_TO = 0.45;
const LINES_FROM = 0.25;
const LINES_TO = 0.8;
const FILL_FROM = 0.45;

/** GLSL shared by the glass and its edge: `buildPhase(b, from, to)`, b's progress through a part, 0 to 1. */
const BUILD_GLSL = /* glsl */ `
  #define EDGE_TO ${EDGE_TO.toFixed(3)}
  #define LINES_FROM ${LINES_FROM.toFixed(3)}
  #define LINES_TO ${LINES_TO.toFixed(3)}
  #define FILL_FROM ${FILL_FROM.toFixed(3)}
  float buildPhase(float b, float from, float to) {
    return clamp((b - from) / (to - from), 0.0, 1.0);
  }`;

const vertexShader = /* glsl */ `
  uniform float uHalf;
  uniform float uPitch;
  varying vec2 vCell;
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    // Squares from the board's corner: lines fall on whole numbers, 0 to 5
    // (in the glass's own frame, so they turn with it: the lobby's leaving)
    vCell = (position.xz * vec2(1.0, -1.0) + uHalf) / uPitch;
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
  uniform float uStepBack;
  uniform float uLead;
  uniform float uBuild;
  varying vec2 vCell;
  varying vec3 vWorld;
  ${GRID_LINES}
  ${BUILD_GLSL}

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
    // The level pointed at a little more; the others well back
    float attended = 1.0 - uStepBack * uDim;
    float focus = (1.0 + 0.25 * uFocus) * attended;
    vec3 frost = mix(uFrost, uColor, 0.5 * above);
    // Built (the game's entrance): the glass floods in from its edge to its
    // middle behind a faint bright front, once the edge has drawn itself
    float flood = 1.0;
    float floodFront = 0.0;
    if (uBuild < 1.0) {
      float inward = min(min(uv.x, uv.y), min(uCells - uv.x, uCells - uv.y)) / (uCells * 0.5);
      float k = buildPhase(uBuild, FILL_FROM, 1.0) * 1.3 - inward;
      flood = smoothstep(0.0, 0.3, k);
      floodFront = exp(-pow((k - 0.06) / 0.05, 2.0)) * (1.0 - buildPhase(uBuild, 0.85, 1.0));
    }
    vec4 c = vec4(0.0);
    c = over(c, uSmoke, (1.0 - light) * uSmokeA * inside * keep * attended * flood);
    c = over(c, frost, light * uFrostA * inside * keep * focus * flood);
    c = over(c, mix(frost, vec3(1.0), 0.4), 0.09 * floodFront * inside);

    // Hairlines between the squares, running out to the edge of the light
    vec2 lines = gridLines(uv, uWidth);
    vec2 nearest = floor(uv + 0.5);
    vec2 innerLine = step(0.5, nearest) * step(nearest, vec2(uCells - 0.5));
    vec2 span = vec2(
      step(-uReach, uv.y) * step(uv.y, uCells + uReach),
      step(-uReach, uv.x) * step(uv.x, uCells + uReach)
    );
    lines *= innerLine * span;
    // Built: each hairline runs in from both its ends to meet in its middle,
    // the outer lines first, a white-hot tip at its front, and all of them
    // glow a little brighter than they will settle to
    float hot = 0.0;
    float glow = 1.0;
    if (uBuild < 1.0) {
      float k = buildPhase(uBuild, LINES_FROM, LINES_TO);
      // How far along each line from its nearer end, 0 there to 1 at its middle
      vec2 along = vec2(uv.y, uv.x);
      vec2 fromEnd = clamp(min(along + uReach, uCells + uReach - along) / (uCells * 0.5 + uReach), 0.0, 1.0);
      vec2 delay = (1.5 - abs(nearest - uCells * 0.5)) * 0.14;
      vec2 front = clamp((k - delay) / (1.0 - 0.14), 0.0, 1.0);
      front = 1.0 - (1.0 - front) * (1.0 - front);
      front *= 1.02;
      vec2 fw = max(fwidth(fromEnd), vec2(1e-4));
      vec2 drawn = smoothstep(fromEnd - fw, fromEnd + fw, front);
      vec2 tip = exp(-pow((front - fromEnd) / 0.05, vec2(2.0))) * step(front, vec2(1.0)) * step(0.001, front);
      hot = max(lines.x * tip.x, lines.y * tip.y);
      lines *= drawn;
      glow = 1.0 + 0.7 * (1.0 - buildPhase(uBuild, 0.55, 1.0));
    }
    // The brighter of the two where they cross: an even line, never a dot
    float line = max(lines.x, lines.y) * uLine * (1.0 - 0.15 * above) * (1.0 - 0.5 * back);
    line *= (1.0 + 0.4 * uFocus) * attended * glow;
    c = over(c, uColor, min(line, 1.0));
    c = over(c, vec3(1.0), min(hot, 1.0) * 0.85);

    if (c.a < 0.002) discard;
    gl_FragColor = vec4(c.rgb / c.a, c.a);
    #include <colorspace_fragment>
  }`;

const WHITE = new Color('#ffffff');
const FROST = 0.108;
const SMOKE = 0.054;
const LINE = 0.5;
const EDGE = 0.8;
/** The edge's brightness: the level attended to reaches past full opacity. */
const EDGE_BRIGHT = 1.1;
/**
 * The square of light widens outward from the glass's edge, never into the
 * squares, and deepens downward from it into a rim, never rising in front of
 * the pieces standing on the edge squares.
 */
const EDGE_WIDTH = 0.0286;
/** The edge's depth below the glass. */
const EDGE_HEIGHT = 0.021;
/** How far the glass runs in under the edge's light: half its width. */
const FILL = EDGE_WIDTH / 2;
/** The glass's half-side out to its edge's light. */
const REACH = FRAME.half + MARGIN;

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
 * corners included (four overlapping bars drew their corners twice). The
 * glass it frames stays square: its corner lies inside the rounded band.
 */
const rimGeometry = (inner: number, width: number, height: number) => {
  const r = CORNER * width;
  const ins = roundedSquare(inner, r);
  const outs = roundedSquare(inner + width, r + width);
  const pos: number[] = [];
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
    }
  };
  // Face by face: the top, the underside and the outer sides (group 0), then
  // the inner sides (group 1), the only faces that can lie behind another
  // face of the same ring on screen (seen through the top, the underside or
  // the near outer side); their material discards those fragments (rimShader)
  const n = ins.length;
  let front = 0;
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
        front = pos.length / 3;
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
  g.addGroup(0, front, 0);
  g.addGroup(front, pos.length / 3 - front, 1);
  return g;
};

/**
 * The ring's shader, over three's basic material: the edge's part of the
 * level's build (uBuild, BUILD_GLSL: the square of light grows out of its four
 * corners, a white-hot tip at each front, to meet in the middle of each side,
 * then settles from a little brighter to its own light), and, for the inner
 * sides (`inner`), the one test that keeps the ring a single layer of light
 * at every angle without writing depth: a fragment of an inner side is
 * dropped when the ray from the camera reaches it through another face of the
 * same ring, the near outer side (entering the ring's outer square between
 * its top and bottom), its top or its underside (crossing their planes within
 * the band). Those are the only faces that can lie over an inner side on
 * screen. `top` is the level's height: the ring's measures in world space are
 * its inner and outer half-sides and its top and bottom, taken in the ring's
 * own frame (turned with it about the tower's axis: the lobby's leaving).
 */
const rimShader = (m: MeshBasicMaterial, top: number, inner: boolean, build: { value: number }) => {
  const shape = {
    uRimInner: { value: REACH },
    uRimOuter: { value: REACH + EDGE_WIDTH },
    uRimTop: { value: top },
    uRimBottom: { value: top - EDGE_HEIGHT },
    uBuild: build,
  };
  m.customProgramCacheKey = () => (inner ? 'rim-inner' : 'rim-caps');
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shape);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRim;\nvarying vec3 vRimCam;')
      .replace(
        '#include <project_vertex>',
        // The point and the camera in the ring's frame: world space turned
        // back by the ring's turn about the vertical (it is only ever moved
        // up the axis, so that is all its matrix holds besides)
        `#include <project_vertex>
        vRim = transformed + modelMatrix[3].xyz;
        vRimCam = transpose(mat3(modelMatrix)) * cameraPosition;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vRim;
        varying vec3 vRimCam;
        uniform float uRimInner;
        uniform float uRimOuter;
        uniform float uRimTop;
        uniform float uRimBottom;
        uniform float uBuild;
        ${BUILD_GLSL}
        // Whether the segment from the camera to p crosses the plane y = h
        // within the band between the inner and outer squares
        bool rimCapHit(vec3 c, vec3 d, float h) {
          if (abs(d.y) < 1e-6) return false;
          float t = (h - c.y) / d.y;
          if (t <= 0.0 || t >= 0.999) return false;
          vec2 q = abs(c.xz + d.xz * t);
          float m = max(q.x, q.y);
          return m > uRimInner && m < uRimOuter;
        }`,
      )
      .replace(
        'void main() {',
        inner
          ? `void main() {
        {
          vec3 c = vRimCam;
          vec3 d = vRim - c;
          // Entering the outer square's column: through the near outer side?
          vec2 sd = vec2(abs(d.x) < 1e-6 ? 1e-6 : d.x, abs(d.z) < 1e-6 ? 1e-6 : d.z);
          vec2 ta = (vec2(-uRimOuter) - c.xz) / sd;
          vec2 tb = (vec2(uRimOuter) - c.xz) / sd;
          vec2 lo = min(ta, tb);
          float tIn = max(lo.x, lo.y);
          if (tIn > 0.0 && tIn < 0.999) {
            float y = c.y + d.y * tIn;
            if (y > uRimBottom && y < uRimTop) discard;
          }
          if (rimCapHit(c, d, uRimTop) || rimCapHit(c, d, uRimBottom)) discard;
        }`
          : 'void main() {',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (uBuild < 1.0) {
          float k = buildPhase(uBuild, 0.0, EDGE_TO);
          k = 1.0 - (1.0 - k) * (1.0 - k);
          // How far along its side from the nearer corner, 0 there to 1 in the middle
          vec2 q = abs(vRim.xz) / uRimInner;
          float s = clamp(1.0 - min(q.x, q.y), 0.0, 1.0);
          float front = k * 1.03;
          float fw = max(fwidth(s), 1e-4);
          float drawn = smoothstep(s - fw, s + fw, front);
          float tip = exp(-pow((front - s) / 0.045, 2.0)) * step(front, 1.0) * step(0.001, front);
          float settle = 1.0 + 0.5 * (1.0 - buildPhase(uBuild, 0.5, 1.0));
          diffuseColor.rgb = mix(diffuseColor.rgb * settle, vec3(1.6), tip * 0.85);
          diffuseColor.a = min(1.0, diffuseColor.a * max(drawn, tip) * (1.0 + 0.4 * tip));
        }`,
      );
  };
};

const ALL_LEVELS: readonly number[] = [0, 1, 2, 3, 4];

/**
 * The five levels (see above), or only those in `levels` (engine z, 0 = A),
 * each at its own height in the tower. Decorative: nothing here takes a
 * click. In the game's entrance each level builds itself (uBuild, from the
 * intro clock); drawn anywhere else, it is simply there.
 */
export const Levels = ({
  focusLevel,
  levels = ALL_LEVELS,
}: {
  focusLevel: number | null;
  levels?: readonly number[];
}) => {
  const plane = useMemo(
    // Out to the middle of the edge's light, so no seam can open between them
    () => new PlaneGeometry((REACH + FILL) * 2, (REACH + FILL) * 2).rotateX(-Math.PI / 2),
    [],
  );
  const edge = useMemo(() => rimGeometry(REACH, EDGE_WIDTH, EDGE_HEIGHT), []);
  useEffect(() => () => plane.dispose(), [plane]);
  useEffect(() => () => edge.dispose(), [edge]);
  // How far the levels the pointer is not on step back (tuning.ts), shared by
  // every level's glass; a change applies the focus again (focusKey)
  const stepBack = useSyncExternalStore(subscribeStepBack, getStepBack);
  const stepBackUniform = useMemo(() => ({ value: getStepBack() }), []);
  stepBackUniform.value = stepBack;
  const materials = useMemo(
    () =>
      LEVEL_COLORS.map((hex, z) => {
        const tint = new Color(hex);
        // How far the level has built itself (1: whole), shared by its glass and edge
        const build = { value: 1 };
        // The edge: one thin square of the level's light, lifted toward white
        const edgeColor = tint.clone().lerp(WHITE, 0.3);
        return {
          glass: new ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            uniforms: {
              uColor: { value: tint.clone() },
              // The frost: the level's light, mostly white
              uFrost: { value: tint.clone().lerp(WHITE, 0.55) },
              uSmoke: { value: new Color('#000000') },
              uCells: { value: GRID_SIZE },
              uLevel: { value: z },
              uReach: { value: MARGIN / FRAME.pitch },
              // Under the inner half of the edge's light, and inside its
              // rounded corners: the glass's square corner never shows past them
              uFill: { value: (MARGIN + FILL) / FRAME.pitch },
              uFrostA: { value: FROST },
              uSmokeA: { value: SMOKE },
              uLine: { value: LINE },
              uWidth: { value: 0.011 },
              uFocus: { value: 0 },
              uDim: { value: 0 },
              uStepBack: stepBackUniform,
              uLead: { value: z === LEVEL_COLORS.length - 1 ? 1 : 0 },
              uHalf: { value: FRAME.half },
              uPitch: { value: FRAME.pitch },
              uBuild: build,
            },
            vertexShader,
            fragmentShader,
          }),
          edgeColor,
          // It writes no depth, so it hides nothing behind it (a glow, a
          // marker, a label): light, not a wall. Its faces never stack all
          // the same: the inner sides skip what lies behind the others
          edge: [false, true].map((inner) => {
            const m = new MeshBasicMaterial({
              color: edgeColor.clone(),
              transparent: true,
              opacity: EDGE,
              depthWrite: false,
              toneMapped: false,
              fog: false,
            });
            rimShader(m, FRAME.levelY[z], inner, build);
            return m;
          }),
          build,
        };
      }),
    [stepBackUniform],
  );
  useEffect(
    () => () =>
      materials.forEach((m) => {
        m.glass.dispose();
        m.edge.forEach((e) => e.dispose());
      }),
    [materials],
  );
  // Each edge's light: its focus (below) times its brightness. Up to full
  // opacity the light is the edge's opacity; past it, its colour, which keeps
  // its hue at full strength and then pales a little toward white, so a
  // focused edge still stands out, in its own colour, at any brightness
  const edgeLight = useRef(LEVEL_COLORS.map(() => EDGE));
  const applyEdge = (z: number) => {
    const m = materials[z];
    const light = edgeLight.current[z] * EDGE_BRIGHT;
    const [caps, sides] = m.edge;
    caps.opacity = Math.min(light, 1);
    const c = caps.color.copy(m.edgeColor).multiplyScalar(Math.max(light, 1));
    const peak = Math.max(c.r, c.g, c.b);
    if (peak > 1) {
      c.multiplyScalar(1 / peak).lerp(WHITE, Math.min((peak - 1) * 0.35, 0.4));
    }
    sides.opacity = caps.opacity;
    sides.color.copy(caps.color);
  };
  const focusKey = useMemo(() => ({ materials, stepBack }), [materials, stepBack]);
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
        edgeLight.current[z] = EDGE * (1 - stepBack * dim) + (1 - EDGE) * w;
        applyEdge(z);
      });
    },
    { ms: LEVEL_FOCUS_MS, key: focusKey },
  );

  // The entrance: each level's build, read from the intro clock every frame
  // (the entrance requests the frames while it plays)
  const intro = useIntro();
  useFrame(() => {
    materials.forEach((m, z) => {
      m.build.value = levelBuild(intro.plan, z, intro.t);
    });
  });

  return (
    <group name="levels">
      {levels.map((z) => (
        <group key={z} position={[0, FRAME.levelY[z], 0]}>
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
