import { useMemo } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  EdgesGeometry,
  Euler,
  LineBasicMaterial,
  Matrix4,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  Quaternion,
  TorusGeometry,
  Vector3,
} from 'three';
import type { Material } from 'three';
import { PieceType } from '../../../engine/pieces';
import { STAUNTON } from '../../pieceGeometry';
import { noRaycast } from '../kit/noRaycast';
import type { PieceBodyProps, PieceColor } from '../types';

// Synthwave pieces: the Staunton silhouettes in near-black glass, outlined
// by a fresnel rim in their army's neon, with neon tubes traced along every
// hard edge of the turned profile and each piece's signature detail (the
// bishop's mitre cut, the unicorn's spiral, the queen's coronet, the king's
// cross) lit up solid.

export const NEON: Record<PieceColor, string> = { white: '#27e3ff', black: '#ff2bd6' };
export const CHECK_RED = '#ff2a3d';
const GLASS: Record<PieceColor, string> = { white: '#0b2733', black: '#33092e' };
// Magenta is darker than cyan at the same drive: lift it so the armies glow evenly.
const GAIN: Record<PieceColor, number> = { white: 1, black: 1.5 };

export type Glow = 'none' | 'hover' | 'selected' | 'check';

// How hard each state drives the rim, the edge tubes and the accents.
const RIM: Record<Glow, number> = { none: 1.15, hover: 1.7, selected: 2.4, check: 2.4 };
const LINE: Record<Glow, number> = { none: 1.2, hover: 1.6, selected: 2.2, check: 2 };

const hdr = (hex: string, k: number) => new Color(hex).multiplyScalar(k);

const tint = (color: PieceColor, glow: Glow) => (glow === 'check' ? CHECK_RED : NEON[color]);

const cached = <T,>(cache: Map<string, T>, key: string, make: () => T): T => {
  let v = cache.get(key);
  if (!v) {
    v = make();
    cache.set(key, v);
  }
  return v;
};

// --- Glass body with a fresnel rim ---------------------------------------

const bodies = new Map<string, MeshPhysicalMaterial>();
export const bodyMaterial = (color: PieceColor, glow: Glow) =>
  cached(bodies, `${color}-${glow}`, () => {
    const m = new MeshPhysicalMaterial({
      color: GLASS[color],
      roughness: 0.16,
      metalness: 0.35,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.5,
      emissive: new Color(tint(color, glow)),
      emissiveIntensity: glow === 'none' ? 0.03 : glow === 'hover' ? 0.08 : 0.14,
    });
    const rim = { value: hdr(tint(color, glow), RIM[glow] * GAIN[color]) };
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uRim = rim;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `#include <emissivemap_fragment>
          float rimK = 1.0 - abs(dot(normal, normalize(vViewPosition)));
          totalEmissiveRadiance += uRim * (pow(rimK, 2.6) + 0.04);`,
        );
    };
    m.customProgramCacheKey = () => 'synthwave-rim';
    return m;
  });

const accents = new Map<string, MeshBasicMaterial>();
/** Solid neon for a piece's signature detail. */
export const accentMaterial = (color: PieceColor, glow: Glow) =>
  cached(
    accents,
    `${color}-${glow}`,
    () =>
      new MeshBasicMaterial({
        color: hdr(tint(color, glow), LINE[glow] * 0.9 * GAIN[color]),
        toneMapped: false,
      }),
  );

const lines = new Map<string, LineBasicMaterial>();
export const lineMaterial = (color: PieceColor, glow: Glow) =>
  cached(
    lines,
    `${color}-${glow}`,
    () =>
      new LineBasicMaterial({
        color: hdr(tint(color, glow), LINE[glow] * GAIN[color]),
        toneMapped: false,
      }),
  );

// --- Neon edge tubes -------------------------------------------------------

type Placed = [BufferGeometry, [number, number, number]?, [number, number, number]?];

const CRENELLATIONS = [0, 1, 2, 3, 4].map((i) => (i * 2 * Math.PI) / 5);

// The parts whose hard edges are traced, placed as StauntonParts places them.
const EDGED: Record<PieceType, Placed[]> = {
  [PieceType.Pawn]: [[STAUNTON.pawnBody]],
  [PieceType.Rook]: [
    [STAUNTON.rookBody],
    ...CRENELLATIONS.map(
      (a): Placed => [
        STAUNTON.rookCrenellation,
        [Math.cos(a) * 0.17, 0.585, Math.sin(a) * 0.17],
        [0, -a, 0],
      ],
    ),
  ],
  [PieceType.Bishop]: [[STAUNTON.bishopBody]],
  [PieceType.Knight]: [[STAUNTON.knightBase], [STAUNTON.knightHead]],
  [PieceType.Unicorn]: [[STAUNTON.unicornBody], [STAUNTON.unicornHorn, [0, 0.67, 0]]],
  [PieceType.Queen]: [[STAUNTON.queenBody]],
  [PieceType.King]: [[STAUNTON.kingBody]],
};

