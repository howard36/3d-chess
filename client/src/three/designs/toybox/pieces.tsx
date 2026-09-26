import { useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferAttribute,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Matrix4,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { BufferGeometry, Mesh, MeshPhysicalMaterialParameters } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PieceType } from '../../../engine/pieces';
import { noRaycast } from '../kit/noRaycast';
import type { PieceBodyProps, PieceColor } from '../types';
import { blobTexture, CREAM, FLOORS, HALF_TRAY, NAVY, rainbowTexture, RED, YELLOW } from './shared';

// Chunky painted-wood toys turned from primitives: a peg-doll pawn, a
// castle-block rook, a gnome-hat bishop, a boxy googly-eyed horse, the same
// horse with a rainbow horn, a queen with a crown of beads and a king with a
// cross. Every part of one piece type that shares a paint is merged into one
// geometry, so a piece is a handful of draw calls.

type V3 = [number, number, number];

const place = (g: BufferGeometry, p: V3 = [0, 0, 0], r: V3 = [0, 0, 0], s: V3 = [1, 1, 1]) =>
  g.applyMatrix4(
    new Matrix4().compose(
      new Vector3(...p),
      new Quaternion().setFromEuler(new Euler(...r)),
      new Vector3(...s),
    ),
  );

const sphere = (r: number, p: V3, s?: V3) => place(new SphereGeometry(r, 16, 11), p, [0, 0, 0], s);
const cylinder = (top: number, bottom: number, h: number, y: number, x = 0, z = 0) =>
  place(new CylinderGeometry(top, bottom, h, 22), [x, y, z]);
/** A torus lying flat at height `y`, the rounded bands of paint. */
const band = (radius: number, tube: number, y: number) =>
  place(new TorusGeometry(radius, tube, 8, 28), [0, y, 0], [Math.PI / 2, 0, 0]);
const block = (w: number, h: number, d: number, radius: number, p: V3, r?: V3) =>
  place(new RoundedBoxGeometry(w, h, d, 2, radius), p, r);
const cone = (r: number, h: number, p: V3, rot?: V3) => place(new ConeGeometry(r, h, 16), p, rot);

/** Tints every vertex, for the one mesh that carries several colours. */
const tint = (g: BufferGeometry, color: string) => {
  const c = new Color(color);
  const n = g.getAttribute('position').count;
  const data = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) data.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new BufferAttribute(data, 3));
  return g;
};

// RoundedBoxGeometry is not indexed while the other primitives are, and
// merging needs them alike: flatten them all.
const merge = (parts: BufferGeometry[]) => {
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  parts.forEach((p) => p.dispose());
  return g;
};

interface Parts {
  body: BufferGeometry[];
  accent: BufferGeometry[];
  eyeWhite?: BufferGeometry[];
  eyeDark?: BufferGeometry[];
  horn?: BufferGeometry[];
  rainbow?: BufferGeometry[];
}

// A round puck every toy stands on, its top edge banded in the army's accent.
const puck = (r: number): Parts => ({
  body: [cylinder(r - 0.012, r, 0.1, 0.05)],
  accent: [band(r - 0.014, 0.03, 0.1)],
});

const join = (...parts: Parts[]): Parts => {
  const out: Parts = { body: [], accent: [] };
  for (const p of parts) {
    for (const key of Object.keys(p) as (keyof Parts)[]) {
      out[key] = [...(out[key] ?? []), ...(p[key] ?? [])];
    }
  }
  return out;
};

// The horse head shared by the knight and the unicorn; it looks along +x.
const horse = (): Parts => ({
  body: [
    // Neck, leaning back a little
    block(0.22, 0.36, 0.2, 0.08, [-0.03, 0.27, 0], [0, 0, 0.14]),
    // Head, nose tipped down
    block(0.38, 0.21, 0.22, 0.09, [0.07, 0.5, 0], [0, 0, -0.26]),
    // Ears
    cone(0.05, 0.13, [-0.05, 0.65, 0.065], [0.25, 0, 0.15]),
    cone(0.05, 0.13, [-0.05, 0.65, -0.065], [-0.25, 0, 0.15]),
  ],
  accent: [],
  eyeWhite: [sphere(0.048, [0.05, 0.57, 0.1]), sphere(0.048, [0.05, 0.57, -0.1])],
  eyeDark: [
    sphere(0.027, [0.065, 0.575, 0.137]),
    sphere(0.027, [0.065, 0.575, -0.137]),
    // Nostrils
    sphere(0.02, [0.245, 0.45, 0.05]),
    sphere(0.02, [0.245, 0.45, -0.05]),
  ],
});

const MANE: V3[] = [
  [-0.14, 0.2, 0],
  [-0.165, 0.31, 0],
  [-0.172, 0.42, 0],
  [-0.13, 0.54, 0],
];

