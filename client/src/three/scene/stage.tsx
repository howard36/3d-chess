import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  MaxEquation,
  OneFactor,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import type { StageProps } from '../types';
import { PieceType } from '../../engine/pieces';
import { PROFILES } from '../pieces';
import { noRaycast } from '../noRaycast';
import { GRID_LINES } from './gridLines';
import type { platformStack } from './mask';
import {
  shadeAt,
  shadeUniforms,
  shadeViewport,
  TOWER_SHADE,
  towerOutlineOnScreen,
  updateTowerOutline,
} from './mask';
import { GROUND_Y, layout, PALETTE } from './palette';
import { ShootingStar } from './shootingStar';
import { useDisposeOnUnmount } from './dispose';
import { Heavens } from './heavens';
import { sculptureOf } from './sculptures';
import { SkyDetail } from './skyDetail';
import { BoardDetail } from './boardDetail';
import { Court } from './court';
import { Horizon } from './horizon';
// ENV PREVIEW (temporary): the preview's settings, and a redraw when one changes
import { useEnvSetting } from '../../envPreview';
import { shootingStar } from '../../envPreview/features/shootingStar';
import { EnvRedraw } from '../../envPreview/EnvRedraw';

// The garden at night. The tower floats over an endless dark plain of
// glossy stone; under it, nothing, so from straight above there is only
// darkness through the levels. Further out the plain carries a colossal
// chessboard, eight squares by eight (a1 dark, as on any board), drawn in
// the faintest lines of light and fading into the horizon, and on it stand
// twelve colossal chess pieces, each on the centre of its square, twins
// facing each other across the board (PLACES), drawn only in thin white
// neon tube: their outlines (sculptures.ts) turn to face the viewer as a
// turned piece looks the same from every side, and stand on real rings of
// light round their bases and collars. Each has a breath of mist at its
// feet, and the ground gives back a faint, soft reflection. The tubes are
// dim and join by taking the brighter (never summed), so no knot of light
// outshines the board. Two flank the tower in the opening view, and every
// side has one or two. Everything here sinks into the tower's shade near it
// on screen, a smooth gradient darkest over the tower's glass (mask.ts), so
// a sculpture nearing the tower darkens steadily and slips behind it with no
// edge anywhere. Overhead, stars and chess constellations for a camera that
// looks up (heavens.tsx). Nothing moves.

// --- The night sky ------------------------------------------------------------------

