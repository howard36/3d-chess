import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  LinearMipmapLinearFilter,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { Group, Points } from 'three';
import { prefersReducedMotion } from '../../motion';
import { noRaycast } from '../kit/noRaycast';
import { dotTexture, rng } from '../kit/textures';
import { TOWER_MASK } from './mask';
import { PALETTE } from './palette';
import { rig } from './pieces';

// The inside of a chess engine's mind: a black-green void with a soft green
// glow low round the horizon, and far off, in a shell round the scene, lines
// of opening theory set in dim phosphor type, as an opening book sets them:
// indented outlines, one line to a row, a thin branch of light running down
// from each line to its answers. 1. e4 and 1. d4 frame the opening view, one
// either side of the tower; the flank openings, this game's own Raumschach
// lines and a few famous moves and results run round behind the players,
// with a sparse field of single moves further out. Low and far off to the
// right, an 8×8 board of faint light has a knight's tour tracing itself
// across it, square by square.
//
// All of it is a murmur: readable when looked for, never competing with the
// board. It lives in a band round the horizon, so looking straight down
// there is only darkness through the panes, and whatever lies behind the
// tower from wherever the camera is fades to nothing (mask.ts), so nothing
// moving ever shows through the platforms. The book sways a degree or so
// and back, and each line breathes very slowly in and out, like a thought
// considered and let go.

// --- The book ------------------------------------------------------------------------------

interface Line {
  text: string;
  /**
   * Where the line starts round the tower: the azimuth of its first letter
   * (degrees; 0 toward the players' opening view; reading runs toward
   * smaller azimuths), for a line that heads a tree or stands alone. An
   * answer is set on the next row down, indented under the line it answers.
   */
  az?: number;
  /** Elevation of a heading line (degrees from the tower's centre). */
  el?: number;
  /** Height of the type (world units). */
  size?: number;
  /** Distance from the tower's centre (default: the book's shell). */
  r?: number;
  /** Index of the line it answers. */
  parent?: number;
  /** Brightness (1: the usual murmur). */
  weight?: number;
}

