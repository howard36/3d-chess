import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AddEquation,
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  DoubleSide,
  ShaderMaterial,
  SrcColorFactor,
  ZeroFactor,
} from 'three';
import type { GardenDetailProps } from './gardenDetail';
import { noRaycast } from '../noRaycast';
import { useDisposeOnUnmount } from './dispose';
import { SHADE_AT_VERTEX, shadeUniforms } from './mask';
import { GROUND_Y, HORIZON, LEVEL_COLORS, PALETTE } from './palette';
import { BLACK_LOOK, RANGES, skylineOf, WHITE_LOOK } from './horizonSkyline';
import type { Range } from './horizonSkyline';
import { gardenBoost, neonMaterial } from './stage';
import { neonStrokes } from './neonStrokes';
import type { NeonStroke } from './neonStrokes';
import type { V3 } from './boardNeon';
import { rng } from './textures';
import { Lighthouse } from './horizonEvents';
// ENV PREVIEW (temporary): each part follows its setting
import { useEnvSetting } from '../../envPreview';
import {
  farTower,
  hills,
  horizonEvents,
  horizonLights,
  horizonMist,
} from '../../envPreview/features/horizon';

// Area D, the horizon and the far ground beyond the colossal board.
//
// The plain runs on to the end of the world: past the board it thickens
// into the night's own haze (the veil, drawn in the ground's own shader:
// horizonGround.ts), so it meets the sky at a level horizon with no edge or
// corner from any side. Two ranges of low hills
// stand far off on it, near-black against the haze and given back faintly
// by the polished stone; their skylines hide chess pieces worn into rock
// (horizonSkyline.ts), one or two on each seat's side of the world. On
// white's side a far tower, a rook's, keeps one tiny window lit, the only
// warm light in the world, and it goes dark when a game is won. Banks of
// mist lie on the far plain between the board and the hills, and at the
// hills' feet a few far lights burn, and on black's side stands another
// game's tower, five level-coloured plates in a faint cube, too far to be
// more than a square with five lines across it. Once in a long
// while a lighthouse's beam sweeps through the haze (horizonEvents.tsx).
//
// All of it is the garden's (backdropCache.tsx): ShaderMaterials in the
// opaque list, writing no depth, drawn after the ground and never with
// normal blending: the hills and the tower multiply what is behind them (so
// they hide the stars), the mist and the lights add, and the other tower's
// tubes take the brighter, as the sculptures' do. All of it sinks into
// the tower's shade, the dark things by fading to no effect. Nothing moves.
// The veil and the sky do not turn; everything standing on the plain turns with the board for
// Black, so each seat looks out over its opponent's side of the world.

const DEG = Math.PI / 180;

/** Draw order, after the ground (-900) and the stars, before the sculptures. */
const ORDER = {
  farHills: -894,
  nearHills: -893,
  tower: -892,
  otherTower: -891.5,
  mist: -891,
  lights: -890,
} as const;

/** A colour as the display's values (a multiplier applied to what the canvas holds). */
const displayColor = (hex: string) => new Color(hex).convertLinearToSRGB();

/** Multiplies what is already drawn: dst × src. */
const multiply = {
  blending: CustomBlending,
  blendEquation: AddEquation,
  blendSrc: ZeroFactor,
  blendDst: SrcColorFactor,
} as const;

/** The lobby's quieting of the garden, as a uniform kept up to date each frame. */
const useDim = (dim: GardenDetailProps['dim']) => {
  const uniform = useMemo(() => ({ value: 1 }), []);
  useFrame(() => {
    uniform.value = typeof dim === 'function' ? dim() : (dim ?? 1);
  });
  return uniform;
};

// The veil, the plain thickening into the night, is drawn in the ground's
// own shader (stage.tsx, VEIL_VERTEX_GLSL in horizonGround.ts): one pass over the
// plain, not two.

export { VEIL } from './horizonGround';

// --- The far hills -------------------------------------------------------------------

/**
 * A range as a band round the horizon: its foot on the ground, its top on
 * the skyline; then the same again, marked (aMirror) to be drawn as the
 * polished stone gives it back, in the same draw (both multiply what is
 * behind them, which comes out the same in either order).
 */
