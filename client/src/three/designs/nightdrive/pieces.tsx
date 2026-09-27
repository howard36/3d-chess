import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, MeshPhysicalMaterial, MeshStandardMaterial, Vector3 } from 'three';
import type { Group } from 'three';
import { PieceType } from '../../../engine/pieces';
import { StauntonParts } from '../classic/pieces';
import { ContactShadow } from '../kit/plates';
import type { PieceBodyProps, PieceColor } from '../types';
import { knightGeometry, unicornGeometry } from './geometry';
import { CHECK, INK, INK_RIM, PEARL, PEARL_RIM, SELECT } from './palette';

// The armies are painted like cars at night: pearl white and ink-indigo
// clearcoat, each reflecting the dusk. Every piece carries a view-dependent
// rim (a fresnel term added to its emission), so its silhouette is traced in
// light from any angle, whatever lies behind it: a faint lilac sheen on the
// pearl army, a hot-pink neon edge on the ink army. The rim is the one thing
// that changes with a piece's state: cyan when it is picked up (with a glint
// of light sweeping up it), red when its king is in check.

export type PieceState = 'idle' | 'selected' | 'check';

interface Look {
  rim: string;
  rimStrength: number;
  /** Where the rim starts, in 1 - N·V (0 lights the whole body, ~0.4 only the edges). */
  rimStart: number;
  rimPower: number;
  glint: number;
  emissive: string;
}

const LOOKS: Record<PieceColor, Record<PieceState, Look>> = {
  white: {
    idle: {
      rim: PEARL_RIM,
      rimStrength: 0.3,
      rimStart: 0.4,
      rimPower: 1.6,
      glint: 0,
      emissive: '#000000',
    },
    selected: {
      rim: SELECT,
      rimStrength: 2.2,
      rimStart: 0.15,
      rimPower: 1.4,
      glint: 1,
      emissive: '#0a3640',
    },
    check: {
      rim: CHECK,
      rimStrength: 1.6,
      rimStart: 0.15,
      rimPower: 1.5,
      glint: 0,
      emissive: '#2a0008',
    },
  },
  black: {
    idle: {
      rim: INK_RIM,
      rimStrength: 1.55,
      rimStart: 0.32,
      rimPower: 1.4,
      glint: 0,
      emissive: '#000000',
    },
    selected: {
      rim: SELECT,
      rimStrength: 1.9,
      rimStart: 0.2,
      rimPower: 1.5,
      glint: 1,
      emissive: '#031c22',
    },
    check: {
      rim: CHECK,
      rimStrength: 1.8,
      rimStart: 0.2,
      rimPower: 1.5,
      glint: 0,
      emissive: '#3a0010',
    },
  },
};

/** Uniforms each piece material adds to three's physical shader. */
interface RimUniforms {
  uRim: { value: Color };
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
    // knight's cheek) stay dark while the silhouette is traced
    float rim = pow(smoothstep(uRimStart, 1.0, 1.0 - facing), uRimPower);
    totalEmissiveRadiance += uRim * rim;
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
  const look = LOOKS[color][state];
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
  m.emissive.set(look.emissive);
  const uniforms: RimUniforms = {
    uRim: { value: new Color(look.rim).multiplyScalar(look.rimStrength) },
    uRimStart: { value: look.rimStart },
    uRimPower: { value: look.rimPower },
    uGlint: { value: look.glint },
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

// The bishop's mitre slot: a violet cut on the pearl army, a pink neon slit
// on the ink army (a bishop tell from any side).
const grooves: Record<PieceColor, MeshStandardMaterial> = {
  white: new MeshStandardMaterial({ color: '#5d4c9a', roughness: 0.5 }),
  black: new MeshStandardMaterial({
    color: '#3a0a26',
    emissive: new Color(INK_RIM).multiplyScalar(0.8),
    roughness: 0.4,
  }),
};

// --- Picking up ---------------------------------------------------------------------------

/** How high a picked-up piece floats, in piece units. */
const RISE = 0.22;
const scratch = new Vector3();

/**
 * Floats its children up off the floor while `lifted` (easing there, with a
 * slow bob), and sweeps the selected material's glint up the piece. Runs on
 * r3f's clock.
 */
const Rise = ({
  lifted,
  color,
  children,
}: {
  lifted: boolean;
  color: PieceColor;
  children: ReactNode;
}) => {
  const group = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  const since = useRef(0);
  useEffect(() => {
    since.current = 0;
    invalidate();
  }, [lifted, invalidate]);
  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const dt = Math.min(delta, 1 / 30);
    since.current += dt;
    const bob = lifted ? Math.sin(since.current * 2.2) * 0.025 : 0;
    const target = (lifted ? RISE : 0) + bob;
    const y = g.position.y + (target - g.position.y) * Math.min(1, dt * 10);
    const settled = !lifted && Math.abs(y) < 1e-3;
    g.position.y = settled ? 0 : y;
    if (lifted) {
      // The glint climbs the piece about every two seconds, then rests a beat
      const rim = pieceMaterial(color, 'selected').userData.rim as RimUniforms;
      g.getWorldPosition(scratch);
      const k = (since.current * 0.5) % 1.25;
      rim.uGlintY.value = scratch.y - 0.05 + k * 0.9;
    }
    if (!settled) invalidate();
  });
  return <group ref={group}>{children}</group>;
};

// --- The body ---------------------------------------------------------------------------

export const pieceState = ({ inCheck, selected }: Pick<PieceBodyProps, 'inCheck' | 'selected'>) =>
  inCheck ? 'check' : selected ? 'selected' : 'idle';

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

/** A piece on its contact shadow; it floats up when picked. */
export const PieceBody = (props: PieceBodyProps) => (
  <>
    <ContactShadow radius={0.34} opacity={0.6} color="#040010" />
    <Rise lifted={props.selected} color={props.color}>
      <PieceParts type={props.type} color={props.color} state={pieceState(props)} />
    </Rise>
  </>
);