const Sky = () => {
  const parts = useMemo(
    () => ({
      geometry: new SphereGeometry(400, 32, 16),
      material: new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTop: { value: new Color(PALETTE.skyTop) },
          uHorizon: { value: new Color(PALETTE.skyHorizon) },
          uBottom: { value: new Color(PALETTE.skyBottom) },
          uMist: { value: new Color(PALETTE.mist) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop;
          uniform vec3 uHorizon;
          uniform vec3 uBottom;
          uniform vec3 uMist;
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            float h = d.y;
            vec3 c = h > 0.0
              ? mix(uHorizon, uTop, pow(h, 0.45))
              : mix(uHorizon, uBottom, pow(-h, 0.5));
            // A breath of mist lying along the horizon, in a soft wider glow
            c += uMist * exp(-pow(h / 0.05, 2.0)) * 0.045;
            c += uMist * exp(-pow(h / 0.16, 2.0)) * 0.008;
            // Far off, two banks of mist, their tops rolling slowly round
            // the horizon (whole waves round it, so they close up behind)
            float az = atan(d.x, d.z);
            float low = 0.012 + 0.006 * sin(az * 3.0 + 0.7) + 0.004 * sin(az * 7.0 + 2.1);
            float high = 0.034 + 0.009 * sin(az * 2.0 + 4.0) + 0.005 * sin(az * 5.0 + 0.3);
            float bank = smoothstep(low + 0.014, low - 0.004, h) * smoothstep(-0.05, -0.005, h);
            float stratum = exp(-pow((h - high) / 0.007, 2.0));
            c += uMist * (bank * 0.014 + stratum * 0.008);
            gl_FragColor = vec4(c, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    }),
    [],
  );
  useDisposeOnUnmount(parts);
  const { geometry, material } = parts;
  return (
    <mesh
      geometry={geometry}
      material={material}
      renderOrder={-1000}
      frustumCulled={false}
      raycast={noRaycast}
    />
  );
};

// --- The plain and its colossal board -------------------------------------------------

/**
 * Side of one square of the colossal board (world units): eight across,
 * sized so every sculpture stands on the centre of a square (PLACES).
 */
export const SQUARE = 8;
/** Radius of clear dark ground round the tower's foot. */
const CLEAR = [17, 27] as const;

const groundVertex = /* glsl */ `
  varying vec2 vP;
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vP = w.xz;
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

/** The brightness of the colossal board: its lines and its light squares together. */
const BOARD = 1.1;

const groundFragment = /* glsl */ `
  uniform vec3 uGround;
  uniform vec3 uLine;
  uniform vec3 uHorizon;
  uniform float uSquare;
  uniform vec2 uClear;
  varying vec2 vP;
  varying vec3 vWorld;
  ${TOWER_SHADE}
  ${GRID_LINES}
  void main() {
    vec3 view = normalize(vWorld - cameraPosition);
    float r = length(vP);
    float dist = distance(vWorld, cameraPosition);
    // The colossal board's lines, joined by taking the brighter (never
    // summed), so crossings stay even
    vec2 uv = vP / uSquare + 4.0;
    vec2 lines = gridLines(uv, 0.006);
    float onBoard = step(-0.02, uv.x) * step(uv.x, 8.02) * step(-0.02, uv.y) * step(uv.y, 8.02);
    vec2 span = vec2(step(-0.01, uv.y) * step(uv.y, 8.01), step(-0.01, uv.x) * step(uv.x, 8.01));
    lines *= span;
    // The board's own edge a little brighter than its inner lines
    vec2 edge = step(3.5, abs(floor(uv + 0.5) - 4.0));
    float line = max(lines.x * mix(1.0, 1.7, edge.x), lines.y * mix(1.0, 1.7, edge.y));
    // A whisper of the checker: the light squares a shade lighter, a1 dark
    // as on any board (rank 1 lies toward +z, where White sits)
    vec2 sq = floor(uv);
    float lightSq = mod(sq.x + sq.y + 1.0, 2.0) * onBoard;
    // Clear ground round the tower, fading into the night far off, and
    // nothing at all where the tower stands in front of it
    float clear = smoothstep(uClear.x, uClear.y, r);
    float far = 1.0 - smoothstep(40.0, 110.0, dist);
    // Into the tower's shade (mask.ts)
    float hidden = 1.0 - towerShade();
    float lit = (line * 0.04 + lightSq * 0.004) * ${BOARD.toFixed(1)} * clear * far * hidden;
    // Polished: toward the horizon it gives back the mist
    float fresnel = pow(1.0 - abs(view.y), 5.0);
    vec3 col = uGround + uLine * lit + uHorizon * fresnel * 0.9;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const Ground = () => {
  const parts = useMemo(
    () => ({
      geometry: new PlaneGeometry(260, 260, 4, 4).rotateX(-Math.PI / 2),
      material: new ShaderMaterial({
        // Drawn first and writing no depth: the reflections go under it
        depthWrite: false,
        uniforms: {
          uGround: { value: new Color(PALETTE.ground) },
          uLine: { value: new Color(PALETTE.neon) },
          ...shadeUniforms(),
          uHorizon: { value: new Color(PALETTE.skyHorizon) },
          uSquare: { value: SQUARE },
          uClear: { value: [...CLEAR] },
        },
        vertexShader: groundVertex,
        fragmentShader: groundFragment,
      }),
    }),
    [],
  );
  useDisposeOnUnmount(parts);
  const { geometry, material } = parts;
  return (
    <mesh
      geometry={geometry}
      material={material}
      position={[0, GROUND_Y, 0]}
      renderOrder={-900}
      raycast={noRaycast}
    />
  );
};

// --- The sculptures ---------------------------------------------------------------------

/** Their scale: a colossal king stands about 5.6 units tall. */
const SCALE = 6.5;

/**
 * Where each stands: on the centre of a square of the colossal board, set
 * out as twins facing each other across it, as in a game: the kings on
 * their own squares down the e-file, the queens down the d-file, the
 * bishops fianchettoed on the long diagonal h1–a8 and the unicorns on
 * a1–h8, the knights up the a-file and the rooks up the h-file. All twelve
 * squares lie the same distance from the centre (about 28.3: 4² + 28² =
 * 20² + 20²), at most 37° apart round it, so one or two stand clear of the
 * tower from every side (see garden.test.ts). The opening view looks from
 * 16° toward 196°: White sees Black's king and a bishop flank the tower,
 * the queen behind it; Black sees White's queen and a bishop. A drawing
 * looks in toward the board's centre, but the knights, side by side, look at
 * each other (`faces`), so they face each other from every side.
 */
const PLACES: { type: PieceType; square: string; faces?: string }[] = [
  { type: PieceType.King, square: 'e1' },
  { type: PieceType.King, square: 'e8' },
  { type: PieceType.Queen, square: 'd1' },
  { type: PieceType.Queen, square: 'd8' },
  { type: PieceType.Bishop, square: 'g2' },
  { type: PieceType.Bishop, square: 'b7' },
  { type: PieceType.Unicorn, square: 'b2' },
  { type: PieceType.Unicorn, square: 'g7' },
  { type: PieceType.Knight, square: 'a4', faces: 'a5' },
  { type: PieceType.Knight, square: 'a5', faces: 'a4' },
  { type: PieceType.Rook, square: 'h4' },
  { type: PieceType.Rook, square: 'h5' },
];

/** The centre of a square of the colossal board (a1 toward -x, +z, as the tower's). */
export const squareCentre = (square: string): [number, number] => {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square.slice(1)) - 1;
  return [(file - 3.5) * SQUARE, (3.5 - rank) * SQUARE];
};

const anchorOf = (square: string): [number, number, number] => {
  const [x, z] = squareCentre(square);
  return [x, GROUND_Y, z];
};

/** Every sculpture's square, where it stands and the point (x, z) it looks toward. */
export const GARDEN = PLACES.map(({ type, square, faces }) => ({
  type,
  square,
  at: anchorOf(square),
  toward: faces ? squareCentre(faces) : ([0, 0] as [number, number]),
}));

/**
 * Every sculpture's tubes as one ribbon mesh. Each vertex carries its
 * sculpture's anchor, the point it looks toward (the board's centre unless
 * given), its point and tangent (in the drawing plane for an outline, in 3D
 * for a ring) and its side of the ribbon; the vertex shader turns an outline
 * to face the camera, its front toward that point, and widens every tube
 * across the view, so the whole garden is one draw call. (The lobby draws
 * its empty seats with the same tubes: a king at piece scale.)
 */
export const neonGeometry = (
  places: readonly {
    type: PieceType;
    at: readonly [number, number, number];
    toward?: readonly [number, number];
  }[] = GARDEN,
  scale = SCALE,
): BufferGeometry => {
  const anchor: number[] = [];
  const toward: number[] = [];
  const local: number[] = [];
  const tangent: number[] = [];
  const side: number[] = [];
  const mode: number[] = [];
  const index: number[] = [];
  const addCurve = (
    at: readonly [number, number, number],
    looks: readonly [number, number],
    pts: [number, number, number][],
    closed: boolean,
    fixed: boolean,
  ) => {
    const n = pts.length;
    const base = side.length;
    for (let k = 0; k < n; k++) {
      const prev = pts[closed ? (k - 1 + n) % n : Math.max(k - 1, 0)];
      const next = pts[closed ? (k + 1) % n : Math.min(k + 1, n - 1)];
      const t = [next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]];
      const l = Math.hypot(t[0], t[1], t[2]) || 1;
      for (const s of [-1, 1]) {
        anchor.push(...at);
        toward.push(...looks);
        local.push(...pts[k]);
        tangent.push(t[0] / l, t[1] / l, t[2] / l);
        side.push(s);
        mode.push(fixed ? 1 : 0);
      }
    }
    const segments = closed ? n : n - 1;
    for (let k = 0; k < segments; k++) {
      const a = base + 2 * k;
      const b = base + 2 * ((k + 1) % n);
      index.push(a, a + 1, b, b, a + 1, b + 1);
    }
  };
  places.forEach(({ type, at, toward: looks = [0, 0] }) => {
    const drawing = sculptureOf(type);
    for (const o of drawing.outlines) {
      addCurve(
        at,
        looks,
        o.points.map(([x, y]) => [x * scale, y * scale, 0]),
        o.closed,
        false,
      );
    }
    for (const ring of drawing.rings) {
      const pts = Array.from({ length: 24 }, (_, k): [number, number, number] => {
        const a = (k / 24) * Math.PI * 2;
        return [
          Math.cos(a) * ring.radius * scale,
          ring.y * scale,
          Math.sin(a) * ring.radius * scale,
        ];
      });
      addCurve(at, looks, pts, true, true);
    }
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(local), 3));
  g.setAttribute('aAnchor', new BufferAttribute(new Float32Array(anchor), 3));
  g.setAttribute('aToward', new BufferAttribute(new Float32Array(toward), 2));
  g.setAttribute('aTangent', new BufferAttribute(new Float32Array(tangent), 3));
  g.setAttribute('aSide', new BufferAttribute(new Float32Array(side), 1));
  g.setAttribute('aMode', new BufferAttribute(new Float32Array(mode), 1));
  g.setIndex(index);
  return g;
};

// --- Behind the tower ------------------------------------------------------------------

/*
 * The sculptures, their mist and reflections, like the colossal board and
 * the stars, sink into the tower's shade (mask.ts): a smooth screen-space
 * gradient, darkest over the tower's glass and easing out to nothing a set
 * distance from it, so a sculpture nearing the tower
 * darkens steadily, side nearest the tower first, and slips behind it into
 * the dark with no edge or line anywhere.
 */
/** The sculptures' brightness: their tubes and their mist. */
const BRIGHT = 0.7;
/**
 * 1, or -1 to turn the garden half about for Black: the tower's board is
 * walked around rather than turned (layout.ts), so the colossal board and
 * everything on it turn with it, and a1 lies at Black's far left as it does
 * on the tower. (Its lines and checker look the same either way.)
 */
const gardenTurn = { value: 1 };
/** The sculptures' and their mist's brightness: 1 in the game, less behind the lobby's kings. */
const gardenDim = { value: 1 };
type ShadeStack = ReturnType<typeof platformStack>;

const corner = new Vector3();
const right = new Vector3();
interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Every point in front of the camera. */
  seen: boolean;
}
/** The screen rectangle (NDC, x scaled by the aspect so both axes match) round some points. */
const rectOf = (camera: Camera, points: [number, number, number][], aspect: number): Rect => {
  const r: Rect = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, seen: true };
  for (const [x, y, z] of points) {
    corner.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
    if (corner.z > -0.1) r.seen = false;
    corner.applyMatrix4(camera.projectionMatrix);
    r.x0 = Math.min(r.x0, corner.x * aspect);
    r.x1 = Math.max(r.x1, corner.x * aspect);
    r.y0 = Math.min(r.y0, corner.y);
    r.y1 = Math.max(r.y1, corner.y);
  }
  return r;
};
const SIZES = GARDEN.map(({ type, at }) => ({
  at,
  radius: PROFILES.radius[type] * SCALE,
  height: sculptureOf(type).top * SCALE,
}));