const rangeGeometry = (range: Range) => {
  const { azimuth, columns } = skylineOf(range);
  const pos: number[] = [];
  const index: number[] = [];
  const at = (a: number, y: number) => {
    pos.push(Math.sin(a) * range.radius, y, Math.cos(a) * range.radius);
    return pos.length / 3 - 1;
  };
  const quad = (a0: number, lo0: number, hi0: number, a1: number, lo1: number, hi1: number) => {
    const p = at(a0, lo0);
    const q = at(a0, hi0);
    const r = at(a1, lo1);
    const s = at(a1, hi1);
    index.push(p, r, q, q, r, s);
  };
  for (let k = 0; k + 1 < azimuth.length; k++) {
    const [a0, a1] = [azimuth[k], azimuth[k + 1]];
    const [c0, c1] = [columns[k], columns[k + 1]];
    // Each run of rock joined to the next column's, or, where the next has
    // a different number of runs (a crag's arm begins), held flat across
    // this one narrow step
    const same = c0.length === c1.length;
    for (let j = 0; j + 1 < c0.length; j += 2)
      quad(a0, c0[j], c0[j + 1], a1, same ? c1[j] : c0[j], same ? c1[j + 1] : c0[j + 1]);
  }
  return withReflection(pos, index);
};

/** A drawing's corners and triangles, then again marked as its reflection (aMirror). */
const withReflection = (pos: number[], index: number[]) => {
  const n = pos.length / 3;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([...pos, ...pos]), 3));
  const mirror = new Float32Array(2 * n);
  mirror.fill(1, n);
  g.setAttribute('aMirror', new BufferAttribute(mirror, 1));
  g.setIndex([...index, ...index.map((i) => i + n)]);
  return g;
};

const hillVertex = /* glsl */ `
  uniform float uGround;
  attribute float aMirror;
  varying float vMirror;
  varying float vY;
  varying vec3 vWorld;
  varying float vLit;
  ${SHADE_AT_VERTEX}
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vY = w.y - uGround;
    // Given back by the polished stone: mirrored about the ground
    vMirror = aMirror;
    if (aMirror > 0.5) w.y = 2.0 * uGround - w.y;
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
    // The tower's shade per vertex (a ridge's columns are 0.4° apart)
    vLit = 1.0 - shadeOfClip(gl_Position);
  }`;

const hillFragment = /* glsl */ `
  uniform vec3 uShadow;
  uniform float uFoot;
  uniform float uDim;
  varying float vMirror;
  varying float vY;
  varying vec3 vWorld;
  varying float vLit;
  void main() {
    // Mist lies at their feet: the foot fades to no shadow at all
    float amount = smoothstep(0.0, uFoot, vY);
    if (vMirror > 0.5) {
      // The reflection: fainter, fading down into the stone
      amount *= 0.22 * (1.0 - 0.6 * smoothstep(0.0, 18.0, vY));
    } else {
      // Seen from above, against the far plain's haze, they are haze
      // themselves, half gone; against the sky, dark
      float up = normalize(vWorld - cameraPosition).y;
      amount *= mix(0.45, 1.0, smoothstep(-0.035, 0.0, up));
    }
    amount *= vLit * mix(0.5, 1.0, uDim);
    // Written as a multiplier for what is behind (no colour conversion)
    gl_FragColor = vec4(mix(vec3(1.0), uShadow, amount), 1.0);
  }`;

const hillMaterial = (shadow: string, foot: number, dim: { value: number }) =>
  new ShaderMaterial({
    depthWrite: false,
    side: DoubleSide,
    ...multiply,
    uniforms: {
      ...shadeUniforms(),
      uShadow: { value: displayColor(shadow) },
      uFoot: { value: foot },
      uGround: { value: GROUND_Y },
      uDim: dim,
    },
    vertexShader: hillVertex,
    fragmentShader: hillFragment,
  });

