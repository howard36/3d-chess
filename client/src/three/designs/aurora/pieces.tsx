import { useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  Color,
  DoubleSide,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import type { Mesh, WebGLProgramParametersWithUniforms } from 'three';
import { PieceType } from '../../../engine/pieces';
import { ChessPiece, pieceSet, pieceTop } from '../../pieces';
import { LAYER } from '../kit/layers';
import { FLOOR_DECAL } from '../kit/motion';
import { noRaycast } from '../kit/noRaycast';
import { ContactShadow } from '../kit/plates';
import type { PieceBodyProps, PieceColor } from '../types';
import {
  CHECK,
  CROWN,
  CROWN_WHITE as SELECT_CROWN_WHITE,
  LEVEL_FEET,
  LEVELS,
  OBSIDIAN,
  OBSIDIAN_ACCENT,
  RIM,
  SNOW_ACCENT,
  SNOW_STONE,
} from './palette';
import { LIFT, PIECE_SCALE, held, steep } from './shared';

// The two armies. Snow stone: a soft, fine-grained white stone that holds a
// few ice-grain glints and a cool edge where it turns from the light.
// Obsidian: volcanic glass under a clear polish, darker than the night; the
// moonlit strips of the room slide down its stems and bulbs, and a thin
// silver edge of moonlight keeps its silhouette off the dark ice. Neither
// army wears an aurora colour: those belong to the levels and to the held
// piece. The details that name a piece (the bishop's cut, the knight's
// mane, the unicorn's spiral) are inlaid: glacier-blue ice in the snow
// stone, ice-grey in the obsidian. Every piece stands on a foot band in its
// level's colour, in a ring of that colour on the ice.

/**
 * A physical material with three additions: a fresnel rim (the edge light
 * that separates a form from the night; optionally only above a height, so
 * check lights just the king's head), a crown light (the held piece's top),
 * and optional ice-grain glints. A class rather than a patched instance, so
 * a clone (a fading ghost) keeps them.
 */
export class PolarMaterial extends MeshPhysicalMaterial {
  rim = new Color('#000000');
  rimStrength = 0;
  rimPower = 3;
  /** The rim shows only above this height (piece units; -1: everywhere). */
  rimFrom = -1;
  crown = new Color('#000000');
  /** The crown light starts at this height (piece units). */
  crownFrom = 10;
  glint = 0;

  onBeforeCompile(shader: WebGLProgramParametersWithUniforms) {
    shader.uniforms.uRim = { value: this.rim };
    shader.uniforms.uRimStrength = { value: this.rimStrength };
    shader.uniforms.uRimPower = { value: this.rimPower };
    shader.uniforms.uRimFrom = { value: this.rimFrom };
    shader.uniforms.uCrown = { value: this.crown };
    shader.uniforms.uCrownFrom = { value: this.crownFrom };
    shader.uniforms.uGlint = { value: this.glint };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPolarObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPolarObj = position;');
    shader.fragmentShader = shader.fragmentShader
      // Half the polish on faces turned up: from a high view a collar would
      // otherwise mirror the room's strip lights as white bands
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          float polarUp = inverseTransformDirection(normal, viewMatrix).y;
          material.clearcoat *= 1.0 - 0.5 * smoothstep(0.3, 0.7, polarUp);
        #endif`,
      )
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uRim;
        uniform float uRimStrength;
        uniform float uRimPower;
        uniform float uRimFrom;
        uniform vec3 uCrown;
        uniform float uCrownFrom;
        uniform float uGlint;
        varying vec3 vPolarObj;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 V = normalize(vViewPosition);
          float ndv = clamp(dot(normal, V), 0.0, 1.0);
          float edge = 1.0 - ndv;
          float rimMask = smoothstep(uRimFrom, uRimFrom + 0.06, vPolarObj.y);
          outgoingLight += uRim * pow(edge, uRimPower) * uRimStrength * rimMask;
          // The crown light: the head of the held piece, strongest at its
          // edges, so from straight above it rings the top rather than
          // washing the whole piece
          float crown = smoothstep(uCrownFrom, uCrownFrom + 0.08, vPolarObj.y);
          outgoingLight += uCrown * crown * (0.08 + 0.92 * pow(edge, 1.6));
          if (uGlint > 0.0) {
            vec3 cell = floor(vPolarObj * 70.0);
            float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
            vec3 d = normalize(vec3(fract(h * 13.7), fract(h * 71.3), fract(h * 37.1)) - 0.5);
            float g = step(0.965, h) * smoothstep(0.82, 0.98, dot(normal, d));
            outgoingLight += vec3(0.75, 0.9, 1.0) * g * uGlint;
          }
        }
        #include <opaque_fragment>`,
      );
  }

  customProgramCacheKey() {
    return 'polaris-piece';
  }

  copy(source: PolarMaterial) {
    super.copy(source);
    this.rim.copy(source.rim);
    this.rimStrength = source.rimStrength;
    this.rimPower = source.rimPower;
    this.rimFrom = source.rimFrom;
    this.crown.copy(source.crown);
    this.crownFrom = source.crownFrom;
    this.glint = source.glint;
    return this;
  }
}

