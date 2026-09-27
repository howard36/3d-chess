import { useEffect, useMemo } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import { useLevelFocus } from '../kit/focus';
import { LAYER } from '../kit/layers';
import { towerFrame } from '../kit/layouts';
import { noRaycast } from '../kit/noRaycast';
import type { BoardLayout } from '../types';
import { fibreTexture, noiseTexture } from './textures';

// The platforms: one sheet of dark rice paper per level, floating. A sheet is
// almost clear seen from above (so the levels below stay in plain view) and
// thickens toward grazing angles, as paper does, so each level reads as a
// surface from the side. Its kozo fibres catch a little moonlight; the light
// squares carry a breath of silver.
//
// The 25 squares are told apart by the grid, brushed rather than ruled: each
// side of each square is its own short stroke in the level's pigment,
// pressed down at one corner and lifted before the next, so every square is
// framed by four strokes with a small break at each crossing. The sheet's
// edge is a bolder stroke of the same pigment, drawn as a camera-facing
// ribbon so it keeps its width even edge-on. Looking straight down, the five
// grids would nest into a plaid: there only the focused level (or the top
// one) keeps its grid, checker and full edge; the others thin to hairlines.

export interface PaperSheetsProps {
  layout: BoardLayout;
  /** One pigment per level, A to E. */
  colors: string[];
  /** The level to emphasise (focusLevelOf(GridProps.focus)); null for none. */
  focusLevel?: number | null;
}

