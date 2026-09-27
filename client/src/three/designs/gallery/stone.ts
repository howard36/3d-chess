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
// Both keep their army's value in every state: the selection's spotlight
// (uSpot) warms only the rim and the upward faces, and check adds only a
// narrow crimson rim round the upper half.

export type StoneKind = 'marble' | 'basalt' | 'bardiglio' | 'graphite';

export interface StoneUniforms {
  uSpot: IUniform<number>;
  uRim: IUniform<number>;
  uRimColor: IUniform<Color>;
  uFade: IUniform<number>;
  /** 1 on a king in check: a narrow crimson rim round its upper half. */
  uCheck: IUniform<number>;
}

const NOISE = /* glsl */ `
  varying vec3 vObj;
  varying vec3 vObjN;
  uniform float uSpot;
  uniform float uRim;
  uniform vec3 uRimColor;
  uniform vec3 uSpotColor;
  uniform float uFade;
  uniform float uCheck;
  uniform vec3 uCheckColor;
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
  float gFbm2(vec3 p) {
    return (gNoise(p) * 0.5 + gNoise(p * 2.07 + vec3(11.7, 3.1, 7.3)) * 0.25) / 0.75;
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
      float wave = sin((p.x * 3.1 + p.y * 5.3 + p.z * 1.9) * 1.7 + turb * 6.0);
      float thread = pow(1.0 - abs(wave), 9.0);
      float halo = pow(1.0 - abs(wave), 3.0);
      float cloud = gNoise(p * 3.0 + 4.0);
      vec3 stone = diffuseColor.rgb * (0.95 + 0.07 * cloud);
      stone = mix(stone, uVein, clamp(thread * 0.5 + halo * 0.35, 0.0, 1.0));
      diffuseColor.rgb = stone;
    }`,
  // A darker grey marble for the details that name a piece, with denser veins
  bardiglio: /* glsl */ `
    {
      vec3 p = vObj + vec3(1.3, 0.2, 0.8);
      float turb = gFbm2(p * 9.0);
      float wave = sin((p.x * 2.0 + p.y * 6.0 + p.z * 2.6) * 4.0 + turb * 6.0);
      float band = pow(1.0 - abs(wave), 6.0);
      diffuseColor.rgb *= 0.9 + 0.12 * turb;
      diffuseColor.rgb = mix(diffuseColor.rgb, uVein, band * 0.45);
    }`,
  // Mottled dark stone with a fine speckle of lighter crystals and a few pits
  basalt: /* glsl */ `
    {
      vec3 p = vObj + vec3(2.1, 0.0, 5.3);
      float mottle = gFbm2(p * 9.0);
      float fine = gNoise(p * 46.0);
      float fleck = smoothstep(0.78, 0.94, fine) * (0.55 + 0.45 * mottle);
      float pit = smoothstep(0.12, 0.03, fine);
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
      float mottle = gFbm2(p * 12.0);
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
  /** Dark stone: the spotlight lights only a narrow top highlight. */
  dark: boolean;
  /** Strength of the skylight's soft reflection. */
  sheen: number;
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
    dark: false,
    sheen: 0.05,
  },
  bardiglio: {
    color: '#cfcac1',
    vein: '#8d939c',
    roughness: 0.32,
    metalness: 0,
    rim: 0.12,
    rimColor: MARBLE.warm,
    rimPower: 2.5,
    glow: 0.02,
    glowColor: MARBLE.warm,
    dark: false,
    sheen: 0.05,
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
    dark: true,
    sheen: 0.045,
  },
  graphite: {
    color: '#46494f',
    vein: '#9aa0a8',
    roughness: 0.4,
    metalness: 0.05,
    rim: 0.7,
    rimColor: BASALT.rim,
    rimPower: 3.2,
    glow: 0,
    glowColor: '#000000',
    dark: true,
    sheen: 0.045,
  },
};

/** The colour of a checked king's narrow second rim: the crimson of the museum rope. */
export const CHECK_RIM = ROPE;

// The selection's spotlight (uSpot) on each army, lighting only its top and
// edges so the army's value never changes. Marble: a small warm lift, more on
// the upward faces, capped so a crown or mitre stays legible. Dark stone: a
// narrow warm highlight on the upward faces, strongest where they turn away.
const SPOT_LIGHT = /* glsl */ `
          totalEmissiveRadiance += uSpot * uSpotColor * diffuseColor.rgb * (0.04 + 0.13 * up);`;
const SPOT_DARK = /* glsl */ `
          totalEmissiveRadiance += uSpot * uSpotColor * 0.09 * pow(up, 4.0) * (0.35 + 0.65 * fres);`;

/**
 * A new stone material. `uniforms` may share a uniform object between
 * materials (the selection's spotlight is one uniform, eased in once per
 * selection); anything not given is the material's own.
 */
export const makeStone = (
  kind: StoneKind,
  {
    spot,
    check = false,
    transparent = false,
  }: {
    spot?: IUniform<number>;
    check?: boolean;
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
  const uniforms: StoneUniforms = {
    uSpot: spot ?? { value: 0 },
    uRim: { value: s.rim },
    uRimColor: { value: new Color(s.rimColor) },
    uFade: { value: 1 },
    uCheck: { value: check ? 1 : 0 },
  };
  m.userData.stone = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, {
      uVein: { value: new Color(s.vein) },
      uSpotColor: { value: new Color(SPOT) },
      uCheckColor: { value: new Color(CHECK_RIM) },
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
          // A light from above: the upper edges catch it most, the undersides
          // (a foot's flare seen from below) hardly at all
          float above = mix(0.15, 1.0, smoothstep(-0.3, 0.7, dot(normal, upV)));
          // The spotlight warms the rim a little; the body keeps its army's value
          vec3 rimCol = mix(uRimColor, uSpotColor, uSpot * 0.45);
          totalEmissiveRadiance += rimCol * fres * above * uRim;
          float up = max(normalize(vObjN).y, 0.0);
          // The room's reflection, without an environment map (too costly per
          // pixel in software): a soft cool sheen where the surface mirrors
          // the moonlit skylight overhead, stronger the smoother the stone
          vec3 R = inverseTransformDirection(reflect(-V, normal), viewMatrix);
          float sky = smoothstep(0.05, 0.9, R.y);
          totalEmissiveRadiance += vec3(0.5, 0.58, 0.72) * ${s.sheen.toFixed(3)} * sky * (0.35 + 0.65 * fres);
          ${s.dark ? SPOT_DARK : SPOT_LIGHT}
          // Check: a second, narrow crimson rim round the upper half only
          float crown = smoothstep(0.34, 0.5, vObj.y);
          totalEmissiveRadiance += uCheck * uCheckColor * pow(1.0 - ndv, 6.0) * 0.3 * crown;
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