type State = 'rest' | 'hover' | 'selected' | 'check';

interface Look {
  rim: string;
  strength: number;
  power: number;
  /** The held piece's crown light (colour, strength). */
  crown?: [string, number];
}

// Edge light per army and state: a quiet cold edge at rest, a brighter one
// under the pointer; held, the crown lights in the aurora's pale mint; in
// check, a thin red edge on the king's head only (the floor carries check)
const LOOKS: Record<PieceColor, Record<State, Look>> = {
  white: {
    rest: { rim: '#a9d8ff', strength: 0.22, power: 3.2 },
    hover: { rim: '#d4ecff', strength: 0.4, power: 3 },
    selected: { rim: '#bfe9ff', strength: 0.3, power: 3.2, crown: [SELECT_CROWN_WHITE, 0.32] },
    check: { rim: CHECK, strength: 0.5, power: 3.4 },
  },
  black: {
    rest: { rim: RIM, strength: 0.3, power: 3.2 },
    hover: { rim: '#d4e2f0', strength: 0.55, power: 2.8 },
    selected: { rim: '#c9d8e8', strength: 0.5, power: 3, crown: [CROWN, 0.6] },
    check: { rim: CHECK, strength: 0.6, power: 3.4 },
  },
};

const makeBody = (color: PieceColor, look: Look) => {
  const m = new PolarMaterial(
    color === 'white'
      ? { color: SNOW_STONE, roughness: 0.62, metalness: 0, envMapIntensity: 0.55 }
      : {
          color: OBSIDIAN,
          roughness: 0.32,
          metalness: 0,
          clearcoat: 1,
          clearcoatRoughness: 0.12,
          envMapIntensity: 2.2,
        },
  );
  m.rim.set(look.rim);
  m.rimStrength = look.strength;
  m.rimPower = look.power;
  m.glint = color === 'white' ? 0.55 : 0;
  return m;
};

const makeAccent = (color: PieceColor, look: Look) => {
  const m = new PolarMaterial(
    color === 'white'
      ? { color: SNOW_ACCENT, roughness: 0.32, metalness: 0, envMapIntensity: 0.8 }
      : {
          color: OBSIDIAN_ACCENT,
          roughness: 0.3,
          metalness: 0,
          clearcoat: 1,
          clearcoatRoughness: 0.15,
          envMapIntensity: 2,
        },
  );
  m.rim.set(look.rim);
  m.rimStrength = look.strength * 1.1;
  m.rimPower = look.power;
  return m;
};

const cache = new Map<string, { body: PolarMaterial; accent: PolarMaterial }>();
/**
 * Shared per army and state; a held piece's and a checked king's are per
 * type too, since their light starts at a height of that piece's own.
 */
const materialsFor = (color: PieceColor, state: State, type: PieceType) => {
  const perType = state === 'selected' || state === 'check';
  const key = `${color}/${state}${perType ? `/${type}` : ''}`;
  let m = cache.get(key);
  if (!m) {
    const look = LOOKS[color][state];
    m = { body: makeBody(color, look), accent: makeAccent(color, look) };
    const top = pieceTop(pieceSet(), type);
    for (const mat of [m.body, m.accent]) {
      // Check: the red edge on the top third only
      if (state === 'check') mat.rimFrom = top * 0.64;
      if (look.crown) {
        mat.crown.set(look.crown[0]).multiplyScalar(look.crown[1]);
        mat.crownFrom = top * 0.78;
      }
    }
    cache.set(key, m);
  }
  return m;
};

/** The foot band, one per level: the level's hue, deepened for snow stone, glowing a little. */
const feet = LEVEL_FEET.map(
  (c) =>
    new MeshStandardMaterial({
      color: c,
      emissive: c,
      emissiveIntensity: 0.3,
      roughness: 0.4,
      metalness: 0,
    }),
);

// --- The pool of level colour on the ice under each piece ----------------------