const Hills = ({ chess, dim }: { chess: boolean; dim: { value: number } }) => {
  const parts = useMemo(() => {
    const [far, near] = RANGES.map((r) => rangeGeometry(chess ? r : { ...r, summits: [] }));
    return {
      far,
      near,
      farMaterial: hillMaterial(HORIZON.hillFar, 7, dim),
      nearMaterial: hillMaterial(HORIZON.hillNear, 3, dim),
    };
  }, [chess, dim]);
  useDisposeOnUnmount(parts);
  const mesh = (name: string, g: BufferGeometry, m: ShaderMaterial, order: number) => (
    <mesh
      name={name}
      geometry={g}
      material={m}
      position={[0, GROUND_Y, 0]}
      renderOrder={order}
      frustumCulled={false}
      raycast={noRaycast}
    />
  );
  return (
    <group name="horizon-hills">
      {mesh('far-hills', parts.far, parts.farMaterial, ORDER.farHills)}
      {mesh('near-hills', parts.near, parts.nearMaterial, ORDER.nearHills)}
    </group>
  );
};

// --- The far tower and its window --------------------------------------------------

/** Where it stands: on white's side of the world, left of the tower in the opening view. */
export const TOWER_AT = { azimuth: WHITE_LOOK + 15, radius: 175 } as const;

/**
 * A rook's tower drawn flat (world units, x across, y up): a slender shaft
 * on a flared foot, corbelled out under a battlement of three merlons.
 */
const TOWER_BODY: [number, number][] = [
  [1.45, 0],
  [1.05, 0.7],
  [0.86, 6.3],
  [1.22, 6.8],
  [1.22, 7.7],
];
const MERLONS = [-0.86, 0, 0.86].map((x) => [x - 0.24, x + 0.24, 7.7, 8.35] as const);
/** The drawing's scale (world units per unit above). */
const TOWER_SCALE = 0.75;
/** The window, high on the shaft. */
const WINDOW_Y = 5.6 * TOWER_SCALE;