const sheetVertex = /* glsl */ `
  uniform float uPitch;
  varying vec2 vCell;
  varying vec3 vWorld;
  void main() {
    // Squares from the corner of a1: lines fall on whole numbers 0..5
    vCell = position.xy / uPitch + 2.5;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const sheetFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uPaper;
  uniform vec3 uSilver;
  uniform sampler2D uFibre;
  uniform sampler2D uNoise;
  uniform float uLevel;
  uniform float uMargin;
  uniform float uFocus;
  uniform float uDim;
  uniform float uLine;
  uniform float uRef;
  varying vec2 vCell;
  varying vec3 vWorld;

  // Smooth value noise, read from a tiling texture (64 cells to the tile)
  float vnoise(vec2 p) {
    return texture2D(uNoise, p / 64.0).a;
  }

  // One brushed side of a square: 'across' is the distance from the line
  // (squares), 'along' the position along it; each whole step of 'along' is
  // its own stroke, pressed at the start and lifted before the next crossing
  float stroke(float across, float along, float k, float width, float fw) {
    float seg = floor(along);
    float t = fract(along);
    float seed = seg * 7.13 + k * 3.71 + uLevel * 11.3;
    // The hand's slight wander off the line
    across += 0.012 * sin(t * 5.0 + seed) * (0.4 + t);
    float press = mix(1.25, 0.7, t) * (0.85 + 0.3 * vnoise(vec2(seed, t * 4.0)));
    float taper = smoothstep(0.03, 0.12, t) * (1.0 - smoothstep(0.84, 0.95, t));
    float w = width * press * taper;
    float deriv = max(fw, 1e-5);
    float drawn = max(w, deriv * 1.1);
    float cover = 1.0 - smoothstep(drawn * 0.5 - deriv * 0.7, drawn * 0.5 + deriv * 0.7, abs(across));
    cover *= clamp(w / drawn, 0.0, 1.0);
    // Dry bristles as the brush runs out
    float dry = smoothstep(0.45, 0.95, t) * 0.55;
    float bristle = vnoise(vec2(across / max(width, 1e-4) * 5.0 + seed, along * 24.0));
    cover *= smoothstep(dry - 0.1, dry + 0.1, bristle);
    return cover;
  }

  void main() {
    vec2 c = vCell;
    vec3 v = normalize(cameraPosition - vWorld);
    float grazing = 1.0 - abs(v.y);
    // Looking steeply down the stack (above about 60°), only the reference
    // level (the focused one, else the top) keeps its grid; the others thin
    // to a quiet hairline lattice
    float birdsEye = smoothstep(0.84, 0.96, normalize(cameraPosition).y);
    float quiet = birdsEye * (1.0 - uRef);

    // The sheet's deckle edge, a little outside the outer squares
    vec2 q = abs(c - 2.5);
    float rag = max(q.x, q.y) > 2.3 ? (vnoise(c * 7.0 + uLevel * 5.0) - 0.5) * 0.06 : 0.0;
    float outer = max(q.x, q.y) - (2.5 + uMargin) + rag;
    float sheet = 1.0 - smoothstep(-0.015, 0.015, outer);
    if (sheet < 0.003) discard;

    // Paper: faint from above, thicker toward grazing angles
    vec4 fib = texture2D(uFibre, c * 0.29 + vec2(uLevel * 0.37, uLevel * 0.61));
    vec2 cell = floor(c);
    float inside = step(0.0, c.x) * step(c.x, 5.0) * step(0.0, c.y) * step(c.y, 5.0);
    float light = mod(cell.x + cell.y + uLevel, 2.0) * inside * (1.0 - quiet);
    float paperA = 0.035 + 0.16 * pow(grazing, 2.2) + 0.035 * fib.g;
    paperA += light * 0.045 + fib.r * 0.065;
    vec3 paper = uPaper + uSilver * (light * 0.12 + fib.r * 0.25);

    // The brushed grid: the four inner lines each way
    float lines = 0.0;
    float kx = clamp(floor(c.x + 0.5), 1.0, 4.0);
    float ky = clamp(floor(c.y + 0.5), 1.0, 4.0);
    // Screen-space widths, taken outside the branch below
    vec2 fw = fwidth(c);
    // (the strokes are only worked out near a line)
    if (inside > 0.0 && min(abs(c.x - kx), abs(c.y - ky)) < 0.08) {
      float width = 0.034 * (1.0 + 0.35 * uFocus) * (1.0 - 0.15 * birdsEye) * (1.0 - 0.55 * quiet);
      lines = max(stroke(c.x - kx, c.y, kx, width, fw.x), stroke(c.y - ky, c.x + 0.37, ky + 5.0, width, fw.y));
    }
    float emphasis = mix(1.0 - uDim, 1.0, uFocus);
    float bird = 1.0 - 0.75 * quiet;
    float lineA = lines * min(1.0, uLine * emphasis * bird + uFocus * 0.3);
    vec3 lineCol = mix(uColor, vec3(1.0), 0.12 + 0.1 * uFocus);

    // Paper under, line over (premultiplied)
    float a = paperA * (1.0 - lineA) + lineA;
    vec3 col = (paper * paperA * (1.0 - lineA) + lineCol * lineA) / max(a, 1e-4);
    a *= sheet;
    if (a < 0.003) discard;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }`;