// One square of the board, in piece units (the body is drawn at PIECE_SCALE)
const TILE = 1 / PIECE_SCALE;
const poolPlane = new PlaneGeometry(TILE, TILE).rotateX(-Math.PI / 2);
const poolMaterials = LEVELS.map(
  (c, level) =>
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      uniforms: {
        uColor: { value: new Color(c) },
        uCount: { value: level + 1 },
        uSteep: steep,
      },
      vertexShader: /* glsl */ `
        varying vec2 vP;
        void main() {
          // World units from the square's centre (the square spans ±0.5)
          vP = uv - 0.5;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      // A quiet ring round the base with a little glow: the level's aurora
      // light lying on the ice. Beads on the ring count the level, one on A
      // to five on E, so the level reads without its colour too. Seen from
      // straight above, where the grids of the other levels step back, a
      // faint square in the level's colour frames the piece's own square.
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uCount;
        uniform float uSteep;
        varying vec2 vP;
        const float R = 0.33;
        void main() {
          float r = length(vP);
          float aa = fwidth(r) * 1.2;
          float ring = 1.0 - smoothstep(0.014 - aa, 0.014 + aa, abs(r - R));
          float glow = exp(-pow((r - R) / 0.04, 2.0)) * 0.12;
          // The beads, evenly round the ring
          float k = (atan(vP.y, vP.x) / 6.2831853 + 0.25) * uCount;
          float along = abs(fract(k + 0.5) - 0.5) / uCount * 6.2831853 * R;
          float bead = length(vec2(along, r - R));
          float ba = fwidth(bead) * 1.2;
          float beads = 1.0 - smoothstep(0.033 - ba, 0.033 + ba, bead);
          float a = max(max(ring * mix(0.55, 0.38, uSteep), glow), beads * mix(0.85, 0.6, uSteep));
          a *= 1.0 - smoothstep(0.37, 0.39, r);
          // The square's frame, from above only
          float q = max(abs(vP.x), abs(vP.y));
          float qa = fwidth(q) * 1.2;
          float frame = 1.0 - smoothstep(0.01 - qa, 0.01 + qa, abs(q - 0.44));
          a = max(a, frame * 0.4 * uSteep);
          if (a < 0.003) discard;
          gl_FragColor = vec4(uColor, a);
          #include <colorspace_fragment>
        }`,
    }),
);

/**
 * The pool under a piece. Squares don't turn with a knight: its frame is
 * held square to the board whatever the knight's heading (the turns
 * between the pool and the piece's own group are undone).
 */
const LevelPool = ({ level, knight }: { level: number; knight: boolean }) => {
  const mesh = useRef<Mesh>(null);
  useFrame(() => {
    const m = mesh.current;
    if (!knight || !m) return;
    let yaw = 0;
    for (let o = m.parent; o && !o.userData?.piece; o = o.parent) yaw += o.rotation.y;
    m.rotation.y = -yaw;
  });
  return (
    <mesh
      ref={mesh}
      geometry={poolPlane}
      material={poolMaterials[level] ?? poolMaterials[0]}
      position={[0, 0.006, 0]}
      renderOrder={LAYER.shadow}
      raycast={noRaycast}
      // Hidden when a mated king topples, rather than standing up on edge
      userData={FLOOR_DECAL}
    />
  );
};

const stateOf = ({ inCheck, selected, hovered }: PieceBodyProps): State =>
  inCheck ? 'check' : selected ? 'selected' : hovered ? 'hover' : 'rest';

/**
 * A Staunton piece in snow stone or obsidian, on its foot band in its
 * level's colour, standing in a ring of that colour on the ice.
 */
export const PieceBody = (props: PieceBodyProps) => {
  const level = props.level ?? 0;
  const { type, selected } = props;
  const m = materialsFor(props.color, stateOf(props), type);
  // The held piece tells the selection how tall it stands
  useLayoutEffect(() => {
    if (selected) held.top = (pieceTop(pieceSet(), type) + LIFT.selected) * PIECE_SCALE;
  }, [selected, type]);
  return (
    <>
      <ContactShadow radius={0.34} opacity={0.5} color="#01040a" />
      <LevelPool level={level} knight={type === PieceType.Knight} />
      <ChessPiece
        type={type}
        parts={{
          body: m.body,
          // The rook's accent is its whole hollow: left in the body's
          // material, so from above a rook reads as its own army
          accent: type === PieceType.Rook ? m.body : m.accent,
          foot: feet[level] ?? feet[0],
        }}
      />
    </>
  );
};
