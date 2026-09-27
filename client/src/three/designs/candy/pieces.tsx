import { useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  Euler,
  BackSide,
  LatheGeometry,
  Matrix4,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  ShaderMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { Group } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PieceType } from '../../../engine/pieces';
import type { Orientation } from '../../layout';
import { ContactShadow } from '../kit/plates';
import type { PieceBodyProps, PieceColor } from '../types';
import { CHECK_RED, CREAM, GRAPE, INK, LEVEL_COLORS, NAVY, ORCHID, SPARKLE } from './palette';

// Chunky vinyl toys, turned and moulded from a handful of rounded parts. Each
// keeps the Staunton archetype a chess player reads at a glance, pushed to a
// silhouette that also reads from above:
// - pawn: a ball on a bell, with a collar;
// - rook: a square toy castle, battlements at its four corners;
// - bishop: an egg-shaped mitre with a slanted band and a bobble;
// - knight: a horse's head bowed forward, its mane in body colour;
// - unicorn: a slimmer horse, head held high, with a long twisted horn and a
//   mane in the army's trim colour (so it never reads as a knight);
// - queen: a coronet of seven beads;
// - king: a crown and a cross, the tallest piece.
// Round every piece's foot (and a pawn's collar, a rook's battlements, a
// bishop's neck) runs a band in the colour of the level it stands on, the
// same colour as that level's rim and letter; the army's own trim (grape or
// orchid) stays on crowns, mitres, horns and manes. Every part of a piece
// that shares a paint is merged into one geometry, so a piece is at most
// four draw calls (body, trim, bands, eyes) plus its shadow.

type V3 = [number, number, number];

const place = (g: BufferGeometry, p: V3 = [0, 0, 0], r: V3 = [0, 0, 0], s: V3 = [1, 1, 1]) =>
  g.applyMatrix4(
    new Matrix4().compose(
      new Vector3(...p),
      new Quaternion().setFromEuler(new Euler(...r)),
      new Vector3(...s),
    ),
  );

/**
 * A lathe profile [radius, height, rounding] from base to top; a corner with
 * a rounding is replaced by a quadratic curve, so the toy has no sharp edge.
 */
const turned = (pts: [number, number, number?][], segments = 18) => {
  const out: Vector2[] = [];
  pts.forEach(([x, y, r = 0], i) => {
    const p = new Vector2(x, y);
    if (r <= 0 || i === 0 || i === pts.length - 1) {
      out.push(p);
      return;
    }
    const prev = new Vector2(pts[i - 1][0], pts[i - 1][1]);
    const next = new Vector2(pts[i + 1][0], pts[i + 1][1]);
    const a = p.clone().add(
      prev
        .clone()
        .sub(p)
        .setLength(Math.min(r, prev.distanceTo(p) / 2)),
    );
    const b = p.clone().add(
      next
        .clone()
        .sub(p)
        .setLength(Math.min(r, next.distanceTo(p) / 2)),
    );
    const steps = 3;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      out.push(
        new Vector2(
          u * u * a.x + 2 * u * t * p.x + t * t * b.x,
          u * u * a.y + 2 * u * t * p.y + t * t * b.y,
        ),
      );
    }
  });
  return new LatheGeometry(out, segments);
};

/** A sphere; small beads (eyes, bobbles, a coronet's pearls) get fewer facets. */
const sphere = (r: number, p: V3, s?: V3) =>
  place(r < 0.06 ? new SphereGeometry(r, 9, 7) : new SphereGeometry(r, 14, 10), p, [0, 0, 0], s);
/** A torus lying flat at height `y`: a painted band. */
const band = (radius: number, tube: number, y: number, tilt: V3 = [0, 0, 0]) =>
  place(
    new TorusGeometry(radius, tube, 7, 22),
    [0, y, 0],
    [Math.PI / 2 + tilt[0], tilt[1], tilt[2]],
  );
const block = (w: number, h: number, d: number, radius: number, p: V3, r?: V3) =>
  place(new RoundedBoxGeometry(w, h, d, 2, radius), p, r);
