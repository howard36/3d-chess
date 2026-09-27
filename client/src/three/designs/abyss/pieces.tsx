import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
} from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PieceType } from '../../../engine/pieces';
import { ChessPiece, PIECE_PARTS, partsGeometry, pieceSet } from '../../pieces';
import { LAYER } from '../kit/layers';
import { FLOOR_DECAL } from '../kit/motion';
import { noRaycast } from '../kit/noRaycast';
import { ContactShadow } from '../kit/plates';
import type { PieceBodyProps, PieceColor } from '../types';
import { CHECK, LEVELS, NACRE, OBSIDIAN, PAUA, PEARL, PLANKTON, RIM } from './palette';
import { view } from './view';

// The armies: the shared Staunton set in mother-of-pearl against volcanic
// glass. Nacre is a warm pearl whose thin-film colours show only in a band at
// its silhouette, inlaid with dark paua shell; obsidian is smoky black glass
// inlaid with pearl. Both are rimmed by the cool light of the water (a
// fresnel glow in the shader), and the room's tall strip lights (stage.tsx)
// run long highlights down every turned form, so the dark army reads as
// sculpted glass from any angle. Every piece stands on a thin foot band
// glowing in its level's colour, which spills a faint pool of that light on
// the glass. Seen from above, the pool gives way to a faint square footprint
// in the level's colour and one to five ticks for the level.
//
// State light only ever touches edges: hover and selection draw a thin
// plankton outline round the piece and a pale rim (the selection's stronger,
// swelling in once); a king in check takes a thin red rim on its top third.
// The body always keeps its army's value and hue.

// --- Materials -------------------------------------------------------------------

export interface GlowUniforms {
  /** The water's cool rim, per army (premultiplied by its strength). */
  uRim: { value: Color };
  uRimPower: { value: number };
  /** A state's coloured rim (hover, selection, check), premultiplied; black for none. */
  uStateRim: { value: Color };
  uStatePower: { value: number };
  /** Local height (piece units) above which the state rim shows: -1 for the whole piece. */
  uStateFrom: { value: number };
  /** A state's light on up-facing edges (premultiplied): never on a face pointed at the eye. */
  uCrown: { value: Color };
  /** Strength of the thin-film colours in the silhouette band (nacre). */
  uFilm: { value: number };
}

/**
 * Adds view-dependent light to a physical material: the water's rim at the
 * silhouette, a state's rim (optionally only above a height), a crown light
 * on up-facing edges, and (for nacre) a thin film's colours in a band at the
 * silhouette. The program is shared by every material made this way; the
 * uniforms are each material's own.
 */
