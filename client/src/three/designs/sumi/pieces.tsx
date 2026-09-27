import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BackSide,
  BufferAttribute,
  Color,
  Euler,
  ExtrudeGeometry,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  RingGeometry,
  ShaderMaterial,
  Shape,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { BufferGeometry, Group, Material } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PieceType } from '../../../engine/pieces';
import { STAUNTON } from '../../pieceGeometry';
import { LAYER } from '../kit/layers';
import { ContactShadow } from '../kit/plates';
import { noRaycast } from '../kit/noRaycast';
import type { PieceBodyProps, PieceColor } from '../types';
import { CHECK, GOLD_LEAF, INK, LACQUER, PORCELAIN, SELECT } from './palette';

// The armies: glazed porcelain and urushi lacquer on the Staunton
// silhouettes, both drawn with a thin sumi outline so every piece reads as
// an ink drawing against paper, glass or the other army. The unicorn's horn
// is gold leaf on both sides, the one accent in the set, so it can never be
// taken for a bishop, even from above.

// --- Geometry ------------------------------------------------------------------

type Part = [BufferGeometry, [number, number, number]?, [number, number, number]?];
type Role = 'body' | 'accent' | 'groove';

const CRENELLATIONS = [0, 1, 2, 3, 4].map((i) => (i * 2 * Math.PI) / 5);
const CORONET = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (i * 2 * Math.PI) / 8);

const g = STAUNTON;

// A horse's head in profile (x forward, y up) for Sumi's knight: a longer
// snout, a clear jaw and throat, pricked ears and a crested neck, so it
// reads as a horse from any side, even at the size of a pawn on screen.
const HEAD: [number, number][] = [
  [0.13, 0.14],
  [0.15, 0.22],
  [0.13, 0.3],
  [0.15, 0.35],
  [0.22, 0.385],
  [0.265, 0.405],
  [0.288, 0.44],
  [0.282, 0.476],
  [0.245, 0.5],
  [0.17, 0.545],
  [0.11, 0.59],
  [0.078, 0.645],
  [0.074, 0.725],
  [0.036, 0.668],
  [-0.004, 0.662],
  [-0.046, 0.622],
  [-0.086, 0.552],
  [-0.122, 0.462],
  [-0.15, 0.362],
  [-0.165, 0.262],
  [-0.16, 0.14],
];
const HEAD_DEPTH = 0.15;
const HEAD_BEVEL = 0.035;
const headShape = (points: [number, number][]) => {
  const shape = new Shape();
  shape.moveTo(...points[0]);
  shape.splineThru(points.slice(1).map(([x, y]) => new Vector2(x, y)));
  shape.closePath();
  return shape;
};
const knightHead = new ExtrudeGeometry(headShape(HEAD), {
  depth: HEAD_DEPTH,
  bevelEnabled: true,
  bevelThickness: HEAD_BEVEL,
  bevelSize: 0.026,
  bevelSegments: 3,
  curveSegments: 3,
}).translate(0, 0, -HEAD_DEPTH / 2);
// The mane, painted down the back of the neck: a band just proud of both sides
const MANE: [number, number][] = [
  [-0.03, 0.66],
  [-0.075, 0.585],
  [-0.115, 0.49],
  [-0.145, 0.39],
  [-0.162, 0.3],
  [-0.172, 0.27],
  [-0.148, 0.27],
  [-0.128, 0.37],
  [-0.098, 0.47],
  [-0.058, 0.56],
  [-0.012, 0.64],
];
const MANE_DEPTH = HEAD_DEPTH + HEAD_BEVEL * 2 + 0.006;
const knightMane = new ExtrudeGeometry(headShape(MANE), {
  depth: MANE_DEPTH,
  bevelEnabled: false,
  curveSegments: 3,
}).translate(0, 0, -MANE_DEPTH / 2);
const eye = new SphereGeometry(0.02, 10, 8);
const EYE_Z = HEAD_DEPTH / 2 + HEAD_BEVEL - 0.006;
/** Each piece's parts by role, placed as StauntonParts places them. */
const PARTS: Record<PieceType, Partial<Record<Role, Part[]>>> = {
  [PieceType.Pawn]: { body: [[g.pawnBody], [g.pawnHead, [0, 0.43, 0]]] },
  [PieceType.Rook]: {
    body: [
      [g.rookBody],
      ...CRENELLATIONS.map(
        (a): Part => [
          g.rookCrenellation,
          [Math.cos(a) * 0.17, 0.585, Math.sin(a) * 0.17],
          [0, -a, 0],
        ],
      ),
    ],
  },
  [PieceType.Bishop]: {
    body: [[g.bishopBody], [g.bishopFinial, [0, 0.725, 0]]],
    groove: [[g.bishopSlot, [0, 0.575, 0], [0, 0, -0.6]]],
  },
  [PieceType.Knight]: {
    body: [[g.knightBase], [knightHead]],
    groove: [[knightMane], [eye, [0.135, 0.555, EYE_Z]], [eye, [0.135, 0.555, -EYE_Z]]],
  },
  [PieceType.Unicorn]: {
    body: [[g.unicornBody]],
    accent: [[g.unicornHorn, [0, 0.67, 0]]],
  },
  [PieceType.Queen]: {
    body: [
      [g.queenBody],
      ...CORONET.map(
        (a): Part => [g.queenCoronet, [Math.cos(a) * 0.15, 0.715, Math.sin(a) * 0.15]],
      ),
      [g.queenFinial, [0, 0.79, 0]],
    ],
  },
  [PieceType.King]: {
    body: [
      [g.kingBody],
      [g.kingCrossVertical, [0, 0.8, 0]],
      [g.kingCrossHorizontal, [0, 0.815, 0]],
    ],
  },
};

