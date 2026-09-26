import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  EdgesGeometry,
  Euler,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PieceType } from '../../../engine/pieces';
import { buildStauntonGeometries } from '../../pieceGeometry';
import type { Vec3 } from '../types';

// The Staunton set as a draughtsman draws it. Each piece type is merged into
// one solid (for the fill and the silhouette) plus one set of crease lines
// (the rings where the turned profile breaks) and a chain-dotted centre line
// up its axis, so a piece is three draw calls however many parts it has.

const S = buildStauntonGeometries(28);

interface Part {
  g: BufferGeometry;
  p?: Vec3;
  r?: Vec3;
  /** Crease angle for this part's drawn edges, degrees; 0 draws none. */
  crease?: number;
}

const ring = (n: number, radius: number, y: number, g: BufferGeometry, twist = false): Part[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i * 2 * Math.PI) / n;
    return {
      g,
      p: [Math.cos(a) * radius, y, Math.sin(a) * radius],
      r: twist ? [0, -a, 0] : undefined,
      crease: twist ? 30 : 0,
    };
  });

const PARTS: Record<PieceType, Part[]> = {
  [PieceType.Pawn]: [{ g: S.pawnBody }, { g: S.pawnHead, p: [0, 0.43, 0], crease: 0 }],
  [PieceType.Rook]: [{ g: S.rookBody }, ...ring(5, 0.17, 0.585, S.rookCrenellation, true)],
  [PieceType.Bishop]: [
    { g: S.bishopBody },
    { g: S.bishopSlot, p: [0, 0.575, 0], r: [0, 0, -0.6], crease: 30 },
    { g: S.bishopFinial, p: [0, 0.725, 0], crease: 0 },
  ],
  [PieceType.Knight]: [{ g: S.knightBase }, { g: S.knightHead, crease: 35 }],
  [PieceType.Unicorn]: [
    { g: S.unicornBody },
    { g: S.unicornHorn, p: [0, 0.67, 0], crease: 40 },
    { g: S.unicornSpiral, crease: 0 },
  ],
  [PieceType.Queen]: [
    { g: S.queenBody },
    ...ring(8, 0.15, 0.715, S.queenCoronet),
    { g: S.queenFinial, p: [0, 0.79, 0], crease: 0 },
  ],
  [PieceType.King]: [
    { g: S.kingBody },
    { g: S.kingCrossVertical, p: [0, 0.8, 0], crease: 30 },
    { g: S.kingCrossHorizontal, p: [0, 0.815, 0], crease: 30 },
  ],
};

export const TOPS: Record<PieceType, number> = {
  [PieceType.Pawn]: 0.545,
  [PieceType.Rook]: 0.64,
  [PieceType.Bishop]: 0.77,
  [PieceType.Knight]: 0.7,
  [PieceType.Unicorn]: 0.82,
  [PieceType.Queen]: 0.84,
  [PieceType.King]: 0.87,
};

const placed = (part: Part) => {
  const m = new Matrix4().compose(
    new Vector3(...(part.p ?? [0, 0, 0])),
    new Quaternion().setFromEuler(new Euler(...(part.r ?? [0, 0, 0]))),
    new Vector3(1, 1, 1),
  );
  const g = (part.g.index ? part.g.toNonIndexed() : part.g.clone()).applyMatrix4(m);
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  }
  return g;
};

/**
 * The `aOutline` direction the silhouette hull is pushed along: summed face
 * normals at creases (so every face moves out the full width and the hull
 * stays closed), averaged where a smooth surface or a cone's tip meets.
 */