// One merged line geometry per piece type: a single draw call per piece.
const edgeGeometries = new Map<PieceType, BufferGeometry>();
const edgesFor = (type: PieceType) => {
  let g = edgeGeometries.get(type);
  if (g) return g;
  const chunks: Float32Array[] = [];
  const m = new Matrix4();
  const v = new Vector3();
  for (const [geometry, pos = [0, 0, 0], rot = [0, 0, 0]] of EDGED[type]) {
    const edges = new EdgesGeometry(geometry, 32);
    const src = edges.getAttribute('position');
    m.compose(
      new Vector3(...pos),
      new Quaternion().setFromEuler(new Euler(...rot)),
      v.set(1, 1, 1),
    );
    const out = new Float32Array(src.count * 3);
    for (let i = 0; i < src.count; i++) {
      v.fromBufferAttribute(src, i).applyMatrix4(m);
      // Nudged out a hair so the tube sits on the glass, not inside it
      v.x *= 1.012;
      v.z *= 1.012;
      out.set([v.x, v.y, v.z], i * 3);
    }
    edges.dispose();
    chunks.push(out);
  }
  const merged = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    merged.set(c, o);
    o += c.length;
  }
  g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(merged, 3));
  edgeGeometries.set(type, g);
  return g;
};

const footRing = new TorusGeometry(1, 0.045, 6, 48);
const FOOT: Partial<Record<PieceType, number>> = {
  [PieceType.King]: 0.285,
  [PieceType.Queen]: 0.275,
};

const CORONET = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (i * 2 * Math.PI) / 8);

/** The Staunton meshes, with each piece's signature detail in `accent`. */
export const SynthParts = ({
  type,
  body,
  accent,
}: {
  type: PieceType;
  body: Material;
  accent: Material;
}) => {
  const g = STAUNTON;
  switch (type) {
    case PieceType.Pawn:
      return (
        <>
          <mesh geometry={g.pawnBody} material={body} />
          <mesh position={[0, 0.43, 0]} geometry={g.pawnHead} material={body} />
        </>
      );
    case PieceType.Rook:
      return (
        <>
          <mesh geometry={g.rookBody} material={body} />
          {CRENELLATIONS.map((a) => (
            <mesh
              key={a}
              position={[Math.cos(a) * 0.17, 0.585, Math.sin(a) * 0.17]}
              rotation={[0, -a, 0]}
              geometry={g.rookCrenellation}
              material={body}
            />
          ))}
        </>
      );
    case PieceType.Bishop:
      return (
        <>
          <mesh geometry={g.bishopBody} material={body} />
          <mesh
            position={[0, 0.575, 0]}
            rotation={[0, 0, -0.6]}
            scale={[1.08, 1.6, 1.08]}
            geometry={g.bishopSlot}
            material={accent}
          />
          <mesh position={[0, 0.725, 0]} geometry={g.bishopFinial} material={accent} />
        </>
      );
    case PieceType.Knight:
      return (
        <>
          <mesh geometry={g.knightBase} material={body} />
          <mesh geometry={g.knightHead} material={body} />
        </>
      );
    case PieceType.Unicorn:
      return (
        <>
          <mesh geometry={g.unicornBody} material={body} />
          <mesh position={[0, 0.67, 0]} geometry={g.unicornHorn} material={body} />
          <mesh geometry={g.unicornSpiral} material={accent} scale={[1.04, 1, 1.04]} />
        </>
      );
    case PieceType.Queen:
      return (
        <>
          <mesh geometry={g.queenBody} material={body} />
          {CORONET.map((a) => (
            <mesh
              key={a}
              position={[Math.cos(a) * 0.15, 0.715, Math.sin(a) * 0.15]}
              geometry={g.queenCoronet}
              material={accent}
            />
          ))}
          <mesh position={[0, 0.79, 0]} geometry={g.queenFinial} material={accent} />
        </>
      );
    case PieceType.King:
      return (
        <>
          <mesh geometry={g.kingBody} material={body} />
          <mesh position={[0, 0.8, 0]} geometry={g.kingCrossVertical} material={accent} />
          <mesh position={[0, 0.815, 0]} geometry={g.kingCrossHorizontal} material={accent} />
        </>
      );
    default:
      return null;
  }
};

/** Neon tubes along a piece's hard edges, plus a glowing ring round its foot. */
export const NeonEdges = ({
  type,
  line,
  ring,
}: {
  type: PieceType;
  line: Material;
  ring: Material;
}) => {
  const geometry = useMemo(() => edgesFor(type), [type]);
  const r = FOOT[type] ?? 0.245;
  return (
    <>
      <lineSegments geometry={geometry} material={line} raycast={noRaycast} />
      <mesh
        geometry={footRing}
        material={ring}
        position={[0, 0.02, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[r, r, 0.6]}
        raycast={noRaycast}
      />
    </>
  );
};

/** The cells here are a quarter wider than the unit cell the set was turned for. */
export const PIECE_SCALE = 1.2;

export const PieceBody = ({ type, color, selected, hovered, inCheck }: PieceBodyProps) => {
  const glow: Glow = inCheck ? 'check' : selected ? 'selected' : hovered ? 'hover' : 'none';
  return (
    <group scale={PIECE_SCALE}>
      <SynthParts
        type={type}
        body={bodyMaterial(color, glow)}
        accent={accentMaterial(color, glow)}
      />
      <NeonEdges type={type} line={lineMaterial(color, glow)} ring={accentMaterial(color, glow)} />
    </group>
  );
};