const capsule = (r: number, length: number, p: V3, rot: V3, s?: V3) =>
  place(new CapsuleGeometry(r, length, 4, 14), p, rot, s);

/** The round puck every toy but the rook stands on. */
const puck = (r: number, h = 0.085): [number, number, number?][] => [
  [0, 0],
  [r, 0, 0.02],
  [r, h, 0.03],
  [r - 0.05, h + 0.02, 0.02],
];

// RoundedBoxGeometry is not indexed and lathes are: flatten them all to merge.
const merge = (parts: BufferGeometry[]) => {
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  parts.forEach((p) => p.dispose());
  g.computeBoundingSphere();
  return g;
};

interface Parts {
  body: BufferGeometry[];
  /** Painted in the army's trim colour. */
  trim: BufferGeometry[];
  /** Painted in the colour of the level the piece stands on. */
  bands: BufferGeometry[];
  eyes: BufferGeometry[];
}

/** A cone twisted about its axis: the unicorn's spiral horn. */
const spiralHorn = (radius: number, height: number) => {
  const g = new ConeGeometry(radius, height, 7, 10);
  const pos = g.getAttribute('position');
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const a = ((v.y + height / 2) / height) * Math.PI * 2.2;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    pos.setXYZ(i, v.x * c - v.z * s, v.y, v.x * s + v.z * c);
  }
  g.computeVertexNormals();
  return g;
};

/** The unicorn's mane: a soft wavy rope down the back of its neck. */
const mane = () => {
  const curve = new CatmullRomCurve3(
    [
      [-0.105, 0.14, 0],
      [-0.13, 0.26, 0],
      [-0.118, 0.38, 0],
      [-0.105, 0.49, 0],
      [-0.05, 0.615, 0],
      [0.02, 0.655, 0],
    ].map(([x, y, z]) => new Vector3(x, y, z)),
  );
  const g = new TubeGeometry(curve, 24, 0.046, 10, false);
  // Taper the rope toward both ends
  const pos = g.getAttribute('position');
  const v = new Vector3();
  const p = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.floor(i / 11) / 24;
    curve.getPointAt(t, p);
    v.fromBufferAttribute(pos, i).sub(p);
    const k = 0.45 + 0.55 * Math.sin(Math.min(t * 1.15, 1) * Math.PI) ** 0.6;
    pos.setXYZ(i, p.x + v.x * k * 1.1, p.y + v.y * k, p.z + v.z * k * 0.5);
  }
  g.computeVertexNormals();
  return g;
};

// The horse, looking along +x (Board turns knights to face the other army).
const horse = (upright: boolean): Parts => {
  if (!upright) {
    return {
      body: [
        turned([...puck(0.23), [0.17, 0.12, 0.02], [0, 0.12]]),
        // Neck, leaning back, and the head bowed forward
        capsule(0.125, 0.17, [-0.035, 0.27, 0], [0, 0, 0.22], [1, 1, 0.9]),
        capsule(0.1, 0.2, [0.075, 0.46, 0], [0, 0, 1.2], [1, 1, 0.86]),
        // Muzzle and ears
        sphere(0.088, [0.2, 0.39, 0], [1, 0.9, 0.88]),
        place(new ConeGeometry(0.04, 0.12, 10), [-0.04, 0.6, 0.055], [0.25, 0, 0.3]),
        place(new ConeGeometry(0.04, 0.12, 10), [-0.04, 0.6, -0.055], [-0.25, 0, 0.3]),
        // Mane, moulded in body colour
        ...[
          [-0.15, 0.2],
          [-0.165, 0.3],
          [-0.16, 0.4],
          [-0.12, 0.5],
        ].map(([x, y]) => sphere(0.058, [x, y, 0], [1, 1, 0.8])),
      ],
      bands: [band(0.2, 0.028, 0.1)],
      trim: [
        // A bridle round the nose
        band(0.084, 0.022, 0, [0, 0, 0]).applyMatrix4(
          new Matrix4().compose(
            new Vector3(0.19, 0.405, 0),
            new Quaternion().setFromEuler(new Euler(0, 0, -0.9)),
            new Vector3(1, 1, 0.95),
          ),
        ),
      ],
      eyes: [sphere(0.03, [0.09, 0.5, 0.083]), sphere(0.03, [0.09, 0.5, -0.083])],
    };
  }
  return {
    body: [
      turned([...puck(0.23), [0.17, 0.12, 0.02], [0, 0.12]]),
      // A longer, upright neck and a head held high
      capsule(0.11, 0.26, [-0.02, 0.3, 0], [0, 0, 0.12], [1, 1, 0.88]),
      capsule(0.088, 0.17, [0.07, 0.52, 0], [0, 0, 1.45], [1, 1, 0.86]),
      sphere(0.078, [0.17, 0.49, 0], [1, 0.9, 0.86]),
      place(new ConeGeometry(0.035, 0.1, 10), [-0.03, 0.64, 0.05], [0.25, 0, 0.25]),
      place(new ConeGeometry(0.035, 0.1, 10), [-0.03, 0.64, -0.05], [-0.25, 0, 0.25]),
    ],
    bands: [band(0.2, 0.028, 0.1)],
    trim: [
      // The horn, and a flowing mane in the army's trim colour
      place(spiralHorn(0.045, 0.3), [0.1, 0.72, 0], [0, 0, -0.55]),
      mane(),
    ],
    eyes: [sphere(0.027, [0.08, 0.56, 0.072]), sphere(0.027, [0.08, 0.56, -0.072])],
  };
};

