import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, MeshStandardMaterial, PlaneGeometry, ShaderMaterial } from 'three';
import type { IUniform, WebGLProgramParametersWithUniforms } from 'three';
import { PieceType } from '../../../engine/pieces';
import { ChessPiece } from '../../pieces';
import { LAYER } from '../kit/layers';
import { FLOOR_DECAL } from '../kit/motion';
import { noRaycast } from '../kit/noRaycast';
import type { PieceBodyProps, PieceColor } from '../types';
import { Mark } from './markers';
import { BOXWOOD, CHECK, LANTERN, LEVELS, ROSEWOOD } from './palette';

/**
 * The lantern light a selected piece is lit by from below: deeper than the
 * paper's glow, so it warms the wood rather than bleaching it.
 */
const GLOW = '#ff9636';

// The armies: a fine wooden tournament set. Pale boxwood against deep
// rosewood, each with its own grain (fine and even in the boxwood, dark
// streaked figure in the rosewood) under a satin varnish, and a felt foot in
// the colour of the level the piece stands on. The details that name a
// piece (mane, mitre cut, spiral, pearls, cross) are inlaid in a contrasting
// wood of the same army, walnut in the boxwood and golden honey wood in the
// rosewood, so they read at game size; the rook's hollow stays in its body
// wood. A soft rim of moonlight edges every piece, so the rosewood keeps its
// form against the dark garden.
//
// Selected, a piece is lit from below by a lantern: a warm glow swells up
// its foot and underside and settles low, so the wood keeps its army's
// value. In check, only the king's crown and cross take a thin edge of red
// lacquer: the wood keeps its army's colour, and the floor mark says check.

export type PieceState = 'rest' | 'hover' | 'selected' | 'check';
type Part = 'body' | 'accent';

interface WoodSpec {
  base: string;
  grain: string;
  /** How strongly the grain shows (0: plain). */
  contrast: number;
  /** Rings per unit (piece units) of the log the piece was turned from. */
  rings: number;
  roughness: number;
  /** Colour and strength of the moonlit rim. */
  rim: string;
  rimStrength: number;
}

const WOODS: Record<PieceColor, Record<Part, WoodSpec>> = {
  white: {
    body: {
      base: BOXWOOD.base,
      grain: BOXWOOD.grain,
      contrast: 0.22,
      rings: 22,
      roughness: 0.42,
      rim: '#c9d6ff',
      rimStrength: 0.12,
    },
    accent: {
      base: BOXWOOD.accent,
      grain: '#3a2414',
      contrast: 0.25,
      rings: 22,
      roughness: 0.36,
      rim: '#c9d6ff',
      rimStrength: 0.1,
    },
  },
  black: {
    body: {
      base: ROSEWOOD.base,
      grain: ROSEWOOD.grain,
      contrast: 0.35,
      rings: 26,
      roughness: 0.34,
      rim: '#9aaeff',
      rimStrength: 0.55,
    },
    accent: {
      base: ROSEWOOD.accent,
      grain: '#8a5230',
      contrast: 0.3,
      rings: 30,
      roughness: 0.3,
      rim: '#9aaeff',
      rimStrength: 0.35,
    },
  },
};

const vertexHead = /* glsl */ `
  varying vec3 vObj;
  varying vec3 vObjNormal;
`;

const fragmentHead = /* glsl */ `
  uniform vec3 uGrain;
  uniform float uContrast;
  uniform float uRings;
  uniform vec3 uRim;
  uniform float uRimStrength;
  uniform vec3 uGlowColor;
  uniform float uGlow;
  uniform float uBurn;
  uniform vec3 uCrown;
  uniform float uCrownFrom;
  varying vec3 vObj;
  float lanternEmber = 0.0;
  varying vec3 vObjNormal;

  float woodHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float woodNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = mix(woodHash(i), woodHash(i + vec3(1, 0, 0)), f.x);
    float b = mix(woodHash(i + vec3(0, 1, 0)), woodHash(i + vec3(1, 1, 0)), f.x);
    float c = mix(woodHash(i + vec3(0, 0, 1)), woodHash(i + vec3(1, 0, 1)), f.x);
    float d = mix(woodHash(i + vec3(0, 1, 1)), woodHash(i + vec3(1, 1, 1)), f.x);
    return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
  }
`;