/** The tower as quads facing +z, turned to the camera in the shader. */
const towerGeometry = () => {
  const pos: number[] = [];
  const index: number[] = [];
  const quad = (x0: number, x1: number, x2: number, x3: number, y0: number, y1: number) => {
    const b = pos.length / 3;
    pos.push(x0, y0, 0, x1, y0, 0, x3, y1, 0, x2, y1, 0);
    for (let i = b * 3; i < pos.length; i++) pos[i] *= TOWER_SCALE;
    index.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  for (let i = 0; i < TOWER_BODY.length - 1; i++) {
    const [w0, y0] = TOWER_BODY[i];
    const [w1, y1] = TOWER_BODY[i + 1];
    quad(-w0, w0, -w1, w1, y0, y1);
  }
  for (const [x0, x1, y0, y1] of MERLONS) quad(x0, x1, x0, x1, y0, y1);
  // And its reflection in the stone, in the same draw
  return withReflection(pos, index);
};

const towerVertex = /* glsl */ `
  uniform vec3 uAnchor;
  attribute float aMirror;
  varying float vMirror;
  varying float vY;
  varying float vLit;
  ${SHADE_AT_VERTEX}
  void main() {
    vec3 anchor = (modelMatrix * vec4(uAnchor, 1.0)).xyz;
    vec2 h = normalize((cameraPosition - anchor).xz + vec2(1e-5, 0.0));
    vec3 right = vec3(h.y, 0.0, -h.x);
    vec3 p = anchor + right * position.x + vec3(0.0, position.y, 0.0);
    vY = position.y;
    vMirror = aMirror;
    if (aMirror > 0.5) p.y = 2.0 * anchor.y - p.y;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    vLit = 1.0 - shadeOfClip(gl_Position);
  }`;

const towerFragment = /* glsl */ `
  uniform vec3 uShadow;
  uniform float uDim;
  varying float vMirror;
  varying float vY;
  varying float vLit;
  void main() {
    float amount = smoothstep(0.0, 1.2, vY);
    if (vMirror > 0.5) amount *= 0.4 * (1.0 - 0.6 * smoothstep(0.0, 8.0, vY));
    amount *= vLit * mix(0.5, 1.0, uDim);
    gl_FragColor = vec4(mix(vec3(1.0), uShadow, amount), 1.0);
  }`;

const towerMaterial = (anchor: number[], dim: { value: number }) =>
  new ShaderMaterial({
    depthWrite: false,
    side: DoubleSide,
    ...multiply,
    uniforms: {
      ...shadeUniforms(),
      uAnchor: { value: anchor },
      uShadow: { value: displayColor(HORIZON.tower) },
      uDim: dim,
    },
    vertexShader: towerVertex,
    fragmentShader: towerFragment,
  });

// --- Points of light (the window, the far lights) ---------------------------------

const lightVertex = /* glsl */ `
  uniform float uDpr;
  uniform float uGround;
  attribute float aSize;
  attribute float aBright;
  attribute float aMirror;
  attribute vec3 aColor;
  varying float vBright;
  varying vec3 vColor;
  ${SHADE_AT_VERTEX}
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    // A light's twin in the polished stone, fainter
    if (aMirror > 0.5) w.y = 2.0 * uGround - w.y;
    vColor = aColor;
    gl_Position = projectionMatrix * viewMatrix * w;
    gl_PointSize = aSize * uDpr;
    // A point is a few pixels: its shade at its centre
    vBright = aBright * (1.0 - shadeOfClip(gl_Position));
  }`;

const lightFragment = /* glsl */ `
  uniform float uLight;
  uniform float uDim;
  varying float vBright;
  varying vec3 vColor;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float a = exp(-dot(p, p) * 3.0) * vBright * uLight * uDim;
    if (a < 0.002) discard;
    gl_FragColor = vec4(vColor * a, 1.0);
    #include <colorspace_fragment>
  }`;

interface Light {
  at: [number, number, number];
  size: number;
  bright: number;
  color: string;
}

/** Points with their twins in the stone (at `mirror` of their brightness). */
const lightGeometry = (lights: Light[], mirror: number) => {
  const pos: number[] = [];
  const size: number[] = [];
  const bright: number[] = [];
  const mirrored: number[] = [];
  const color: number[] = [];
  const c = new Color();
  for (const twin of [0, 1])
    for (const l of lights) {
      pos.push(l.at[0], l.at[1], l.at[2]);
      size.push(l.size);
      bright.push(twin ? l.bright * mirror : l.bright);
      mirrored.push(twin);
      c.set(l.color);
      color.push(c.r, c.g, c.b);
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aSize', new BufferAttribute(new Float32Array(size), 1));
  g.setAttribute('aBright', new BufferAttribute(new Float32Array(bright), 1));
  g.setAttribute('aMirror', new BufferAttribute(new Float32Array(mirrored), 1));
  g.setAttribute('aColor', new BufferAttribute(new Float32Array(color), 3));
  return g;
};

const lightMaterial = (dim: { value: number }) =>
  new ShaderMaterial({
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      ...shadeUniforms(),
      uDpr: { value: 1 },
      uGround: { value: GROUND_Y },
      uLight: { value: 1 },
      uDim: dim,
    },
    vertexShader: lightVertex,
    fragmentShader: lightFragment,
  });

/** A point on the plain at an azimuth (degrees), a distance and a height above the ground. */
const onPlain = (azimuth: number, radius: number, up: number): [number, number, number] => [
  Math.sin(azimuth * DEG) * radius,
  GROUND_Y + up,
  Math.cos(azimuth * DEG) * radius,
];

const FarTower = ({ dim }: { dim: { value: number } }) => {
  const dpr = useThree((s) => s.viewport.dpr);
  const parts = useMemo(() => {
    const anchor = onPlain(TOWER_AT.azimuth, TOWER_AT.radius, 0);
    // The window a hair in front of the shaft (toward the plain's centre)
    const lamp = onPlain(TOWER_AT.azimuth, TOWER_AT.radius - 1, WINDOW_Y);
    return {
      geometry: towerGeometry(),
      material: towerMaterial(anchor, dim),
      window: lightGeometry([{ at: lamp, size: 2.2, bright: 0.55, color: HORIZON.window }], 0.2),
      windowMaterial: lightMaterial(dim),
    };
  }, [dim]);
  useDisposeOnUnmount(parts);
  parts.windowMaterial.uniforms.uDpr.value = dpr;
  // Someone was watching: the window goes dark when a game is won (the
  // mate's flourish, on frames already being drawn), for as long as this
  // garden stands
  const lit = useRef(true);
  useFrame(() => {
    if (lit.current && gardenBoost.value > 0.3) {
      lit.current = false;
      parts.windowMaterial.uniforms.uLight.value = 0;
    }
  });
  return (
    <group name="horizon-tower">
      <mesh
        geometry={parts.geometry}
        material={parts.material}
        renderOrder={ORDER.tower}
        frustumCulled={false}
        raycast={noRaycast}
      />
      <points
        geometry={parts.window}
        material={parts.windowMaterial}
        renderOrder={ORDER.lights}
        frustumCulled={false}
        raycast={noRaycast}
      />
    </group>
  );
};

// --- The other tower ---------------------------------------------------------------

/** Where the other tower burns: on black's side of the world, left of the tower in Black's view. */
export const OTHER_TOWER_AT = { azimuth: BLACK_LOOK + 23, radius: 215 } as const;

/**
 * Its shape (world units): five square plates `side` across, floating in a
 * stack as tall as they are wide, the lowest `foot` above the ground; the
 * distance out from the plain's centre of the opening's camera, behind the
 * board (on White's side for White's seat, the horizon turned for Black's)
 * that it faces; the tubes' radius and light, and the reflection's.
 */
export const OTHER_TOWER = {
  side: 4.2,
  foot: 0.35,
  faces: 22,
  width: 0.07,
  intensity: 0.38,
  reflection: 0.2,
} as const;

/**
 * The other tower's tubes, one set per level (0-4, from A at the foot up):
 * five square plates floating with nothing holding them, as the game's own
 * levels do, each fixed in the world, facing the opening's camera, so from
 * the side, as it is always seen from so far and so low, it reads as the
 * game's tower does: five level-coloured lines stacked into a square. Each comes
 * again below the ground, upside down and fainter, as the polished stone
 * gives it back (fading with its depth).
 */
export const otherTowerStrokes = (): NeonStroke[][] => {
  const { side, foot, reflection } = OTHER_TOWER;
  const at = onPlain(OTHER_TOWER_AT.azimuth, OTHER_TOWER_AT.radius, 0);
  // Its own axes: across the view (r), and toward where the seats look
  // out from at the opening (f), so it shows them its front square-on
  const seat = onPlain(WHITE_LOOK, OTHER_TOWER.faces, 0);
  const f = [seat[0] - at[0], seat[2] - at[2]];
  const fl = Math.hypot(f[0], f[1]);
  const [fx, fz] = [f[0] / fl, f[1] / fl];
  const [rx, rz] = [fz, -fx];
  const point = (x: number, y: number, z: number): V3 => [rx * x + fx * z, y, rz * x + fz * z];
  const square = (half: number, y: number) =>
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([x, z]) => point(x * half, y, z * half));
  const h = side / 2;
  // Its light given back: fainter, and fading with the depth under the stone
  const below = (y: number) => reflection * Math.exp(-y / (side * 0.8));
  const twice = (points: V3[], closed: boolean, light: number): NeonStroke[] => [
    { at, points, closed, mode: 1, light },
    {
      at,
      points: points.map(([x, y, z]): V3 => [x, -y, z]),
      closed,
      mode: 1,
      light: points.map(([, y]) => light * below(y)),
    },
  ];
  // Evenly up a height equal to their width, A's at the foot, E's at the top
  return LEVEL_COLORS.map((_, i) =>
    twice(square(h, foot + (i / (LEVEL_COLORS.length - 1)) * side), true, 1),
  );
};

