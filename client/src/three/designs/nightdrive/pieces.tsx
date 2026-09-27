import { useRef } from 'react';
import type { ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  Color,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  TorusGeometry,
  Vector3,
} from 'three';
import type { Group } from 'three';
import { PieceType } from '../../../engine/pieces';
import { StauntonParts } from '../classic/pieces';
import { ContactShadow } from '../kit/plates';
import { noRaycast } from '../kit/noRaycast';
import type { PieceBodyProps, PieceColor } from '../types';
import { knightGeometry, unicornGeometry } from './geometry';
import { CHECK, INK, INK_RIM, INK_RIM_EDGE, LEVEL_NEON, PEARL, PEARL_RIM, SELECT } from './palette';

// The armies are painted like cars at night: pearl white and ink-indigo
// clearcoat, each reflecting the dusk. Every piece carries a view-dependent
// rim (a fresnel term added to its emission), so its silhouette is traced in
// light from any angle, whatever lies behind it: a cool white edge on the
// pearl army, a violet-magenta edge on the ink army whose outermost sliver
// turns pale cyan (so it holds against the pink horizon). The rim is what
// changes with a piece's state: a pale cyan under the pointer (a first hint
// of the cyan that marks where it can go), full cyan when picked up (with a
// glint sweeping up the piece), red when its king is in check.
//
// Round every base runs a thin neon band in the colour of the level the
// piece stands on, the same colour as that level's plate edge and letter.

export type PieceState = 'idle' | 'hover' | 'selected' | 'check';

/** The pointer's pale cyan: a softer version of the selection's. */
const HOVER = '#a6f7ff';

interface Look {
  rim: string;
  /** Colour the rim turns toward at its very edge. */
  rimEdge: string;
  rimStrength: number;
  /** Where the rim starts, in 1 - N·V (0 lights the whole body, ~0.4 only the edges). */
  rimStart: number;
  rimPower: number;
  glint: number;
  emissive: string;
}

const look = (rim: string, rimEdge: string, rimStrength: number, rimStart: number): Look => ({
  rim,
  rimEdge,
  rimStrength,
  rimStart,
  rimPower: 1.5,
  glint: 0,
  emissive: '#000000',
});

const LOOKS: Record<PieceColor, Record<PieceState, Look>> = {
  white: {
    idle: look(PEARL_RIM, '#ffffff', 0.8, 0.36),
    hover: { ...look(HOVER, '#ffffff', 1.9, 0.18), emissive: '#0a3842' },
    selected: { ...look(SELECT, '#ffffff', 2.2, 0.15), glint: 1, emissive: '#0a3640' },
    check: { ...look(CHECK, '#ffd0d8', 1.6, 0.15), emissive: '#2a0008' },
  },
  black: {
    idle: look(INK_RIM, INK_RIM_EDGE, 2.3, 0.3),
    hover: { ...look(HOVER, '#ffffff', 2.4, 0.16), emissive: '#052229' },
    selected: { ...look(SELECT, '#ffffff', 1.9, 0.2), glint: 1, emissive: '#031c22' },
    check: { ...look(CHECK, '#ffd0d8', 1.8, 0.2), emissive: '#3a0010' },
  },
};

/** Uniforms each piece material adds to three's physical shader. */
interface RimUniforms {
  uRim: { value: Color };
  uRimEdge: { value: Color };
  uRimStart: { value: number };
  uRimPower: { value: number };
  uGlint: { value: number };
  uGlintY: { value: number };
  uGlintColor: { value: Color };
}

const vertexHead = /* glsl */ `
  #include <common>
  varying float vWorldY;`;
const vertexBody = /* glsl */ `
  #include <project_vertex>
  vWorldY = (modelMatrix * vec4(transformed, 1.0)).y;`;
const fragmentHead = /* glsl */ `
  #include <common>
  uniform vec3 uRim;
  uniform vec3 uRimEdge;
  uniform float uRimStart;
  uniform float uRimPower;
  uniform float uGlint;
  uniform float uGlintY;
  uniform vec3 uGlintColor;
  varying float vWorldY;`;