/**
 * How each sculpture stands on screen: how much the tower's shade darkens
 * it, and how much of it is in frame.
 */
interface SculptureView {
  /** The tower's shade over the sculpture, on average: 0 clear, 1 dark. */
  cover: number;
  /** Share of the sculpture's screen rectangle inside the frame, 0–1. */
  inFrame: number;
}

/**
 * Every sculpture's shade and framing for a camera (pure, for tests).
 * `turn` is -1 when the garden is turned about for Black (gardenTurn).
 */
export const gardenView = (camera: Camera, aspect: number, turn = 1): SculptureView[] => {
  const hull = towerOutlineOnScreen(camera, aspect);
  right.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
  return SIZES.map(({ at: home, radius, height }) => {
    const at = [home[0] * turn, home[1], home[2] * turn];
    // The sculpture as it faces the camera: its axis, as wide as its base
    const body = rectOf(
      camera,
      [-1, 1].flatMap((s) =>
        [GROUND_Y, GROUND_Y + height].map((y): [number, number, number] => [
          at[0] + right.x * radius * s,
          y,
          at[2] + right.z * radius * s,
        ]),
      ),
      aspect,
    );
    if (!body.seen) return { cover: 0, inFrame: 0 };
    // The shade, sampled over the sculpture
    let shade = 0;
    const n = 5;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        shade += shadeAt(hull, [
          body.x0 + ((i + 0.5) / n) * (body.x1 - body.x0),
          body.y0 + ((j + 0.5) / n) * (body.y1 - body.y0),
        ]);
      }
    }
    const w = Math.max(body.x1 - body.x0, 1e-6);
    const h = Math.max(body.y1 - body.y0, 1e-6);
    const ix = Math.max(0, Math.min(body.x1, aspect) - Math.max(body.x0, -aspect));
    const iy = Math.max(0, Math.min(body.y1, 1) - Math.max(body.y0, -1));
    return { cover: shade / (n * n), inFrame: (ix * iy) / (w * h) };
  });
};

