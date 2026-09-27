import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  Color,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
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
import { PieceType } from '../../../engine/pieces';
import { prefersReducedMotion } from '../../motion';
import { noRaycast } from '../kit/noRaycast';
import { LAYER } from '../kit/layers';
import { FLOOR_DECAL } from '../kit/motion';
import { ContactShadow } from '../kit/plates';
import type { PieceBodyProps, PieceColor } from '../types';
import { LEVEL_COLORS, PALETTE } from './palette';

// The pieces: the shared Staunton set in brushed gold against glazed black
// ceramic. Each army is inlaid with the other's material on its small
// details, gold collars, mane, cut, spiral, pearls and cross on the ceramic
// and ceramic details on the gold, while whatever dominates a piece seen
// from above stays the army's own. Every piece stands on a thin foot of its
// level's colour, ringed on the wafer by a trace of the same colour that
// carries the level as a count of electrons. A warm rim on the gold and a
// frosty one on the ceramic keep every form clear of the dark cryostat.
//
// Selection is superposition: as a piece is picked up, two faint,
// phase-shifted echoes split away from it, ring like a struck wave packet,
// and settle back into it within a second and a half.

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

/** Brushed along the turning: the anisotropy follows each shell's U, round the axis. */
const GOLD: MeshPhysicalMaterialParameters = {
  color: PALETTE.gold,
  metalness: 1,
  roughness: 0.36,
  anisotropy: 0.5,
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
/**
 * Black ceramic under a crisp glaze: the camera's key draws a highlight down
 * every form, so its mid-tones model it and the frost reads as a rim.
 */
const CERAMIC: MeshPhysicalMaterialParameters = {
  color: PALETTE.ceramic,
  metalness: 0,
  roughness: 0.5,
  clearcoat: 0.6,
  clearcoatRoughness: 0.12,
  envMapIntensity: 0.9,
};

/**
 * The rim each army wears in each state: warm on gold and frost on ceramic,
 * a little brighter under the pointer and when held, red in check. Held, a
 * ceramic piece stays the darkest thing on its square.
 */
const rimFor = (army: PieceColor, state: PieceState): RimOptions => {
  const ceramic = army === 'black';
  const rim = ceramic ? PALETTE.frost : PALETTE.goldRim;
  switch (state) {
    case 'check':
      // Red on the edges only: the king keeps its army's colour
      return { rim: PALETTE.check, rimStrength: ceramic ? 0.6 : 0.45, rimPower: 4.5 };
    case 'selected':
      return { rim, rimStrength: ceramic ? 0.7 : 0.4, rimPower: 2.5 };
    case 'hover':
      return { rim, rimStrength: ceramic ? 0.8 : 0.32, rimPower: 2.5 };
    default:
      return { rim, rimStrength: ceramic ? 0.55 : 0.2, rimPower: 2.8 };
  }
};

interface ArmyMaterials {
  body: RimMaterial;
  collar: RimMaterial;
  accent: RimMaterial;
  /**
   * A rook's accent is its whole crenellated hollow, most of the piece seen
   * from above, so it takes the army's own material, never the inlay.
   */
  rookAccent: RimMaterial;
}

const cache = new Map<string, ArmyMaterials>();
/** Shared per army and state: never recolour one of these for a single piece. */
export const armyMaterials = (army: PieceColor, state: PieceState): ArmyMaterials => {
  const key = `${army}/${state}`;
  let m = cache.get(key);
  if (!m) {
    const rim = rimFor(army, state);
    const make = (p: MeshPhysicalMaterialParameters) => new RimMaterial(p, rim);
    if (army === 'white') {
      const collar = make(GOLD_POLISHED);
      m = { body: make(GOLD), collar, accent: make(CERAMIC_INLAY), rookAccent: collar };
    } else {
      const body = make(CERAMIC);
      const gold = make(GOLD);
      m = { body, collar: gold, accent: gold, rookAccent: body };
    }
    cache.set(key, m);
  }
  return m;
};

/** The parts of a piece in its army's materials. */
export const pieceParts = (type: PieceType, m: ArmyMaterials, level: number) => ({
  body: m.body,
  collar: m.collar,
  accent: type === PieceType.Rook ? m.rookAccent : m.accent,
  foot: footMaterial(level),
});

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

/** The camera's forward, in the frame of `parent` (reused scratch vector). */
const viewForward = (camera: Camera, parent: Object3D | null) => {
  forward.setFromMatrixColumn(camera.matrixWorld, 2).negate();
  if (parent) forward.applyQuaternion(parent.getWorldQuaternion(turn).invert());
  return forward;
};
const forward = new Vector3();

/** How long the echoes ring before they start to settle, and how long they take to (s). */
const RING_IN = 0.9;
const SETTLE = 0.5;

/**
 * Two echoes of a held piece: they split away to either side (across the
 * view, so they always show), ring like a struck wave packet out of phase
 * with each other, and settle back into the piece within about a second and
 * a half. While they are up they sit a little behind it along the view, so
 * the piece hides where they overlap and only their fringes show, as a
 * faint dispersion: the held piece keeps its own material throughout.
 */
const Superposition = ({ type }: { type: PieceType }) => {
  const a = useRef<Mesh>(null);
  const b = useRef<Mesh>(null);
  const time = useRef(0);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const still = prefersReducedMotion();
  // One echo a little warm, one a little cold
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
    const t = time.current;
    const gone = still || t > RING_IN + SETTLE;
    ma.visible = mb.visible = !gone;
    if (gone) return;
    time.current += Math.min(delta, 0.1);
    // Across the view and a little behind the piece, in its own frame
    const across = viewRight(camera, ma.parent);
    const back = viewForward(camera, ma.parent);
    // Held apart a little, then drawn back in after the ring-in
    const settle = 1 - smooth(Math.min(Math.max((t - RING_IN) / SETTLE, 0), 1));
    const split = (s: number) =>
      0.26 * Math.sin(2 * Math.PI * 1.45 * s) * Math.exp(-s / 0.5) +
      0.07 * (1 - Math.exp(-s / 0.4)) * settle;
    ma.position.copy(across).multiplyScalar(split(t)).addScaledVector(back, 0.12);
    mb.position
      .copy(across)
      .multiplyScalar(-split(Math.max(t - 0.11, 0)))
      .addScaledVector(back, 0.12);
    const opacity = 0.6 * Math.exp(-t / 0.5) * settle;
    for (const m of materials) m.uniforms.uOpacity.value = opacity;
    invalidate();
  });

  return (
    <>
      <mesh ref={a} geometry={geometry} material={materials[0]} raycast={noRaycast} />
      <mesh ref={b} geometry={geometry} material={materials[1]} raycast={noRaycast} />
    </>
  );
};