const fragmentBody = /* glsl */ `
  #include <emissivemap_fragment>
  {
    float facing = saturate(dot(normal, normalize(vViewPosition)));
    // Only the parts seen near edge-on light up, so broad flat faces (the
    // knight's cheek) stay dark while the silhouette is traced; the last
    // sliver of the edge turns toward uRimEdge
    float edge = smoothstep(uRimStart, 1.0, 1.0 - facing);
    float rim = pow(edge, uRimPower);
    totalEmissiveRadiance += mix(uRim, uRimEdge * length(uRim) * 0.6, pow(edge, 3.5) * 0.8) * rim;
    if (uGlint > 0.0) {
      // A band of light climbing the piece
      float g = (vWorldY - uGlintY) / 0.05;
      totalEmissiveRadiance += uGlintColor * uGlint * exp(-g * g) * (0.45 + 0.55 * rim);
    }
  }`;

const materials = new Map<string, MeshPhysicalMaterial>();

/** The shared body material of one army in one state. */
export const pieceMaterial = (color: PieceColor, state: PieceState): MeshPhysicalMaterial => {
  const key = `${color}/${state}`;
  let m = materials.get(key);
  if (m) return m;
  const l = LOOKS[color][state];
  m =
    color === 'white'
      ? new MeshPhysicalMaterial({
          color: PEARL,
          roughness: 0.34,
          metalness: 0,
          clearcoat: 0.7,
          clearcoatRoughness: 0.22,
          envMapIntensity: 0.55,
        })
      : new MeshPhysicalMaterial({
          color: INK,
          roughness: 0.3,
          metalness: 0.2,
          clearcoat: 1,
          clearcoatRoughness: 0.12,
          envMapIntensity: 1.0,
        });
  m.emissive.set(l.emissive);
  const uniforms: RimUniforms = {
    uRim: { value: new Color(l.rim).multiplyScalar(l.rimStrength) },
    uRimEdge: { value: new Color(l.rimEdge) },
    uRimStart: { value: l.rimStart },
    uRimPower: { value: l.rimPower },
    uGlint: { value: l.glint },
    uGlintY: { value: -100 },
    uGlintColor: { value: new Color('#dffcff').multiplyScalar(0.9) },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', vertexHead)
      .replace('#include <project_vertex>', vertexBody);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', fragmentHead)
      .replace('#include <emissivemap_fragment>', fragmentBody);
  };
  m.customProgramCacheKey = () => 'nightdrive-piece';
  m.userData.rim = uniforms;
  materials.set(key, m);
  return m;
};

// The bishop's mitre slot: a violet cut on the pearl army, a neon slit on the
// ink army (a bishop tell from any side).
const grooves: Record<PieceColor, MeshStandardMaterial> = {
  white: new MeshStandardMaterial({ color: '#5d4c9a', roughness: 0.5 }),
  black: new MeshStandardMaterial({
    color: '#2e0a36',
    emissive: new Color(INK_RIM).multiplyScalar(0.8),
    roughness: 0.4,
  }),
};

// --- The level band ---------------------------------------------------------------------

/** Radius of each piece's foot (piece units), which its level band wraps. */
const FOOT: Record<PieceType, number> = {
  [PieceType.Pawn]: 0.23,
  [PieceType.Rook]: 0.26,
  [PieceType.Knight]: 0.24,
  [PieceType.Bishop]: 0.24,
  [PieceType.Unicorn]: 0.25,
  [PieceType.Queen]: 0.27,
  [PieceType.King]: 0.28,
};

const bands = new Map<number, TorusGeometry>();
const bandFor = (radius: number) => {
  let g = bands.get(radius);
  if (!g) {
    g = new TorusGeometry(radius + 0.006, 0.016, 6, 40).rotateX(Math.PI / 2);
    bands.set(radius, g);
  }
  return g;
};

/**
 * One band material per level, shared by every piece on it. Grid brightens
 * the focused level's bands and dims the others (see `focusBands`).
 */
