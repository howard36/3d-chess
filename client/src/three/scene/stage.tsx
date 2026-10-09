import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  BackSide,
  BufferGeometry,
  Color,
  CustomBlending,
  MathUtils,
  MaxEquation,
  OneFactor,
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
  SHADE_AT_VERTEX,
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
import { GardenSides } from './gardenSides';
import type { GardenFigure } from './gardenSides';
import { neonStrokes, STROKE_TUBE, STROKE_VERTEX, updateStrokes } from './neonStrokes';
import { KNIGHT_SEGMENTS, KnightLines, sculptureStrokes } from './sculptureStrokes';
import type { Place } from './sculptureStrokes';
import { boardGroundGlsl } from './boardGround';
import { FALLEN, fallenBodies } from './boardFallen';
import { SkyDetail, skyAirUniforms } from './skyDetail';
import { SKY_COLOR } from './skyColor';
import { BoardDetail } from './boardDetail';
import { Court, COURT_REACH, COURT_GLSL, courtUniforms } from './court';
import { Horizon } from './horizon';
import { SculptureGlow } from './sculptureGlow';
import { groundParts, VEIL_MIX, VEIL_VERTEX_GLSL } from './horizonGround';

// The garden at night. The tower floats over an endless dark plain of
// glossy stone; under it, nothing, so from straight above there is only
// darkness through the levels. Further out the plain carries a colossal
// chessboard, eight squares by eight (a1 dark, as on any board), drawn in
// the faintest lines of light and fading into the horizon, and on it stand
// twelve colossal chess pieces, each on the centre of its square, twins
// facing each other across the board (PLACES), drawn only in thin white
// neon tube: their outlines (sculptures.ts) turn to face the viewer as a
// turned piece looks the same from every side, and stand on real rings of
// light round their bases and collars. Each throws a faint glow on the stone
// round its foot (sculptureGlow.tsx), and the ground gives back a faint,
// soft reflection of its tubes. The tubes are dim and join by taking the
// brighter (never summed), so no knot of light outshines the board. Two
// flank the tower in the opening view, and every side has one or two.
// Everything here sinks into the tower's shade near it on screen, a smooth
// gradient darkest over the tower's glass (mask.ts), so a sculpture nearing
// the tower darkens steadily and slips behind it with no edge anywhere.
// Overhead, stars and chess constellations for a camera that looks up
// (heavens.tsx).

// --- The night sky ------------------------------------------------------------------

/**
 * The sky drawn: its colour in each direction from its centre (skyColor.ts).
 * Its light sinks into the tower's shade, taken per vertex (its sphere is
 * fine): the air is faint and the shade smooth, and per pixel the shade
 * would be most of the sky's cost in software.
 */
