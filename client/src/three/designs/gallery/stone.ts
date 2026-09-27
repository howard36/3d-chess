import { Color, MeshStandardMaterial } from 'three';
import type { IUniform } from 'three';
import { BASALT, MARBLE, ROPE, SPOT } from './palette';

// Gallery's sculpture stone: two MeshStandardMaterials with their surface
// painted in the shader from the piece's own (object-space) position, so
// the stone is fixed to the piece as it moves and turns.
//
// - Carrara marble: a warm white with soft grey-blue veins running on a
//   slant through the whole piece, a faint cloudiness, and a soft glow at
//   grazing angles where light would scatter through the stone's skin.
// - Basalt: dark stone with visible grain (a mottle and a fine speckle of
//   lighter crystals), honed rather than polished, and a crisp, cool rim of
//   light from above and behind the viewer's line of sight, so every dark
//   piece reads as a carved form against the dark room, never a silhouette.
//
// Both take the selection's spotlight (uSpot: warm light pouring onto the
// piece's upward faces) and a rim colour, which check turns crimson.

export type StoneKind = 'marble' | 'basalt' | 'bardiglio' | 'graphite';

export interface StoneUniforms {
  uSpot: IUniform<number>;
  uRim: IUniform<number>;
  uRimColor: IUniform<Color>;
  uFade: IUniform<number>;
}

const NOISE = /* glsl */ `
  varying vec3 vObj;
  varying vec3 vObjN;
  uniform float uSpot;
  uniform float uRim;
  uniform vec3 uRimColor;
  uniform vec3 uSpotColor;
  uniform float uFade;
  float gHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float gNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(gHash(i), gHash(i + vec3(1.0, 0.0, 0.0)), f.x),
          mix(gHash(i + vec3(0.0, 1.0, 0.0)), gHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(gHash(i + vec3(0.0, 0.0, 1.0)), gHash(i + vec3(1.0, 0.0, 1.0)), f.x),
          mix(gHash(i + vec3(0.0, 1.0, 1.0)), gHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z);
  }
  float gFbm(vec3 p) {
    float a = 0.5;
    float s = 0.0;
    for (int i = 0; i < 3; i++) {
      s += a * gNoise(p);
      p = p * 2.07 + vec3(11.7, 3.1, 7.3);
      a *= 0.5;
    }
    return s / 0.875;
  }
`;

/** The surface of each stone, painted over `diffuseColor` (after color_fragment). */
const SURFACE: Record<StoneKind, string> = {
  // Veins on a slant through the block, warped by turbulence: thin dark
  // threads with a softer halo, over a faint cloudiness
  marble: /* glsl */ `
    {
      vec3 p = vObj * vec3(1.0, 0.9, 1.0) + vec3(0.37, 0.0, 0.61);
      float turb = gFbm(p * 7.0);
      float wave = sin((p.x * 3.1 + p.y * 5.3 + p.z * 1.9) * 3.4 + turb * 7.5);
      float thread = pow(1.0 - abs(wave), 22.0);
      float halo = pow(1.0 - abs(wave), 5.0);
      float cloud = gFbm(p * 3.0 + 4.0);
      vec3 stone = diffuseColor.rgb * (0.94 + 0.08 * cloud);
      stone = mix(stone, uVein, clamp(thread * 0.7 + halo * 0.22, 0.0, 1.0));
      diffuseColor.rgb = stone;
    }`,
  // A darker grey marble for the details that name a piece, with denser veins
  bardiglio: /* glsl */ `
    {
      vec3 p = vObj + vec3(1.3, 0.2, 0.8);
      float turb = gFbm(p * 9.0);
      float wave = sin((p.x * 2.0 + p.y * 6.0 + p.z * 2.6) * 4.0 + turb * 6.0);
      float band = pow(1.0 - abs(wave), 6.0);
      diffuseColor.rgb *= 0.9 + 0.12 * turb;
      diffuseColor.rgb = mix(diffuseColor.rgb, uVein, band * 0.45);
    }`,
  // Mottled dark stone with a fine speckle of lighter crystals and a few pits
  basalt: /* glsl */ `
    {
      vec3 p = vObj + vec3(2.1, 0.0, 5.3);
      float mottle = gFbm(p * 9.0);
      float fine = gNoise(p * 46.0);
      float fleck = smoothstep(0.78, 0.94, fine) * (0.55 + 0.45 * gNoise(p * 17.0));
      float pit = smoothstep(0.2, 0.06, gNoise(p * 31.0 + 9.0));
      vec3 stone = diffuseColor.rgb * (0.8 + 0.42 * mottle);
      stone = mix(stone, uVein, fleck * 0.55);
      stone *= 1.0 - pit * 0.35;
      diffuseColor.rgb = stone;
      gGrain = fleck - pit;
    }`,
  // Honed graphite-grey stone for the black army's details: finer and lighter
  graphite: /* glsl */ `
    {
      vec3 p = vObj + vec3(0.4, 1.0, 2.2);
      float mottle = gFbm(p * 12.0);
      float fleck = smoothstep(0.8, 0.95, gNoise(p * 52.0));
      diffuseColor.rgb *= 0.85 + 0.3 * mottle;
      diffuseColor.rgb = mix(diffuseColor.rgb, uVein, fleck * 0.5);
    }`,
};