// The opening view looks toward azimuth 196°. Each tree is set as an opening
// book sets it, an indented outline, one line of theory to a row, a thin
// branch of light running down from each line to its answers: 1. e4 in the
// band left of the tower, 1. d4 in the band to its right, both whole inside
// the opening view and clear of the tower and the HUD; the flank openings,
// this game's own Raumschach lines and a few famous moves run round behind
// the players.
const BOOK: Line[] = [
  // 1. e4 (0–7)
  { text: '1. e4', az: 239, el: -5, size: 0.72 },
  { text: '1... e5 2. Nf3 Nc6', parent: 0, size: 0.58 },
  { text: '3. Bb5 a6 4. Ba4', parent: 1, size: 0.5 },
  { text: '3. Bc4 Bc5 4. c3', parent: 1, size: 0.5 },
  { text: '1... c5 2. Nf3 d6', parent: 0, size: 0.58 },
  { text: '3. d4 cxd4 4. Nxd4', parent: 4, size: 0.5 },
  { text: '1... e6 2. d4 d5', parent: 0, size: 0.54 },
  { text: '1... c6 2. d4 d5', parent: 0, size: 0.54 },
  // 1. d4 (8–14)
  { text: '1. d4', az: 168, el: -3, size: 0.72 },
  { text: '1... d5 2. c4', parent: 8, size: 0.58 },
  { text: '2... e6 3. Nc3 Nf6', parent: 9, size: 0.5 },
  { text: '2... c6 3. Nf3 Nf6', parent: 9, size: 0.5 },
  { text: '1... Nf6 2. c4', parent: 8, size: 0.58 },
  { text: '2... e6 3. Nc3 Bb4', parent: 12, size: 0.5 },
  { text: '2... g6 3. Nc3 Bg7', parent: 12, size: 0.5 },
  // The flank openings, behind the players (15–19)
  { text: '1. c4 e5 2. Nc3', az: 92, el: -6 },
  { text: '2... Nf6 3. g3 d5', parent: 15, size: 0.6 },
  { text: '2... Nc6 3. g3 g6', parent: 15, size: 0.6 },
  { text: '1. Nf3 d5 2. g3', az: 40, el: -8 },
  { text: '2... Nf6 3. Bg2 c6', parent: 18, size: 0.6 },
  // This game's own book, in Raumschach (20–23)
  { text: '1. Ab2-De5 Ed4-Ba1', az: 330, el: -6 },
  { text: '2. Ac2-Cc4 Dc4-Dc3', parent: 20, size: 0.6 },
  { text: '3. Ad2-Dd5+ Ec4-Dd5', parent: 21, size: 0.56 },
  { text: '2. Bc2-Cc3 Ec5-Cc3', parent: 20, size: 0.6 },
  // Famous moves and results, set apart
  { text: '16. Qb8+!! Nxb8 17. Rd8#', az: 290, el: -24, size: 0.6, weight: 0.9 },
  { text: '1. f3 e5 2. g4 Qh4#', az: 128, el: -26, size: 0.6, weight: 0.9 },
  { text: '23... Qg3!!', az: 110, el: -8, size: 0.7 },
  { text: 'Aa2-Ab3', az: 8, el: -24, size: 0.6 },
  { text: 'Db3-Ec4#', az: 300, el: -29, size: 0.6 },
  { text: '1-0', az: 268, el: -10, size: 0.7 },
  { text: '½-½', az: 62, el: -26, size: 0.7 },
  { text: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3', az: 20, el: 1, size: 0.5 },
];

// Further out, a scatter of single moves and squares, fainter still, like
// the engine's passing thoughts: a field of notation for depth, all round
const MOVES = (
  'e4 d4 Nf3 c4 e5 c5 Nc6 Nf6 d5 e6 Bb5 a6 Ba4 O-O Re1 b5 Bb3 d6 c3 h3 Nbd7 Bg5 Be7 Qc2 ' +
  'Rd1 Kh1 g3 Bg2 Rb1 f4 exd5 cxd4 Nxd4 Qxd7+ Bxf7+ Nxe5 Qh5 Rxe8# h6 g6 Bg7 O-O-O ' +
  'Aa1 Ec5 Cc3 Bd2 Db4 Ea5 Ce3 Bb1-Cb2 Ud1 Ec4-Dd5 Cc2 Dd4'
).split(' ');
const TOKENS: Line[] = (() => {
  const random = rng(29);
  // Spread evenly round, jittered, in a band round the horizon, but clear
  // of the two trees that frame the opening view
  return MOVES.map((text, i) => {
    let az = ((i + random() * 0.8) / MOVES.length) * 360;
    if (az > 208 && az < 252) az += 47;
    else if (az > 140 && az < 184) az -= 42;
    return {
      text,
      az,
      el: -30 + random() * 50,
      r: 46 + random() * 8,
      size: 0.5 + random() * 0.35,
      weight: 0.35 + random() * 0.3,
    };
  });
})();
/** Every line set in type: the book (whose indices the branches use), then the field. */
const LINES: Line[] = [...BOOK, ...TOKENS];

const SHELL = 32;
/** The outline's rows and indent (degrees round the shell). */
const ROW_DEG = 2.8;
const INDENT_DEG = 2.2;
const ROW = 64;
const FONT = '500 44px "IBM Plex Mono", ui-monospace, monospace';

/** The book set in type once, every line on its own strip of one atlas. */
const setType = () => {
  const W = 2048;
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = FONT;
  const pad = 12;
  const rects: { x: number; y: number; w: number }[] = [];
  let x = 0;
  let y = 0;
  for (const line of LINES) {
    const w = Math.ceil(probe.measureText(line.text).width) + pad * 2;
    if (x + w > W) {
      x = 0;
      y += ROW;
    }
    rects.push({ x, y, w });
    x += w;
  }
  const H = 2 ** Math.ceil(Math.log2(y + ROW));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.font = FONT;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  LINES.forEach((line, i) => ctx.fillText(line.text, rects[i].x + pad, rects[i].y + ROW / 2 + 2));
  const texture = new CanvasTexture(c);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  return { texture, rects, W, H };
};

const DEG = Math.PI / 180;
const at = (az: number, el: number, r: number) =>
  new Vector3(
    Math.sin(az * DEG) * Math.cos(el * DEG) * r,
    Math.sin(el * DEG) * r,
    Math.cos(az * DEG) * Math.cos(el * DEG) * r,
  );

// The type is masked per pixel: a long line of notation can run behind the
// tower with both its ends clear of it
const scriptVertex = /* glsl */ `
  attribute float aSeed;
  attribute float aWeight;
  uniform float uTime;
  varying vec2 vUv;
  varying float vLight;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    // Each line breathes in and out on its own slow period
    float period = 26.0 + 22.0 * fract(aSeed * 7.13);
    float breath = 0.62 + 0.38 * sin(6.2831853 * (uTime / period + aSeed));
    vLight = aWeight * breath;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const scriptFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uStrength;
  varying vec2 vUv;
  varying float vLight;
  varying vec3 vWorld;
  ${TOWER_MASK}
  void main() {
    float a = texture2D(uMap, vUv).a * vLight * uStrength;
    if (a < 0.002) discard;
    a *= 1.0 - bookCover(vWorld);
    if (a < 0.002) discard;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <colorspace_fragment>
  }`;

const branchVertex = /* glsl */ `
  attribute float aSeed;
  attribute float aWeight;
  uniform float uTime;
  varying float vLight;
  ${TOWER_MASK}
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    float period = 26.0 + 22.0 * fract(aSeed * 7.13);
    float breath = 0.62 + 0.38 * sin(6.2831853 * (uTime / period + aSeed));
    vLight = aWeight * breath * (1.0 - bookCover(w.xyz));
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const branchFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  varying float vLight;
  void main() {
    float a = vLight * uStrength;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <colorspace_fragment>
  }`;

/**
 * The book drifts, never turns away: it sways a degree or so round the
 * tower and back over a minute and a half, so the two trees framing the
 * opening view stay where they were set.
 */
const SWAY = { amplitude: 1.2 * (Math.PI / 180), period: 90 };

const Book = () => {
  const [fontReady, setFontReady] = useState(false);
  useEffect(() => {
    let live = true;
    const done = () => live && setFontReady(true);
    if (typeof document !== 'undefined' && document.fonts?.load) {
      document.fonts.load(FONT).then(done, done);
    } else done();
    return () => {
      live = false;
    };
  }, []);

  const group = useRef<Group>(null);
  const time = useMemo(() => ({ value: 0 }), []);
  const built = useMemo(() => {
    if (!fontReady) return null;
    const { texture, rects, W, H } = setType();
    const n = LINES.length;
    const pos = new Float32Array(n * 4 * 3);
    const uv = new Float32Array(n * 4 * 2);
    const seed = new Float32Array(n * 4);
    const weight = new Float32Array(n * 4);
    const index: number[] = [];
    // Where each line sits: its first letter's azimuth (reading runs toward
    // smaller azimuths) and its row. An answer takes the next row of its tree,
    // indented one step under the line it answers
    const widthOf = (i: number) => (rects[i].w / ROW) * (LINES[i].size ?? 0.75);
    const widthDeg = (i: number) => widthOf(i) / SHELL / DEG;
    const starts: number[] = [];
    const els: number[] = [];
    const rows = new Map<number, number>();
    const rootOf = (i: number): number => {
      const p = LINES[i].parent;
      return p === undefined ? i : rootOf(p);
    };
    LINES.forEach((line, i) => {
      if (line.parent === undefined) {
        starts[i] = line.az ?? 0;
        els[i] = line.el ?? 0;
        return;
      }
      const root = rootOf(i);
      const row = (rows.get(root) ?? 0) + 1;
      rows.set(root, row);
      starts[i] = starts[line.parent] - INDENT_DEG;
      els[i] = els[root] - row * ROW_DEG;
    });
    const azs = LINES.map((_, i) => starts[i] - widthDeg(i) / 2);
    LINES.forEach((line, i) => {
      const r = line.r ?? SHELL;
      const h = line.size ?? 0.75;
      const { x, y, w } = rects[i];
      const width = widthOf(i);
      const az = azs[i];
      const c = at(az, els[i], r);
      // Facing the tower: right across the view from the centre, up square to it
      const inward = c.clone().negate().normalize();
      const right = new Vector3(-Math.cos(az * DEG), 0, Math.sin(az * DEG));
      const up = new Vector3().crossVectors(inward, right).normalize();
      const corners = [
        [-0.5, -0.5],
        [0.5, -0.5],
        [0.5, 0.5],
        [-0.5, 0.5],
      ];
      corners.forEach(([sx, sy], k) => {
        const p = c
          .clone()
          .addScaledVector(right, sx * width)
          .addScaledVector(up, sy * h);
        pos.set([p.x, p.y, p.z], (i * 4 + k) * 3);
        uv.set([(x + (sx + 0.5) * w) / W, 1 - (y + (0.5 - sy) * ROW) / H], (i * 4 + k) * 2);
        seed[i * 4 + k] = (i * 0.618) % 1;
        weight[i * 4 + k] = line.weight ?? 1;
      });
      const o = i * 4;
      index.push(o, o + 1, o + 2, o, o + 2, o + 3);
    });
    const type = new BufferGeometry();
    type.setAttribute('position', new BufferAttribute(pos, 3));
    type.setAttribute('uv', new BufferAttribute(uv, 2));
    type.setAttribute('aSeed', new BufferAttribute(seed, 1));
    type.setAttribute('aWeight', new BufferAttribute(weight, 1));
    type.setIndex(index);

    // The branches, as an outline draws them: a thin line down from under
    // the start of each line past its answers, and a short tick across to
    // each one, all along the shell in short segments so the mask holds
    const bp: number[] = [];
    const bs: number[] = [];
    const bw: number[] = [];
    const seedOf = (i: number) => (i * 0.618) % 1;
    const run = (az0: number, el0: number, az1: number, el1: number, s0: number, s1: number) => {
      const n = 6;
      for (let k = 0; k < n; k++) {
        const t0 = k / n;
        const t1 = (k + 1) / n;
        const p = at(az0 + (az1 - az0) * t0, el0 + (el1 - el0) * t0, SHELL);
        const q = at(az0 + (az1 - az0) * t1, el0 + (el1 - el0) * t1, SHELL);
        bp.push(p.x, p.y, p.z, q.x, q.y, q.z);
        bs.push(t0 < 0.5 ? s0 : s1, t1 <= 0.5 ? s0 : s1);
        bw.push(0.8, 0.8);
      }
    };
    const halfHeightDeg = (i: number) => (LINES[i].size ?? 0.75) / 2 / SHELL / DEG;
    BOOK.forEach((_, i) => {
      const answers = BOOK.map((l, j) => (l.parent === i ? j : -1)).filter((j) => j >= 0);
      if (answers.length === 0) return;
      const trunk = starts[i] - INDENT_DEG * 0.45;
      const last = answers[answers.length - 1];
      run(trunk, els[i] - halfHeightDeg(i) - 0.35, trunk, els[last], seedOf(i), seedOf(last));
      for (const j of answers) run(trunk, els[j], starts[j] + 0.35, els[j], seedOf(i), seedOf(j));
    });
    const branches = new BufferGeometry();
    branches.setAttribute('position', new BufferAttribute(new Float32Array(bp), 3));
    branches.setAttribute('aSeed', new BufferAttribute(new Float32Array(bs), 1));
    branches.setAttribute('aWeight', new BufferAttribute(new Float32Array(bw), 1));

    const typeMaterial = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uMap: { value: texture },
        uColor: { value: new Color(PALETTE.script) },
        uStrength: { value: 0.085 },
        uTime: time,
      },
      vertexShader: scriptVertex,
      fragmentShader: scriptFragment,
    });
    const branchMaterial = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uColor: { value: new Color(PALETTE.branch) },
        uStrength: { value: 0.06 },
        uTime: time,
      },
      vertexShader: branchVertex,
      fragmentShader: branchFragment,
    });
    return { type, branches, texture, typeMaterial, branchMaterial };
  }, [fontReady, time]);
  useEffect(
    () => () => {
      if (!built) return;
      built.type.dispose();
      built.branches.dispose();
      built.texture.dispose();
      built.typeMaterial.dispose();
      built.branchMaterial.dispose();
    },
    [built],
  );

  const still = prefersReducedMotion();
  useFrame((state) => {
    time.value = state.clock.elapsedTime;
    if (group.current && !still) {
      const t = state.clock.elapsedTime / SWAY.period;
      group.current.rotation.y = Math.sin(t * Math.PI * 2) * SWAY.amplitude;
    }
  });

  if (!built) return null;
  return (
    <group ref={group}>
      <mesh
        geometry={built.type}
        material={built.typeMaterial}
        renderOrder={-900}
        raycast={noRaycast}
        frustumCulled={false}
      />
      <lineSegments
        geometry={built.branches}
        material={built.branchMaterial}
        renderOrder={-901}
        raycast={noRaycast}
        frustumCulled={false}
      />
    </group>
  );
};

