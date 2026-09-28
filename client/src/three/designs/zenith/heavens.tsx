import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  ShaderMaterial,
  Vector3,
} from 'three';
import { noRaycast } from '../kit/noRaycast';
import { rng } from '../kit/textures';
import { TOWER_MASK } from './mask';
import { PALETTE } from './palette';

// The night overhead. A sparse field of faint stars thins out toward the
// horizon's mist, and high above the garden, where only a camera sunk below
// the horizon looking up past the tower can see, eight chess pieces are
// drawn among them as constellations (after Meridian's): a few brighter
// stars each, joined by hair-thin lines, round the whole sky, so whichever
// way the player looks up there is one beside the tower. They sit above the
// top of the frame in every ordinary view: an easter egg, not a backdrop.
// Nothing moves, and whatever lies behind the tower is held down to nothing
// (mask.ts).

/** Radius of the dome the stars are set on (inside the sky sphere). */
const DOME = 300;

type P2 = [number, number];

interface Constellation {
  /** Points in a unit box (x right, y up). */
  stars: P2[];
  /** Pairs of star indices joined by a line. */
  lines: [number, number][];
  /** Stars left unjoined (an eye, an orb): drawn, no line. */
  loose?: P2[];
}

const loop = (n: number, from = 0): [number, number][] =>
  Array.from({ length: n }, (_, i) => [from + i, from + ((i + 1) % n)]);
const chain = (n: number, from = 0): [number, number][] =>
  Array.from({ length: n - 1 }, (_, i) => [from + i, from + i + 1]);

// The pieces as constellations, each an outline of a few stars
const KNIGHT: Constellation = {
  stars: [
    [0.52, 1.0],
    [0.66, 0.84],
    [0.8, 0.6],
    [0.86, 0.28],
    [0.82, 0.0],
    [0.24, 0.0],
    [0.3, 0.3],
    [0.36, 0.42],
    [0.04, 0.48],
    [0.1, 0.66],
    [0.38, 0.86],
  ],
  lines: loop(11),
  loose: [[0.34, 0.7]],
};
const ROOK: Constellation = {
  stars: [
    [0.18, 0.0],
    [0.82, 0.0],
    [0.72, 0.16],
    [0.7, 0.7],
    [0.82, 0.78],
    [0.82, 1.0],
    [0.62, 1.0],
    [0.62, 0.9],
    [0.38, 0.9],
    [0.38, 1.0],
    [0.18, 1.0],
    [0.18, 0.78],
    [0.3, 0.7],
    [0.28, 0.16],
  ],
  lines: loop(14),
};
const KING: Constellation = {
  stars: [
    // The cross
    [0.5, 1.0],
    [0.5, 0.78],
    [0.39, 0.9],
    [0.61, 0.9],
    // The crown and body
    [0.3, 0.7],
    [0.7, 0.7],
    [0.63, 0.32],
    [0.76, 0.06],
    [0.24, 0.06],
    [0.37, 0.32],
  ],
  lines: [[0, 1], [2, 3], [1, 4], [1, 5], ...loop(6, 4).slice(1), [9, 4]],
};
const BISHOP: Constellation = {
  stars: [
    [0.5, 0.9],
    [0.34, 0.72],
    [0.37, 0.5],
    [0.5, 0.42],
    [0.63, 0.5],
    [0.66, 0.72],
    // The mitre's cut
    [0.43, 0.78],
    [0.6, 0.6],
    // Collar and foot
    [0.36, 0.32],
    [0.64, 0.32],
    [0.26, 0.02],
    [0.74, 0.02],
  ],
  lines: [...loop(6), [6, 7], [8, 9], [8, 10], [9, 11], [10, 11]],
  loose: [[0.5, 1.02]],
};
const QUEEN: Constellation = {
  stars: [
    [0.18, 0.58],
    [0.3, 0.88],
    [0.4, 0.64],
    [0.5, 0.96],
    [0.6, 0.64],
    [0.7, 0.88],
    [0.82, 0.58],
    [0.74, 0.34],
    [0.26, 0.34],
  ],
  lines: loop(9),
  loose: [
    [0.3, 0.98],
    [0.5, 1.07],
    [0.7, 0.98],
  ],
};
const PAWN: Constellation = {
  stars: [
    [0.5, 1.0],
    [0.65, 0.84],
    [0.5, 0.68],
    [0.35, 0.84],
    [0.4, 0.62],
    [0.6, 0.62],
    [0.72, 0.08],
    [0.28, 0.08],
  ],
  lines: [...loop(4), [4, 7], [5, 6], [6, 7], [4, 5]],
};
const UNICORN: Constellation = {
  stars: [
    // The horn, spiralling up
    [0.62, 1.0],
    [0.55, 0.84],
    [0.62, 0.8],
    [0.52, 0.68],
    // The head below it
    [0.4, 0.66],
    [0.12, 0.44],
    [0.2, 0.3],
    [0.46, 0.4],
    [0.56, 0.14],
    [0.86, 0.14],
    [0.8, 0.5],
    [0.62, 0.62],
  ],
  lines: [...chain(5), ...loop(8, 4)],
};
/** The knight turned the other way, for the far side of the sky. */
const KNIGHT_WEST: Constellation = {
  ...KNIGHT,
  stars: KNIGHT.stars.map(([u, v]) => [1 - u, v]),
  loose: KNIGHT.loose?.map(([u, v]) => [1 - u, v]),
};