interface StoneSpec {
  color: string;
  vein: string;
  roughness: number;
  metalness: number;
  /** Strength of the grazing-angle glow (marble) or rim light (basalt). */
  rim: number;
  rimColor: string;
  /** Exponent of the rim's falloff: higher is crisper. */
  rimPower: number;
  /** A soft, even glow from within (marble's translucency). */
  glow: number;
  glowColor: string;
}

export const STONES: Record<StoneKind, StoneSpec> = {
  marble: {
    color: MARBLE.base,
    vein: MARBLE.vein,
    roughness: 0.38,
    metalness: 0,
    rim: 0.16,
    rimColor: MARBLE.warm,
    rimPower: 2.2,
    glow: 0.03,
    glowColor: MARBLE.warm,
  },
  bardiglio: {
    color: '#b4b7bd',
    vein: '#5d636d',
    roughness: 0.32,
    metalness: 0,
    rim: 0.12,
    rimColor: MARBLE.warm,
    rimPower: 2.5,
    glow: 0.02,
    glowColor: MARBLE.warm,
  },
  basalt: {
    color: BASALT.base,
    vein: BASALT.grain,
    roughness: 0.52,
    metalness: 0,
    rim: 0.85,
    rimColor: BASALT.rim,
    rimPower: 3.2,
    glow: 0,
    glowColor: '#000000',
  },
  graphite: {
    color: '#5c6067',
    vein: '#9aa0a8',
    roughness: 0.4,
    metalness: 0.05,
    rim: 0.7,
    rimColor: BASALT.rim,
    rimPower: 3.2,
    glow: 0,
    glowColor: '#000000',
  },
};

/** The rim colour of a king in check: the crimson of the museum rope. */
export const CHECK_RIM = ROPE;

/**
 * A new stone material. `uniforms` may share a uniform object between
 * materials (the selection's spotlight is one uniform, eased in once per
 * selection); anything not given is the material's own.
 */
export const makeStone = (
  kind: StoneKind,
  {
    spot,
    rimColor,
    rimScale = 1,
    transparent = false,
  }: {
    spot?: IUniform<number>;
    rimColor?: string;
    rimScale?: number;
    transparent?: boolean;
  } = {},
) => {
  const s = STONES[kind];
  const m = new MeshStandardMaterial({
    color: s.color,
    roughness: s.roughness,
    metalness: s.metalness,
    emissive: s.glowColor,
    emissiveIntensity: s.glow,
    transparent,
  });
  // Marble takes less of the room's fill, so its forms model more
  if (kind === 'marble' || kind === 'bardiglio') m.envMapIntensity = 0.7;
  const uniforms: StoneUniforms = {
    uSpot: spot ?? { value: 0 },
    uRim: { value: s.rim * rimScale },
    uRimColor: { value: new Color(rimColor ?? s.rimColor) },
    uFade: { value: 1 },
  };
  m.userData.stone = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, {
      uVein: { value: new Color(s.vein) },
      uSpotColor: { value: new Color(SPOT) },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vObj;\nvarying vec3 vObjN;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nvObj = position;\nvObjN = normal;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\n${NOISE}\nuniform vec3 uVein;\nfloat gGrain = 0.0;`,
      )
      .replace('#include <color_fragment>', `#include <color_fragment>\n${SURFACE[kind]}`)
      .replace(
        '#include <roughnessmap_fragment>',
        // Crystals catch the light a little more than the matrix round them
        `#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor - gGrain * 0.18, 0.05, 1.0);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        {
          vec3 V = normalize(vViewPosition);
          float ndv = clamp(dot(normal, V), 0.0, 1.0);
          float fres = pow(1.0 - ndv, ${s.rimPower.toFixed(2)});
          vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          // A light from above: the upper edges catch it most
          float above = mix(0.4, 1.0, smoothstep(-0.3, 0.7, dot(normal, upV)));
          totalEmissiveRadiance += uRimColor * fres * above * uRim;
          // The selection's spotlight, pouring onto the upward faces
          float top = smoothstep(-0.2, 0.9, normalize(vObjN).y);
          totalEmissiveRadiance += uSpot * uSpotColor *
            (diffuseColor.rgb * (0.12 + 0.5 * top) + 0.02 * top);
        }`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>\ngl_FragColor.a *= uFade;`,
      );
  };
  m.customProgramCacheKey = () => `gallery-stone-${kind}`;
  return m;
};