/** The other tower's colours, as its strokes come (each level's, from A). */
const otherTowerColors = () => {
  const grey = new Color(PALETTE.neon);
  return LEVEL_COLORS.map((hex) => new Color(hex).lerp(grey, 0.3));
};

/**
 * The other tower: another game's glass tower far off on black's side of
 * the plain, five floating plates drawn in the sculptures' clean tubes
 * (their program; each colour its own draw), joined by the brighter where
 * they meet, never summed, so its corners and its near and far edges, one
 * over the other from so far, are no brighter than a line.
 */
const OtherTower = ({ turn, dim }: { turn: number; dim: { value: number } }) => {
  const sign = useMemo(() => ({ value: 1 }), []);
  sign.value = turn < 0 ? -1 : 1;
  const { parts, sets } = useMemo(() => {
    const colors = otherTowerColors();
    const sets = otherTowerStrokes().map((strokes, i) => {
      const material = neonMaterial({
        width: OTHER_TOWER.width,
        // All core, no halo: from so far, a hairline (drawn about a pixel
        // wide, dimmer for its thinness, so it never breaks up)
        core: 1,
        halo: 0,
        intensity: OTHER_TOWER.intensity,
        mirror: false,
        fade: 0,
        turn: sign,
        dim,
        clean: true,
      });
      // With the garden, in three.js's opaque list (backdropCache.tsx)
      material.transparent = false;
      material.uniforms.uColor.value = colors[i];
      return { geometry: neonStrokes(strokes), material };
    });
    const parts: Record<string, { dispose(): void }> = {};
    sets.forEach(({ geometry, material }, i) => {
      parts[`geometry${i}`] = geometry;
      parts[`material${i}`] = material;
    });
    return { parts, sets };
  }, [sign, dim]);
  useDisposeOnUnmount(parts);
  return (
    <group name="horizon-other-tower">
      {sets.map(({ geometry, material }, i) => (
        <mesh
          key={i}
          geometry={geometry}
          material={material}
          renderOrder={ORDER.otherTower}
          frustumCulled={false}
          raycast={noRaycast}
        />
      ))}
    </group>
  );
};