export const bandMaterials = LEVEL_NEON.map(
  (c) => new MeshBasicMaterial({ color: new Color(c).multiplyScalar(0.85), toneMapped: false }),
);
const BAND_BASE = LEVEL_NEON.map((c) => new Color(c));

/** Eases the level bands with the level focus: the focused level glows, the others recede. */
export const focusBands = (weights: number[], any: number) => {
  bandMaterials.forEach((m, z) => {
    const w = weights[z] ?? 0;
    m.color.copy(BAND_BASE[z]).multiplyScalar(0.85 * (1 - any * 0.35 * (1 - w)) + w * 0.35);
  });
};

/** A thin neon band round a piece's foot, in its level's colour. */
const LevelBand = ({ type, level }: { type: PieceType; level: number }) => (
  <mesh
    geometry={bandFor(FOOT[type])}
    material={bandMaterials[Math.min(Math.max(level, 0), 4)]}
    position={[0, 0.022, 0]}
    raycast={noRaycast}
  />
);

// --- Picking up ------------------------------------------------------------------------

const scratch = new Vector3();

/**
 * Keeps its children on the floor while the piece above them is lifted (the
 * kit's Lift raises the whole body): the contact shadow stays put, and
 * shrinks and fades a little as the piece rises.
 */
const Grounded = ({ children }: { children: ReactNode }) => {
  const group = useRef<Group>(null);
  useFrame(() => {
    const g = group.current;
    const lift = g?.parent?.position.y ?? 0;
    if (!g) return;
    g.position.y = -lift;
    g.scale.setScalar(1 - Math.min(lift, 0.3) * 0.9);
  });
  return <group ref={group}>{children}</group>;
};

/** Sweeps the selected material's glint up the picked-up piece, on r3f's clock. */
const Glint = ({ color }: { color: PieceColor }) => {
  const group = useRef<Group>(null);
  const since = useRef(0);
  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    since.current += Math.min(delta, 1 / 30);
    const rim = pieceMaterial(color, 'selected').userData.rim as RimUniforms;
    g.getWorldPosition(scratch);
    // Climbs the piece about every two and a half seconds, then rests a beat
    const k = (since.current * 0.5) % 1.25;
    rim.uGlintY.value = scratch.y - 0.05 + k * 0.9;
  });
  return <group ref={group} />;
};

// --- The body ---------------------------------------------------------------------------

export const pieceState = ({
  inCheck,
  selected,
  hovered,
}: Pick<PieceBodyProps, 'inCheck' | 'selected' | 'hovered'>): PieceState =>
  inCheck ? 'check' : selected ? 'selected' : hovered ? 'hover' : 'idle';

/**
 * A piece in one army's paint: the Staunton set, with Nightdrive's own
 * carved knight and horned unicorn (see geometry.ts).
 */
export const PieceParts = ({
  type,
  color,
  state = 'idle',
}: Pick<PieceBodyProps, 'type' | 'color'> & { state?: PieceState }) => {
  const material = pieceMaterial(color, state);
  if (type === PieceType.Knight) return <mesh geometry={knightGeometry} material={material} />;
  if (type === PieceType.Unicorn) return <mesh geometry={unicornGeometry} material={material} />;
  return <StauntonParts type={type} material={material} groove={grooves[color]} />;
};

/** A piece in its paint, with its level band. */
export const PieceWithBand = ({
  type,
  color,
  state,
  level,
}: Pick<PieceBodyProps, 'type' | 'color'> & { state?: PieceState; level: number }) => (
  <>
    <LevelBand type={type} level={level} />
    <PieceParts type={type} color={color} state={state} />
  </>
);

/**
 * A piece on its contact shadow, banded in its level's colour. Board lifts
 * it (hoverLift) under the pointer and when picked up; the shadow stays on
 * the floor.
 */
export const PieceBody = (props: PieceBodyProps) => (
  <>
    <Grounded>
      <ContactShadow radius={0.34} opacity={0.6} color="#040010" />
    </Grounded>
    {props.selected && <Glint color={props.color} />}
    <PieceWithBand
      type={props.type}
      color={props.color}
      state={pieceState(props)}
      level={props.level ?? 0}
    />
  </>
);