export const withGlow = <M extends MeshPhysicalMaterial | MeshStandardMaterial>(
  m: M,
  { rim = RIM, rimStrength = 0.3, rimPower = 2.5, film = 0 } = {},
): M & { userData: { glow: GlowUniforms } } => {
  const glow: GlowUniforms = {
    uRim: { value: new Color(rim).multiplyScalar(rimStrength) },
    uRimPower: { value: rimPower },
    uStateRim: { value: new Color(0, 0, 0) },
    uStatePower: { value: 2.4 },
    uStateFrom: { value: -1 },
    uCrown: { value: new Color(0, 0, 0) },
    uFilm: { value: film },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, glow);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vLocalY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocalY = position.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform vec3 uRim;
        uniform float uRimPower;
        uniform vec3 uStateRim;
        uniform float uStatePower;
        uniform float uStateFrom;
        uniform vec3 uCrown;
        uniform float uFilm;
        varying float vLocalY;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        {
          vec3 toEye = normalize(vViewPosition);
          float facing = clamp(abs(dot(normal, toEye)), 0.0, 1.0);
          float edge = 1.0 - facing;
          // Nacre: a thin film's colours in a band at the silhouette; faces stay clean
          float band = facing * 1.9 + dot(normal, vec3(0.35, 0.55, 0.15)) * 0.7;
          vec3 film = 0.5 + 0.5 * cos(6.2831853 * (band + vec3(0.0, 0.33, 0.67)));
          diffuseColor.rgb *= mix(vec3(1.0), 0.66 + 0.68 * film, uFilm * pow(edge, 1.5));
          totalEmissiveRadiance += uRim * pow(edge, uRimPower);
          float above = smoothstep(uStateFrom, uStateFrom + 0.06, vLocalY);
          totalEmissiveRadiance += uStateRim * pow(edge, uStatePower) * above;
          // Up-facing edges only: seen from straight above, a face pointed at
          // the eye takes none of it, so a piece never greys from the top
          vec3 worldNormal = inverseTransformDirection(normal, viewMatrix);
          totalEmissiveRadiance += uCrown * pow(max(worldNormal.y, 0.0), 6.0) * (1.0 - pow(facing, 4.0)) * above;
        }`,
      );
  };
  m.customProgramCacheKey = () => `abyss-glow2-${m.type}`;
  m.userData.glow = glow;
  return m as M & { userData: { glow: GlowUniforms } };
};

type State = 'idle' | 'hover' | 'selected' | 'check';

const makeBody = (color: PieceColor) =>
  color === 'white'
    ? withGlow(
        new MeshPhysicalMaterial({
          color: NACRE,
          roughness: 0.22,
          metalness: 0,
          clearcoat: 0.8,
          clearcoatRoughness: 0.14,
          iridescence: 0.4,
          iridescenceIOR: 1.4,
          iridescenceThicknessRange: [260, 540],
        }),
        { rimStrength: 0.16, rimPower: 3, film: 0.55 },
      )
    : withGlow(
        new MeshPhysicalMaterial({
          color: OBSIDIAN,
          roughness: 0.24,
          metalness: 0.05,
          clearcoat: 0.8,
          clearcoatRoughness: 0.1,
          specularIntensity: 1,
        }),
        { rimStrength: 0.55, rimPower: 2.4 },
      );

// The inlays (knight's mane, bishop's cut, unicorn's spiral, queen's pearls,
// king's cross): each army is inlaid with the other's kind of shell, so the
// details read at game size by value: dark paua in the nacre, pearl in the
// obsidian. The rook's accent is its whole hollow, so it stays in the body's
// material (see AbyssPiece): from above a rook reads as its own army.
const makeAccent = (color: PieceColor) =>
  color === 'white'
    ? withGlow(
        new MeshPhysicalMaterial({
          color: PAUA,
          roughness: 0.2,
          metalness: 0.15,
          clearcoat: 1,
          clearcoatRoughness: 0.08,
          iridescence: 1,
          iridescenceIOR: 1.5,
          iridescenceThicknessRange: [380, 720],
        }),
        { rimStrength: 0.12, rimPower: 3, film: 0.85 },
      )
    : withGlow(
        new MeshPhysicalMaterial({
          color: PEARL,
          roughness: 0.28,
          metalness: 0,
          clearcoat: 0.8,
          clearcoatRoughness: 0.14,
          iridescence: 0.5,
          iridescenceIOR: 1.4,
          iridescenceThicknessRange: [260, 540],
        }),
        { rimStrength: 0.1, rimPower: 3, film: 0.35 },
      );

interface StateLight {
  /** The state rim's colour and strength per army, its power, and the height it starts at. */
  rim: string;
  strength: Record<PieceColor, number>;
  power: number;
  from: number;
  /** The crown light on up-facing edges. */
  crown: number;
}

/**
 * How each state lights a piece: only its edges, never the whole body, so it
 * keeps its army's value and hue. Check is a thin, tight red rim on the top
 * third of the king (the floor ring and pulse carry the rest).
 */
const STATE_LIGHT: Record<State, StateLight | null> = {
  idle: null,
  hover: { rim: PLANKTON, strength: { white: 0.16, black: 0.12 }, power: 4, from: -1, crown: 0 },
  selected: {
    rim: PLANKTON,
    strength: { white: 0.24, black: 0.14 },
    power: 4,
    from: -1,
    crown: 0,
  },
  check: { rim: CHECK, strength: { white: 0.4, black: 0.55 }, power: 4.5, from: 0.56, crown: 0 },
};

type GlowMaterial = MeshPhysicalMaterial & { userData: { glow: GlowUniforms } };
const cache = new Map<string, { body: GlowMaterial; accent: GlowMaterial }>();

/** Sets a material's state light to a state's resting light, scaled by `k` (a swell). */
const restState = (mat: GlowMaterial, color: PieceColor, state: State, k = 1) => {
  const light = STATE_LIGHT[state];
  const glow = mat.userData.glow;
  if (!light) {
    glow.uStateRim.value.setRGB(0, 0, 0);
    glow.uCrown.value.setRGB(0, 0, 0);
    return;
  }
  glow.uStateRim.value.set(light.rim).multiplyScalar(light.strength[color] * k);
  glow.uStatePower.value = light.power;
  glow.uStateFrom.value = light.from;
  glow.uCrown.value.set(light.rim).multiplyScalar(light.crown * k);
};

/** The shared body and accent materials of an army in one state. */
export const armyMaterials = (color: PieceColor, state: State) => {
  const key = `${color}/${state}`;
  let m = cache.get(key);
  if (!m) {
    m = { body: makeBody(color), accent: makeAccent(color) };
    for (const mat of [m.body, m.accent]) restState(mat, color, state);
    cache.set(key, m);
  }
  return m;
};

/** The foot bands: each level's colour, glowing a little so it holds in shade. */
const footMaterial = (c: string) =>
  new MeshStandardMaterial({
    color: c,
    emissive: c,
    emissiveIntensity: 0.6,
    roughness: 0.4,
    metalness: 0,
  });
export const FEET = LEVELS.map(footMaterial);

/**
 * Fresh materials for one piece that fades (a captured victim), foot band
 * included: its own copies, so fading it never fades the army. Dispose them
 * with it.
 */
export const ghostMaterials = (color: PieceColor, level: number) => {
  const body = makeBody(color);
  const accent = makeAccent(color);
  const foot = footMaterial(LEVELS[level] ?? LEVELS[0]);
  const all = [body, accent, foot];
  for (const m of all) {
    m.transparent = true;
    m.depthWrite = false;
  }
  return {
    body,
    accent,
    foot,
    setOpacity: (o: number) => all.forEach((m) => (m.opacity = o)),
    /** A flare on the edges: the state rim and crown in `c`, at `strength`. */
    setFlare: (c: Color, strength: number) =>
      [body, accent].forEach((m) => {
        m.userData.glow.uStateRim.value.copy(c).multiplyScalar(strength);
        m.userData.glow.uStatePower.value = 1.8;
        m.userData.glow.uCrown.value.copy(c).multiplyScalar(strength * 0.3);
      }),
    dispose: () => all.forEach((m) => m.dispose()),
  };
};

// --- The level's light on the glass -------------------------------------------------

const poolVertex = /* glsl */ `
  varying vec2 vLocal;
  varying vec2 vWorld;
  void main() {
    vLocal = position.xz;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vec4 o = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    // Offset from the piece in world units, square to the board however a knight is turned
    vWorld = w.xz - o.xz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const poolFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uCount;
  uniform float uRadius;
  uniform float uPool;
  uniform float uHalf;
  uniform float uSteep;
  uniform float uTicks;
  varying vec2 vLocal;
  varying vec2 vWorld;
  void main() {
    float r = length(vLocal);
    // The foot band's faint spill, fading softly outside the base
    float glow = 0.5 * (1.0 - smoothstep(0.62, 1.0, r / uRadius));
    // Seen from above: a faint square footprint in the level's colour, the
    // square the piece stands on at its own level's scale
    vec2 q = abs(vWorld) - vec2(uHalf - 0.1);
    float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.1;
    float aa = fwidth(sd) + 1e-4;
    float fill = (1.0 - smoothstep(-aa, aa, sd)) * 0.09;
    float edge = (1.0 - smoothstep(0.0, aa + 0.012, abs(sd + 0.02))) * 0.22;
    // One to five ticks round the base for the level, a cue that needs no colour
    float sector = 6.2831853 / uCount;
    float a = mod(atan(vLocal.y, vLocal.x) + 1.5707963 + sector * 0.5, sector) - sector * 0.5;
    float across = abs(sin(a)) * r;
    float ta = fwidth(across) + 1e-4;
    float tick = (1.0 - smoothstep(0.012 - ta, 0.012 + ta, across))
      * smoothstep(0.3, 0.31, r) * (1.0 - smoothstep(0.37, 0.38, r)) * step(0.0, cos(a));
    float alpha = glow * uPool * (1.0 - uSteep) + (fill + edge) * uSteep + tick * uTicks * 0.5;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(uColor, alpha);
    #include <colorspace_fragment>
  }`;

/** Radius of the round spill, piece units: a little past the widest base. */
const POOL_RADIUS = 0.44;
/** The plane's half-size, piece units: room for the footprint square under a turned knight. */
const POOL_EXTENT = 0.8;

const poolPlane = new PlaneGeometry(POOL_EXTENT * 2, POOL_EXTENT * 2).rotateX(-Math.PI / 2);
const poolMaterials = new Map<number, ShaderMaterial>();
/** Half the footprint square, world units (clarityTower's pitch is 1). */
const FOOTPRINT_HALF = 0.43;
const poolMaterial = (level: number) => {
  let m = poolMaterials.get(level);
  if (!m) {
    m = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      uniforms: {
        uColor: { value: new Color(LEVELS[level]) },
        uCount: { value: level + 1 },
        uRadius: { value: POOL_RADIUS },
        uPool: { value: 0.3 },
        uHalf: { value: FOOTPRINT_HALF },
        uSteep: view.steep,
        uTicks: view.ticks,
      },
      vertexShader: poolVertex,
      fragmentShader: poolFragment,
    });
    poolMaterials.set(level, m);
  }
  return m;
};

/** The foot band's light on the glass in the level's colour, its footprint and ticks. */
export const LightPool = ({ level }: { level: number }) => (
  <mesh
    geometry={poolPlane}
    material={poolMaterial(level)}
    position={[0, 0.006, 0]}
    // Hidden by the kit's Topple when a mated king falls, so it never stands up on edge
    userData={FLOOR_DECAL}
    renderOrder={LAYER.shadow}
    raycast={noRaycast}
  />
);

// --- The edge light of hover and selection -----------------------------------------

const hullVertex = /* glsl */ `
  uniform float uWidth;
  uniform vec2 uResolution;
  void main() {
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    vec2 dir = (projectionMatrix * vec4(n, 0.0)).xy;
    float len = length(dir);
    if (len > 1e-5) clip.xy += dir / len * uWidth * 2.0 / uResolution * clip.w;
    gl_Position = clip;
  }`;

const hullFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    gl_FragColor = vec4(uColor, uOpacity);
    #include <colorspace_fragment>
  }`;

const hulls = new Map<PieceType, BufferGeometry>();
/** The whole piece with smooth normals, so its outline has no cracks at creases. */
const hullGeometry = (type: PieceType) => {
  let g = hulls.get(type);
  if (!g) {
    const src = partsGeometry(pieceSet(), type, PIECE_PARTS)!;
    const flat = src.index ? src.toNonIndexed() : src;
    const positions = new BufferGeometry();
    positions.setAttribute(
      'position',
      new BufferAttribute((flat.getAttribute('position').array as Float32Array).slice(), 3),
    );
    if (flat !== src) flat.dispose();
    g = mergeVertices(positions, 1e-4);
    positions.dispose();
    g.computeVertexNormals();
    hulls.set(type, g);
  }
  return g;
};

/** Outline widths in CSS pixels: selection bolder than hover, so the two never read alike. */
const HULL_WIDTH = { hover: 1, selected: 1.5 };
const hullMaterials = new Map<string, ShaderMaterial>();
const resolution = new Vector2(1, 1);
const hullMaterial = (strength: 'hover' | 'selected') => {
  let m = hullMaterials.get(strength);
  if (!m) {
    m = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: BackSide,
      uniforms: {
        uColor: { value: new Color(PLANKTON) },
        uOpacity: { value: strength === 'selected' ? 1 : 0.7 },
        uWidth: { value: HULL_WIDTH[strength] },
        uResolution: { value: resolution },
      },
      vertexShader: hullVertex,
      fragmentShader: hullFragment,
    });
    hullMaterials.set(strength, m);
  }
  return m;
};