const PIECE_PARTS: Record<PieceType, () => Parts> = {
  [PieceType.Pawn]: () =>
    join(puck(0.22), {
      body: [cylinder(0.095, 0.155, 0.28, 0.24), sphere(0.135, [0, 0.49, 0])],
      accent: [band(0.1, 0.04, 0.37)],
    }),
  [PieceType.Rook]: () =>
    join(puck(0.25), {
      body: [
        block(0.38, 0.38, 0.38, 0.06, [0, 0.28, 0]),
        ...[
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ].map(([x, z]) => block(0.14, 0.14, 0.14, 0.04, [x * 0.16, 0.6, z * 0.16])),
      ],
      accent: [
        block(0.46, 0.08, 0.46, 0.035, [0, 0.5, 0]),
        // An arched door on each face
        ...[0, 1, 2, 3].flatMap((i) => {
          const a = (i * Math.PI) / 2;
          const [s, c] = [Math.sin(a), Math.cos(a)];
          return [
            block(0.13, 0.13, 0.04, 0.015, [s * 0.19, 0.165, c * 0.19], [0, a, 0]),
            place(
              new CylinderGeometry(0.065, 0.065, 0.04, 16),
              [s * 0.19, 0.23, c * 0.19],
              [Math.PI / 2, 0, -a],
            ),
          ];
        }),
      ],
    }),
  [PieceType.Bishop]: () =>
    join(puck(0.23), {
      body: [cylinder(0.14, 0.175, 0.22, 0.2), cone(0.165, 0.36, [0, 0.52, 0])],
      accent: [
        // Hat brim, a band round the hat, and the bobble on its tip
        cylinder(0.215, 0.215, 0.04, 0.325),
        band(0.215, 0.022, 0.325),
        band(0.13, 0.03, 0.4),
        sphere(0.07, [0, 0.705, 0]),
      ],
    }),
  [PieceType.Knight]: () =>
    join(puck(0.25), horse(), {
      body: [],
      accent: MANE.map((p) => sphere(0.058, p)),
    }),
  [PieceType.Unicorn]: () =>
    join(puck(0.25), horse(), {
      body: [],
      accent: [],
      horn: [cone(0.045, 0.27, [0.135, 0.73, 0], [0, 0, -0.45])],
      rainbow: MANE.map((p, i) =>
        tint(sphere(0.06, p), ['#ff4b4b', '#ffd21f', '#3cc76a', '#3e95e6'][i]),
      ),
    }),
  [PieceType.Queen]: () =>
    join(puck(0.25), {
      body: [
        cylinder(0.12, 0.2, 0.38, 0.29),
        sphere(0.135, [0, 0.52, 0], [1, 0.85, 1]),
        sphere(0.09, [0, 0.66, 0]),
      ],
      accent: [
        band(0.165, 0.032, 0.27),
        cylinder(0.14, 0.12, 0.08, 0.64),
        ...Array.from({ length: 7 }, (_, i) => {
          const a = (i / 7) * Math.PI * 2;
          return sphere(0.043, [Math.cos(a) * 0.135, 0.7, Math.sin(a) * 0.135]);
        }),
        sphere(0.055, [0, 0.79, 0]),
      ],
    }),
  [PieceType.King]: () =>
    join(puck(0.27), {
      body: [
        cylinder(0.14, 0.215, 0.44, 0.32),
        sphere(0.15, [0, 0.56, 0], [1, 0.8, 1]),
        sphere(0.11, [0, 0.72, 0]),
      ],
      accent: [
        band(0.18, 0.034, 0.3),
        cylinder(0.15, 0.13, 0.1, 0.67),
        block(0.08, 0.24, 0.08, 0.03, [0, 0.9, 0]),
        block(0.21, 0.075, 0.08, 0.03, [0, 0.92, 0]),
      ],
    }),
};

interface PieceGeometries {
  body: BufferGeometry;
  accent: BufferGeometry | null;
  eyeWhite: BufferGeometry | null;
  eyeDark: BufferGeometry | null;
  horn: BufferGeometry | null;
  rainbow: BufferGeometry | null;
}

const built = new Map<PieceType, PieceGeometries>();
const geometriesFor = (type: PieceType): PieceGeometries => {
  let g = built.get(type);
  if (!g) {
    const p = PIECE_PARTS[type]();
    const opt = (parts?: BufferGeometry[]) => (parts && parts.length ? merge(parts) : null);
    g = {
      body: merge(p.body),
      accent: opt(p.accent),
      eyeWhite: opt(p.eyeWhite),
      eyeDark: opt(p.eyeDark),
      horn: opt(p.horn),
      rainbow: opt(p.rainbow),
    };
    built.set(type, g);
  }
  return g;
};

// --- Paint ------------------------------------------------------------------

export type Glow = 'none' | 'hover' | 'selected' | 'check';
const GLOW: Record<Glow, [string, number]> = {
  none: ['#000000', 0],
  hover: ['#ffd66b', 0.14],
  selected: ['#ffc933', 0.32],
  check: ['#ff1f3d', 0.6],
};