const merge = (parts: Part[]): BufferGeometry => {
  const placed = parts.map(([geometry, position = [0, 0, 0], rotation = [0, 0, 0]]) => {
    const c = geometry.clone();
    // mergeGeometries wants all indexed or none; extrusions come unindexed
    if (!c.index) c.setIndex([...Array(c.getAttribute('position').count).keys()]);
    for (const name of Object.keys(c.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) c.deleteAttribute(name);
    }
    c.applyMatrix4(
      new Matrix4().compose(
        new Vector3(...position),
        new Quaternion().setFromEuler(new Euler(...rotation)),
        new Vector3(1, 1, 1),
      ),
    );
    return c;
  });
  const merged = mergeGeometries(placed)!;
  placed.forEach((p) => p.dispose());
  // Outline normals: every vertex at one position shares one averaged normal,
  // so the inflated hull stays closed across hard edges and seams.
  const pos = merged.getAttribute('position');
  const nor = merged.getAttribute('normal');
  const sums = new Map<string, Vector3>();
  const keyOf = (i: number) =>
    `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  for (let i = 0; i < pos.count; i++) {
    const k = keyOf(i);
    const s = sums.get(k) ?? new Vector3();
    s.x += nor.getX(i);
    s.y += nor.getY(i);
    s.z += nor.getZ(i);
    sums.set(k, s);
  }
  const outline = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const s = sums.get(keyOf(i))!.clone().normalize();
    outline.set([s.x, s.y, s.z], i * 3);
  }
  merged.setAttribute('aOutline', new BufferAttribute(outline, 3));
  return merged;
};

export interface PieceGeometry {
  body: BufferGeometry;
  accent?: BufferGeometry;
  groove?: BufferGeometry;
}

const cache = new Map<PieceType, PieceGeometry>();
/** The merged meshes of one piece type (built once, shared by every piece). */
export const pieceGeometry = (type: PieceType): PieceGeometry => {
  let geo = cache.get(type);
  if (!geo) {
    const p = PARTS[type];
    geo = {
      body: merge(p.body ?? []),
      accent: p.accent && merge(p.accent),
      groove: p.groove && merge(p.groove),
    };
    cache.set(type, geo);
  }
  return geo;
};

// --- Materials -------------------------------------------------------------------

export type PieceState = 'rest' | 'hovered' | 'selected' | 'check';

const EMISSIVE: Record<PieceState, string> = {
  rest: '#000000',
  // Under the pointer the glaze catches a little more light
  hovered: '#16120c',
  selected: '#2e1f04',
  check: '#3a030a',
};

const bodies = new Map<string, MeshStandardMaterial>();
/** Porcelain or lacquer, shared per colour and state. */
export const bodyMaterial = (color: PieceColor, state: PieceState = 'rest') => {
  const key = `${color}/${state}`;
  let m = bodies.get(key);
  if (!m) {
    m =
      color === 'white'
        ? new MeshStandardMaterial({
            color: PORCELAIN,
            roughness: 0.24,
            metalness: 0,
            envMapIntensity: 0.85,
          })
        : new MeshStandardMaterial({
            color: LACQUER,
            roughness: 0.17,
            metalness: 0,
            envMapIntensity: 1.25,
          });
    m.emissive.set(EMISSIVE[state]);
    bodies.set(key, m);
  }
  return m;
};

export const goldMaterial = new MeshStandardMaterial({
  color: GOLD_LEAF,
  roughness: 0.3,
  metalness: 1,
  envMapIntensity: 1.2,
});

export const grooveMaterial: Record<PieceColor, MeshStandardMaterial> = {
  white: new MeshStandardMaterial({ color: '#2d2723', roughness: 0.6 }),
  black: new MeshStandardMaterial({ color: '#9a8f80', roughness: 0.5 }),
};

const hullVertex = /* glsl */ `
  attribute vec3 aOutline;
  uniform float uWidth;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * aOutline);
    // Inflate in proportion to depth: the line keeps one width on screen
    mv.xyz += n * uWidth * -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;

const hullFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    gl_FragColor = vec4(uColor, uOpacity);
    #include <colorspace_fragment>
  }`;

/**
 * The sumi outline: the piece's own mesh, inflated and drawn from the back,
 * so only a rim of it shows round the silhouette. `width` is an angle
 * (radians of view per unit of depth), about 1.6 px at a 720 px view.
 */
export const hullMaterial = (color: string, width: number) =>
  new ShaderMaterial({
    side: BackSide,
    uniforms: {
      uColor: { value: new Color(color) },
      uWidth: { value: width },
      uOpacity: { value: 1 },
    },
    vertexShader: hullVertex,
    fragmentShader: hullFragment,
  });

const OUTLINE = 0.0015;
export const hulls: Record<PieceState, ShaderMaterial> = {
  rest: hullMaterial(INK, OUTLINE),
  // A piece the player may pick up, under the pointer: the same ink, drawn bolder
  hovered: hullMaterial(INK, OUTLINE * 2.1),
  selected: hullMaterial(SELECT, OUTLINE * 1.7),
  check: hullMaterial(CHECK, OUTLINE * 1.9),
};

// --- Meshes ----------------------------------------------------------------------

/** One piece's meshes, with its outline, in the given materials. */
export const PieceMeshes = ({
  type,
  body,
  accent = goldMaterial,
  groove,
  hull,
}: {
  type: PieceType;
  body: Material;
  accent?: Material;
  groove: Material;
  hull: Material;
}) => {
  const geo = pieceGeometry(type);
  return (
    <>
      <mesh geometry={geo.body} material={body} />
      <mesh geometry={geo.body} material={hull} raycast={noRaycast} />
      {geo.accent && (
        <>
          <mesh geometry={geo.accent} material={accent} />
          <mesh geometry={geo.accent} material={hull} raycast={noRaycast} />
        </>
      )}
      {geo.groove && <mesh geometry={geo.groove} material={groove} />}
    </>
  );
};

/**
 * Keeps its children on the floor while the piece above them is lifted. Board
 * wraps a piece body in the kit's Lift (hoverLift); this reads how far that
 * Lift has raised the body and moves back down by as much, so the shadow and
 * the level ring stay on the platform and keep saying which level the piece
 * belongs to. It mounts a frame late on purpose: frame callbacks run in the
 * order they subscribe, and subscribing after the Lift means it reads the
 * Lift's height for this frame, not the last.
 */
const OnFloor = ({ children }: { children: React.ReactNode }) => {
  const [late, setLate] = useState(false);
  useEffect(() => setLate(true), []);
  const group = useRef<Group>(null);
  return (
    <group ref={group}>
      {children}
      {late && <FollowFloor group={group} />}
    </group>
  );
};

const FollowFloor = ({ group }: { group: React.RefObject<Group | null> }) => {
  useFrame(() => {
    const g = group.current;
    // The body's parent is the Lift's group (or the piece's own, unlifted)
    const lift = g?.parent?.position.y ?? 0;
    if (g && g.position.y !== -lift) g.position.y = -lift;
  });
  return null;
};

const footprintRing = new RingGeometry(0.34, 0.382, 48).rotateX(-Math.PI / 2);
const footprints = new Map<string, MeshBasicMaterial>();
/** The ring of the level's ink at a piece's foot (piece units). */
const footprintMaterial = (color: string) => {
  let m = footprints.get(color);
  if (!m) {
    m = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    footprints.set(color, m);
  }
  return m;
};

/**
 * A piece on its platform: a soft contact shadow and a thin ring of its
 * level's ink on the floor, and the piece above them. Hovered (a piece the
 * player may pick up) its ink outline goes bolder and it stirs up a little;
 * selected it rises, gold-outlined. Both lifts are the kit's (hoverLift); the
 * shadow and ring stay down on the floor.
 */
export const makePieceBody = (levelInks: string[]) => {
  const SumiPieceBody = ({ type, color, selected, hovered, inCheck, level }: PieceBodyProps) => {
    const state: PieceState = inCheck
      ? 'check'
      : selected
        ? 'selected'
        : hovered
          ? 'hovered'
          : 'rest';
    return (
      <>
        <OnFloor>
          <ContactShadow radius={0.37} opacity={0.55} color="#2a1c10" />
          {level !== undefined && (
            <mesh
              geometry={footprintRing}
              material={footprintMaterial(levelInks[level] ?? levelInks[0])}
              position={[0, 0.007, 0]}
              renderOrder={LAYER.shadow + 0.5}
              raycast={noRaycast}
            />
          )}
        </OnFloor>
        <PieceMeshes
          type={type}
          body={bodyMaterial(color, state)}
          groove={grooveMaterial[color]}
          hull={hulls[state]}
        />
      </>
    );
  };
  return SumiPieceBody;
};
