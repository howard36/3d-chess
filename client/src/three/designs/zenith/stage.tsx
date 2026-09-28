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
  Vector4,
} from 'three';
import type { Camera } from 'three';
import type { StageProps } from '../types';
import { PieceType } from '../../../engine/pieces';
import { PROFILES } from '../../pieces';
import { CLARITY_TOWER_DEFAULTS } from '../kit/layouts';
import { noRaycast } from '../kit/noRaycast';
import { TOWER_MASK } from './mask';
import { FRAME, GROUND_Y, layout, MARGIN, PALETTE, PIECE_SCALE } from './palette';
import { Details } from './details';
import { Heavens } from './heavens';
import { sculptureOf } from './sculptures';
import { useEnvSetting } from './settings-env';

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
// side has one or two; a sculpture nearing the tower on screen dims by
// degrees and slips behind it into shade, and the board's lines behind the
// tower are held down to nothing (mask.ts). Overhead, stars and chess
// constellations for a camera that looks up (heavens.tsx). Nothing moves.

// --- The night sky ------------------------------------------------------------------

/** The horizon's wider glow and far banks of mist: 1 with the close-look details, else 0. */
const skyLayers = { value: 1 };

const Sky = () => {
  const { geometry, material } = useMemo(
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
          uLayers: skyLayers,
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
          uniform float uLayers;
          void main() {
            vec3 d = normalize(vDir);
            float h = d.y;
            vec3 c = h > 0.0
              ? mix(uHorizon, uTop, pow(h, 0.45))
              : mix(uHorizon, uBottom, pow(-h, 0.5));
            // A breath of mist lying along the horizon, in a soft wider glow
            c += uMist * exp(-pow(h / 0.05, 2.0)) * 0.045;
            c += uMist * exp(-pow(h / 0.16, 2.0)) * 0.008 * uLayers;
            // Far off, two banks of mist, their tops rolling slowly round
            // the horizon (whole waves round it, so they close up behind)
            float az = atan(d.x, d.z);
            float low = 0.012 + 0.006 * sin(az * 3.0 + 0.7) + 0.004 * sin(az * 7.0 + 2.1);
            float high = 0.034 + 0.009 * sin(az * 2.0 + 4.0) + 0.005 * sin(az * 5.0 + 0.3);
            float bank = smoothstep(low + 0.014, low - 0.004, h) * smoothstep(-0.05, -0.005, h);
            float stratum = exp(-pow((h - high) / 0.007, 2.0));
            c += uMist * (bank * 0.014 + stratum * 0.008) * uLayers;
            gl_FragColor = vec4(c, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    }),
    [],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
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
  varying float vCover;
  ${TOWER_MASK}
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vP = w.xz;
    vWorld = w.xyz;
    // The mask is smooth: per vertex, on a finer mesh
    vCover = towerCover(w.xyz);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const groundFragment = /* glsl */ `
  uniform vec3 uGround;
  uniform vec3 uLine;
  uniform vec3 uHorizon;
  uniform float uSquare;
  uniform vec2 uClear;
  varying vec2 vP;
  varying vec3 vWorld;
  varying float vCover;
  void main() {
    vec3 view = normalize(vWorld - cameraPosition);
    float r = length(vP);
    float dist = distance(vWorld, cameraPosition);
    // The colossal board's lines, coverage-correct at any distance, joined
    // by taking the brighter (never summed), so crossings stay even
    vec2 uv = vP / uSquare + 4.0;
    vec4 dd = vec4(dFdx(uv), dFdy(uv));
    vec2 deriv = max(vec2(length(dd.xz), length(dd.yw)), vec2(1e-6));
    vec2 target = vec2(0.006);
    vec2 draw = clamp(target, deriv, vec2(0.5));
    vec2 aa = deriv * 1.5;
    vec2 g = 1.0 - abs(fract(uv) * 2.0 - 1.0);
    vec2 lines = smoothstep(draw + aa, draw - aa, g);
    lines *= clamp(target / draw, 0.0, 1.0);
    lines = mix(lines, target, clamp(deriv * 2.0 - 1.0, 0.0, 1.0));
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
    float hidden = 1.0 - vCover;
    float lit = (line * 0.04 + lightSq * 0.004) * clear * far * hidden;
    // Polished: toward the horizon it gives back the mist
    float fresnel = pow(1.0 - abs(view.y), 5.0);
    vec3 col = uGround + uLine * lit + uHorizon * fresnel * 0.9;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const Ground = () => {
  const { geometry, material } = useMemo(
    () => ({
      geometry: new PlaneGeometry(260, 260, 24, 24).rotateX(-Math.PI / 2),
      material: new ShaderMaterial({
        // Drawn first and writing no depth: the reflections go under it
        depthWrite: false,
        uniforms: {
          uGround: { value: new Color(PALETTE.ground) },
          uLine: { value: new Color(PALETTE.neon) },
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
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
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
 * the queen behind it; Black sees White's queen and a bishop.
 */
const PLACES: { type: PieceType; square: string }[] = [
  { type: PieceType.King, square: 'e1' },
  { type: PieceType.King, square: 'e8' },
  { type: PieceType.Queen, square: 'd1' },
  { type: PieceType.Queen, square: 'd8' },
  { type: PieceType.Bishop, square: 'g2' },
  { type: PieceType.Bishop, square: 'b7' },
  { type: PieceType.Unicorn, square: 'b2' },
  { type: PieceType.Unicorn, square: 'g7' },
  { type: PieceType.Knight, square: 'a4' },
  { type: PieceType.Knight, square: 'a5' },
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

/** Every sculpture's square and where it stands (for tests and the sweep). */
export const GARDEN = PLACES.map(({ type, square }) => ({ type, square, at: anchorOf(square) }));

/**
 * Every sculpture's tubes as one ribbon mesh. Each vertex carries its
 * sculpture's anchor, its point and tangent (in the drawing plane for an
 * outline, in 3D for a ring) and its side of the ribbon; the vertex shader
 * turns an outline to face the camera and widens every tube across the view,
 * so the whole garden is one draw call.
 */
const neonGeometry = (): BufferGeometry => {
  const anchor: number[] = [];
  const local: number[] = [];
  const tangent: number[] = [];
  const side: number[] = [];
  const mode: number[] = [];
  const place: number[] = [];
  const index: number[] = [];
  let current = 0;
  const addCurve = (
    at: [number, number, number],
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
        local.push(...pts[k]);
        tangent.push(t[0] / l, t[1] / l, t[2] / l);
        side.push(s);
        mode.push(fixed ? 1 : 0);
        place.push(current);
      }
    }
    const segments = closed ? n : n - 1;
    for (let k = 0; k < segments; k++) {
      const a = base + 2 * k;
      const b = base + 2 * ((k + 1) % n);
      index.push(a, a + 1, b, b, a + 1, b + 1);
    }
  };
  GARDEN.forEach(({ type, at }, i) => {
    current = i;
    const drawing = sculptureOf(type);
    for (const o of drawing.outlines) {
      addCurve(
        at,
        o.points.map(([x, y]) => [x * SCALE, y * SCALE, 0]),
        o.closed,
        false,
      );
    }
    for (const ring of drawing.rings) {
      const pts = Array.from({ length: 24 }, (_, k): [number, number, number] => {
        const a = (k / 24) * Math.PI * 2;
        return [
          Math.cos(a) * ring.radius * SCALE,
          ring.y * SCALE,
          Math.sin(a) * ring.radius * SCALE,
        ];
      });
      addCurve(at, pts, true, true);
    }
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(local), 3));
  g.setAttribute('aAnchor', new BufferAttribute(new Float32Array(anchor), 3));
  g.setAttribute('aTangent', new BufferAttribute(new Float32Array(tangent), 3));
  g.setAttribute('aSide', new BufferAttribute(new Float32Array(side), 1));
  g.setAttribute('aMode', new BufferAttribute(new Float32Array(mode), 1));
  g.setAttribute('aPlace', new BufferAttribute(new Float32Array(place), 1));
  g.setIndex(index);
  return g;
};

// --- Behind the tower ------------------------------------------------------------------

/**
 * How much of each sculpture the tower hides from the camera, 0 to 1, one
 * value per place, written every frame. A sculpture dims as a whole (with
 * its reflection and mist) as its outline on screen nears the tower's, the
 * level letters beside it included: gently from well before the two touch
 * (FADE_NDC), to about two thirds as they do, then, as it slips behind, by
 * the share of it the tower covers. On top of that, whatever part of it
 * lies over the tower's glass on screen is held down to nothing with a soft
 * edge (TOWER_SCREEN), so a sculpture half behind the tower is a dim half
 * beside it, and no line of it ever shows through the glass.
 */
const covers = { value: GARDEN.map(() => 0) };
/** The tower's rectangle on screen (NDC, x scaled by the aspect). */
const towerRect = { value: new Vector4(0, 0, 0, 0) };
/** The drawing buffer's size in pixels and its aspect, to find NDC per fragment. */
const viewport = { value: new Vector3(1, 1, 1) };
/** The player's sculpture brightness (settings-env.ts). */
const brightness = { value: 1 };
/**
 * 1, or -1 to turn the garden half about for Black: the tower's board is
 * walked around rather than turned (layout.ts), so the colossal board and
 * everything on it turn with it, and a1 lies at Black's far left as it does
 * on the tower. (Its lines and checker look the same either way.)
 */
const gardenTurn = { value: 1 };

/** The platforms' own square (the letters and numbers round it: MARGIN_NDC). */
const TOWER_HALF = FRAME.half + MARGIN;
const TOWER_Y: [number, number] = [
  FRAME.levelY[0] - 0.1,
  FRAME.levelY[4] + (0.87 + 0.14) * PIECE_SCALE + 0.1,
];
/** Room round the tower's outline on screen for its labels (NDC, height units). */
const MARGIN_NDC = 0.06;
/**
 * How far outside that a sculpture starts to dim (NDC, height units, at the
 * default fade): wide, so the fade reads as the sculpture drifting into the
 * tower's shade rather than switching off.
 */
export const FADE_NDC = 0.3;
/** How bright a sculpture still is as its outline touches the tower's. */
const TOUCH_LIGHT = 0.7;
/** The share of a sculpture behind the tower by which it has dimmed away. */
const FADE_OVER = 0.9;
/** Smoothstep on 0–1, clamped. */
const smooth = (x: number) => {
  const k = Math.min(Math.max(x, 0), 1);
  return k * k * (3 - 2 * k);
};
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
const TOWER_POINTS = [-1, 1].flatMap((sx) =>
  [-1, 1].flatMap((sz) =>
    TOWER_Y.map((y): [number, number, number] => [sx * TOWER_HALF, y, sz * TOWER_HALF]),
  ),
);
const SIZES = GARDEN.map(({ type, at }) => {
  const height = sculptureOf(type).top * SCALE;
  return {
    at,
    radius: PROFILES.radius[type] * SCALE,
    // The reflection's brighter upper part belongs to it too
    ys: [GROUND_Y - 0.35 * height, GROUND_Y + height],
  };
});

/**
 * How each sculpture stands on screen: how much the tower hides it, and how
 * much of it is in frame.
 */
export interface SculptureView {
  /** 0 clear of the tower (and its labels), 1 faded out. */
  cover: number;
  /** Share of the sculpture's screen rectangle inside the frame, 0–1. */
  inFrame: number;
}

/** The tower's screen rectangle, labels included (null when it is not wholly in front). */
export const towerOnScreen = (camera: Camera, aspect: number): Rect | null => {
  camera.updateMatrixWorld();
  const t = rectOf(camera, TOWER_POINTS, aspect);
  if (!t.seen) return null;
  return {
    x0: t.x0 - MARGIN_NDC,
    x1: t.x1 + MARGIN_NDC,
    y0: t.y0 - MARGIN_NDC,
    y1: t.y1 + MARGIN_NDC,
    seen: true,
  };
};

/**
 * Every sculpture's cover and framing for a camera (pure, for tests and the
 * sweep). `fade` widens (above 1) or narrows the dimming before the tower;
 * `turn` is -1 when the garden is turned about for Black (gardenTurn).
 */
export const gardenView = (camera: Camera, aspect: number, fade = 1, turn = 1): SculptureView[] => {
  const t = towerOnScreen(camera, aspect);
  right.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
  return SIZES.map(({ at: home, radius, ys }) => {
    const at = [home[0] * turn, home[1], home[2] * turn];
    // The sculpture as it faces the camera: its axis, as wide as its base
    const around = (heights: number[]) =>
      [-1, 1].flatMap((s) =>
        heights.map((y): [number, number, number] => [
          at[0] + right.x * radius * s,
          y,
          at[2] + right.z * radius * s,
        ]),
      );
    const r = rectOf(camera, around(ys), aspect);
    if (!r.seen || !t) return { cover: 0, inFrame: 0 };
    // Nearing the tower it dims by degrees, to TOUCH_LIGHT as the two touch;
    // passing behind, the share of it over the tower fades what is left
    // (the part over the tower itself is held down further, per pixel)
    const width = Math.max(r.x1 - r.x0, 1e-6);
    const height = Math.max(r.y1 - r.y0, 1e-6);
    const ox = Math.min(r.x1, t.x1) - Math.max(r.x0, t.x0);
    const oy = Math.min(r.y1, t.y1) - Math.max(r.y0, t.y0);
    const gap = Math.hypot(Math.max(-ox, 0), Math.max(-oy, 0));
    const near = smooth(1 - gap / (FADE_NDC * fade));
    const over = ox > 0 && oy > 0 ? smooth((ox * oy) / (width * height) / FADE_OVER) : 0;
    const light = (1 - (1 - TOUCH_LIGHT) * near) * (1 - over);
    // In frame: the sculpture itself, above the ground
    const body = rectOf(camera, around([GROUND_Y, ys[1]]), aspect);
    const w = Math.max(body.x1 - body.x0, 1e-6);
    const h = Math.max(body.y1 - body.y0, 1e-6);
    const ix = Math.max(0, Math.min(body.x1, aspect) - Math.max(body.x0, -aspect));
    const iy = Math.max(0, Math.min(body.y1, 1) - Math.max(body.y0, -1));
    return { cover: 1 - light, inFrame: (ix * iy) / (w * h) };
  });
};

const drawingBuffer = new Vector2();
const TowerCovers = ({ turn }: { turn: number }) => {
  const fade = useEnvSetting<number>('env.sculptureFade');
  const bright = useEnvSetting<number>('env.sculptures');
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    brightness.value = bright;
    gardenTurn.value = turn;
    invalidate();
  }, [bright, fade, turn, invalidate]);
  useFrame(({ camera, size, gl }) => {
    const aspect = size.width / Math.max(size.height, 1);
    const view = gardenView(camera, aspect, fade, turn);
    view.forEach(({ cover }, i) => {
      covers.value[i] = cover;
    });
    // The glass itself, without the room for its labels
    const t = towerOnScreen(camera, aspect);
    if (t) {
      const m = MARGIN_NDC;
      towerRect.value.set(t.x0 + m, t.x1 - m, t.y0 + m, t.y1 - m);
    } else towerRect.value.set(0, 0, 0, 0);
    gl.getDrawingBufferSize(drawingBuffer);
    viewport.value.set(drawingBuffer.x, drawingBuffer.y, aspect);
  });
  return null;
};

/**
 * GLSL: `float towerScreen()`, 1 where this fragment lies over the tower's
 * glass on screen, easing to 0 across a soft band round its outline.
 */
const TOWER_SCREEN = /* glsl */ `
  uniform vec4 uTowerRect;
  uniform vec3 uViewport;
  float towerScreen() {
    vec2 ndc = gl_FragCoord.xy / uViewport.xy * 2.0 - 1.0;
    ndc.x *= uViewport.z;
    vec2 c = vec2(uTowerRect.x + uTowerRect.y, uTowerRect.z + uTowerRect.w) * 0.5;
    vec2 h = vec2(uTowerRect.y - uTowerRect.x, uTowerRect.w - uTowerRect.z) * 0.5;
    vec2 q = abs(ndc - c) - h;
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    return 1.0 - smoothstep(-0.05, 0.05, d);
  }`;

const neonVertex = /* glsl */ `
  uniform float uWidth;
  uniform float uMirror;
  uniform float uGround;
  uniform float uTurn;
  attribute vec3 aAnchor;
  attribute vec3 aTangent;
  attribute float aSide;
  attribute float aMode;
  attribute float aPlace;
  uniform float uCover[${GARDEN.length}];
  varying float vAcross;
  varying float vCover;
  varying float vDepth;
  varying float vRing;
  void main() {
    // Turned about for Black, as the board is (gardenTurn)
    vec3 anchor = vec3(aAnchor.x * uTurn, aAnchor.y, aAnchor.z * uTurn);
    vec3 toCam = cameraPosition - anchor;
    vec2 h = normalize(toCam.xz + vec2(1e-5, 0.0));
    // The drawing's plane faces the camera, turned about the vertical
    vec3 right = vec3(h.y, 0.0, -h.x);
    // A knight looks in toward the board, whichever side of it it stands
    float face = dot(right.xz, -anchor.xz) >= 0.0 ? 1.0 : -1.0;
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
    // The whole sculpture dims together, never sliced by the tower
    vCover = uCover[int(aPlace + 0.5)];
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

const neonFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uCore;
  uniform float uHalo;
  uniform float uIntensity;
  uniform float uFade;
  uniform float uBoost;
  uniform float uBright;
  varying float vAcross;
  varying float vCover;
  varying float vDepth;
  varying float vRing;
  ${TOWER_SCREEN}
  void main() {
    float a = abs(vAcross);
    float fw = max(fwidth(vAcross), 1e-5);
    // The tube: never thinner than about a pixel, dimmer instead
    float w = max(uCore, fw * 0.8);
    float core = (1.0 - smoothstep(w - fw, w + fw, a)) * min(uCore / w, 1.0);
    float halo = exp(-a * a * 7.0) * (1.0 - a) * uHalo;
    // The rings a little quieter than the outlines they stand the pieces on
    float light = (core + halo) * uIntensity * uBright * (1.0 + uBoost) * (1.0 - 0.3 * vRing);
    // A reflection fades with its depth under the polished ground
    light *= uFade > 0.0 ? exp(-vDepth / uFade) : 1.0;
    light *= (1.0 - vCover) * (1.0 - 0.94 * towerScreen());
    if (light < 0.001) discard;
    gl_FragColor = vec4(uColor * light, 1.0);
    #include <colorspace_fragment>
  }`;

/** Brightens the garden for a moment at mate (fx.tsx). */
export const gardenBoost = { value: 0 };

const neonMaterial = (o: {
  width: number;
  core: number;
  halo: number;
  intensity: number;
  mirror: boolean;
  fade: number;
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
      uCover: covers,
      uBright: brightness,
      uTowerRect: towerRect,
      uViewport: viewport,
      uTurn: gardenTurn,
      uWidth: { value: o.width },
      uCore: { value: o.core },
      uHalo: { value: o.halo },
      uIntensity: { value: o.intensity },
      uMirror: { value: o.mirror ? 1 : 0 },
      uGround: { value: GROUND_Y },
      uFade: { value: o.fade },
      uBoost: gardenBoost,
    },
    vertexShader: neonVertex,
    fragmentShader: neonFragment,
  });

const Sculptures = ({ turn }: { turn: number }) => {
  const { geometry, tubes, reflection } = useMemo(
    () => ({
      geometry: neonGeometry(),
      tubes: neonMaterial({
        width: 0.26,
        core: 0.12,
        halo: 0.06,
        intensity: 0.078,
        mirror: false,
        fade: 0,
      }),
      // Softer and dimmer in the polished stone, fading with depth
      reflection: neonMaterial({
        width: 0.45,
        core: 0.05,
        halo: 0.14,
        intensity: 0.025,
        mirror: true,
        fade: 3.2,
      }),
    }),
    [],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      tubes.dispose();
      reflection.dispose();
    },
    [geometry, tubes, reflection],
  );
  return (
    <group name="monolith-garden">
      <TowerCovers turn={turn} />
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
  const places: number[] = [];
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
      places.push(i);
    }
    const b = i * 4;
    index.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(corner), 3));
  g.setAttribute('aAnchor', new BufferAttribute(new Float32Array(anchor), 3));
  g.setAttribute('aSize', new BufferAttribute(new Float32Array(size), 2));
  g.setAttribute('aPlace', new BufferAttribute(new Float32Array(places), 1));
  g.setIndex(index);
  return g;
};

const Mist = () => {
  const { geometry, material } = useMemo(
    () => ({
      geometry: mistGeometry(),
      material: new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: {
          uColor: { value: new Color(PALETTE.mist) },
          uBoost: gardenBoost,
          uCover: covers,
          uBright: brightness,
          uTowerRect: towerRect,
          uViewport: viewport,
          uTurn: gardenTurn,
        },
        vertexShader: /* glsl */ `
          uniform float uTurn;
          attribute vec3 aAnchor;
          attribute vec2 aSize;
          attribute float aPlace;
          uniform float uCover[${GARDEN.length}];
          varying vec2 vC;
          varying float vCover;
          void main() {
            vec3 anchor = vec3(aAnchor.x * uTurn, aAnchor.y, aAnchor.z * uTurn);
            vec2 h = normalize((cameraPosition - anchor).xz + vec2(1e-5, 0.0));
            vec3 right = vec3(h.y, 0.0, -h.x);
            vec3 p = anchor + right * position.x * aSize.x + vec3(0.0, position.y * aSize.y, 0.0);
            vC = position.xy;
            vCover = uCover[int(aPlace + 0.5)];
            gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uBoost;
          uniform float uBright;
          varying vec2 vC;
          varying float vCover;
          ${TOWER_SCREEN}
          void main() {
            float m = exp(-dot(vC * vec2(2.0, 2.6), vC * vec2(2.0, 2.6)));
            float a = m * 0.075 * (1.0 + 0.6 * uBoost) * (1.0 - vCover);
            a *= min(uBright, 1.4) * (1.0 - 0.94 * towerScreen());
            if (a < 0.001) discard;
            gl_FragColor = vec4(uColor * a, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    }),
    [],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
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

/** The lowest view without looking up: the compact tower's own, 6° above level. */
const LEVEL_MAX_POLAR = ((90 - CLARITY_TOWER_DEFAULTS.minElevation) * Math.PI) / 180;

/**
 * The orbit may sink below the horizon to look up (layout's minElevation),
 * but never through the ground: before the controls update each frame, their
 * lowest angle is raised as far as the camera's distance needs, so zoomed in
 * it looks up the full 20° and zoomed out a little less, and a zoom out at
 * the lowest angle lifts the camera rather than sinking it into the plain.
 * With looking up turned off (settings-env.ts) the orbit stops where the
 * compact tower's does, 6° above level.
 */
const CameraFloor = () => {
  const controls = useThree((s) => s.controls) as unknown as OrbitLike | null;
  const lookUp = useEnvSetting<boolean>('env.lookUp');
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!controls) return;
    invalidate();
    return () => {
      controls.maxPolarAngle = BASE_MAX_POLAR;
    };
  }, [controls, lookUp, invalidate]);
  useFrame(({ camera }) => {
    if (!controls) return;
    const d = camera.position.distanceTo(controls.target);
    const lowest = (GROUND_Y + CLEARANCE - controls.target.y) / Math.max(d, 1e-3);
    const base = lookUp ? BASE_MAX_POLAR : Math.min(BASE_MAX_POLAR, LEVEL_MAX_POLAR);
    controls.maxPolarAngle = Math.min(base, Math.acos(Math.min(Math.max(lowest, -1), 1)));
  }, -2);
  return null;
};

export const Stage = ({ orientation }: StageProps) => {
  const turn = orientation === 'black' ? -1 : 1;
  const stars = useEnvSetting<boolean>('env.stars');
  const figures = useEnvSetting<boolean>('env.constellations');
  const details = useEnvSetting<boolean>('env.details');
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    skyLayers.value = details ? 1 : 0;
    invalidate();
  }, [details, invalidate]);
  return (
    <>
      <CameraFloor />
      <Heavens stars={stars} figures={figures} />
      <Sky />
      <Ground />
      <Sculptures turn={turn} />
      <Mist />
      {details && <Details turn={turn} />}
    </>
  );
};
