import { Color, MeshPhysicalMaterial, Vector3 } from 'three';
import type { PieceColor } from '../types';

// Shared GPU pieces of the Cosmos look: one clock and one point-size scale
// for every shader (the Stage keeps them current), 3D value noise, and the
// two celestial piece materials.

/** Seconds since the scene started; the Stage writes it every frame. */
export const cosmosTime = { value: 0 };

/** Pixels per world unit at distance 1, for size-attenuated points. */
export const pixelScale = { value: 400 };

/** Cheap 3D value noise and a 4-octave fbm, in [0, 1]. */
export const NOISE_GLSL = /* glsl */ `
  float cHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float cNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(cHash(i), cHash(i + vec3(1.0, 0.0, 0.0)), f.x),
          mix(cHash(i + vec3(0.0, 1.0, 0.0)), cHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(cHash(i + vec3(0.0, 0.0, 1.0)), cHash(i + vec3(1.0, 0.0, 1.0)), f.x),
          mix(cHash(i + vec3(0.0, 1.0, 1.0)), cHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z);
  }
  float cFbm(vec3 p) {
    float a = 0.5;
    float s = 0.0;
    for (int i = 0; i < 4; i++) {
      s += a * cNoise(p);
      p = p * 2.03 + 17.1;
      a *= 0.5;
    }
    return s / 0.9375;
  }
`;

// --- Pieces ---------------------------------------------------------------

export type Glow = 'none' | 'hover' | 'selected' | 'check' | 'flare';

interface Look {
  color: string;
  roughness: number;
  metalness: number;
  clearcoat: number;
  /** Self-light, modulated by the surface pattern: at the centre of the disc and at its limb. */
  core: string;
  limb: string;
  coreStrength: number;
  /** Scale of the surface pattern: granulation for suns, bands for the dark worlds. */
  pattern: [number, number, number];
  /** How much of the surface the pattern owns. */
  contrast: number;
  /** How much the self-light gathers in the face turned to the viewer (a sun's bright disc). */
  facing: number;
  rim: string;
  rimStrength: number;
  rimPower: number;
}

const LOOKS: Record<PieceColor, Look> = {
  // A small sun: gold photosphere, boiling granulation, a hot limb.
  white: {
    color: '#c0701c',
    roughness: 0.6,
    metalness: 0,
    clearcoat: 0.15,
    core: '#ffd779',
    limb: '#ff6a12',
    coreStrength: 0.75,
    pattern: [6, 6, 6],
    contrast: 0.6,
    facing: 0.8,
    rim: '#ff9a3a',
    rimStrength: 0.6,
    rimPower: 2,
  },
  // A night world: deep indigo banded in violet, wrapped in a blue atmosphere.
  black: {
    color: '#271a68',
    roughness: 0.28,
    metalness: 0.25,
    clearcoat: 0.8,
    core: '#5a36c8',
    limb: '#5a36c8',
    coreStrength: 0.2,
    pattern: [3, 26, 3],
    contrast: 0.9,
    facing: 0,
    rim: '#5cc2ff',
    rimStrength: 2,
    rimPower: 2.4,
  },
};

// Per-state extras: [rim boost, steady glow colour, steady glow strength, pulse colour, pulse strength]
const GLOWS: Record<Glow, [number, string, number, string, number]> = {
  none: [1, '#000000', 0, '#000000', 0],
  hover: [1.35, '#fff1c4', 0.08, '#000000', 0],
  selected: [1.7, '#fff1c4', 0.16, '#000000', 0],
  check: [1.2, '#ff3a14', 0.35, '#ff2a10', 0.75],
  flare: [3, '#fff6e0', 2.2, '#000000', 0],
};

const VERTEX_HEAD = /* glsl */ `
  varying vec3 vCosmosObj;
`;
const FRAGMENT_HEAD = /* glsl */ `
  uniform float uTime;
  uniform vec3 uCore;
  uniform vec3 uLimb;
  uniform vec3 uPattern;
  uniform float uContrast;
  uniform float uFacing;
  uniform vec3 uRim;
  uniform float uRimPower;
  uniform vec3 uGlow;
  uniform vec3 uPulse;
  varying vec3 vCosmosObj;
  ${NOISE_GLSL}
`;
const FRAGMENT_BODY = /* glsl */ `
  {
    vec3 cView = normalize(vViewPosition);
    float cFace = clamp(abs(dot(normal, cView)), 0.0, 1.0);
    float cFres = pow(1.0 - cFace, uRimPower);
    float cPat = cFbm(vCosmosObj * uPattern + vec3(0.0, uTime * 0.22, uTime * 0.09));
    float cLit = mix(1.0, 0.2 + 1.6 * cPat * cPat, uContrast);
    diffuseColor.rgb *= mix(1.0, 0.55 + 0.75 * cPat, uContrast);
    // Limb darkening: the disc facing the viewer burns brightest
    cLit *= mix(1.0, 0.25 + 0.75 * pow(cFace, 0.7), uFacing);
    totalEmissiveRadiance += mix(uLimb, uCore, pow(cFace, 1.4)) * cLit;
    totalEmissiveRadiance += uRim * cFres;
    totalEmissiveRadiance += uGlow;
    totalEmissiveRadiance += uPulse * (0.55 + 0.45 * sin(uTime * 5.5));
  }
`;

const materials = new Map<string, MeshPhysicalMaterial>();

/** The shared material of one army in one state (hovered, selected, in check…). */
export const pieceMaterial = (color: PieceColor, glow: Glow = 'none') => {
  const key = `${color}-${glow}`;
  let m = materials.get(key);
  if (m) return m;
  const look = LOOKS[color];
  const [rimBoost, glowColor, glowStrength, pulseColor, pulseStrength] = GLOWS[glow];
  const rim = new Color(glow === 'check' ? '#ff7a3a' : look.rim).multiplyScalar(
    look.rimStrength * rimBoost,
  );
  const uniforms = {
    uTime: cosmosTime,
    uCore: { value: new Color(look.core).multiplyScalar(look.coreStrength) },
    uLimb: { value: new Color(look.limb).multiplyScalar(look.coreStrength) },
    uPattern: { value: new Vector3(...look.pattern) },
    uContrast: { value: look.contrast },
    uFacing: { value: look.facing },
    uRim: { value: rim },
    uRimPower: { value: look.rimPower },
    uGlow: { value: new Color(glowColor).multiplyScalar(glowStrength) },
    uPulse: { value: new Color(pulseColor).multiplyScalar(pulseStrength) },
  };
  m = new MeshPhysicalMaterial({
    color: look.color,
    roughness: look.roughness,
    metalness: look.metalness,
    clearcoat: look.clearcoat,
    clearcoatRoughness: 0.2,
    envMapIntensity: color === 'white' ? 0.6 : 1.4,
  });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_HEAD}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCosmosObj = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_HEAD}`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\n${FRAGMENT_BODY}`,
      );
  };
  materials.set(key, m);
  return m;
};