const edgeVertex = /* glsl */ `
  attribute vec3 aTangent;
  attribute vec3 aNormal;
  attribute float aSide;
  attribute float aAlong;
  attribute float aSeed;
  uniform float uWidth;
  uniform float uFocus;
  uniform float uRef;
  varying float vAcross;
  varying float vHalf;
  varying float vAlong;
  varying float vSeed;
  varying float vNear;
  varying float vQuiet;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 toCamera = normalize(cameraPosition - world.xyz);
    vec2 ground = cameraPosition.xz - world.xz;
    float near = smoothstep(-0.2, 0.6, dot(aNormal.xz, normalize(ground + 1e-5)));
    float wobble = 1.0 + 0.16 * sin(aAlong * 6.0 + aSeed * 4.3) + 0.07 * sin(aAlong * 19.0 + aSeed);
    float quiet = smoothstep(0.84, 0.96, normalize(cameraPosition).y) * (1.0 - uRef);
    float halfWidth = 0.5 * uWidth * wobble * mix(0.85, 1.2, near) * (1.0 + 0.7 * uFocus) * (1.0 - 0.4 * quiet);
    vQuiet = quiet;
    vec3 across = cross(normalize(mat3(modelMatrix) * aTangent), toCamera);
    float l = length(across);
    across = l > 1e-4 ? across / l : vec3(0.0, 1.0, 0.0);
    world.xyz += across * aSide * halfWidth;
    vAcross = aSide * halfWidth;
    vHalf = halfWidth;
    vAlong = aAlong;
    vSeed = aSeed;
    vNear = near;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const edgeFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uFocus;
  uniform float uDim;
  varying float vAcross;
  varying float vHalf;
  varying float vAlong;
  varying float vSeed;
  varying float vNear;
  varying float vQuiet;
  float hash(float n) { return fract(sin(n) * 43758.5453123); }
  float vnoise(float x) {
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash(i), hash(i + 1.0), f);
  }
  void main() {
    float d = abs(vAcross);
    float aa = max(fwidth(vAcross), 1e-4);
    float body = 1.0 - smoothstep(vHalf - aa, vHalf + aa * 0.5, d);
    float u = vHalf > 1e-4 ? vAcross / vHalf : 0.0;
    // The brush lifts at each corner into dry streaks
    float end = min(vAlong, 1.0 - vAlong);
    float dry = 1.0 - smoothstep(0.0, 0.08, end);
    float n = vnoise(u * 6.0 + vSeed * 13.0) * 0.8 + vnoise(vAlong * 40.0 + u) * 0.2;
    body *= smoothstep(dry * 0.85 - 0.08, dry * 0.85 + 0.08, n);
    body *= 0.86 + 0.14 * vnoise(vAlong * 55.0 + vSeed * 7.0);
    // Pigment pooled toward the stroke's middle, a silvery bloom at its heart
    vec3 col = mix(uColor, vec3(1.0), 0.18 * (1.0 - abs(u)) + 0.12 * uFocus);
    float strength = uOpacity * mix(0.8, 1.0, vNear) * mix(1.0 - uDim, 1.0, uFocus) * (1.0 - 0.45 * vQuiet);
    float a = body * min(1.0, strength + uFocus * 0.2);
    if (a < 0.003) discard;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }`;

const SAMPLES = 30;

/**
 * Four strokes round a square of half side `side`, each overrunning its
 * corners a little, as camera-facing ribbons: a pigment line of steady width
 * on screen from any angle, even edge-on.
 */
