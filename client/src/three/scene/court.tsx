import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AdditiveBlending, Color, DoubleSide, ShaderMaterial } from 'three';
import type { GardenDetailProps } from './gardenDetail';
import { noRaycast } from '../noRaycast';
import { shadeUniforms } from './mask';
import { COURT } from './palette';
import {
  COURT_SLABS,
  COURT_SPAN,
  decalGeometry,
  INLAY,
  KNIGHT_WAYS,
  mossGeometry,
  SHADE_AT_VERTEX,
  STONE_HALF,
} from './courtLayout';
// ENV PREVIEW (temporary): the court's settings
import { useEnvSetting } from '../../envPreview';
import { courtEggs, courtLife } from '../../envPreview/features/court';

// Area C, the court: the near ground between the tower and the colossal
// board, where the board's lines have faded out round the tower's foot. It
// stays the quietest part of the garden, since it lies right under the
// pieces on screen: everything here is a murmur of light added onto the
// stone (no line as bright as the colossal board's), cool and colourless,
// and sinks into the tower's shade like the rest of the garden.
//
// - The stone (courtFloor): the plain round the tower is paved in large
//   polished slabs, staggered, seen only as a change of sheen from slab to
//   slab (each is laid a hair off level, so it catches the horizon's mist a
//   little more or less), never as a seam line; `veined` adds faint veins,
//   each slab cut from its own block.
// - The inlay (courtInlay): two rings of light in the stone round the
//   tower, each whole, and spokes running from ring to ring pointing not to the compass but the
//   eight ways a knight jumps (`star`: the spokes alone, fading both ways).
// - The moss (courtLife): still points of cool light in the slabs' joints,
//   in short clusters toward the court's rim, a few lifted a hand above the
//   stone, so they show their depth as the view turns.
// - Secrets (courtEggs): stepping stones laid in knight's jumps, from the
//   court out to the board's edge between the two knights, who face each
//   other across the path.
//
// Nothing moves: every value is a uniform the garden's copy reads.

/** Brightness of each part (linear light, times its colour). */
const LIGHT = {
  /** A slab's own polish, from slab to slab. */
  tone: 0.0022,
  /** The horizon's mist caught in a slab toward grazing. */
  sky: 0.012,
  vein: 0.0028,
  /** The tower's light on the stone round its foot. */
  pool: 0.0065,
  inlay: 0.0105,
  stone: 0.0022,
  kerb: 0.006,
  moss: 0.07,
  /** The moss's glow on the stone round it. */
  mossGlow: 0.006,
};
/** How far out the tower's light on the stone reaches (its 1/e radius). */
const POOL_RADIUS = 10;
/** How far a slab is laid off level (radians, at most half each way). */
const TILT = 0.08;
/** The court's stone and inlay reach this far: the colossal board has come back. */
export const COURT_REACH = COURT_SPAN.outer[1];

const [wayX, wayZ] = KNIGHT_WAYS[0];

const f = (n: number) => n.toFixed(4);

/**
 * The stone and the inlay, as GLSL for the ground's own shader (stage.tsx),
 * which draws the court's disc of the plain with them (the court is light
 * added onto the stone, so it is added there, in the display's values, as
 * blending would add it): null when both are off. \`decl\` declares
 * \`vec3 courtLight(vec2 p, float r, vec3 view)\`, the court's light at a point
 * of the plain (p in the garden's frame before it turns for Black, r its
 * distance from the centre, view the eye's ray), before the tower's shade
 * and the lobby's quiet.
 */
/** The uniforms courtGroundGlsl's chunk needs. */
export const courtUniforms = () => ({
  uSheen: { value: new Color(COURT.sheen) },
  uVein: { value: new Color(COURT.vein) },
  uInlay: { value: new Color(COURT.inlay) },
});