interface Placement {
  c: Constellation;
  /** Degrees round from +z toward +x. */
  azimuth: number;
  /** Degrees above the horizon, of the figure's centre. */
  elevation: number;
  /** Height of the figure, degrees of sky. */
  size: number;
  /** A slight turn off upright, radians. */
  tilt: number;
}

/**
 * Round the whole sky about one every 45°, each at its own height between
 * 21° and 29° above the horizon: above the top of the frame from the opening
 * view (whose top edge is the horizon) and every view down to level, in
 * frame beside the tower once the camera sinks below the horizon to look up.
 * Looking up from White's side, the knight stands right of the tower and the
 * king left; from Black's, the queen and the unicorn.
 */
export const SKY_PLAN: Placement[] = [
  { c: KNIGHT, azimuth: 172, elevation: 25, size: 9.5, tilt: -0.06 },
  { c: KING, azimuth: 221, elevation: 27, size: 9, tilt: 0.05 },
  { c: BISHOP, azimuth: 264, elevation: 23, size: 8, tilt: -0.05 },
  { c: ROOK, azimuth: 306, elevation: 26, size: 7, tilt: 0.06 },
  { c: QUEEN, azimuth: 352, elevation: 24, size: 8.5, tilt: 0.04 },
  { c: UNICORN, azimuth: 40, elevation: 27, size: 9, tilt: 0.07 },
  { c: PAWN, azimuth: 84, elevation: 22, size: 7, tilt: -0.08 },
  { c: KNIGHT_WEST, azimuth: 128, elevation: 25, size: 9.5, tilt: 0.05 },
];

const DEG = Math.PI / 180;
const UP = new Vector3(0, 1, 0);

/** A direction on the dome at this azimuth and elevation (degrees). */
const onDome = (azimuth: number, elevation: number) =>
  new Vector3(
    Math.sin(azimuth * DEG) * Math.cos(elevation * DEG),
    Math.sin(elevation * DEG),
    Math.cos(azimuth * DEG) * Math.cos(elevation * DEG),
  );

/** A point on the dome from a constellation's unit box. */
export const placeStar = ([u, v]: P2, plan: Placement): [number, number, number] => {
  const centre = onDome(plan.azimuth, plan.elevation);
  const inward = centre.clone().negate();
  const right = UP.clone().cross(inward).normalize();
  const up = inward.clone().cross(right).normalize();
  // The figure's size as an angle, laid out in the tangent plane
  const span = Math.tan(plan.size * DEG);
  const x = (u - 0.5) * span;
  const y = (v - 0.5) * span;
  const c = Math.cos(plan.tilt);
  const s = Math.sin(plan.tilt);
  const p = centre
    .clone()
    .addScaledVector(right, x * c - y * s)
    .addScaledVector(up, x * s + y * c);
  return p.normalize().multiplyScalar(DOME).toArray() as [number, number, number];
};

const pointVertex = /* glsl */ `
  uniform float uDpr;
  attribute float aSize;
  attribute float aBright;
  attribute vec3 aColor;
  varying float vBright;
  varying vec3 vColor;
  varying vec3 vWorld;
  void main() {
    vBright = aBright;
    vColor = aColor;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
    gl_PointSize = aSize * uDpr;
  }`;

const pointFragment = /* glsl */ `
  uniform float uOpacity;
  varying float vBright;
  varying vec3 vColor;
  varying vec3 vWorld;
  ${TOWER_MASK}
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = length(p);
    float a = (1.0 - smoothstep(0.3, 1.0, r)) * vBright * uOpacity * (1.0 - towerCover(vWorld));
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor * a, 1.0);
    #include <colorspace_fragment>
  }`;

const lineVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const lineFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vWorld;
  ${TOWER_MASK}
  void main() {
    float a = uOpacity * (1.0 - towerCover(vWorld));
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <colorspace_fragment>
  }`;

const FIELD = 900;

/** The background field: sparse and dim, thinning into the horizon's mist. */
const fieldGeometry = () => {
  const random = rng(53);
  const pos: number[] = [];
  const size: number[] = [];
  const bright: number[] = [];
  const color: number[] = [];
  const cool = new Color(PALETTE.neon);
  const warm = new Color('#ffe6c4');
  for (let i = 0; i < FIELD; i++) {
    // Even over the dome above 3°
    const y = 0.05 + random() * 0.95;
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(1 - y * y);
    const low = Math.min((y - 0.05) / 0.2, 1);
    pos.push(Math.sin(a) * r * DOME, y * DOME, Math.cos(a) * r * DOME);
    size.push(1.2 + random() ** 3 * 1.4);
    bright.push((0.1 + random() ** 2.6 * 0.42) * (0.3 + 0.7 * low));
    const c = random() < 0.2 ? warm : cool;
    color.push(c.r, c.g, c.b);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aSize', new BufferAttribute(new Float32Array(size), 1));
  g.setAttribute('aBright', new BufferAttribute(new Float32Array(bright), 1));
  g.setAttribute('aColor', new BufferAttribute(new Float32Array(color), 3));
  return g;
};

/** The constellations' stars: a little brighter and larger than the field's. */
const figureStarGeometry = () => {
  const random = rng(71);
  const pos: number[] = [];
  const size: number[] = [];
  const bright: number[] = [];
  const color: number[] = [];
  const cool = new Color(PALETTE.neon);
  for (const plan of SKY_PLAN) {
    for (const s of [...plan.c.stars, ...(plan.c.loose ?? [])]) {
      pos.push(...placeStar(s, plan));
      size.push(2 + random() * 0.7);
      bright.push(0.34 + random() * 0.16);
      color.push(cool.r, cool.g, cool.b);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aSize', new BufferAttribute(new Float32Array(size), 1));
  g.setAttribute('aBright', new BufferAttribute(new Float32Array(bright), 1));
  g.setAttribute('aColor', new BufferAttribute(new Float32Array(color), 3));
  return g;
};

const figureLineGeometry = () => {
  const pos: number[] = [];
  for (const plan of SKY_PLAN) {
    for (const [a, b] of plan.c.lines) {
      pos.push(...placeStar(plan.c.stars[a], plan), ...placeStar(plan.c.stars[b], plan));
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  return g;
};

// Light added onto the night, before the garden and the tower
const pointMaterial = (opacity: number) =>
  new ShaderMaterial({
    depthWrite: false,
    transparent: true,
    blending: AdditiveBlending,
    uniforms: { uDpr: { value: 1 }, uOpacity: { value: opacity } },
    vertexShader: pointVertex,
    fragmentShader: pointFragment,
  });

/** The sky's stars (`stars`) and its chess constellations (`figures`). */
export const Heavens = ({ stars, figures }: { stars: boolean; figures: boolean }) => {
  const dpr = useThree((s) => s.viewport.dpr);
  const parts = useMemo(
    () => ({
      field: fieldGeometry(),
      figureStars: figureStarGeometry(),
      figureLines: figureLineGeometry(),
      fieldMaterial: pointMaterial(1),
      starMaterial: pointMaterial(1),
      lineMaterial: new ShaderMaterial({
        depthWrite: false,
        transparent: true,
        blending: AdditiveBlending,
        uniforms: {
          uColor: { value: new Color(PALETTE.neon) },
          uOpacity: { value: 0.065 },
        },
        vertexShader: lineVertex,
        fragmentShader: lineFragment,
      }),
    }),
    [],
  );
  useEffect(() => () => Object.values(parts).forEach((p) => p.dispose()), [parts]);
  // Point sizes are in CSS pixels; the shader draws in device pixels
  parts.fieldMaterial.uniforms.uDpr.value = dpr;
  parts.starMaterial.uniforms.uDpr.value = dpr;
  return (
    <group name="zenith-heavens">
      {stars && (
        <points
          geometry={parts.field}
          material={parts.fieldMaterial}
          renderOrder={-990}
          raycast={noRaycast}
          frustumCulled={false}
        />
      )}
      {figures && (
        <>
          <lineSegments
            geometry={parts.figureLines}
            material={parts.lineMaterial}
            renderOrder={-989}
            raycast={noRaycast}
            frustumCulled={false}
          />
          <points
            geometry={parts.figureStars}
            material={parts.starMaterial}
            renderOrder={-988}
            raycast={noRaycast}
            frustumCulled={false}
          />
        </>
      )}
    </group>
  );
};