const PIECE_PARTS: Record<PieceType, () => Parts> = {
  [PieceType.Pawn]: () => ({
    body: [
      turned([...puck(0.2), [0.14, 0.13, 0.04], [0.085, 0.29, 0.03], [0.07, 0.33], [0, 0.33]]),
      sphere(0.13, [0, 0.43, 0]),
    ],
    trim: [],
    bands: [band(0.175, 0.026, 0.095), band(0.095, 0.034, 0.315)],
    eyes: [],
  }),
  [PieceType.Rook]: () => ({
    body: [
      block(0.42, 0.1, 0.42, 0.04, [0, 0.05, 0]),
      block(0.33, 0.36, 0.33, 0.05, [0, 0.27, 0]),
      block(0.42, 0.08, 0.42, 0.03, [0, 0.49, 0]),
      ...[
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ].map(([x, z]) => block(0.13, 0.13, 0.13, 0.035, [x * 0.145, 0.585, z * 0.145])),
    ],
    trim: [],
    // Painted bands round the foot and under the battlements
    bands: [
      block(0.435, 0.035, 0.435, 0.015, [0, 0.085, 0]),
      block(0.37, 0.05, 0.37, 0.02, [0, 0.44, 0]),
    ],
    eyes: [],
  }),
  [PieceType.Bishop]: () => ({
    body: [
      turned([...puck(0.21), [0.14, 0.14, 0.04], [0.08, 0.29, 0.03], [0.07, 0.32], [0, 0.32]]),
      turned([
        [0, 0.3],
        [0.1, 0.31, 0.03],
        [0.148, 0.41, 0.07],
        [0.125, 0.52, 0.06],
        [0.05, 0.62, 0.04],
        [0, 0.645],
      ]),
    ],
    // The mitre's slanted band and its bobble
    trim: [band(0.138, 0.022, 0.45, [0.5, 0, 0]), sphere(0.05, [0, 0.675, 0])],
    bands: [band(0.185, 0.026, 0.095), band(0.09, 0.03, 0.31)],
    eyes: [],
  }),
  [PieceType.Knight]: () => horse(false),
  [PieceType.Unicorn]: () => horse(true),
  [PieceType.Queen]: () => ({
    body: [
      turned([
        ...puck(0.23),
        [0.15, 0.15, 0.05],
        [0.09, 0.42, 0.04],
        [0.125, 0.47, 0.03],
        [0.12, 0.51, 0.02],
        [0.07, 0.53],
        [0, 0.53],
      ]),
      sphere(0.1, [0, 0.6, 0], [1, 0.85, 1]),
    ],
    bands: [band(0.205, 0.026, 0.095)],
    trim: [
      // The coronet: a flared band ringed with beads, and a bead on top
      turned(
        [
          [0.11, 0.5],
          [0.125, 0.52, 0.01],
          [0.155, 0.62, 0.01],
          [0.14, 0.63],
          [0.1, 0.55],
        ],
        20,
      ),
      ...Array.from({ length: 7 }, (_, i) => {
        const a = (i / 7) * Math.PI * 2;
        return sphere(0.042, [Math.cos(a) * 0.15, 0.655, Math.sin(a) * 0.15]);
      }),
      sphere(0.052, [0, 0.72, 0]),
    ],
    eyes: [],
  }),
  [PieceType.King]: () => ({
    body: [
      turned([
        ...puck(0.24),
        [0.16, 0.16, 0.05],
        [0.1, 0.45, 0.04],
        [0.135, 0.5, 0.03],
        [0.13, 0.54, 0.02],
        [0.08, 0.56],
        [0, 0.56],
      ]),
      sphere(0.112, [0, 0.64, 0], [1, 0.82, 1]),
    ],
    bands: [band(0.215, 0.026, 0.095)],
    trim: [
      turned(
        [
          [0.12, 0.53],
          [0.14, 0.55, 0.01],
          [0.145, 0.64, 0.01],
          [0.125, 0.65],
          [0.105, 0.58],
        ],
        20,
      ),
      // The cross
      block(0.075, 0.2, 0.07, 0.03, [0, 0.76, 0]),
      block(0.2, 0.07, 0.07, 0.03, [0, 0.785, 0]),
    ],
    eyes: [],
  }),
};