/**
 * The far lights: a few small clusters at the hills' feet, most a cool
 * starlight and a few warmer.
 */
const farLights = (): Light[] => {
  const random = rng(4417);
  const out: Light[] = [];
  const clusters = [
    { azimuth: WHITE_LOOK - 24, radius: 270, count: 5 },
    // In the narrow view of an upright phone, beside its line, under the HUD
    { azimuth: WHITE_LOOK - 5, radius: 255, count: 3 },
    { azimuth: BLACK_LOOK + 5, radius: 250, count: 3 },
    { azimuth: WHITE_LOOK + 30, radius: 285, count: 3 },
    { azimuth: BLACK_LOOK - 27, radius: 265, count: 4 },
    { azimuth: BLACK_LOOK + 62, radius: 280, count: 6 },
    { azimuth: WHITE_LOOK + 75, radius: 275, count: 4 },
    { azimuth: WHITE_LOOK - 95, radius: 260, count: 3 },
  ];
  for (const { azimuth, radius, count } of clusters)
    for (let i = 0; i < count; i++) {
      // Spread across the cluster's 3°, each light in its own column, so no
      // two (and their twins in the stone) stack into a dotted upright
      const slot = 3 / count;
      out.push({
        at: onPlain(
          azimuth + ((i + 0.5) / count - 0.5) * 3 + (random() - 0.5) * slot * 0.4,
          radius + (random() - 0.5) * 18,
          0.3 + random() * 1.4,
        ),
        size: 1.3 + random() * 0.6,
        bright: 0.12 + random() * 0.14,
        color: random() < 0.3 ? HORIZON.lightWarm : HORIZON.lightCool,
      });
    }
  return out;
};

const FarLights = ({ dim }: { dim: { value: number } }) => {
  const dpr = useThree((s) => s.viewport.dpr);
  const parts = useMemo(
    () => ({ geometry: lightGeometry(farLights(), 0.15), material: lightMaterial(dim) }),
    [dim],
  );
  useDisposeOnUnmount(parts);
  parts.material.uniforms.uDpr.value = dpr;
  return (
    <points
      name="horizon-lights"
      geometry={parts.geometry}
      material={parts.material}
      renderOrder={ORDER.lights}
      frustumCulled={false}
      raycast={noRaycast}
    />
  );
};

// --- Mist on the far plain ---------------------------------------------------------

/** The banks: distance, the height of their densest layer, their depth and light. */
const BANKS = [
  { radius: 105, y: 1.6, depth: 2.2, light: 0.016, seed: 1.3 },
  { radius: 175, y: 2.6, depth: 3.6, light: 0.02, seed: 4.1 },
  { radius: 250, y: 4.0, depth: 5.5, light: 0.022, seed: 2.2 },
] as const;

/**
 * How high a bank's cylinder reaches, in its depths above its densest layer:
 * past this its light (exp(-dy²), at most every bank's light at full clump)
 * is under the least the shader draws, so nothing is cut off.
 */