const drawingBuffer = new Vector2();
/**
 * Every frame, the tower's outline on screen for the shade (mask.ts), and
 * which way the garden is turned into its uniforms.
 */
const GardenUniforms = ({
  turn,
  shade,
  dim = 1,
}: {
  turn: number;
  shade?: ShadeStack;
  dim?: number | (() => number);
}) => {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => invalidate(), [turn, shade, dim, invalidate]);
  // Written as each frame is drawn, like the outline: the uniforms are
  // shared, and two canvases (the lobby's, fading, over the game's) each set
  // their own just before they render
  useFrame(({ camera, size, gl }) => {
    gardenTurn.value = turn;
    gardenDim.value = typeof dim === 'function' ? dim() : dim;
    const aspect = size.width / Math.max(size.height, 1);
    updateTowerOutline(camera, aspect, shade);
    gl.getDrawingBufferSize(drawingBuffer);
    shadeViewport.value.set(drawingBuffer.x, drawingBuffer.y, aspect);
  });
  return null;
};

const neonVertex = /* glsl */ `
  uniform float uWidth;
  uniform float uMirror;
  uniform float uGround;
  uniform float uTurn;
  attribute vec3 aAnchor;
  attribute vec2 aToward;
  attribute vec3 aTangent;
  attribute float aSide;
  attribute float aMode;
  varying float vAcross;
  varying float vDepth;
  varying float vRing;
  void main() {
    // Turned about for Black, as the board is (gardenTurn)
    vec3 anchor = vec3(aAnchor.x * uTurn, aAnchor.y, aAnchor.z * uTurn);
    vec2 toward = aToward * uTurn;
    vec3 toCam = cameraPosition - anchor;
    vec2 h = normalize(toCam.xz + vec2(1e-5, 0.0));
    // The drawing's plane faces the camera, turned about the vertical
    vec3 right = vec3(h.y, 0.0, -h.x);
    // A knight looks toward its point (its twin, or the board's centre),
    // whichever side of it the camera stands
    float face = dot(right.xz, toward - anchor.xz) >= 0.0 ? 1.0 : -1.0;
    vec3 p;
    vec3 t;
    if (aMode < 0.5) {
      p = anchor + right * position.x * face + vec3(0.0, position.y, 0.0);
      t = right * aTangent.x * face + vec3(0.0, aTangent.y, 0.0);
    } else {
      p = anchor + position;
      t = aTangent;
    }
    vDepth = p.y - uGround;
    if (uMirror > 0.5) {
      p.y = 2.0 * uGround - p.y;
      t.y = -t.y;
    }
    // Widened across the view, so every tube reads the same from any side
    vec3 v = normalize(cameraPosition - p);
    vec3 s = cross(t, v);
    float sl = length(s);
    s = sl > 1e-5 ? s / sl : vec3(0.0, 1.0, 0.0);
    p += s * aSide * uWidth;
    vAcross = aSide;
    vRing = aMode;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;

/** The soft edge of a tube drawn up to a height (`uReveal`, world units). */
export const REVEAL_SOFT = 0.12;

const neonFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uCore;
  uniform float uHalo;
  uniform float uIntensity;
  uniform float uFade;
  uniform float uBoost;
  uniform float uShaded;
  uniform float uDim;
  uniform float uGround;
  uniform float uReveal;
  varying float vAcross;
  varying float vDepth;
  varying float vRing;
  ${TOWER_SHADE}
  void main() {
    float a = abs(vAcross);
    float fw = max(fwidth(vAcross), 1e-5);
    // The tube: never thinner than about a pixel, dimmer instead
    float w = max(uCore, fw * 0.8);
    float core = (1.0 - smoothstep(w - fw, w + fw, a)) * min(uCore / w, 1.0);
    float halo = exp(-a * a * 7.0) * (1.0 - a) * uHalo;
    // The rings a little quieter than the outlines they stand the pieces on
    float light = (core + halo) * uIntensity * ${BRIGHT.toFixed(1)} * (1.0 + uBoost) * (1.0 - 0.3 * vRing);
    // A reflection fades with its depth under the polished ground
    light *= uFade > 0.0 ? exp(-vDepth / uFade) : 1.0;
    // Into the tower's shade, steadily, nearest the tower darkest
    light *= (1.0 - uShaded * towerShade()) * uDim;
    // Drawn up to a height (a lobby seat opening), with a soft edge
    light *= 1.0 - smoothstep(uReveal - ${REVEAL_SOFT.toFixed(2)}, uReveal, vDepth + uGround);
    if (light < 0.001) discard;
    gl_FragColor = vec4(uColor * light, 1.0);
    #include <colorspace_fragment>
  }`;