/** A thin plankton outline round a hovered or selected piece, a constant width on screen. */
const EdgeLight = ({ type, strength }: { type: PieceType; strength: 'hover' | 'selected' }) => {
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  resolution.set(size.width * dpr, size.height * dpr);
  const material = hullMaterial(strength);
  material.uniforms.uWidth.value = HULL_WIDTH[strength] * dpr;
  return <mesh geometry={hullGeometry(type)} material={material} raycast={noRaycast} />;
};

// --- The piece ---------------------------------------------------------------------

const SWELL_MS = 520;

/**
 * The selected piece's edge light swells in and settles, once per
 * selection. The selected materials are shared by the army, which is fine:
 * only one piece is ever selected.
 */
const useSelectionSwell = (color: PieceColor, selected: boolean) => {
  const elapsed = useRef(0);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    elapsed.current = 0;
    if (selected) invalidate();
  }, [selected, invalidate]);
  useFrame((_, delta) => {
    if (!selected || elapsed.current >= SWELL_MS) return;
    elapsed.current = Math.min(elapsed.current + Math.min(delta, 1 / 30) * 1000, SWELL_MS);
    const t = elapsed.current / SWELL_MS;
    // Up quickly to 1.8 times the resting light, then down to rest
    const k = t < 0.3 ? 1 + 0.8 * (t / 0.3) ** 0.7 : 1 + 0.8 * (1 - (t - 0.3) / 0.7) ** 2;
    const m = armyMaterials(color, 'selected');
    for (const mat of [m.body, m.accent]) restState(mat, color, 'selected', k);
    invalidate();
  });
};