const withOutline = (geometry: BufferGeometry) => {
  const pos = geometry.getAttribute('position');
  const nor = geometry.getAttribute('normal');
  const key = (i: number) =>
    `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
  const normals = new Map<string, Vector3[]>();
  for (let i = 0; i < pos.count; i++) {
    const n = new Vector3(nor.getX(i), nor.getY(i), nor.getZ(i));
    const list = normals.get(key(i)) ?? [];
    if (!list.some((m) => m.dot(n) > 0.995)) list.push(n);
    normals.set(key(i), list);
  }
  const resolved = new Map<string, Vector3>();
  for (const [k, list] of normals) {
    const sum = list.reduce((a, n) => a.add(n), new Vector3());
    resolved.set(k, list.length <= 3 ? sum : sum.normalize());
  }
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const n = resolved.get(key(i))!;
    out.set([n.x, n.y, n.z], i * 3);
  }
  geometry.setAttribute('aOutline', new BufferAttribute(out, 3));
  return geometry;
};

const mergeLines = (lines: BufferGeometry[]) => {
  const total = lines.reduce((a, g) => a + g.getAttribute('position').count, 0);
  const out = new Float32Array(total * 3);
  let o = 0;
  for (const g of lines) {
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++, o++) out.set([p.getX(i), p.getY(i), p.getZ(i)], o * 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(out, 3));
  return g;
};

/** A chain line (long dash, short dash) up the piece's axis. */
const centreLine = (top: number) => {
  const pts: number[] = [];
  let y = -0.06;
  const end = top + 0.12;
  let long = true;
  while (y < end) {
    const len = long ? 0.11 : 0.025;
    const y1 = Math.min(y + len, end);
    pts.push(0, y, 0, 0, y1, 0);
    y = y1 + 0.035;
    long = !long;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
  return g;
};

/**
 * Short segments for the eraser: every edge of the piece's facets, so a
 * scattered piece throws off a flurry of pencil strokes. Each vertex knows its
 * segment's midpoint and a random heading.
 */
const scatterFrom = (solid: BufferGeometry, seed: number) => {
  const edges = new EdgesGeometry(solid, 10);
  const p = edges.getAttribute('position');
  const n = p.count;
  const mid = new Float32Array(n * 3);
  const dir = new Float32Array(n * 3);
  const rand = new Float32Array(n);
  let s = seed;
  const random = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  for (let i = 0; i < n; i += 2) {
    const mx = (p.getX(i) + p.getX(i + 1)) / 2;
    const my = (p.getY(i) + p.getY(i + 1)) / 2;
    const mz = (p.getZ(i) + p.getZ(i + 1)) / 2;
    const out = new Vector3(mx, 0, mz);
    if (out.lengthSq() < 1e-6) out.set(random() - 0.5, 0, random() - 0.5);
    out.normalize();
    const speed = 0.6 + random() * 1.6;
    const d = [
      (out.x + (random() - 0.5) * 0.9) * speed,
      (0.5 + random() * 1.3) * speed,
      (out.z + (random() - 0.5) * 0.9) * speed,
    ];
    const r = random();
    for (const j of [i, i + 1]) {
      mid.set([mx, my, mz], j * 3);
      dir.set(d, j * 3);
      rand[j] = r;
    }
  }
  edges.setAttribute('aMid', new BufferAttribute(mid, 3));
  edges.setAttribute('aDir', new BufferAttribute(dir, 3));
  edges.setAttribute('aRand', new BufferAttribute(rand, 1));
  return edges;
};

export interface Drawing {
  solid: BufferGeometry;
  creases: BufferGeometry;
  axis: BufferGeometry;
  scatter: BufferGeometry;
}

const draw = (type: PieceType, seed: number): Drawing => {
  const parts = PARTS[type];
  const pieces = parts.map(placed);
  const solid = withOutline(mergeGeometries(pieces)!);
  const creases = mergeLines(
    parts.flatMap((part, j) =>
      part.crease === 0 ? [] : [new EdgesGeometry(pieces[j], part.crease ?? 22)],
    ),
  );
  return { solid, creases, axis: centreLine(TOPS[type]), scatter: scatterFrom(solid, seed) };
};

export const DRAWINGS = {} as Record<PieceType, Drawing>;
(Object.keys(PARTS) as PieceType[]).forEach((type, i) => {
  DRAWINGS[type] = draw(type, 97 + i * 31);
});

// --- Materials ---------------------------------------------------------------

/** Light in view space, from the upper left. */
const LIGHT = new Vector3(-0.5, 0.7, 0.5).normalize();

/**
 * The fill: a flat wash with 45° hatching in screen space. `hatchShade`
 * hatches only the side turned from the light (shading, for the open
 * drawing); `hatchAll` lines the whole face (a section, for the solid one).
 */
export const fillMaterial = ({
  fill,
  alpha,
  hatch,
  hatchAlpha,
  spacing,
  all,
}: {
  fill: string;
  alpha: number;
  hatch: string;
  hatchAlpha: number;
  spacing: number;
  all: boolean;
}) =>
  new ShaderMaterial({
    transparent: alpha < 1,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 2,
    uniforms: {
      uFill: { value: new Color(fill) },
      uAlpha: { value: alpha },
      uHatch: { value: new Color(hatch) },
      uHatchAlpha: { value: hatchAlpha },
      uSpacing: { value: spacing },
      uAll: { value: all ? 1 : 0 },
      uLight: { value: LIGHT },
      uFade: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      void main() {
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uFill; uniform float uAlpha; uniform vec3 uHatch; uniform float uHatchAlpha;
      uniform float uSpacing; uniform float uAll; uniform vec3 uLight; uniform float uFade;
      varying vec3 vN;
      void main() {
        float d = dot(normalize(vN), uLight);
        float shade = smoothstep(0.15, -0.2, d);
        float s = (gl_FragCoord.x + gl_FragCoord.y) / uSpacing;
        float q = abs(fract(s + 0.5) - 0.5);
        float w = fwidth(s);
        float line = 1.0 - smoothstep(0.55 / uSpacing, 0.55 / uSpacing + w, q);
        // Cross-hatch the shaded side of a section
        float s2 = (gl_FragCoord.x - gl_FragCoord.y) / uSpacing;
        float q2 = abs(fract(s2 + 0.5) - 0.5);
        float cross = (1.0 - smoothstep(0.55 / uSpacing, 0.55 / uSpacing + w, q2)) * shade * uAll;
        float h = max(line * mix(shade, 1.0, uAll), cross) * uHatchAlpha;
        vec3 c = mix(uFill, uHatch, h / max(uAlpha + h, 1e-3));
        float a = uAlpha < 1.0 ? uAlpha + h * (1.0 - uAlpha) : 1.0;
        gl_FragColor = vec4(uAlpha < 1.0 ? c : mix(uFill, uHatch, h), a * uFade);
        #include <colorspace_fragment>
      }`,
  });