// The grain: growth rings of a log whose axis stands upright a little off
// the piece's own, so a turned surface shows long flames of figure and the
// top of a piece shows arcs of ring. Faded where the rings would be finer
// than a pixel, so it never shimmers.
const grainChunk = /* glsl */ `
  {
    vec3 p = vObj;
    float wobble = woodNoise(p * vec3(5.0, 1.2, 5.0)) * 3.2 + woodNoise(p * vec3(17.0, 2.6, 17.0)) * 0.8;
    float r = length(p.xz - vec2(0.61, -0.37)) * uRings + wobble + p.y * 0.8;
    float ring = fract(r);
    // Each year's late wood a different width, so the figure never stripes evenly
    float width = 0.12 + 0.3 * woodHash(vec3(floor(r), 3.1, 7.7));
    float late = smoothstep(1.0 - width - 0.14, 1.0 - width, ring) * (1.0 - smoothstep(0.86, 1.0, ring));
    float fleck = woodNoise(p * vec3(90.0, 12.0, 90.0));
    float aa = fwidth(r);
    float k = uContrast * (1.0 - smoothstep(0.35, 0.9, aa));
    float g = clamp(late * 0.85 + (fleck - 0.5) * 0.35, 0.0, 1.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, uGrain, g * k);
    diffuseColor.rgb *= 1.0 + (fleck - 0.5) * 0.08;
  }
  // Burning away from the foot up, like paper: gone below a ragged line,
  // charred and glowing just above it
  if (uBurn > -0.5) {
    float edge = vObj.y - uBurn + (woodNoise(vObj * 16.0) - 0.5) * 0.1;
    if (edge < 0.0) discard;
    lanternEmber = 1.0 - smoothstep(0.0, 0.07, edge);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.04, 0.02, 0.01), smoothstep(0.16, 0.0, edge) * 0.8);
  }
`;

// Lantern light from below: strongest at the foot and on surfaces that face
// down, fading up the piece
const glowChunk = /* glsl */ `
  {
    float below = exp(-vObj.y * 9.0) * 0.5 + max(-vObjNormal.y, 0.0) * exp(-vObj.y * 3.5) * 0.7;
    totalEmissiveRadiance += uGlowColor * (uGlow * below + lanternEmber * 3.0);
  }
`;

const rimChunk = /* glsl */ `
  {
    float facing = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
    // The moonlit rim, turning to uCrown above uCrownFrom (a king in check)
    float crown = smoothstep(uCrownFrom, uCrownFrom + 0.14, vObj.y);
    outgoingLight += mix(uRim * uRimStrength, uCrown, crown) * pow(1.0 - facing, 2.6);
  }
`;

export interface WoodUniforms {
  uGrain: IUniform<Color>;
  uContrast: IUniform<number>;
  uRings: IUniform<number>;
  uRim: IUniform<Color>;
  uRimStrength: IUniform<number>;
  uGlowColor: IUniform<Color>;
  uGlow: IUniform<number>;
  /** Height (piece units) the piece has burnt away to from its foot; below 0 for none. */
  uBurn: IUniform<number>;
  /** The rim's colour (strength included) above `uCrownFrom`: red lacquer on a checked king's crown. */
  uCrown: IUniform<Color>;
  /** Height (piece units) where the rim turns to `uCrown`; above any piece for none. */
  uCrownFrom: IUniform<number>;
}

/** The glow of the selected piece of each army, shared by its parts, swelling when picked up. */
const swell: Record<PieceColor, IUniform<number>> = { white: { value: 0 }, black: { value: 0 } };

/**
 * A new wood material of its own (not shared), for a piece that fades or
 * glows alone; its uniforms are on `userData.uniforms`.
 */
export const woodMaterial = (color: PieceColor, part: Part, state: PieceState) => {
  const spec = WOODS[color][part];
  const uniforms: WoodUniforms = {
    uGrain: { value: new Color(spec.grain) },
    uContrast: { value: spec.contrast },
    uRings: { value: spec.rings },
    uRim: { value: new Color(spec.rim) },
    uRimStrength: { value: spec.rimStrength },
    uGlowColor: { value: new Color(state === 'check' ? CHECK : GLOW) },
    uGlow:
      state === 'selected'
        ? swell[color]
        : { value: state === 'hover' ? 0.5 : state === 'check' ? 0.35 : 0 },
    uBurn: { value: -1 },
    // In check, a thin red edge on the top third only (the king's crown and cross)
    uCrown: {
      value:
        state === 'check'
          ? new Color(CHECK).multiplyScalar(0.6)
          : new Color(spec.rim).multiplyScalar(spec.rimStrength),
    },
    uCrownFrom: { value: state === 'check' ? 0.56 : 9 },
  };
  const m = new MeshStandardMaterial({
    color: spec.base,
    roughness: spec.roughness,
    metalness: 0,
    envMapIntensity: 0.75,
    fog: false,
  });
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      vertexHead +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vObj = position;\n  vObjNormal = normal;',
      );
    shader.fragmentShader = (fragmentHead + shader.fragmentShader)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${grainChunk}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${glowChunk}`)
      .replace('#include <opaque_fragment>', `${rimChunk}\n#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'lantern-wood';
  m.userData.uniforms = uniforms;
  return m;
};

const woods = new Map<string, MeshStandardMaterial>();
/** A wood material, shared per army, part and state. */
export const wood = (color: PieceColor, part: Part, state: PieceState = 'rest') => {
  const key = `${color}/${part}/${state}`;
  let m = woods.get(key);
  if (!m) {
    m = woodMaterial(color, part, state);
    woods.set(key, m);
  }
  return m;
};

