import { Color, DoubleSide, MeshStandardMaterial, PlaneGeometry, ShaderMaterial } from 'three';
import type { WebGLProgramParametersWithUniforms } from 'three';
import { PieceType } from '../../../engine/pieces';
import { ChessPiece } from '../../pieces';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import { ContactShadow } from '../kit/plates';
import type { PieceBodyProps, PieceColor } from '../types';
import {
  CHECK,
  LEVEL_FEET,
  LEVELS,
  OBSIDIAN,
  OBSIDIAN_ACCENT,
  RIM,
  SNOW_ACCENT,
  SNOW_STONE,
} from './palette';

// The two armies. Snow stone: a soft, fine-grained white stone that holds a
// few ice-grain glints and a cool edge where it turns from the light.
// Obsidian: volcanic glass, darker than the night, polished to long soft
// reflections, and edged in aurora green all round its silhouette, so every
// piece reads as a sculpted form from any side, even top-down on dark ice.
// The details that name a piece (the bishop's cut, the knight's mane, the
// unicorn's spiral) are a shade apart in the same material family. Every
// piece stands on a foot band in its level's colour, over a pool of that
// colour on the ice.

/**
 * A standard material with two additions: a fresnel rim (the edge light
 * that separates a form from the night) and, optionally, ice-grain glints.
 * A class rather than a patched instance, so a clone (a fading ghost) keeps
 * both.
 */
export class PolarMaterial extends MeshStandardMaterial {
  rim = new Color('#000000');
  rimStrength = 0;
  rimPower = 3;
  glint = 0;

  onBeforeCompile(shader: WebGLProgramParametersWithUniforms) {
    shader.uniforms.uRim = { value: this.rim };
    shader.uniforms.uRimStrength = { value: this.rimStrength };
    shader.uniforms.uRimPower = { value: this.rimPower };
    shader.uniforms.uGlint = { value: this.glint };
    // Keep the uniforms live, so a state change needs no recompile
    this.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPolarObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPolarObj = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uRim;
        uniform float uRimStrength;
        uniform float uRimPower;
        uniform float uGlint;
        varying vec3 vPolarObj;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 V = normalize(vViewPosition);
          float ndv = clamp(dot(normal, V), 0.0, 1.0);
          outgoingLight += uRim * pow(1.0 - ndv, uRimPower) * uRimStrength;
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
    this.glint = source.glint;
    return this;
  }
}

type State = 'rest' | 'hover' | 'selected' | 'check';

interface Look {
  rim: string;
  strength: number;
  power: number;
}

// Rim light per army and state: a quiet cold edge at rest, aurora green
// when held, red in check
const LOOKS: Record<PieceColor, Record<State, Look>> = {
  white: {
    rest: { rim: '#a9d8ff', strength: 0.22, power: 3.2 },
    hover: { rim: '#bff5dc', strength: 0.35, power: 3.2 },
    selected: { rim: RIM, strength: 0.5, power: 3.6 },
    check: { rim: CHECK, strength: 0.55, power: 2.8 },
  },
  black: {
    rest: { rim: RIM, strength: 0.32, power: 3.4 },
    hover: { rim: RIM, strength: 0.5, power: 3.2 },
    selected: { rim: '#8dffd6', strength: 0.6, power: 3.8 },
    check: { rim: CHECK, strength: 0.6, power: 3.2 },
  },
};

const makeBody = (color: PieceColor, look: Look) => {
  const m = new PolarMaterial(
    color === 'white'
      ? { color: SNOW_STONE, roughness: 0.62, metalness: 0, envMapIntensity: 0.55 }
      : { color: OBSIDIAN, roughness: 0.22, metalness: 0.05, envMapIntensity: 3.2 },
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
          roughness: 0.25,
          metalness: 0.05,
          envMapIntensity: 3,
          emissive: new Color(RIM),
          emissiveIntensity: 0.1,
        },
  );
  m.rim.set(look.rim);
  m.rimStrength = look.strength * 1.1;
  m.rimPower = look.power;
  return m;
};

const cache = new Map<string, { body: PolarMaterial; accent: PolarMaterial }>();
const materialsFor = (color: PieceColor, state: State) => {
  const key = `${color}/${state}`;
  let m = cache.get(key);
  if (!m) {
    const look = LOOKS[color][state];
    m = { body: makeBody(color, look), accent: makeAccent(color, look) };
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

const poolPlane = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const poolMaterials = LEVELS.map(
  (c, level) =>
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      uniforms: { uColor: { value: new Color(c) }, uCount: { value: level + 1 } },
      vertexShader: /* glsl */ `
        varying vec2 vP;
        void main() {
          vP = uv - 0.5;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      // A quiet ring round the base with a little glow: the level's aurora
      // light lying on the ice. Beads on the ring count the level, one on A
      // to five on E, so the level reads without its colour too.
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uCount;
        varying vec2 vP;
        void main() {
          float r = length(vP) * 2.0;
          float aa = fwidth(r) * 1.2;
          float ring = 1.0 - smoothstep(0.035 - aa, 0.035 + aa, abs(r - 0.84));
          float glow = exp(-pow((r - 0.84) / 0.1, 2.0)) * 0.12;
          // The beads, evenly round the ring
          float k = (atan(vP.y, vP.x) / 6.2831853 + 0.25) * uCount;
          float along = abs(fract(k + 0.5) - 0.5) / uCount * 6.2831853 * 0.84;
          float bead = length(vec2(along, r - 0.84));
          float ba = fwidth(bead) * 1.2;
          float beads = 1.0 - smoothstep(0.085 - ba, 0.085 + ba, bead);
          float a = max(max(ring * 0.55, glow), beads * 0.85) * (1.0 - smoothstep(0.96, 1.0, r));
          if (a < 0.003) discard;
          gl_FragColor = vec4(uColor, a);
          #include <colorspace_fragment>
        }`,
    }),
);

const LevelPool = ({ level }: { level: number }) => (
  <mesh
    geometry={poolPlane}
    material={poolMaterials[level] ?? poolMaterials[0]}
    position={[0, 0.006, 0]}
    scale={[0.98, 1, 0.98]}
    renderOrder={LAYER.shadow}
    raycast={noRaycast}
  />
);

const stateOf = ({ inCheck, selected, hovered }: PieceBodyProps): State =>
  inCheck ? 'check' : selected ? 'selected' : hovered ? 'hover' : 'rest';

/**
 * A Staunton piece in snow stone or obsidian, on its foot band in its
 * level's colour, standing in a ring of that colour on the ice.
 */
export const PieceBody = (props: PieceBodyProps) => {
  const level = props.level ?? 0;
  const m = materialsFor(props.color, stateOf(props));
  return (
    <>
      <ContactShadow radius={0.34} opacity={0.5} color="#01040a" />
      <LevelPool level={level} />
      <ChessPiece
        type={props.type}
        parts={{
          body: m.body,
          // The rook's accent is its whole hollow: left in the body's
          // material, so from above a rook reads as its own army
          accent: props.type === PieceType.Rook ? m.body : m.accent,
          foot: feet[level] ?? feet[0],
        }}
      />
    </>
  );
};
