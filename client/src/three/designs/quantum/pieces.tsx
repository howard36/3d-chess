import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  Color,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import type {
  Camera,
  Mesh,
  Object3D,
  MeshPhysicalMaterialParameters,
  WebGLProgramParametersWithUniforms,
} from 'three';
import { ChessPiece, partsGeometry, PIECE_PARTS, pieceSet } from '../../pieces';
import type { PieceType } from '../../../engine/pieces';
import { prefersReducedMotion } from '../../motion';
import { noRaycast } from '../kit/noRaycast';
import { ContactShadow, LevelFootprint } from '../kit/plates';
import type { PieceBodyProps, PieceColor } from '../types';
import { LEVEL_COLORS, PALETTE } from './palette';

// The pieces: the shared Staunton set in brushed gold against matte black
// ceramic. Each army is inlaid with the other's material, gold collars and
// details on the ceramic, ceramic details on the gold, and every piece
// stands on a thin foot of its level's colour, ringed on the wafer by a
// trace of the same colour. A frosty rim light, strongest on the ceramic,
// keeps every dark form clear of the dark cryostat.
//
// Selection is superposition: two faint, phase-shifted echoes of the piece
// split away and oscillate, then settle into a slow shimmer about it for as
// long as it is held; it collapses back into one when released.

// --- Materials --------------------------------------------------------------------

interface RimOptions {
  rim: string;
  rimStrength: number;
  rimPower: number;
}

/**
 * A physical material with a view-dependent rim added to its lit colour:
 * silhouettes and turned-away surfaces catch a thin edge of light, so a dark
 * form never melts into a dark background. A class (not an onBeforeCompile
 * patch on an instance) so that a clone, like the one the kit's GhostPiece
 * makes, keeps the rim.
 */
export class RimMaterial extends MeshPhysicalMaterial {
  rimUniforms = {
    uRimColor: { value: new Color('#ffffff') },
    uRimStrength: { value: 0 },
    uRimPower: { value: 3 },
  };

  constructor(params?: MeshPhysicalMaterialParameters, rim?: RimOptions) {
    super(params);
    if (rim) this.setRim(rim);
  }

  setRim({ rim, rimStrength, rimPower }: RimOptions) {
    this.rimUniforms.uRimColor.value.set(rim);
    this.rimUniforms.uRimStrength.value = rimStrength;
    this.rimUniforms.uRimPower.value = rimPower;
    return this;
  }

  onBeforeCompile(shader: WebGLProgramParametersWithUniforms) {
    Object.assign(shader.uniforms, this.rimUniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        'uniform vec3 uRimColor;\nuniform float uRimStrength;\nuniform float uRimPower;\nvoid main() {',
      )
      .replace(
        '#include <opaque_fragment>',
        `float rimF = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), uRimPower);
        outgoingLight += uRimColor * rimF * uRimStrength;
        #include <opaque_fragment>`,
      );
  }

  customProgramCacheKey() {
    return 'quantum-rim';
  }

  copy(source: RimMaterial) {
    super.copy(source);
    if (source.rimUniforms) {
      this.rimUniforms.uRimColor.value.copy(source.rimUniforms.uRimColor.value);
      this.rimUniforms.uRimStrength.value = source.rimUniforms.uRimStrength.value;
      this.rimUniforms.uRimPower.value = source.rimUniforms.uRimPower.value;
    }
    return this;
  }
}

type PieceState = 'rest' | 'hover' | 'selected' | 'check';

const GOLD: MeshPhysicalMaterialParameters = {
  color: PALETTE.gold,
  metalness: 1,
  roughness: 0.34,
  envMapIntensity: 1,
};
const GOLD_POLISHED: MeshPhysicalMaterialParameters = {
  color: PALETTE.goldPolished,
  metalness: 1,
  roughness: 0.2,
  envMapIntensity: 1.1,
};
/** The ceramic inlaid in the gold army's details: satin, so it never catches the softbox pale. */
const CERAMIC_INLAY: MeshPhysicalMaterialParameters = {
  color: '#101217',
  metalness: 0,
  roughness: 0.62,
  envMapIntensity: 0.6,
};
const CERAMIC: MeshPhysicalMaterialParameters = {
  color: PALETTE.ceramic,
  metalness: 0,
  roughness: 0.52,
  clearcoat: 0.35,
  clearcoatRoughness: 0.28,
  envMapIntensity: 0.9,
};

/** The rim each army wears in each state: frost at rest, gold when held, red in check. */
const rimFor = (army: PieceColor, state: PieceState): RimOptions => {
  const ceramic = army === 'black';
  switch (state) {
    case 'check':
      return { rim: PALETTE.check, rimStrength: 1.05, rimPower: 2.4 };
    case 'selected':
      // A held gold piece glows warmer; a held ceramic one brighter frost,
      // never gold, so it cannot pass for the other army
      return ceramic
        ? { rim: PALETTE.frost, rimStrength: 0.95, rimPower: 2.5 }
        : { rim: PALETTE.select, rimStrength: 0.55, rimPower: 2.4 };
    case 'hover':
      return { rim: PALETTE.frost, rimStrength: ceramic ? 0.95 : 0.45, rimPower: 2.4 };
    default:
      return { rim: PALETTE.frost, rimStrength: ceramic ? 0.6 : 0.2, rimPower: 2.8 };
  }
};

