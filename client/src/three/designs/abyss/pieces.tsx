import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  CanvasTexture,
  Color,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three';
import type { Texture } from 'three';
import { PieceType } from '../../../engine/pieces';
import { ChessPiece } from '../../pieces';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import { ContactShadow } from '../kit/plates';
import type { PieceBodyProps, PieceColor } from '../types';
import { CHECK, LEVELS, NACRE, OBSIDIAN, PAUA, PEARL, PLANKTON, RIM } from './palette';

// The armies: the shared Staunton set in mother-of-pearl against volcanic
// glass. Nacre is a warm pearl with a restrained thin-film iridescence, inlaid
// with dark paua shell; obsidian is a smoky satin glass inlaid with pearl.
// Both are rimmed by the cool light of the water (a fresnel glow in the
// shader), so the dark army holds its shape against the dark sea from any
// angle. Every piece stands on a thin foot band glowing in its level's
// colour, which spills a soft pool of that light onto the glass, marked with
// one to five ticks for the level.
//
// Selected, a piece catches the plankton light: its rim and crown flare pale
// and settle to a steady edge light, while the body keeps its army's value
// (state light only ever touches edges and tops). A king in check takes a
// red rim and a red crown.

// --- Materials -------------------------------------------------------------------

export interface GlowUniforms {
  /** Fresnel rim colour (premultiplied by its strength). */
  uRim: { value: Color };
  uRimPower: { value: number };
  /** Inner light (premultiplied by its strength), brightest facing the viewer. */
  uCore: { value: Color };
  /** Light on the upward-facing surfaces (premultiplied): a small highlight on the piece's top. */
  uCrown: { value: Color };
  /** Strength of the thin-film colours over the albedo (nacre). */
  uFilm: { value: number };
}

/**
 * Adds view-dependent light to a physical material: a rim at the silhouette,
 * an inner light facing the viewer, and (for nacre) a thin film's colours
 * shifting over the albedo with the viewing angle. The program is shared by
 * every material made this way; the uniforms are each material's own.
 */