/** Felt, in each level's colour: matte, a little glow so it holds in shade. */
export const FELT = LEVELS.map((hex) => {
  const c = new Color(hex);
  return new MeshStandardMaterial({
    color: c.clone().multiplyScalar(0.85),
    emissive: c,
    emissiveIntensity: 0.28,
    roughness: 1,
    metalness: 0,
    fog: false,
  });
});

// --- The footprint -------------------------------------------------------------------

/** Radius of the footprint's pool of level colour and of its shadow, in piece units. */
const FOOT_RING = 0.4;
const FOOT_SHADOW = 0.36;
const footGeometry = new PlaneGeometry(FOOT_RING * 2 + 0.04, FOOT_RING * 2 + 0.04).rotateX(
  -Math.PI / 2,
);

/**
 * Under every piece, in one quad: a soft contact shadow in a faint pool of
 * the level's colour, so the level reads from straight above, where the
 * felt foot hides under the piece. One material per level, shared.
 */
const footMaterials = LEVELS.map(
  (hex) =>
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      uniforms: {
        uColor: { value: new Color(hex) },
        uHalf: { value: FOOT_RING + 0.02 },
      },
      vertexShader: /* glsl */ `
        uniform float uHalf;
        varying vec2 vP;
        void main() {
          vP = (uv - 0.5) * 2.0 * uHalf;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying vec2 vP;
        void main() {
          float r = length(vP);
          // A soft pool of the level's colour round the base, fading out:
          // quieter than any marker, and no crisp ring to be taken for one
          float pool = 0.4 * (1.0 - smoothstep(0.22, ${FOOT_RING.toFixed(3)}, r));
          float k = r / ${FOOT_SHADOW.toFixed(3)};
          float shadow = 0.55 * (1.0 - smoothstep(0.35, 1.0, k)) * (0.75 + 0.25 * (1.0 - smoothstep(0.0, 0.45, k)));
          // The shadow darkens the pool near the base
          float a = pool + shadow * (1.0 - pool);
          if (a < 0.003) discard;
          vec3 color = uColor * pool * (1.0 - shadow * 0.6) / a;
          gl_FragColor = vec4(color, a);
          #include <colorspace_fragment>
        }`,
    }),
);

const SWELL_MS = 520;

/** Swells the selected army's lantern glow from nothing to full, then lets it settle low. */
const Swell = ({ color }: { color: PieceColor }) => {
  const invalidate = useThree((s) => s.invalidate);
  const elapsed = useRef(0);
  useEffect(() => {
    elapsed.current = 0;
    swell[color].value = 0;
    invalidate();
  }, [color, invalidate]);
  useFrame((_, delta) => {
    if (elapsed.current >= SWELL_MS) return;
    elapsed.current += Math.min(delta, 1 / 20) * 1000;
    const t = Math.min(elapsed.current / SWELL_MS, 1);
    // Up to full, then settling back: a lantern flaring as it is lifted
    swell[color].value =
      t < 0.5 ? 1 - (1 - t / 0.5) ** 3 : 0.55 + 0.45 * (1 - (t - 0.5) / 0.5) ** 2;
    invalidate();
  });
  return null;
};

export const stateOf = ({ inCheck, selected, hovered }: PieceBodyProps): PieceState =>
  inCheck ? 'check' : selected ? 'selected' : hovered ? 'hover' : 'rest';

/**
 * A wooden Staunton piece on a soft contact shadow and a thin ring of its
 * level's colour on the paper (for the view from above, where the felt foot
 * hides under the piece).
 */
export const PieceBody = (props: PieceBodyProps) => {
  const { type, color, level = 0 } = props;
  const state = stateOf(props);
  return (
    <>
      <mesh
        geometry={footGeometry}
        material={footMaterials[level]}
        position={[0, 0.005, 0]}
        renderOrder={LAYER.shadow}
        raycast={noRaycast}
        // Hidden when a mated king topples, rather than stood on edge
        userData={FLOOR_DECAL}
      />
      {props.selected && <Swell color={color} />}
      {/* Under the pointer, a lantern is brought near: a soft warm pool on the paper */}
      {state === 'hover' && (
        <Mark
          floor={[0, 0, 0]}
          color={LANTERN}
          glow={[0.62, 0.55]}
          additive
          quad={1.5}
          renderOrder={LAYER.shadow + 0.5}
          lift={0.008}
          decal
        />
      )}
      <ChessPiece
        type={type}
        parts={{
          body: wood(color, 'body', state),
          // The rook's accent is its whole hollow: it stays in the body's wood,
          // so from above a rook reads as its own army
          accent: wood(color, type === PieceType.Rook ? 'body' : 'accent', state),
          foot: FELT[level],
        }}
      />
    </>
  );
};