/** `uReveal` for tubes drawn whole: above everything. */
export const NEON_WHOLE = 1e4;

/** A blended material sorted with the opaque ones (it keeps its blending). */
const opaque = (m: ShaderMaterial) => {
  m.transparent = false;
  return m;
};

/** Brightens the garden for a moment at mate (fx.tsx). */
export const gardenBoost = { value: 0 };

/**
 * The tubes' light. `turn` is the garden's (gardenTurn) unless given, and
 * `shaded: false` keeps them out of the tower's shade (the lobby's seats).
 */
export const neonMaterial = (o: {
  width: number;
  core: number;
  halo: number;
  intensity: number;
  mirror: boolean;
  fade: number;
  turn?: { value: number };
  shaded?: boolean;
  dim?: { value: number };
}) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    // The brighter of two tubes where they meet or cross, never their sum:
    // a joint is no brighter than the tube
    blending: CustomBlending,
    blendEquation: MaxEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    uniforms: {
      uColor: { value: new Color(PALETTE.neon) },
      ...shadeUniforms(),
      uTurn: o.turn ?? gardenTurn,
      uShaded: { value: o.shaded === false ? 0 : 1 },
      uDim: o.dim ?? gardenDim,
      uWidth: { value: o.width },
      uCore: { value: o.core },
      uHalo: { value: o.halo },
      uIntensity: { value: o.intensity },
      uMirror: { value: o.mirror ? 1 : 0 },
      uGround: { value: GROUND_Y },
      uFade: { value: o.fade },
      uReveal: { value: NEON_WHOLE },
      uBoost: gardenBoost,
    },
    vertexShader: neonVertex,
    fragmentShader: neonFragment,
  });