const SKY_FRAGMENT = /* glsl */ `
  ${SKY_COLOR}
  varying vec3 vDir;
  varying float vShade;
  void main() {
    gl_FragColor = vec4(skyColorShaded(normalize(vDir), vShade), 1.0);
    #include <colorspace_fragment>
  }`;

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  ${SHADE_AT_VERTEX}
  varying float vShade;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vShade = shadeOfClip(gl_Position);
  }`;

/**
 * How far below the horizon the sky is drawn over the round plain (degrees,
 * a whole number of the sphere's 11.25° rings): the plain hides everything
 * lower, out to its rim (horizonGround.ts), from as high as the camera
 * climbs, so the sky need not be worked out there only to be drawn over.
 */
const SKY_BELOW = 22.5;

const Sky = () => {
  const parts = useMemo(
    () => ({
      // Rings 5.625° apart, down to SKY_BELOW
      geometry: new SphereGeometry(
        400,
        64,
        (8 + SKY_BELOW / 11.25) * 2,
        0,
        Math.PI * 2,
        0,
        Math.PI / 2 + MathUtils.degToRad(SKY_BELOW),
      ),
      material: new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTop: { value: new Color(PALETTE.skyTop) },
          uHorizon: { value: new Color(PALETTE.skyHorizon) },
          uBottom: { value: new Color(PALETTE.skyBottom) },
          uMist: { value: new Color(PALETTE.mist) },
          ...skyAirUniforms(),
        },
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
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

/** The brightness of the colossal board: its lines and its light squares together. */
const BOARD = 1.1;

/** How far out from the board's edge its frame's band reaches (world units). */
const FRAME_BAND = 6;

/**
 * What one part of the plain draws: the board's detail that lies in it
 * (boardGround.ts), whether the court's stone and inlay do (court.tsx), and
 * whether it lies wholly in the clear ground round the tower's foot (inside
 * CLEAR[0]), where the board draws nothing at all.
 */
interface GroundPart {
  detail: ReturnType<typeof boardGroundGlsl> | null;
  court: boolean;
  clear: boolean;
}

const groundVertex = ({ clear }: GroundPart) => /* glsl */ `
  uniform float uTurn;
  varying vec2 vP;
  varying vec3 vWorld;
  ${SHADE_AT_VERTEX}
  ${SKY_COLOR}
  varying vec4 vVeil;
  ${clear ? 'varying float vLit;' : ''}
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vP = w.xz;
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
    ${VEIL_VERTEX_GLSL}
    ${
      // The court's light in the clear part takes the tower's shade per
      // vertex (the part's mesh is fine)
      clear ? 'vLit = 1.0 - shadeOfClip(gl_Position);' : ''
    }
  }`;

/**
 * GLSL: `vec3 faintToDisplay(vec3 c)`, the display's value of faint light
 * (three.js's sRGB transfer) without its power, which software works out
 * slowly: a fit in square and fourth roots, within 0.05 of a step of 255 up
 * to 0.15 (the court's light stays far under it).
 */
const FAINT_TO_DISPLAY = /* glsl */ `
  vec3 faintToDisplay(vec3 c) {
    vec3 s = sqrt(c);
    vec3 fit = 0.90569927 * s + 0.25728784 * sqrt(s) - 0.10946774 * c - 0.07093325;
    return mix(fit, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
  }`;

/**
 * The end of the ground's shader: the plain's colour (`col`) as the display
 * shows it, with the veil mixed over it and the court added to it (its
 * light before the shade: `courtLit`), as blending them on in passes of
 * their own would.
 */
const groundOutput = (court: boolean, courtLit: string) => /* glsl */ `
    vec4 shown = linearToOutputTexel(vec4(col, 1.0));
    ${VEIL_MIX}
    ${
      court
        ? `{
      float courtLit = ${courtLit};
      vec3 cc = courtLight(bp, r, view) * courtLit;
      if (courtLit >= 0.003 && max(cc.r, max(cc.g, cc.b)) >= 0.0002)
        shown.rgb += faintToDisplay(cc);
    }`
        : ''
    }
    gl_FragColor = shown;`;

/**
 * The ground's shader for one part of the plain: with the colossal board's
 * detail that lies in that part (boardGround.ts), the court's stone and
 * inlay in the court's parts (court.tsx), and the veil that thickens the far
 * plain into the night (horizonGround.ts), each mixed in here rather than
 * blended over the plain in a pass of its own.
 */
const groundFragment = ({ detail, court, clear }: GroundPart) => {
  const head = /* glsl */ `
  uniform vec3 uGround;
  uniform vec3 uLine;
  uniform vec3 uHorizon;
  uniform float uSquare;
  uniform vec2 uClear;
  uniform float uTurn;
  uniform float uDim;
  varying vec2 vP;
  varying vec3 vWorld;
  varying vec4 vVeil;
  ${court ? `${COURT_GLSL}\n  ${FAINT_TO_DISPLAY}` : ''}`;
  if (clear)
    return /* glsl */ `
  ${head}
  varying float vLit;
  void main() {
    vec3 view = normalize(vWorld - cameraPosition);
    float r = length(vP);
    vec2 bp = vP * uTurn;
    // Clear ground round the tower: the colossal board and all its detail
    // are nothing here (each fades in with uClear, from 0 at its start),
    // the polish alone is left
    float fresnel = pow(1.0 - abs(view.y), 5.0);
    vec3 col = uGround + uHorizon * fresnel * 0.9;
    ${groundOutput(court, 'vLit * uDim')}
  }`;
  return /* glsl */ `
  ${head}
  ${TOWER_SHADE}
  ${GRID_LINES}
  ${detail?.decl ?? ''}
  void main() {
    vec3 view = normalize(vWorld - cameraPosition);
    float r = length(vP);
    float dist = distance(vWorld, cameraPosition);
    // The board in its own coordinates, turned half about for Black (its
    // lines and checker look the same either way; its detail does not)
    vec2 bp = vP * uTurn;
    // The colossal board's lines, joined by taking the brighter (never
    // summed), so crossings stay even
    vec2 uv = bp / uSquare + 4.0;
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
    float glow = 0.0;
    ${detail?.lines ?? ''}
    float lit = (line * 0.04 + lightSq * 0.004) * ${BOARD.toFixed(1)} * clear * far * hidden;
    lit += glow * far * hidden;
    // Polished: toward the horizon it gives back the mist
    float fresnel = pow(1.0 - abs(view.y), 5.0);
    vec3 col = uGround + uLine * lit + uHorizon * fresnel * 0.9;
    ${detail?.polish ?? ''}
    ${groundOutput(court, 'hidden * uDim')}
  }`;
};

/**
 * The ground's four parts (horizonGround.ts's groundParts), each with only
 * the detail that lies in it: a software renderer (CI's) works out all of a
 * shader for every pixel, so a part pays for nothing that lies elsewhere.
 * The clear ground round the tower's foot has the court's stone alone; the
 * rest of the court's disc, the court and the board's squares; the board
 * out to its frame's band, the squares and frame; the far plain, none of
 * them. All have the veil (the camera can stand far enough out for it to
 * reach the court), worked out per vertex.
 */
const groundMaterials = () => {
  const material = (part: GroundPart): ShaderMaterial =>
    new ShaderMaterial({
      // Drawn first and writing no depth: the reflections go under it
      depthWrite: false,
      uniforms: {
        uGround: { value: new Color(PALETTE.ground) },
        uLine: { value: new Color(PALETTE.neon) },
        ...shadeUniforms(),
        uHorizon: { value: new Color(PALETTE.skyHorizon) },
        uTop: { value: new Color(PALETTE.skyTop) },
        uBottom: { value: new Color(PALETTE.skyBottom) },
        uMist: { value: new Color(PALETTE.mist) },
        ...skyAirUniforms(),
        ...(part.court ? courtUniforms() : {}),
        uSquare: { value: SQUARE },
        uClear: { value: [...CLEAR] },
        uTurn: gardenTurn,
        uDim: gardenDim,
      },
      vertexShader: groundVertex(part),
      fragmentShader: groundFragment(part),
    });
  return {
    middle: material({ detail: null, court: true, clear: true }),
    court: material({ detail: boardGroundGlsl(false), court: true, clear: false }),
    board: material({ detail: boardGroundGlsl(true), court: false, clear: false }),
    far: material({ detail: null, court: false, clear: false }),
  };
};

const PARTS = ['middle', 'court', 'board', 'far'] as const;

const Ground = () => {
  const geometry = useMemo(() => groundParts(CLEAR[0], COURT_REACH, 4 * SQUARE + FRAME_BAND), []);
  useDisposeOnUnmount(geometry);
  const materials = useMemo(groundMaterials, []);
  useDisposeOnUnmount(materials);
  return (
    <group name="ground" position={[0, GROUND_Y, 0]}>
      {PARTS.map((part) => (
        <mesh
          key={part}
          name={`ground-${part}`}
          geometry={geometry[part]}
          material={materials[part]}
          // The court's ring over the clear middle's rim
          renderOrder={part === 'middle' ? -900.1 : -900}
          raycast={noRaycast}
        />
      ))}
    </group>
  );
};

// --- The sculptures ---------------------------------------------------------------------

/** Their scale: a colossal king stands about 5.6 units tall. */
export const SCALE = 6.5;

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
 * the queen behind it; Black sees White's queen and a bishop. What is not
 * the same from every side faces in toward the board's centre, but the
 * knights, side by side, look at each other (`faces`): they stand facing
 * each other in the world, outlined by their silhouette from wherever the
 * camera is (knightSilhouette.ts).
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

/** gardenWhole's slots: the sculptures', then the fallen pieces', then one always drawn. */
export const FALLEN_SLOT = PLACES.length;
export const WHOLE_SLOTS = FALLEN_SLOT + FALLEN.length + 1;
export const ALWAYS_WHOLE = WHOLE_SLOTS - 1;

/**
 * Every sculpture's tubes as one stroke mesh (neonStrokes.ts), but the
 * knights' outlines (KnightLines, useKnightTubes): the vertex shader turns an
 * outline to face the camera and spans every tube across the view, so the
 * whole garden is one draw call. (The lobby draws its empty seats with the
 * same tubes: a king at piece scale.)
 */
export const neonGeometry = (places: readonly Place[] = GARDEN, scale = SCALE): BufferGeometry =>
  neonStrokes(sculptureStrokes(places, scale));

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
export const gardenTurn = { value: 1 };
/** The sculptures' and their mist's brightness: 1 in the game, less behind the lobby's kings. */
export const gardenDim = { value: 1 };
/**
 * Whether each figure of the garden is drawn (1) or left out (0, one the
 * camera stands behind: gardenSides.ts): the twelve sculptures, then the
 * fallen pieces, and a last slot always drawn. Their tubes, reflections and
 * glow on the ground all take it.
 */
export const gardenWhole = { value: new Float32Array(WHOLE_SLOTS).fill(1) };
const drawingBuffer = new Vector2();
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

/** The fallen pieces' outlines on the ground, as points round them (boardFallen.ts). */
const FALLEN_BODIES = fallenBodies(SCALE, GROUND_Y);

/**
 * How far round its foot a sculpture's light on the ground reaches (world
 * units): its glow (sculptureGlow.tsx), its footprint and the hand-high
 * pawn at the king's foot.
 */
const GROUND_REACH = 7;

/**
 * Every figure of the garden (the twelve sculptures, then the fallen
 * pieces, as gardenWhole's slots) with boxes round all it draws: its tubes
 * and their reflection, and its light on the ground (gardenSides.ts).
 */
export const GARDEN_FIGURES: GardenFigure[] = [
  ...GARDEN.map(({ type, at }): GardenFigure => {
    const drawing = sculptureOf(type);
    const across = drawing.outlines.reduce(
      (r, o) => o.points.reduce((m, [x]) => Math.max(m, Math.abs(x)), r),
      PROFILES.radius[type],
    );
    // Wide enough for a knight's head whichever way it faces
    const r = across * SCALE + 1;
    const h = drawing.top * SCALE + 0.5;
    const [x, , z] = at;
    return {
      at: [x, z],
      boxes: [
        [x - r, GROUND_Y - h, z - r, x + r, GROUND_Y + h, z + r],
        [
          x - GROUND_REACH,
          GROUND_Y - 1,
          z - GROUND_REACH,
          x + GROUND_REACH,
          GROUND_Y + 1,
          z + GROUND_REACH,
        ],
      ],
    };
  }),
  ...FALLEN_BODIES.map((points): GardenFigure => {
    const lo = [0, 1, 2].map((k) => Math.min(...points.map((p) => p[k])) - 0.5);
    const hi = [0, 1, 2].map((k) => Math.max(...points.map((p) => p[k])) + 0.5);
    // Down to its reflection's foot
    lo[1] = Math.min(lo[1], 2 * GROUND_Y - hi[1]);
    return {
      at: [(lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2],
      boxes: [[lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]]],
    };
  }),
];

/**
 * Every frame, the tower's outline on screen for the shade (mask.ts), which
 * way the garden is turned, and which figures are drawn (gardenWhole), into
 * their uniforms.
 */
const GardenUniforms = ({
  turn,
  shade,
  dim = 1,
  sides = false,
}: {
  turn: number;
  shade?: ShadeStack;
  dim?: number | (() => number);
  /** Leave out a figure the camera stands behind (gardenSides.ts). */
  sides?: boolean;
}) => {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => invalidate(), [turn, shade, dim, sides, invalidate]);
  // Each canvas keeps its own figures shown or not (the lobby's and the game's)
  const figures = useMemo(() => (sides ? new GardenSides(GARDEN_FIGURES) : null), [sides]);
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
    const w = gardenWhole.value;
    w.fill(1);
    if (figures) {
      figures.update(camera, turn);
      figures.shown.forEach((shown, i) => {
        w[i] = shown;
      });
    }
  });
  return null;
};

/** The soft edge of a tube drawn up to a height (`uReveal`, world units). */
export const REVEAL_SOFT = 0.12;

/** The tubes' light (neonStrokes.ts's tube). */
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
  ${STROKE_TUBE}
  ${TOWER_SHADE}
  void main() {
    float t;
    float light = strokeTube(uCore, uHalo, t);
    light *= uIntensity * ${BRIGHT.toFixed(1)} * (1.0 + uBoost);
    float depth = mix(vLit.z, vLit.w, t);
    light *= uFade > 0.0 ? exp(-depth / uFade) : 1.0;
    light *= (1.0 - uShaded * towerShade()) * uDim;
    light *= 1.0 - smoothstep(uReveal - ${REVEAL_SOFT.toFixed(2)}, uReveal, depth + uGround);
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
 * The tubes' light. `turn` is the garden's (gardenTurn) unless given,
 * `shaded: false` keeps them out of the tower's shade (the lobby's seats),
 * and `whole` says which figures are drawn (gardenWhole for the garden's;
 * all of them unless given).
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
  whole?: { value: Float32Array };
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
      uWhole: o.whole ?? { value: new Float32Array(WHOLE_SLOTS).fill(1) },
    },
    vertexShader: STROKE_VERTEX(WHOLE_SLOTS),
    fragmentShader: neonFragment,
  });

/** The sculptures' tubes. */
const TUBES = { width: 0.26, core: 0.12, halo: 0.06, intensity: 0.078, mirror: false, fade: 0 };
/** Their reflections: softer and dimmer in the polished stone, fading with depth. */
const REFLECTION = {
  width: 0.45,
  core: 0.05,
  halo: 0.14,
  intensity: 0.025,
  mirror: true,
  fade: 3.2,
};

/**
 * The garden's tube materials, as the sculptures' (anything drawn with
 * their light: boardDetail.tsx), in three.js's opaque list, which draws
 * first, so the whole garden is drawn before the tower (backdropCache.tsx);
 * still joined by the max.
 */
export const gardenNeon = () => ({
  tubes: opaque(neonMaterial({ ...TUBES, whole: gardenWhole })),
  reflection: opaque(neonMaterial({ ...REFLECTION, whole: gardenWhole })),
});

/**
 * Knights drawn by their silhouette: their strokes rewritten as the camera
 * moves round them (KnightLines), before the frame is drawn; at rest
 * nothing changes, and nothing is redone.
 */
export const useKnightTubes = (knights: KnightLines, turn: number) => {
  const geometry = useMemo(() => neonStrokes([], knights.count * KNIGHT_SEGMENTS), [knights]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame(({ camera }) => {
    const p = camera.position;
    if (knights.update([p.x, p.y, p.z], turn)) updateStrokes(geometry, knights.strokes);
  });
  return geometry;
};

/** A tube geometry drawn with the garden's tube materials (and their reflection). */
export const GardenTubes = ({
  geometry,
  materials,
  order = 0,
}: {
  geometry: BufferGeometry;
  materials: ReturnType<typeof gardenNeon>;
  /** Added to the sculptures' renderOrder (still below the tower: BACKDROP_END). */
  order?: number;
}) => (
  <>
    <mesh
      geometry={geometry}
      material={materials.reflection}
      renderOrder={-880 + order}
      frustumCulled={false}
      raycast={noRaycast}
    />
    <mesh
      geometry={geometry}
      material={materials.tubes}
      renderOrder={-870 + order}
      frustumCulled={false}
      raycast={noRaycast}
    />
  </>
);

export const Sculptures = ({
  turn,
  shade,
  dim,
  sides,
}: {
  turn: number;
  shade?: ShadeStack;
  dim?: number | (() => number);
  /** Leave out a figure the camera stands behind (gardenSides.ts). */
  sides?: boolean;
}) => {
  const parts = useMemo(() => ({ geometry: neonGeometry(), ...gardenNeon() }), []);
  const knights = useMemo(() => new KnightLines(GARDEN, SCALE), []);
  const knightGeometry = useKnightTubes(knights, turn);

  useDisposeOnUnmount(parts);
  const { geometry, tubes, reflection } = parts;
  return (
    <group name="garden">
      <GardenUniforms turn={turn} shade={shade} dim={dim} sides={sides} />
      <GardenTubes geometry={geometry} materials={{ tubes, reflection }} />
      <GardenTubes geometry={knightGeometry} materials={{ tubes, reflection }} />
    </group>
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
  const turn = orientation === 'black' ? -1 : 1;
  return (
    <>
      <CameraFloor />
      <Heavens />
      <Sky />
      <Ground />
      <Sculptures turn={turn} shade={shade} dim={dim} sides />
      <SculptureGlow />
      <SkyDetail />
      <BoardDetail turn={turn} shade={shade} dim={dim} />
      <Court turn={turn} shade={shade} dim={dim} />
      <Horizon turn={turn} shade={shade} dim={dim} />
      <ShootingStar />
    </>
  );
};