interface PieceGeometries {
  body: BufferGeometry;
  trim: BufferGeometry | null;
  bands: BufferGeometry;
  eyes: BufferGeometry | null;
}

const built = new Map<PieceType, PieceGeometries>();
export const geometriesFor = (type: PieceType): PieceGeometries => {
  let g = built.get(type);
  if (!g) {
    const p = PIECE_PARTS[type]();
    g = {
      body: merge(p.body),
      trim: p.trim.length ? merge(p.trim) : null,
      bands: merge(p.bands),
      eyes: p.eyes.length ? merge(p.eyes) : null,
    };
    built.set(type, g);
  }
  return g;
};

// --- Paint --------------------------------------------------------------------

/**
 * Glossy vinyl: a thin clearcoat over the paint, and a fresnel term that
 * mixes the silhouette toward a rim colour, so cream toys get a soft ink line
 * and navy toys a cool sheen where they turn away from the camera. It keeps
 * both armies crisp against the sky, through glass, and against each other.
 */
const vinyl = (
  color: string,
  { rim, rimStrength, roughness = 0.36, emissive = '#000000', emissiveIntensity = 0 }: VinylOptions,
) => {
  const m = new MeshPhysicalMaterial({
    color,
    roughness,
    metalness: 0,
    clearcoat: 0.55,
    clearcoatRoughness: 0.22,
    envMapIntensity: 0.7,
    emissive,
    emissiveIntensity,
  });
  const uniforms = {
    uRimColor: { value: new Color(rim) },
    uRimStrength: { value: rimStrength },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimStrength;',
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
        float rimK = 1.0 - saturate(dot(normal, geometryViewDir));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uRimColor, smoothstep(0.55, 0.97, rimK) * uRimStrength);`,
      );
  };
  m.customProgramCacheKey = () => 'candy-vinyl';
  return m;
};

interface VinylOptions {
  rim: string;
  rimStrength: number;
  roughness?: number;
  emissive?: string;
  emissiveIntensity?: number;
}

export type Glow = 'none' | 'check';

const ARMY: Record<
  PieceColor,
  { body: string; trim: string; eye: string; rim: string; k: number }
> = {
  white: { body: CREAM, trim: GRAPE, eye: INK, rim: '#6f5d8e', k: 0.4 },
  black: { body: NAVY, trim: ORCHID, eye: CREAM, rim: '#a9b8ff', k: 0.55 },
};

const GLOW: Record<Glow, [string, number]> = {
  none: ['#000000', 0],
  check: ['#ff1f3d', 0.1],
};

const bodies = new Map<string, MeshPhysicalMaterial>();
export const bodyMaterial = (color: PieceColor, glow: Glow) => {
  const key = `${color}/${glow}`;
  let m = bodies.get(key);
  if (!m) {
    const a = ARMY[color];
    m = vinyl(a.body, {
      rim: glow === 'check' ? CHECK_RED : a.rim,
      rimStrength: glow === 'check' ? 0.6 : a.k,
      roughness: color === 'white' ? 0.42 : 0.34,
      emissive: GLOW[glow][0],
      emissiveIntensity: GLOW[glow][1],
    });
    bodies.set(key, m);
  }
  return m;
};

const trims: Record<PieceColor, MeshPhysicalMaterial> = {
  white: vinyl(ARMY.white.trim, { rim: '#3a2a8a', rimStrength: 0.35, roughness: 0.3 }),
  black: vinyl(ARMY.black.trim, { rim: '#ffd0f2', rimStrength: 0.35, roughness: 0.3 }),
};
/** The bands round a piece's base, in its level's colour (the same for both armies). */
const bands = LEVEL_COLORS.map((c) =>
  vinyl(c, {
    rim: '#ffffff',
    rimStrength: 0.2,
    roughness: 0.3,
    emissive: c,
    emissiveIntensity: 0.12,
  }),
);
const eyes: Record<PieceColor, MeshStandardMaterial> = {
  white: new MeshStandardMaterial({ color: ARMY.white.eye, roughness: 0.2 }),
  black: new MeshStandardMaterial({ color: ARMY.black.eye, roughness: 0.2 }),
};

// --- Hover outline ----------------------------------------------------------------

/**
 * A die-cut sticker outline round a toy under the pointer, like the markers'
 * stickers: a white band edged in ink. Each is the toy's back faces pushed
 * out along their normals, drawn behind it; the ink shell is wider, so it
 * shows only beyond the white one. It reads on both armies and any sky.
 */
const shell = (color: string, width: number) =>
  new ShaderMaterial({
    side: BackSide,
    uniforms: { uColor: { value: new Color(color) }, uWidth: { value: width } },
    vertexShader: /* glsl */ `
      uniform float uWidth;
      void main() {
        vec3 p = position + normal * uWidth;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      void main() {
        gl_FragColor = vec4(uColor, 1.0);
        #include <colorspace_fragment>
      }`,
  });
const outlineWhite = shell(SPARKLE, 0.022);
const outlineInk = shell(INK, 0.038);

// --- Facing ---------------------------------------------------------------------

export const KNIGHT_YAW = 0.5;
/** The yaw Board gives a knight: looking toward the other army, turned to show its profile. */
export const facingFor = (color: PieceColor, orientation: Orientation) =>
  (color === orientation ? 1 : -1) * (Math.PI / 2 - KNIGHT_YAW);

// --- The toy -------------------------------------------------------------------

export interface ToyProps {
  type: PieceType;
  color: PieceColor;
  orientation: Orientation;
  /** The level it stands on, for the colour of its bands (A when unknown). */
  level?: number;
  glow?: Glow;
  /** Draw the white hover outline. */
  outlined?: boolean;
  /**
   * Yaw for a knight redrawn outside Board (Board turns the real ones);
   * a unicorn always turns itself, the same way as its army's knights.
   */
  knightFacing?: number;
}

/** One toy, standing at its base (y = 0). */
export const ToyPiece = ({
  type,
  color,
  orientation,
  level = 0,
  glow = 'none',
  outlined = false,
  knightFacing,
}: ToyProps) => {
  const g = geometriesFor(type);
  const yaw =
    type === PieceType.Unicorn
      ? facingFor(color, orientation)
      : type === PieceType.Knight
        ? (knightFacing ?? 0)
        : 0;
  const band = bands[Math.min(Math.max(level, 0), bands.length - 1)];
  return (
    <group rotation={[0, yaw, 0]}>
      <mesh geometry={g.body} material={bodyMaterial(color, glow)} />
      {g.trim && <mesh geometry={g.trim} material={trims[color]} />}
      <mesh geometry={g.bands} material={band} />
      {g.eyes && <mesh geometry={g.eyes} material={eyes[color]} />}
      {outlined &&
        [outlineWhite, outlineInk].map((m, i) => (
          <group key={i}>
            <mesh geometry={g.body} material={m} />
            {g.trim && <mesh geometry={g.trim} material={m} />}
            <mesh geometry={g.bands} material={m} />
          </group>
        ))}
    </group>
  );
};

// --- Selection: the happy hop -----------------------------------------------------

const SHADOW_RADIUS: Record<PieceType, number> = {
  [PieceType.Pawn]: 0.3,
  [PieceType.Rook]: 0.36,
  [PieceType.Bishop]: 0.31,
  [PieceType.Knight]: 0.34,
  [PieceType.Unicorn]: 0.34,
  [PieceType.Queen]: 0.34,
  [PieceType.King]: 0.36,
};

/**
 * A piece body: the toy on its contact shadow. Under the pointer it lifts a
 * little (Board's Lift) and wears a white-and-ink sticker outline. Picked up,
 * it does a happy hop (a crouch, a stretch on the way up, a wobble as it
 * settles into its hover) and sways gently while it hovers. The shadow stays
 * on the floor, shrinking as the toy rises.
 */
export const PieceBody = ({
  type,
  color,
  selected,
  hovered,
  inCheck,
  orientation,
  level,
}: PieceBodyProps) => {
  const root = useRef<Group>(null);
  const toy = useRef<Group>(null);
  const shadow = useRef<Group>(null);
  const hop = useRef({ t: 10, was: false, sway: 0, rise: 0 });

  useLayoutEffect(() => {
    if (selected !== hop.current.was) {
      hop.current.was = selected;
      if (selected) hop.current.t = 0;
    }
  }, [selected]);

  useFrame((state, delta) => {
    const r = root.current;
    const t = toy.current;
    const s = shadow.current;
    if (!r || !t || !s) return;
    const h = hop.current;
    const dt = Math.min(delta, 1 / 30);
    h.t += dt;
    // The crouch and stretch of the hop, a damped wobble after it
    const k = h.t;
    let sy = 1;
    if (k < 0.08) sy = 1 - 0.14 * Math.sin((k / 0.08) * (Math.PI / 2));
    else if (k < 0.7) {
      const u = (k - 0.08) / 0.62;
      sy = 1 + 0.16 * Math.sin(u * Math.PI * 2.5 + 0.35) * Math.exp(-u * 4.2);
    }
    const sxz = 1 / Math.sqrt(sy);
    t.scale.set(sxz, sy, sxz);
    // A gentle sway while held
    const swayGoal = selected ? Math.sin(state.clock.elapsedTime * 2.1) * 0.16 : 0;
    h.sway += (swayGoal - h.sway) * Math.min(1, dt * 6);
    t.rotation.y = h.sway;
    // A little higher than Board's lift: held up to be admired
    h.rise += ((selected ? 0.1 : 0) - h.rise) * Math.min(1, dt * 10);
    t.position.y = h.rise;
    // Keep the shadow on the floor under whatever Lift raised the body by
    const lifted = r.parent?.position.y ?? 0;
    s.position.y = -lifted;
    const fade = Math.max(0.45, 1 - (lifted + h.rise) * 2.2);
    s.scale.setScalar(fade);
  });

  return (
    <group ref={root}>
      <group ref={shadow}>
        <ContactShadow radius={SHADOW_RADIUS[type]} opacity={0.42} color="#1b2160" />
      </group>
      <group ref={toy}>
        <ToyPiece
          type={type}
          color={color}
          orientation={orientation}
          level={level}
          glow={inCheck ? 'check' : 'none'}
          outlined={hovered && !selected}
        />
      </group>
    </group>
  );
};