const stateOf = ({ inCheck, selected, hovered }: PieceBodyProps): State =>
  inCheck ? 'check' : selected ? 'selected' : hovered ? 'hover' : 'idle';

/** One piece of an army as drawn on the board (and by the capture and mate effects). */
export const AbyssPiece = ({
  type,
  color,
  level,
  state = 'idle',
  decor = true,
}: Pick<PieceBodyProps, 'type' | 'color'> & {
  level: number;
  state?: State;
  /** The contact shadow and light pool on the floor. */
  decor?: boolean;
}) => {
  const m = armyMaterials(color, state);
  const parts = useMemo(
    () => ({
      body: m.body,
      accent: type === PieceType.Rook ? m.body : m.accent,
      foot: FEET[level] ?? FEET[0],
    }),
    [m, type, level],
  );
  return (
    <>
      {decor && (
        <>
          <ContactShadow radius={0.34} opacity={0.55} color="#01080b" />
          <LightPool level={level} />
        </>
      )}
      <ChessPiece type={type} parts={parts} />
      {(state === 'hover' || state === 'selected') && <EdgeLight type={type} strength={state} />}
    </>
  );
};

export const PieceBody = (props: PieceBodyProps) => {
  useSelectionSwell(props.color, props.selected && !props.inCheck);
  return (
    <AbyssPiece
      type={props.type}
      color={props.color}
      level={props.level ?? 0}
      state={stateOf(props)}
    />
  );
};