// --- The knight's tour -----------------------------------------------------------------------

const KNIGHT_STEPS = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];

/** A knight's tour of the 8×8 board from b1, by Warnsdorff's rule (fewest onward moves first). */
const knightsTour = (): [number, number][] => {
  const seen = new Set<number>();
  const free = (u: number, v: number) => u >= 0 && u < 8 && v >= 0 && v < 8 && !seen.has(v * 8 + u);
  const onward = (u: number, v: number) =>
    KNIGHT_STEPS.filter(([dx, dy]) => free(u + dx, v + dy)).length;
  let [x, y] = [1, 0];
  const path: [number, number][] = [[x, y]];
  seen.add(y * 8 + x);
  while (path.length < 64) {
    let best: [number, number] | null = null;
    let fewest = 99;
    for (const [dx, dy] of KNIGHT_STEPS) {
      if (!free(x + dx, y + dy)) continue;
      const n = onward(x + dx, y + dy);
      if (n < fewest) {
        fewest = n;
        best = [x + dx, y + dy];
      }
    }
    if (!best) break;
    [x, y] = best;
    seen.add(y * 8 + x);
    path.push(best);
  }
  return path;
};

const tourVertex = /* glsl */ `
  attribute float aStep;
  varying float vStep;
  varying float vCover;
  ${TOWER_MASK}
  void main() {
    vStep = aStep;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vCover = towerCover(w.xyz);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

// The grid (aStep < 0) holds still and faint; the path shows only its last
// few moves behind the knight, the newest brightest, drawn up to the knight
const tourFragment = /* glsl */ `
  uniform vec3 uGrid;
  uniform vec3 uPath;
  uniform float uHead;
  uniform float uTail;
  uniform float uGridStrength;
  uniform float uPathStrength;
  varying float vStep;
  varying float vCover;
  void main() {
    float a;
    vec3 c;
    if (vStep < 0.0) {
      a = uGridStrength;
      c = uGrid;
    } else {
      float behind = uHead - vStep;
      if (behind < 0.0 || behind > uTail) discard;
      a = uPathStrength * pow(1.0 - behind / uTail, 1.5);
      c = uPath;
    }
    a *= 1.0 - vCover;
    gl_FragColor = vec4(c * a, 1.0);
    #include <colorspace_fragment>
  }`;

const TOUR = {
  /** Where the board lies: azimuth, distance and height (far off and low, right of the lower levels in the opening view). */
  az: 170,
  distance: 60,
  y: -31,
  /** Side of one square. */
  square: 1.1,
  /** Tilted up toward the tower, so it reads at a distance. */
  tilt: 24,
  /** Moves a second, and how many stay lit behind the knight. */
  speed: 0.4,
  tail: 9,
  /** A pause, in moves, before the tour starts again. */
  rest: 14,
};

const KnightsTour = () => {
  const head = useRef<Points>(null);
  const { lines, material, path, dot, dotMaterial } = useMemo(() => {
    const path = knightsTour();
    const s = TOUR.square;
    const half = 4 * s;
    const p: number[] = [];
    const st: number[] = [];
    const SEG = 8;
    // The grid, each line in short segments so the mask holds along it
    for (let i = 0; i <= 8; i++) {
      const o = -half + i * s;
      for (let k = 0; k < SEG; k++) {
        const a = -half + (k / SEG) * 2 * half;
        const b = -half + ((k + 1) / SEG) * 2 * half;
        p.push(o, 0, a, o, 0, b, a, 0, o, b, 0, o);
        st.push(-1, -1, -1, -1);
      }
    }
    const centre = ([x, y]: [number, number]) => [
      -half + (x + 0.5) * s,
      0.01,
      -half + (y + 0.5) * s,
    ];
    for (let i = 0; i < path.length - 1; i++) {
      p.push(...centre(path[i]), ...centre(path[i + 1]));
      st.push(i, i + 1);
    }
    const lines = new BufferGeometry();
    lines.setAttribute('position', new BufferAttribute(new Float32Array(p), 3));
    lines.setAttribute('aStep', new BufferAttribute(new Float32Array(st), 1));
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uGrid: { value: new Color(PALETTE.tourGrid) },
        uPath: { value: new Color(PALETTE.tourPath) },
        uHead: { value: 0 },
        uTail: { value: TOUR.tail },
        uGridStrength: { value: 0.05 },
        uPathStrength: { value: 0.12 },
      },
      vertexShader: tourVertex,
      fragmentShader: tourFragment,
    });
    const dot = new BufferGeometry();
    dot.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
    const dotMaterial = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uMap: { value: dotTexture(0.7) },
        uColor: { value: new Color(PALETTE.tourPath) },
        uStrength: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying float vCover;
        ${TOWER_MASK}
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vCover = towerCover(w.xyz);
          vec4 mv = viewMatrix * w;
          gl_PointSize = 90.0 / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform vec3 uColor;
        uniform float uStrength;
        varying float vCover;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a * uStrength * (1.0 - vCover);
          if (a < 0.002) discard;
          gl_FragColor = vec4(uColor * a, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    return { lines, material, path, dot, dotMaterial };
  }, []);
  useEffect(
    () => () => {
      lines.dispose();
      material.dispose();
      dot.dispose();
      dotMaterial.dispose();
    },
    [lines, material, dot, dotMaterial],
  );

  const still = prefersReducedMotion();
  useFrame((state) => {
    const cycle = path.length - 1 + TOUR.tail + TOUR.rest;
    const h = still ? path.length - 1 : (state.clock.elapsedTime * TOUR.speed) % cycle;
    material.uniforms.uHead.value = h;
    // The knight: a faint light at the head, gliding square to square
    const k = Math.min(h, path.length - 1);
    const i = Math.min(Math.floor(k), path.length - 2);
    const t = Math.min(k - i, 1);
    const e = t * t * (3 - 2 * t);
    const s = TOUR.square;
    const half = 4 * s;
    const [x0, y0] = path[i];
    const [x1, y1] = path[i + 1];
    const pos = dot.getAttribute('position') as BufferAttribute;
    pos.setXYZ(
      0,
      -half + (x0 + (x1 - x0) * e + 0.5) * s,
      0.02,
      -half + (y0 + (y1 - y0) * e + 0.5) * s,
    );
    pos.needsUpdate = true;
    dotMaterial.uniforms.uStrength.value = h <= path.length - 1 ? 0.12 : 0;
    if (head.current) head.current.visible = h <= path.length - 1;
  });

  const place = at(TOUR.az, 0, TOUR.distance).setY(TOUR.y);
  return (
    <group position={place} rotation={[0, TOUR.az * DEG, 0]}>
      <group rotation={[-TOUR.tilt * DEG, 0, 0]}>
        <lineSegments
          geometry={lines}
          material={material}
          renderOrder={-902}
          raycast={noRaycast}
          frustumCulled={false}
        />
        <points
          ref={head}
          geometry={dot}
          material={dotMaterial}
          renderOrder={-899}
          raycast={noRaycast}
          frustumCulled={false}
        />
      </group>
    </group>
  );
};

// --- Light ---------------------------------------------------------------------------------

const UP = new Vector3(0, 1, 0);
const forward = new Vector3();
const right = new Vector3();
const origin = new Vector3();
const key = new Vector3();

/**
 * The pieces' light rig (pieces.tsx), riding with the camera: a soft key
 * above its left shoulder and a cool fill low on its right, so the pieces
 * are modelled the same way from every side and from both seats. The jade
 * shader is the only lit material, so the rig is directions, not lights.
 */
const CameraRig = () => {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target?: Vector3 } | null;
  useFrame(() => {
    const target = controls?.target ?? origin;
    forward.copy(target).sub(camera.position).normalize();
    right.crossVectors(forward, UP);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    right.normalize();
    key.copy(forward).multiplyScalar(-8).addScaledVector(right, -5).addScaledVector(UP, 9);
    rig.key.value.copy(key.normalize());
    key.copy(forward).multiplyScalar(-6).addScaledVector(right, 7).addScaledVector(UP, 1);
    rig.fill.value.copy(key.normalize());
  });
  return null;
};

// --- The void ------------------------------------------------------------------------------

// A still, soft glow of green light round the horizon, like the haze of a
// screen in a dark room: the one broad volume of light in the void. It lies
// low round every side, so it fills the dark behind the tower from the
// opening view without any detail, and it fades out long before straight
// down, where the view through the panes stays black.
const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const skyFragment = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uBottom;
  uniform vec3 uGlow;
  varying vec3 vDir;
  void main() {
    float h = vDir.y;
    vec3 c = h > 0.0 ? mix(uHorizon, uTop, pow(h, 0.55)) : mix(uHorizon, uBottom, pow(-h, 0.55));
    // The glow: centred a little below the horizon, reaching well down
    float g = exp(-pow((h + 0.16) / 0.2, 2.0));
    c += uGlow * g;
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }`;

const Void = () => {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTop: { value: new Color(PALETTE.skyTop) },
          uHorizon: { value: new Color(PALETTE.skyHorizon) },
          uBottom: { value: new Color(PALETTE.skyBottom) },
          uGlow: { value: new Color(PALETTE.skyGlow) },
        },
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh material={material} raycast={noRaycast} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[80, 48, 24]} />
    </mesh>
  );
};

export const Stage = () => (
  <>
    <Void />
    <Book />
    <KnightsTour />
    <CameraRig />
  </>
);