const BANK_TOP = 1.85;

/**
 * Bank's clump round the plain (whole waves round, so they close up), as the
 * shader's: worked out per vertex, 1.5° apart, where it bends gently.
 */
const clumpOf = (az: number, seed: number) =>
  Math.min(
    Math.max(
      0.55 +
        0.3 * Math.sin(az * 3 + seed) +
        0.2 * Math.sin(az * 7 + seed * 2.7) +
        0.12 * Math.sin(az * 13 + seed * 5.1),
      0,
    ),
    1,
  );

/**
 * An open cylinder round the axis for each bank, its foot on the ground
 * (y = 0), each vertex carrying its bank's layer (height, depth, light,
 * and its clump there).
 */
const bankGeometry = () => {
  const segments = 240;
  const pos: number[] = [];
  const layer: number[] = [];
  const index: number[] = [];
  BANKS.forEach(({ radius, y, depth, light, seed }) => {
    const base = pos.length / 3;
    const top = y + depth * BANK_TOP;
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const x = Math.sin(a) * radius;
      const z = Math.cos(a) * radius;
      const clump = clumpOf(Math.atan2(x, z), seed);
      pos.push(x, 0, z, x, top, z);
      layer.push(y, depth, light * clump, y, depth, light * clump);
    }
    for (let i = 0; i < segments; i++) {
      const a = base + i * 2;
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aLayer', new BufferAttribute(new Float32Array(layer), 3));
  g.setIndex(index);
  return g;
};

const bankVertex = /* glsl */ `
  uniform float uDim;
  attribute vec3 aLayer;
  varying float vY;
  varying vec2 vLayer;
  varying float vLight;
  ${SHADE_AT_VERTEX}
  void main() {
    vY = position.y;
    vLayer = aLayer.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    // Its light in banks and gaps round the plain, into the tower's shade
    vLight = aLayer.z * uDim * (1.0 - shadeOfClip(gl_Position));
  }`;

const bankFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vY;
  varying vec2 vLayer;
  varying float vLight;
  void main() {
    // Lying low and thinning upward
    float dy = (vY - vLayer.x) / vLayer.y;
    float v = exp(-dy * dy) * smoothstep(0.0, vLayer.x * 1.6, vY);
    float a = v * vLight;
    if (a < 0.0008) discard;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <colorspace_fragment>
  }`;

const FarMist = ({ dim }: { dim: { value: number } }) => {
  const parts = useMemo(
    () => ({
      geometry: bankGeometry(),
      material: new ShaderMaterial({
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
        uniforms: {
          ...shadeUniforms(),
          uColor: { value: new Color(HORIZON.mist) },
          uDim: dim,
        },
        vertexShader: bankVertex,
        fragmentShader: bankFragment,
      }),
    }),
    [dim],
  );
  useDisposeOnUnmount(parts);
  return (
    <mesh
      name="horizon-mist"
      geometry={parts.geometry}
      material={parts.material}
      position={[0, GROUND_Y, 0]}
      renderOrder={ORDER.mist}
      frustumCulled={false}
      raycast={noRaycast}
    />
  );
};

/** The horizon and the far ground; each part only while its setting is on. */
export const Horizon = ({ turn, dim }: GardenDetailProps) => {
  const ranges = useEnvSetting(hills);
  const tower = useEnvSetting(farTower);
  const mist = useEnvSetting(horizonMist);
  const lights = useEnvSetting(horizonLights);
  const events = useEnvSetting(horizonEvents);
  const quiet = useDim(dim);
  return (
    <>
      <group name="horizon" rotation-y={turn < 0 ? Math.PI : 0}>
        {ranges !== 'off' && <Hills chess={ranges === 'chess'} dim={quiet} />}
        {tower === 'on' && <FarTower dim={quiet} />}
        {mist === 'on' && <FarMist dim={quiet} />}
        {lights === 'on' && <FarLights dim={quiet} />}
        {lights === 'on' && <OtherTower turn={turn} dim={quiet} />}
      </group>
      {events !== 'off' && <Lighthouse often={events === 'often'} dim={quiet} />}
    </>
  );
};