interface ArmyMaterials {
  body: RimMaterial;
  collar: RimMaterial;
  accent: RimMaterial;
}

const cache = new Map<string, ArmyMaterials>();
/** Shared per army and state: never recolour one of these for a single piece. */
export const armyMaterials = (army: PieceColor, state: PieceState): ArmyMaterials => {
  const key = `${army}/${state}`;
  let m = cache.get(key);
  if (!m) {
    const rim = rimFor(army, state);
    const glow = state === 'check' ? '#2a0306' : '#000000';
    const make = (p: MeshPhysicalMaterialParameters) =>
      new RimMaterial({ ...p, emissive: glow }, rim);
    m =
      army === 'white'
        ? { body: make(GOLD), collar: make(GOLD_POLISHED), accent: make(CERAMIC_INLAY) }
        : { body: make(CERAMIC), collar: make(GOLD), accent: make(GOLD) };
    cache.set(key, m);
  }
  return m;
};

/** The foot of every piece: a thin band of its level's colour, glowing a little so it holds in shade. */
const feet = LEVEL_COLORS.map(
  (c) =>
    new MeshStandardMaterial({
      color: c,
      emissive: c,
      emissiveIntensity: 0.55,
      roughness: 0.4,
      metalness: 0,
    }),
);
export const footMaterial = (level: number) => feet[level] ?? feet[0];

// --- Echoes -------------------------------------------------------------------------

/**
 * A see-through echo of a piece: its silhouette edges glow, its face is
 * nearly clear, added onto whatever is behind it.
 */
export const echoMaterial = (color: string, opacity = 0.5) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uColor: { value: new Color(color) },
      uOpacity: { value: opacity },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        gl_FragColor = vec4(uColor * (0.05 + 1.5 * f), uOpacity);
        #include <colorspace_fragment>
      }`,
  });

/** The whole piece as one geometry, for echoes. */
export const wholePiece = (type: PieceType) => partsGeometry(pieceSet(), type, PIECE_PARTS)!;

/** The camera's right, level, in the frame of `parent` (reused scratch vector). */
export const viewRight = (camera: Camera, parent: Object3D | null) => {
  right.setFromMatrixColumn(camera.matrixWorld, 0);
  right.y = 0;
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  right.normalize();
  if (parent) right.applyQuaternion(parent.getWorldQuaternion(turn).invert());
  return right;
};
const right = new Vector3();
const turn = new Quaternion();

/**
 * Two echoes of a held piece: they split away to either side (across the
 * view, so they always show), ring like a struck wave packet out of phase
 * with each other, and settle into a slow, faint shimmer about the piece.
 */
const Superposition = ({ type }: { type: PieceType }) => {
  const a = useRef<Mesh>(null);
  const b = useRef<Mesh>(null);
  const time = useRef(0);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const still = prefersReducedMotion();
  // One echo a little warm, one a little cold: a faint dispersion
  const materials = useMemo(
    () => [echoMaterial(PALETTE.echoWarm, 0.6), echoMaterial(PALETTE.echo, 0.6)],
    [],
  );
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);
  const geometry = wholePiece(type);

  useFrame((_, delta) => {
    const ma = a.current;
    const mb = b.current;
    if (!ma || !mb) return;
    time.current += Math.min(delta, 1 / 20);
    const t = time.current;
    // Across the view, in the piece's own frame
    const across = viewRight(camera, ma.parent);
    // Struck: a wave packet ringing out; then held apart, breathing slowly
    const split = (s: number) =>
      still
        ? 0.07
        : 0.26 * Math.sin(2 * Math.PI * 1.45 * s) * Math.exp(-s / 0.5) +
          (0.07 + 0.018 * Math.sin((2 * Math.PI * s) / 3.4)) * (1 - Math.exp(-s / 0.4));
    ma.position.copy(across).multiplyScalar(split(t));
    mb.position.copy(across).multiplyScalar(-split(Math.max(t - 0.11, 0)));
    const opacity = 0.36 + 0.5 * Math.exp(-t / 0.55);
    for (const m of materials) m.uniforms.uOpacity.value = opacity;
    if (!still) invalidate();
  });

  return (
    <>
      <mesh ref={a} geometry={geometry} material={materials[0]} raycast={noRaycast} />
      <mesh ref={b} geometry={geometry} material={materials[1]} raycast={noRaycast} />
    </>
  );
};

// --- The body ---------------------------------------------------------------------

/**
 * A piece standing on its contact shadow and a ring of its level's colour
 * (both part of the body, so they travel with it), echoed while held.
 */
export const PieceBody = ({
  type,
  color,
  level = 0,
  selected,
  hovered,
  inCheck,
}: PieceBodyProps) => {
  const state: PieceState = inCheck ? 'check' : selected ? 'selected' : hovered ? 'hover' : 'rest';
  const m = armyMaterials(color, state);
  return (
    <>
      <ContactShadow radius={0.38} opacity={0.55} color="#01040a" />
      <LevelFootprint color={LEVEL_COLORS[level]} radius={0.42} width={0.035} opacity={0.9} />
      <ChessPiece
        type={type}
        parts={{ body: m.body, collar: m.collar, accent: m.accent, foot: footMaterial(level) }}
      />
      {selected && <Superposition type={type} />}
    </>
  );
};