export const withGlow = <M extends MeshPhysicalMaterial | MeshStandardMaterial>(
  m: M,
  { rim = RIM, rimStrength = 0.3, rimPower = 2.5, film = 0 } = {},
): M & { userData: { glow: GlowUniforms } } => {
  const glow: GlowUniforms = {
    uRim: { value: new Color(rim).multiplyScalar(rimStrength) },
    uRimPower: { value: rimPower },
    uCore: { value: new Color(0, 0, 0) },
    uCrown: { value: new Color(0, 0, 0) },
    uFilm: { value: film },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, glow);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uRim;\nuniform float uRimPower;\nuniform vec3 uCore;\nuniform vec3 uCrown;\nuniform float uFilm;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        {
          vec3 toEye = normalize(vViewPosition);
          float facing = clamp(abs(dot(normal, toEye)), 0.0, 1.0);
          // Nacre: a thin film's colours drift over the form with the angle of view
          float band = facing * 1.9 + dot(normal, vec3(0.35, 0.55, 0.15)) * 0.7;
          vec3 film = 0.5 + 0.5 * cos(6.2831853 * (band + vec3(0.0, 0.33, 0.67)));
          diffuseColor.rgb *= mix(vec3(1.0), 0.74 + 0.52 * film, uFilm);
          totalEmissiveRadiance += uRim * pow(1.0 - facing, uRimPower);
          totalEmissiveRadiance += uCore * (0.3 + 0.7 * facing * facing);
          vec3 worldNormal = inverseTransformDirection(normal, viewMatrix);
          totalEmissiveRadiance += uCrown * pow(max(worldNormal.y, 0.0), 6.0);
        }`,
      );
  };
  m.customProgramCacheKey = () => `abyss-glow-${m.type}`;
  m.userData.glow = glow;
  return m as M & { userData: { glow: GlowUniforms } };
};

type State = 'idle' | 'hover' | 'selected' | 'check';

const makeBody = (color: PieceColor) =>
  color === 'white'
    ? withGlow(
        new MeshPhysicalMaterial({
          color: NACRE,
          roughness: 0.32,
          metalness: 0,
          clearcoat: 0.8,
          clearcoatRoughness: 0.16,
          iridescence: 0.4,
          iridescenceIOR: 1.4,
          iridescenceThicknessRange: [260, 540],
        }),
        { rimStrength: 0.16, rimPower: 3, film: 0.3 },
      )
    : withGlow(
        new MeshPhysicalMaterial({
          color: OBSIDIAN,
          roughness: 0.3,
          metalness: 0.05,
          clearcoat: 0.7,
          clearcoatRoughness: 0.14,
          specularIntensity: 1,
        }),
        { rimStrength: 0.6, rimPower: 2.2 },
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
          roughness: 0.26,
          metalness: 0,
          clearcoat: 0.9,
          clearcoatRoughness: 0.12,
          iridescence: 0.6,
          iridescenceIOR: 1.4,
          iridescenceThicknessRange: [260, 540],
        }),
        { rimStrength: 0.1, rimPower: 3, film: 0.35 },
      );

/**
 * How each state lights a piece: only its edges and its top, never the whole
 * body, so it keeps its army's value. The rim takes a colour and burns
 * brighter; the crown is a small highlight on the upward-facing surfaces.
 */
const STATE_LIGHT: Record<
  State,
  { rim: string | null; rimBoost: number; crown: string; crownStrength: number }
> = {
  idle: { rim: null, rimBoost: 1, crown: '#000000', crownStrength: 0 },
  hover: { rim: null, rimBoost: 1.7, crown: PLANKTON, crownStrength: 0.1 },
  selected: { rim: PLANKTON, rimBoost: 1, crown: PLANKTON, crownStrength: 0.22 },
  check: { rim: CHECK, rimBoost: 1, crown: CHECK, crownStrength: 0.14 },
};
/** Rim strength of a state with a colour of its own, per army (the dark army needs more). */
const STATE_RIM: Record<PieceColor, number> = { white: 0.45, black: 0.75 };

type GlowMaterial = MeshPhysicalMaterial & {
  userData: { glow: GlowUniforms; baseRim?: Color };
};
const cache = new Map<string, { body: GlowMaterial; accent: GlowMaterial }>();

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

/**
 * Fresh materials for one piece that fades (a captured victim): its own
 * copies, so fading it never fades the army. Dispose them with it.
 */
export const ghostMaterials = (color: PieceColor) => {
  const body = makeBody(color);
  const accent = makeAccent(color);
  const both = [body, accent];
  for (const m of both) {
    m.transparent = true;
    m.depthWrite = false;
  }
  return {
    body,
    accent,
    setOpacity: (o: number) => both.forEach((m) => (m.opacity = o)),
    setCore: (c: Color, strength: number) =>
      both.forEach((m) => m.userData.glow.uCore.value.copy(c).multiplyScalar(strength)),
    dispose: () => both.forEach((m) => m.dispose()),
  };
};

/** Sets a material's rim and crown to a state's resting light, scaled by `k` (a swell). */
const restState = (mat: GlowMaterial, color: PieceColor, state: State, k = 1) => {
  const light = STATE_LIGHT[state];
  const glow = mat.userData.glow;
  const base = mat.userData.baseRim ?? (mat.userData.baseRim = glow.uRim.value.clone());
  if (light.rim) glow.uRim.value.set(light.rim).multiplyScalar(STATE_RIM[color] * k);
  else glow.uRim.value.copy(base).multiplyScalar(light.rimBoost * k);
  glow.uCrown.value.set(light.crown).multiplyScalar(light.crownStrength * k);
};

/** The foot bands: each level's colour, glowing so it holds in shade and reads as light. */
export const FEET = LEVELS.map(
  (c) =>
    new MeshStandardMaterial({
      color: c,
      emissive: c,
      emissiveIntensity: 0.85,
      roughness: 0.4,
      metalness: 0,
    }),
);

// --- The light pool under a piece -------------------------------------------------

const poolTextures = new Map<number, Texture>();
/**
 * A soft pool of light round a piece's base, fading out, with one to five
 * short ticks round it for its level (A one, E five): a cue that does not
 * rely on colour, read best from above.
 */
const pool = (level: number) => {
  let t = poolTextures.get(level);
  if (t) return t;
  const size = 256;
  const h = size / 2;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(h, h, 0, h, h, h);
  // An alpha map reads the green channel: grey levels on black, not white
  // with alpha. An even glow under the base (the base hides most of it) that
  // fades softly outside it: a spill of light, never a crisp ring, so it can
  // never be taken for a mark of play.
  const grey = (v: number) => `rgb(${v * 255}, ${v * 255}, ${v * 255})`;
  g.addColorStop(0, grey(0.5));
  g.addColorStop(0.6, grey(0.5));
  g.addColorStop(0.72, grey(0.24));
  g.addColorStop(0.86, grey(0.06));
  g.addColorStop(1, grey(0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // The ticks: short radial strokes just outside the base, evenly spread,
  // the first toward the back of the piece
  ctx.strokeStyle = grey(0.95);
  ctx.lineCap = 'round';
  ctx.lineWidth = size * 0.02;
  const count = level + 1;
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (i / count) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(h + Math.cos(a) * h * 0.72, h + Math.sin(a) * h * 0.72);
    ctx.lineTo(h + Math.cos(a) * h * 0.86, h + Math.sin(a) * h * 0.86);
    ctx.stroke();
  }
  t = new CanvasTexture(c);
  t.anisotropy = 4;
  poolTextures.set(level, t);
  return t;
};

const poolPlane = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const poolMaterials = new Map<number, MeshBasicMaterial>();
const poolMaterial = (level: number) => {
  let m = poolMaterials.get(level);
  if (!m) {
    m = new MeshBasicMaterial({
      color: LEVELS[level],
      alphaMap: pool(level),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    poolMaterials.set(level, m);
  }
  return m;
};

/** Radius of the light pool, piece units: it reaches a little past the widest base. */
const POOL_RADIUS = 0.44;

/** The foot band's light on the glass, in the level's colour. */
export const LightPool = ({ level }: { level: number }) => (
  <mesh
    geometry={poolPlane}
    material={poolMaterial(level)}
    position={[0, 0.006, 0]}
    scale={[POOL_RADIUS * 2, 1, POOL_RADIUS * 2]}
    renderOrder={LAYER.shadow}
    raycast={noRaycast}
  />
);

// --- The piece ---------------------------------------------------------------------

const SWELL_MS = 520;

/**
 * The selected piece's rim and crown light: it swells up past its resting
 * glow and settles, once per selection. The selected materials are shared by the army,
 * which is fine: only one piece is ever selected.
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
    // Up quickly to two and a half times the resting light, then down to rest
    const k = t < 0.3 ? 1 + 1.5 * (t / 0.3) ** 0.7 : 1 + 1.5 * (1 - (t - 0.3) / 0.7) ** 2;
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
  return (
    <>
      {decor && (
        <>
          <ContactShadow radius={0.34} opacity={0.55} color="#01080b" />
          <LightPool level={level} />
        </>
      )}
      <ChessPiece
        type={type}
        parts={{
          body: m.body,
          accent: type === PieceType.Rook ? m.body : m.accent,
          foot: FEET[level] ?? FEET[0],
        }}
      />
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