const Sculptures = ({
  turn,
  shade,
  dim,
}: {
  turn: number;
  shade?: ShadeStack;
  dim?: number | (() => number);
}) => {
  const parts = useMemo(
    () => ({
      geometry: neonGeometry(),
      // In three.js's opaque list, which draws first, so the whole garden
      // is drawn before the tower (backdropCache.tsx); still joined by the max
      tubes: opaque(
        neonMaterial({
          width: 0.26,
          core: 0.12,
          halo: 0.06,
          intensity: 0.078,
          mirror: false,
          fade: 0,
        }),
      ),
      // Softer and dimmer in the polished stone, fading with depth
      reflection: opaque(
        neonMaterial({
          width: 0.45,
          core: 0.05,
          halo: 0.14,
          intensity: 0.025,
          mirror: true,
          fade: 3.2,
        }),
      ),
    }),
    [],
  );

  useDisposeOnUnmount(parts);
  const { geometry, tubes, reflection } = parts;
  return (
    <group name="garden">
      <GardenUniforms turn={turn} shade={shade} dim={dim} />
      <mesh
        geometry={geometry}
        material={reflection}
        renderOrder={-880}
        frustumCulled={false}
        raycast={noRaycast}
      />
      <mesh
        geometry={geometry}
        material={tubes}
        renderOrder={-870}
        frustumCulled={false}
        raycast={noRaycast}
      />
    </group>
  );
};

// --- Mist at their feet ---------------------------------------------------------------------