export const courtGroundGlsl = (floor: string, inlay: string) => {
  if (floor === 'off' && inlay === 'off') return null;
  const defines = [
    floor !== 'off' && 'FLOOR_ON',
    floor === 'veined' && 'VEINS_ON',
    inlay === 'ring' && 'INLAY_RING',
    inlay === 'double' && 'INLAY_DOUBLE',
    inlay === 'star' && 'INLAY_STAR',
  ].filter(Boolean);
  return {
    decl: /* glsl */ `
  ${defines.map((d) => `#define ${d}`).join('\n  ')}
  uniform vec3 uSheen;
  uniform vec3 uVein;
  uniform vec3 uInlay;
  ${COURT_SLABS}
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 u = fract(p);
    u = u * u * (3.0 - 2.0 * u);
    return mix(
      mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
      mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x),
      u.y);
  }
  // A hairline of half-width hw about d = 0, coverage-correct: never
  // thinner than about a pixel, dimmer instead
  float courtHair(float d, float hw) {
    float fw = max(fwidth(d), 1e-5);
    float draw = max(hw, fw * 0.6);
    return clamp((draw - abs(d)) / fw + 0.5, 0.0, 1.0) * (hw / draw);
  }
  vec3 courtLight(vec2 p, float r, vec3 view) {
    float grazing = 1.0 - abs(view.y);
    // The court: from round the tower's foot out to where the colossal
    // board has come back
    float span = smoothstep(${f(COURT_SPAN.inner[0])}, ${f(COURT_SPAN.inner[1])}, r)
      * (1.0 - smoothstep(${f(COURT_SPAN.outer[0])}, ${f(COURT_SPAN.outer[1])}, r));
    float far = 1.0 - smoothstep(30.0, 60.0, distance(vWorld, cameraPosition));
    vec3 col = vec3(0.0);
    #ifdef FLOOR_ON
    {
      vec4 s = slabOf(p);
      vec2 id = s.xz;
      vec2 h = hash22(id) - 0.5;
      // Each slab laid a hair off level: it gives back the horizon's mist
      // a little more or less than its neighbours
      vec3 n = normalize(vec3(h.x * ${f(TILT)}, 1.0, h.y * ${f(TILT)}));
      vec3 rd = reflect(view, n);
      float sky = exp(-pow(rd.y / 0.32, 2.0));
      float tone = hash12(id + 7.31);
      float sheen = tone * ${f(LIGHT.tone)} + sky * ${f(LIGHT.sky)} * (0.3 + 1.4 * tone);
      col += uSheen * sheen * span;
      // The tower's glass lights the stone under it a little, falling off
      // softly outward (seen only past the shade's edge), each slab giving
      // it back by its own polish
      float pool = exp(-r * r / ${f(POOL_RADIUS * POOL_RADIUS)});
      col += uSheen * pool * ${f(LIGHT.pool)} * (0.55 + 0.9 * tone);
      #ifdef VEINS_ON
      {
        // Each slab cut from its own block: its own veins
        // drawn out one way, as veins in a cut stone run
        vec2 hv = hash22(id + 3.7);
        float va = hv.x * 6.2832;
        vec2 q = mat2(cos(va), sin(va), -sin(va), cos(va)) * p * vec2(0.14, 0.42) + hv * 40.0;
        vec2 w = vec2(vnoise(q * 0.5 + 3.1), vnoise(q * 0.5 + 8.7));
        float v = 0.65 * vnoise(q + w * 2.0) + 0.35 * vnoise(q * 2.1 + w);
        float ridge = 1.0 - abs(v * 2.0 - 1.0);
        float fw = fwidth(ridge);
        float vein = smoothstep(0.94, 0.99, ridge) * clamp(1.5 - fw * 10.0, 0.0, 1.0);
        vein *= smoothstep(0.38, 0.62, vnoise(q * 0.6 + 11.0));
        col += uVein * vein * ${f(LIGHT.vein)} * (0.35 + grazing) * span;
      }
      #endif
    }
    #endif
    #if defined(INLAY_RING) || defined(INLAY_DOUBLE) || defined(INLAY_STAR)
    {
      // Folded into one eighth of the turn, where the only spoke is (2, 1)
      vec2 o = abs(p);
      if (o.y > o.x) o = o.yx;
      float t = dot(o, vec2(${f(wayX)}, ${f(wayZ)}));
      float across = o.x * ${f(wayZ)} - o.y * ${f(wayX)};
      float inlay = 0.0;
      #if defined(INLAY_RING) || defined(INLAY_DOUBLE)
      // The outer ring whole, all the way round
      inlay = max(inlay, courtHair(r - ${f(INLAY.outer)}, 0.03));
      // Each spoke ends at its ring's line, cleanly (no fade short of it)
      float fwT = max(fwidth(t), 1e-5);
      float toOuter = clamp((${f(INLAY.outer)} - t) / fwT + 0.5, 0.0, 1.0);
      #ifdef INLAY_DOUBLE
      inlay = max(inlay, courtHair(r - ${f(INLAY.inner)}, 0.03) * 0.5);
      // From ring to ring, whole
      float along = clamp((t - ${f(INLAY.inner)}) / fwT + 0.5, 0.0, 1.0);
      #else
      // The spokes run in from the ring, fading toward the tower
      float along = smoothstep(${f(INLAY.inner - 2.0)}, ${f(INLAY.outer - 1.0)}, t);
      #endif
      along *= toOuter;
      inlay = max(inlay, courtHair(across, 0.025) * along * 0.85);
      #else
      float along = smoothstep(${f(INLAY.star[0])}, ${f(INLAY.star[0] + 3.5)}, t)
        * (1.0 - smoothstep(${f(INLAY.star[0] + 4.5)}, ${f(INLAY.star[1])}, t));
      inlay = courtHair(across, 0.03) * along * 1.3;
      #endif
      col += uInlay * inlay * ${f(LIGHT.inlay)} * far;
    }
    #endif
    return col;
  }`,
  };
};

const mossVertex = /* glsl */ `
  uniform float uDpr;
  uniform float uTurn;
  attribute float aSize;
  attribute float aBright;
  uniform float uDim;
  varying float vBright;
  ${SHADE_AT_VERTEX}
  void main() {
    vec3 at = vec3(position.x * uTurn, position.y, position.z * uTurn);
    vec4 w = modelMatrix * vec4(at, 1.0);
    // Nearer is a little brighter, as a glow is
    vBright = aBright * clamp(24.0 / distance(w.xyz, cameraPosition), 0.45, 1.15);
    gl_Position = projectionMatrix * viewMatrix * w;
    gl_PointSize = aSize * uDpr;
    vBright *= (1.0 - shadeOfClip(gl_Position)) * uDim;
  }`;

const mossFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vBright;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float a = exp(-dot(p, p) * 4.5) * vBright * ${f(LIGHT.moss)};
    if (a < 0.002) discard;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <colorspace_fragment>
  }`;