/** The silhouette: back faces of a copy pushed out by `width`, in one colour. */
export const hullMaterial = (color: string, width: number) =>
  new ShaderMaterial({
    side: BackSide,
    transparent: true,
    uniforms: {
      uInk: { value: new Color(color) },
      uWidth: { value: width },
      uFade: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aOutline;
      uniform float uWidth;
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position + aOutline * uWidth, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uInk; uniform float uFade;
      void main() {
        gl_FragColor = vec4(uInk, uFade);
        #include <colorspace_fragment>
      }`,
  });

/** Pencil strokes flying off an erased piece, fading as they fall. */
export const scatterMaterial = (color: string) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uT: { value: 0 }, uInk: { value: new Color(color) } },
    vertexShader: /* glsl */ `
      attribute vec3 aMid; attribute vec3 aDir; attribute float aRand;
      uniform float uT;
      varying float vA;
      void main() {
        float t = max(uT - aRand * 0.12, 0.0);
        float drag = (1.0 - exp(-2.6 * t)) / 2.6;
        float a = t * (4.0 + aRand * 8.0);
        vec3 r = position - aMid;
        float c = cos(a), s = sin(a);
        r = vec3(c * r.x - s * r.y, s * r.x + c * r.y, r.z) * (1.0 - 0.4 * clamp(t, 0.0, 1.0));
        vec3 p = aMid + r + aDir * drag - vec3(0.0, 1.8 * t * t, 0.0);
        vA = uT < 0.0 ? 0.0 : clamp(1.0 - t / (0.7 + aRand * 0.5), 0.0, 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uInk; varying float vA;
      void main() {
        gl_FragColor = vec4(uInk, vA);
        #include <colorspace_fragment>
      }`,
  });