const gloss = (color: string, extra: MeshPhysicalMaterialParameters = {}) =>
  new MeshPhysicalMaterial({
    color,
    roughness: 0.34,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    envMapIntensity: 0.9,
    ...extra,
  });

const bodyMaterials = new Map<string, MeshPhysicalMaterial>();
/** The main paint of an army, one shared material per glow state. */
export const bodyMaterial = (color: PieceColor, glow: Glow) => {
  const key = `${color}-${glow}`;
  let m = bodyMaterials.get(key);
  if (!m) {
    const white = color === 'white';
    m = gloss(white ? CREAM : NAVY, {
      roughness: white ? 0.38 : 0.3,
      emissive: new Color(GLOW[glow][0]),
      emissiveIntensity: GLOW[glow][1],
    });
    bodyMaterials.set(key, m);
  }
  return m;
};

const accentMaterials: Record<PieceColor, MeshPhysicalMaterial> = {
  white: gloss(RED),
  black: gloss(YELLOW),
};
const eyeWhite = gloss('#ffffff', { roughness: 0.2 });
const eyeDark = gloss('#15151f', { roughness: 0.15 });
const hornMaterial = gloss('#ffffff', { map: rainbowTexture, roughness: 0.25 });
const rainbowMaterial = gloss('#ffffff', { vertexColors: true });

// --- Blob shadow ------------------------------------------------------------

// The trays are stacked, so a real sun would throw every piece's shadow onto
// the levels below. Each toy instead carries a soft blob that stays on the
// tray right under it: it follows the piece through hops and bounces and
// shrinks as the piece rises.
const blobGeometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const blobMaterial = new MeshBasicMaterial({
  map: blobTexture,
  color: '#1c2653',
  transparent: true,
  opacity: 0.5,
  depthWrite: false,
  toneMapped: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});
const at = new Vector3();
const flat = new Quaternion();
const size = new Vector3();

const BlobShadow = ({ radius }: { radius: number }) => {
  const ref = useRef<Mesh>(null);
  useLayoutEffect(() => {
    if (ref.current) ref.current.matrixWorldAutoUpdate = false;
  }, []);
  useFrame(() => {
    const m = ref.current;
    const anchor = m?.parent;
    if (!m || !anchor) return;
    anchor.updateWorldMatrix(true, false);
    at.setFromMatrixPosition(anchor.matrixWorld);
    let floor: number | null = null;
    if (Math.abs(at.x) < HALF_TRAY && Math.abs(at.z) < HALF_TRAY) {
      for (const f of FLOORS) if (f <= at.y + 0.03 && (floor === null || f > floor)) floor = f;
    }
    if (floor === null) {
      m.visible = false;
      return;
    }
    const k = Math.max(0, 1 - (at.y - floor) / 1.3);
    m.visible = k > 0.02;
    const s = radius * (0.45 + 0.55 * k);
    m.matrixWorld.compose(at.set(at.x, floor + 0.004, at.z), flat, size.set(s, 1, s));
  });
  return (
    <mesh
      ref={ref}
      geometry={blobGeometry}
      material={blobMaterial}
      raycast={noRaycast}
      frustumCulled={false}
      renderOrder={-1}
    />
  );
};

const BLOB: Record<PieceType, number> = {
  [PieceType.Pawn]: 0.62,
  [PieceType.Rook]: 0.74,
  [PieceType.Bishop]: 0.66,
  [PieceType.Knight]: 0.72,
  [PieceType.Unicorn]: 0.72,
  [PieceType.Queen]: 0.72,
  [PieceType.King]: 0.78,
};

// The unicorn is not turned by the board, so it turns itself to show its
// horn in profile (each army looking toward the other from White's side).
const UNICORN_YAW: Record<PieceColor, number> = { white: 0.85, black: -0.85 };

export const ToyPiece = ({
  type,
  color,
  glow = 'none',
  blob = true,
}: {
  type: PieceType;
  color: PieceColor;
  glow?: Glow;
  blob?: boolean;
}) => {
  const g = geometriesFor(type);
  return (
    <group rotation={[0, type === PieceType.Unicorn ? UNICORN_YAW[color] : 0, 0]}>
      <mesh geometry={g.body} material={bodyMaterial(color, glow)} />
      {g.accent && <mesh geometry={g.accent} material={accentMaterials[color]} />}
      {g.eyeWhite && <mesh geometry={g.eyeWhite} material={eyeWhite} />}
      {g.eyeDark && <mesh geometry={g.eyeDark} material={eyeDark} />}
      {g.horn && <mesh geometry={g.horn} material={hornMaterial} />}
      {g.rainbow && <mesh geometry={g.rainbow} material={rainbowMaterial} />}
      {blob && <BlobShadow radius={BLOB[type]} />}
    </group>
  );
};

export const PieceBody = ({ type, color, selected, hovered, inCheck }: PieceBodyProps) => (
  <ToyPiece
    type={type}
    color={color}
    glow={inCheck ? 'check' : selected ? 'selected' : hovered ? 'hover' : 'none'}
  />
);