const decalVertex = /* glsl */ `
  uniform float uTurn;
  attribute vec2 aLocal;
  attribute float aKind;
  uniform float uDim;
  varying vec2 vLocal;
  varying float vKind;
  varying vec3 vWorld;
  varying float vLit;
  ${SHADE_AT_VERTEX}
  void main() {
    vec3 at = vec3(position.x * uTurn, position.y, position.z * uTurn);
    vec4 w = modelMatrix * vec4(at, 1.0);
    vWorld = w.xyz;
    vLocal = aLocal;
    vKind = aKind;
    gl_Position = projectionMatrix * viewMatrix * w;
    vLit = (1.0 - shadeOfClip(gl_Position)) * uDim;
  }`;

const decalFragment = /* glsl */ `
  uniform vec3 uSheen;
  uniform vec3 uInlay;
  uniform vec3 uMoss;
  varying vec2 vLocal;
  varying float vKind;
  varying vec3 vWorld;
  varying float vLit;
  float hair(float d, float hw) {
    float fw = max(fwidth(d), 1e-5);
    float draw = max(hw, fw * 0.6);
    return clamp((draw - abs(d)) / fw + 0.5, 0.0, 1.0) * (hw / draw);
  }
  void main() {
    float lit = vLit;
    if (lit < 0.003) discard;
    float far = 1.0 - smoothstep(30.0, 60.0, distance(vWorld, cameraPosition));
    vec3 col;
    if (vKind < 0.5) {
      // The moss's own faint glow on the stone round a patch
      col = uMoss * exp(-dot(vLocal, vLocal)) * ${f(LIGHT.mossGlow)};
    } else {
      // A stepping stone, polished finer than the paving: it holds more of
      // the horizon's mist, inside a kerb of light
      vec3 view = normalize(vWorld - cameraPosition);
      float sky = exp(-pow(view.y / 0.32, 2.0));
      vec2 d = abs(vLocal);
      float m = max(d.x, d.y);
      float fw = max(fwidth(m), 1e-5);
      float stone = clamp((${f(STONE_HALF)} - m) / fw + 0.5, 0.0, 1.0);
      float kerb = hair(m - ${f(STONE_HALF + 0.05)}, 0.018);
      // The path fades in from the tower's foot: its first stones the faintest
      float outward = smoothstep(8.0, 17.0, length(vWorld.xz));
      col = (uSheen * stone * (${f(LIGHT.stone)} + sky * ${f(LIGHT.sky)})
        + uInlay * kerb * ${f(LIGHT.kerb)}) * outward;
    }
    col *= lit * far;
    if (max(col.r, max(col.g, col.b)) < 0.0002) discard;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

/** The lobby's quiet, as a number now. */
const dimNow = (dim: GardenDetailProps['dim']) => (typeof dim === 'function' ? dim() : (dim ?? 1));

/** The moss's glow on the stone and the stepping stones: small quads on the ground, one pass. */
const CourtDecals = ({
  turn,
  dim,
  moss,
  stones,
}: GardenDetailProps & { moss: boolean; stones: boolean }) => {
  const geometry = useMemo(() => decalGeometry({ moss, stones }), [moss, stones]);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        uniforms: {
          uTurn: { value: 1 },
          uDim: { value: 1 },
          uSheen: { value: new Color(COURT.sheen) },
          uInlay: { value: new Color(COURT.inlay) },
          uMoss: { value: new Color(COURT.moss) },
          ...shadeUniforms(),
        },
        vertexShader: decalVertex,
        fragmentShader: decalFragment,
      }),
    [],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  material.uniforms.uTurn.value = turn;
  useFrame(() => {
    material.uniforms.uDim.value = dimNow(dim);
  });
  return (
    <mesh
      name="court-marks"
      geometry={geometry}
      material={material}
      renderOrder={-892}
      frustumCulled={false}
      raycast={noRaycast}
    />
  );
};

/** The glow-moss in the joints. */
const CourtMoss = ({ turn, dim }: GardenDetailProps) => {
  const dpr = useThree((s) => s.viewport.dpr);
  const parts = useMemo(
    () => ({
      geometry: mossGeometry(),
      material: new ShaderMaterial({
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: {
          uDpr: { value: 1 },
          uTurn: { value: 1 },
          uDim: { value: 1 },
          uColor: { value: new Color(COURT.moss) },
          ...shadeUniforms(),
        },
        vertexShader: mossVertex,
        fragmentShader: mossFragment,
      }),
    }),
    [],
  );
  useEffect(() => () => Object.values(parts).forEach((p) => p.dispose()), [parts]);
  const { geometry, material } = parts;
  material.uniforms.uDpr.value = dpr;
  material.uniforms.uTurn.value = turn;
  useFrame(() => {
    material.uniforms.uDim.value = dimNow(dim);
  });
  return (
    <points
      name="court-moss"
      geometry={geometry}
      material={material}
      renderOrder={-889}
      frustumCulled={false}
      raycast={noRaycast}
    />
  );
};

/**
 * The court's marks and moss; its stone and inlay are drawn in the ground's
 * own pass (courtGroundGlsl, stage.tsx).
 */
export const Court = (props: GardenDetailProps) => {
  const life = useEnvSetting(courtLife);
  const eggs = useEnvSetting(courtEggs);
  const stones = eggs === 'on';
  const moss = life === 'on';
  return (
    <>
      {(moss || stones) && <CourtDecals {...props} moss={moss} stones={stones} />}
      {moss && <CourtMoss {...props} />}
    </>
  );
};