const mistGeometry = (): BufferGeometry => {
  const anchor: number[] = [];
  const corner: number[] = [];
  const size: number[] = [];
  const index: number[] = [];
  GARDEN.forEach(({ at }, i) => {
    for (const [cx, cy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      anchor.push(...at);
      corner.push(cx, cy, 0);
      size.push(SCALE * 0.62, SCALE * 0.16);
    }
    const b = i * 4;
    index.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(corner), 3));
  g.setAttribute('aAnchor', new BufferAttribute(new Float32Array(anchor), 3));
  g.setAttribute('aSize', new BufferAttribute(new Float32Array(size), 2));
  g.setIndex(index);
  return g;
};

const Mist = () => {
  const parts = useMemo(
    () => ({
      geometry: mistGeometry(),
      material: new ShaderMaterial({
        // Added onto the ground; in the opaque list with the rest of the
        // garden, drawn before the tower (backdropCache.tsx)
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: {
          uColor: { value: new Color(PALETTE.mist) },
          uBoost: gardenBoost,
          uDim: gardenDim,
          ...shadeUniforms(),
          uTurn: gardenTurn,
        },
        vertexShader: /* glsl */ `
          uniform float uTurn;
          attribute vec3 aAnchor;
          attribute vec2 aSize;
          varying vec2 vC;
          void main() {
            vec3 anchor = vec3(aAnchor.x * uTurn, aAnchor.y, aAnchor.z * uTurn);
            vec2 h = normalize((cameraPosition - anchor).xz + vec2(1e-5, 0.0));
            vec3 right = vec3(h.y, 0.0, -h.x);
            vec3 p = anchor + right * position.x * aSize.x + vec3(0.0, position.y * aSize.y, 0.0);
            vC = position.xy;
            gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uBoost;
          uniform float uDim;
          varying vec2 vC;
          ${TOWER_SHADE}
          void main() {
            float m = exp(-dot(vC * vec2(2.0, 2.6), vC * vec2(2.0, 2.6)));
            float a = m * 0.075 * (1.0 + 0.6 * uBoost) * ${BRIGHT.toFixed(1)};
            a *= (1.0 - towerShade()) * uDim;
            if (a < 0.001) discard;
            gl_FragColor = vec4(uColor * a, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    }),
    [],
  );
  useDisposeOnUnmount(parts);
  const { geometry, material } = parts;
  return (
    <mesh
      geometry={geometry}
      material={material}
      renderOrder={-860}
      frustumCulled={false}
      raycast={noRaycast}
    />
  );
};

// --- The camera's floor -----------------------------------------------------------

/** How far above the polished ground the camera must stay. */
const CLEARANCE = 1.2;
const BASE_MAX_POLAR = layout.orbit?.maxPolarAngle ?? Math.PI;

interface OrbitLike {
  target: Vector3;
  maxPolarAngle: number;
}

/**
 * The orbit may sink below the horizon to look up (layout's minElevation),
 * but never through the ground: before the controls update each frame, their
 * lowest angle is raised as far as the camera's distance needs, so zoomed in
 * it looks up the full 14° and zoomed out a little less, and a zoom out at
 * the lowest angle lifts the camera rather than sinking it into the plain.
 */
const CameraFloor = () => {
  const controls = useThree((s) => s.controls) as unknown as OrbitLike | null;
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!controls) return;
    invalidate();
    return () => {
      controls.maxPolarAngle = BASE_MAX_POLAR;
    };
  }, [controls, invalidate]);
  useFrame(({ camera }) => {
    if (!controls) return;
    const d = camera.position.distanceTo(controls.target);
    const lowest = (GROUND_Y + CLEARANCE - controls.target.y) / Math.max(d, 1e-3);
    controls.maxPolarAngle = Math.min(BASE_MAX_POLAR, Math.acos(Math.min(Math.max(lowest, -1), 1)));
  }, -2);
  return null;
};

/**
 * The garden. `shade` is what casts the tower's shade when that is not the
 * whole tower (the lobby's single platform: platformStack in mask.ts), and
 * `dim` quiets the sculptures (the lobby's kings stand in front of them).
 */
export const Stage = ({
  orientation,
  shade,
  dim,
}: StageProps & { shade?: ShadeStack; dim?: number | (() => number) }) => {
  const meteor = useEnvSetting(shootingStar);
  const turn = orientation === 'black' ? -1 : 1;
  return (
    <>
      <EnvRedraw />
      <CameraFloor />
      <Heavens />
      <Sky />
      <Ground />
      <Sculptures turn={turn} shade={shade} dim={dim} />
      <Mist />
      <SkyDetail turn={turn} shade={shade} dim={dim} />
      <BoardDetail turn={turn} shade={shade} dim={dim} />
      <Court turn={turn} shade={shade} dim={dim} />
      <Horizon turn={turn} shade={shade} dim={dim} />
      {meteor !== 'off' && <ShootingStar often={meteor === 'often'} />}
    </>
  );
};