const smooth = (x: number) => x * x * (3 - 2 * x);

// --- The level ring -----------------------------------------------------------------

/** Radius of the ring round a piece's base, and of its electrons (piece units). */
const RING_RADIUS = 0.42;

const levelRingMaterials = new Map<number, ShaderMaterial>();
/**
 * The ring round a piece's base in its level's colour, carrying the level as
 * a count of electrons, A one to E five: a cue that reads without colour and
 * from straight above. Drawn in world orientation (a knight's turn does not
 * turn it), quieter than any marker.
 */
const levelRingMaterial = (level: number) => {
  let m = levelRingMaterials.get(level);
  if (!m) {
    m = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      uniforms: {
        uColor: { value: new Color(LEVEL_COLORS[level] ?? LEVEL_COLORS[0]) },
        uCount: { value: level + 1 },
        uTurn: { value: ELECTRON_TURN },
      },
      vertexShader: /* glsl */ `
        varying vec2 vP;
        void main() {
          // In piece units, turned back by the piece's yaw so every ring's
          // electrons sit the same way round, whatever a knight faces
          vec2 a = normalize(modelMatrix[0].xz + vec2(1e-6, 0.0));
          vec2 q = position.xz;
          vP = vec2(a.x * q.x - a.y * q.y, a.y * q.x + a.x * q.y);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uCount;
        uniform float uTurn;
        varying vec2 vP;
        void main() {
          float r = length(vP);
          float d = abs(r - ${RING_RADIUS.toFixed(3)});
          float aa = max(fwidth(r), 1e-4);
          float ring = 1.0 - smoothstep(0.014 - aa, 0.014 + aa, d);
          // n electrons, evenly spaced on the ring
          float step = 6.2831853 / uCount;
          float a = atan(vP.y, vP.x) - uTurn;
          float k = floor(a / step + 0.5);
          vec2 e = ${RING_RADIUS.toFixed(3)} * vec2(cos(k * step + uTurn), sin(k * step + uTurn));
          float de = length(vP - e);
          float electron = 1.0 - smoothstep(0.042 - aa, 0.042 + aa, de);
          float alpha = max(ring * 0.7, electron);
          if (alpha < 0.003) discard;
          gl_FragColor = vec4(uColor * (1.0 + 0.3 * electron), alpha);
          #include <colorspace_fragment>
        }`,
    });
    levelRingMaterials.set(level, m);
  }
  return m;
};
const ringPlane = new PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2);

/** The electrons' angle, the same as the markers' orbits. */
export const ELECTRON_TURN = 0.6;

const LevelRing = ({ level }: { level: number }) => (
  <mesh
    geometry={ringPlane}
    material={levelRingMaterial(level)}
    position={[0, 0.006, 0]}
    renderOrder={LAYER.shadow}
    raycast={noRaycast}
    // Hidden when the piece topples (a mated king), so it never stands up
    userData={FLOOR_DECAL}
  />
);

// --- The body ---------------------------------------------------------------------

/**
 * A piece standing on its contact shadow and its level ring (both part of
 * the body, so they travel with it), echoed as it is picked up.
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
  return (
    <>
      <ContactShadow radius={0.38} opacity={0.55} color="#01040a" />
      <LevelRing level={level} />
      <ChessPiece type={type} parts={pieceParts(type, armyMaterials(color, state), level)} />
      {selected && <Superposition type={type} />}
    </>
  );
};