const perimeterGeometry = (side: number): BufferGeometry => {
  const corners: [number, number][] = [
    [-side, side],
    [side, side],
    [side, -side],
    [-side, -side],
  ];
  const overrun = side * 0.03;
  const position: number[] = [];
  const tangent: number[] = [];
  const normal: number[] = [];
  const sideAttr: number[] = [];
  const along: number[] = [];
  const seed: number[] = [];
  const index: number[] = [];
  for (let e = 0; e < 4; e++) {
    const [ax, az] = corners[e];
    const [bx, bz] = corners[(e + 1) % 4];
    const len = Math.hypot(bx - ax, bz - az);
    const tx = (bx - ax) / len;
    const tz = (bz - az) / len;
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    const ml = Math.hypot(mx, mz);
    const base = position.length / 3;
    for (let i = 0; i <= SAMPLES; i++) {
      const k = i / SAMPLES;
      const x = ax - tx * overrun + (bx - ax + tx * 2 * overrun) * k;
      const z = az - tz * overrun + (bz - az + tz * 2 * overrun) * k;
      for (const s of [-1, 1]) {
        position.push(x, 0.004, z);
        tangent.push(tx, 0, tz);
        normal.push(mx / ml, 0, mz / ml);
        sideAttr.push(s);
        along.push(k);
        seed.push(e + 1);
      }
    }
    for (let i = 0; i < SAMPLES; i++) {
      const a = base + i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  g.setAttribute('aTangent', new BufferAttribute(new Float32Array(tangent), 3));
  g.setAttribute('aNormal', new BufferAttribute(new Float32Array(normal), 3));
  g.setAttribute('aSide', new BufferAttribute(new Float32Array(sideAttr), 1));
  g.setAttribute('aAlong', new BufferAttribute(new Float32Array(along), 1));
  g.setAttribute('aSeed', new BufferAttribute(new Float32Array(seed), 1));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
};

/** Paper colour of the sheets: a silvery indigo, laid on very thin. */
const PAPER = '#39426a';
const SILVER = '#c8d2ea';
/** The top level: the one a bird's-eye view keeps when no level is focused. */
const TOP = 4;
/** How far the paper reaches past the outer squares (in squares). */
const MARGIN = 0.14;

export const PaperSheets = ({ layout, colors, focusLevel = null }: PaperSheetsProps) => {
  const frame = towerFrame(layout);
  const colorKey = colors.join(',');
  const sheets = useMemo(
    () =>
      frame.levelY.map(
        (_, z) =>
          new ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            uniforms: {
              uColor: { value: new Color(colors[z] ?? colors[colors.length - 1]) },
              uPaper: { value: new Color(PAPER) },
              uSilver: { value: new Color(SILVER) },
              uFibre: { value: fibreTexture() },
              uNoise: { value: noiseTexture() },
              uLevel: { value: z },
              uPitch: { value: frame.pitch },
              uMargin: { value: MARGIN },
              uFocus: { value: 0 },
              uDim: { value: 0 },
              uLine: { value: 0.62 },
              uRef: { value: z === TOP ? 1 : 0 },
            },
            vertexShader: sheetVertex,
            fragmentShader: sheetFragment,
          }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- colours compared by value
    [colorKey, frame.pitch, frame.levelY.length],
  );
  useEffect(() => () => sheets.forEach((m) => m.dispose()), [sheets]);
  const edges = useMemo(
    () =>
      frame.levelY.map(
        (_, z) =>
          new ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            uniforms: {
              uColor: { value: new Color(colors[z] ?? colors[colors.length - 1]) },
              uOpacity: { value: 0.9 },
              uWidth: { value: 0.055 },
              uFocus: { value: 0 },
              uRef: { value: z === TOP ? 1 : 0 },
              uDim: { value: 0 },
            },
            vertexShader: edgeVertex,
            fragmentShader: edgeFragment,
          }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- colours compared by value
    [colorKey, frame.levelY.length],
  );
  useEffect(() => () => edges.forEach((m) => m.dispose()), [edges]);
  const side = frame.half + frame.pitch * 0.07;
  const geometries = useMemo(() => {
    const reach = (frame.half + frame.pitch * (MARGIN + 0.05)) * 2;
    return { sheet: new PlaneGeometry(reach, reach), edge: perimeterGeometry(side) };
  }, [frame.half, frame.pitch, side]);
  useEffect(
    () => () => {
      geometries.sheet.dispose();
      geometries.edge.dispose();
    },
    [geometries],
  );

  // Level focus: the attended level's strokes go bolder and brighter, the
  // others step back, over a short calm ease
  useLevelFocus(
    focusLevel,
    (weights, any) => {
      weights.forEach((w, z) => {
        for (const m of [sheets[z], edges[z]]) {
          if (!m) continue;
          m.uniforms.uFocus.value = w;
          m.uniforms.uDim.value = any * 0.35;
          // The level the bird's-eye view keeps: the focused one, else the top
          m.uniforms.uRef.value = w + (1 - any) * (z === TOP ? 1 : 0);
        }
      });
    },
    { levels: frame.levelY.length, key: sheets },
  );

  return (
    <group name="paper-sheets">
      {frame.levelY.map((y, z) => (
        <group key={z} position={[0, y, 0]}>
          <mesh
            geometry={geometries.sheet}
            material={sheets[z]}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, -0.002, 0]}
            renderOrder={LAYER.plate}
            raycast={noRaycast}
          />
          <mesh
            geometry={geometries.edge}
            material={edges[z]}
            renderOrder={LAYER.plateEdge}
            raycast={noRaycast}
            frustumCulled={false}
          />
        </group>
      ))}
    </group>
  );
};
