import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  Color,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { BufferGeometry, Group, Material, Mesh } from 'three';
import { PieceType } from '../../../engine/pieces';
import { ChessPiece, buildPieceSet, partsGeometry, pieceTop } from '../../pieces';
import type { PieceSet } from '../../pieces';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import type { PieceBodyProps, PieceColor } from '../types';
import {
  CHECK,
  INLAY_INK,
  INLAY_PEWTER,
  INK,
  LACQUER,
  PORCELAIN,
  RIM,
  SELECT,
  SILVER,
} from './palette';
import { floorTexture } from './textures';

// The armies: glazed porcelain against black urushi lacquer, on the shared
// Staunton set. Porcelain is drawn with a fine sumi line, as in Sumi; the
// lacquer, which would be a black blob on a night board, is drawn in silver
// ink instead and lit round its edge by the moon (a fresnel rim, cool and
// soft), so every black piece reads as a sculpted form from any side. The
// collars and the identifying details (the knight's mane, the bishop's cut,
// the unicorn's spiral, the queen's pearls, the king's cross) are inlaid in
// ink on porcelain and pewter on lacquer, so no one piece stands apart; the
// rook's hollow keeps its body's glaze, so from above it reads as its army.
// The foot band is the level's pigment.
//
// Selection is a moonrise: a silver halo rises behind the piece, a ring of
// light with a faint disc inside it, and the piece's line thickens. A piece
// under the pointer gets the ring alone, faintly. In check, the king's line
// turns vermilion over its seal.

// --- Geometry ------------------------------------------------------------------

/**
 * The shared set at 14 sides: the silhouettes are the medium set's, with a
 * little less turning, which pays for the outline hull (every piece is drawn
 * twice, its body alone) while the whole scene stays near 140k triangles.
 */
let set: PieceSet | null = null;
export const nocturneSet = (): PieceSet => {
  if (!set) set = buildPieceSet({ quality: 'medium', segments: 14 });
  return set;
};

const hullGeometries = new Map<PieceType, BufferGeometry>();
/**
 * The whole piece in one geometry with an extra attribute for the outline:
 * every vertex at one position shares one averaged normal, so the inflated
 * hull stays closed across creases and between parts.
 */
export const hullGeometry = (type: PieceType): BufferGeometry => {
  let g = hullGeometries.get(type);
  if (g) return g;
  g = partsGeometry(nocturneSet(), type, ['body'])!.clone();
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const sums = new Map<string, Vector3>();
  const keyOf = (i: number) =>
    `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  for (let i = 0; i < pos.count; i++) {
    const k = keyOf(i);
    const s = sums.get(k) ?? new Vector3();
    s.x += nor.getX(i);
    s.y += nor.getY(i);
    s.z += nor.getZ(i);
    sums.set(k, s);
  }
  const outline = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const s = sums.get(keyOf(i))!.clone().normalize();
    outline.set([s.x, s.y, s.z], i * 3);
  }
  g.setAttribute('aOutline', new BufferAttribute(outline, 3));
  hullGeometries.set(type, g);
  return g;
};

// --- Materials -------------------------------------------------------------------

export type PieceState = 'rest' | 'hovered' | 'selected' | 'check';

/**
 * A standard material with a fresnel rim added after lighting: a soft edge
 * of `rim` colour where the surface turns away from the viewer.
 */
const withRim = (m: MeshStandardMaterial, rim: string, strength: number, power: number) => {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = { value: new Color(rim) };
    shader.uniforms.uRimStrength = { value: strength };
    shader.uniforms.uRimPower = { value: power };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        'uniform vec3 uRim;\nuniform float uRimStrength;\nuniform float uRimPower;\nvoid main() {',
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 rimView = normalize(vViewPosition);
          float rimK = pow(1.0 - clamp(abs(dot(normal, rimView)), 0.0, 1.0), uRimPower);
          // Stronger toward the top: moonlight comes from above
          rimK *= 0.6 + 0.4 * clamp(normal.y * 0.5 + 0.5, 0.0, 1.0);
          outgoingLight += uRim * rimK * uRimStrength;
        }
        #include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => `nocturne-rim-${rim}-${strength}-${power}`;
  return m;
};

const bodies = new Map<PieceColor, MeshStandardMaterial>();
/**
 * Porcelain or lacquer, one per army. Every state shares it: hover,
 * selection and check change only the drawn line round the piece and what
 * lies behind and under it, never the body, so an army's value holds.
 */
export const bodyMaterial = (color: PieceColor) => {
  let m = bodies.get(color);
  if (!m) {
    m =
      color === 'white'
        ? withRim(
            new MeshStandardMaterial({
              color: PORCELAIN,
              roughness: 0.26,
              metalness: 0,
              envMapIntensity: 0.75,
            }),
            '#b8c6e6',
            0.18,
            3,
          )
        : withRim(
            new MeshStandardMaterial({
              color: LACQUER,
              roughness: 0.16,
              metalness: 0,
              envMapIntensity: 1.7,
            }),
            RIM,
            0.45,
            2.8,
          );
    bodies.set(color, m);
  }
  return m;
};

/**
 * The inlay and painted details (collar, knight's mane, bishop's cut,
 * unicorn's spiral, queen's pearls, king's cross), one material per army so
 * they draw as one mesh: sumi ink on porcelain, pewter on lacquer. Neither is
 * a marker colour (no gold, no bright silver), and each contrasts with its
 * own body, so the details read at game size.
 */
export const detailMaterial: Record<PieceColor, MeshStandardMaterial> = {
  white: new MeshStandardMaterial({ color: INLAY_INK, roughness: 0.4, envMapIntensity: 0.6 }),
  black: new MeshStandardMaterial({
    color: INLAY_PEWTER,
    roughness: 0.34,
    metalness: 0.75,
    envMapIntensity: 1.1,
  }),
};

const feet = new Map<string, MeshStandardMaterial>();
/** The foot band in the level's pigment, glowing a little so it holds at night. */
export const footMaterial = (color: string) => {
  let m = feet.get(color);
  if (!m) {
    const c = new Color(color);
    m = new MeshStandardMaterial({
      color: c,
      emissive: c,
      emissiveIntensity: 0.55,
      roughness: 0.5,
    });
    feet.set(color, m);
  }
  return m;
};

const hullVertex = /* glsl */ `
  attribute vec3 aOutline;
  uniform float uWidth;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * aOutline);
    // Inflate in proportion to depth: the line keeps one width on screen
    mv.xyz += n * uWidth * -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;

const hullFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    gl_FragColor = vec4(uColor, uOpacity);
    #include <colorspace_fragment>
  }`;

/**
 * The drawn line: the piece's own mesh, inflated and drawn from the back, so
 * only a rim of it shows round the silhouette. `width` is an angle (radians
 * of view per unit of depth); 0.0015 is about 1.6 px at a 720 px view.
 */
export const hullMaterial = (color: string, width: number) =>
  new ShaderMaterial({
    side: BackSide,
    uniforms: {
      uColor: { value: new Color(color) },
      uWidth: { value: width },
      uOpacity: { value: 1 },
    },
    vertexShader: hullVertex,
    fragmentShader: hullFragment,
  });

const LINE = 0.0014;
/** The lacquer's line: silver, a little dimmer than the marks, so black still reads as black. */
const SILVER_LINE = '#97a3c2';
export const hulls: Record<PieceColor, Record<PieceState, ShaderMaterial>> = {
  white: {
    rest: hullMaterial(INK, LINE),
    hovered: hullMaterial(INK, LINE * 1.35),
    selected: hullMaterial(INK, LINE * 1.6),
    check: hullMaterial(CHECK, LINE * 1.3),
  },
  black: {
    rest: hullMaterial(SILVER_LINE, LINE * 0.85),
    hovered: hullMaterial(SILVER, LINE * 1.2),
    selected: hullMaterial(SILVER, LINE * 1.25),
    check: hullMaterial(CHECK, LINE * 1.25),
  },
};

// --- The moon halo -----------------------------------------------------------------

const haloVertex = /* glsl */ `
  uniform float uSize;
  uniform float uHeight;
  uniform float uPush;
  varying vec2 vP;
  varying float vSide;
  void main() {
    vP = position.xy * 2.0;
    // Seen from above the halo would lie round the piece like another ring
    // on the floor: it belongs to side views, and fades out toward top-down
    vec3 anchor = (modelMatrix * vec4(0.0, uHeight, 0.0, 1.0)).xyz;
    vSide = 1.0 - smoothstep(0.72, 0.9, abs(normalize(cameraPosition - anchor).y));
    // A billboard centred above the piece's base, pushed away from the
    // viewer so the piece stands in front of it
    vec4 centre = modelViewMatrix * vec4(0.0, uHeight, 0.0, 1.0);
    vec3 away = normalize(centre.xyz);
    centre.xyz += away * uPush;
    centre.xy += position.xy * uSize;
    gl_Position = projectionMatrix * centre;
  }`;

const haloFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uGlow;
  uniform float uRing;
  uniform float uScale;
  varying vec2 vP;
  varying float vSide;
  void main() {
    if (vSide < 0.003) discard;
    float r = length(vP) / max(uScale, 1e-3);
    float aa = fwidth(r) * 1.2;
    // The ring of light, a faint moon disc inside it, and a soft glow outside
    float ring = 1.0 - smoothstep(0.0, 0.028 + aa, abs(r - 0.8));
    float disc = (1.0 - smoothstep(0.78 - aa, 0.8, r)) * (0.34 + 0.16 * r);
    float glow = exp(-pow((r - 0.8) / 0.16, 2.0)) * 0.5 + exp(-r * 2.6) * 0.25;
    float a = (ring * uRing + (disc + glow) * uGlow) * vSide;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }`;

const haloQuad = new PlaneGeometry(1, 1);

/**
 * The moon rising behind a piece: eases in when the piece is picked up (or
 * faintly, as a ring alone, under the pointer) and out again when it is not.
 * `height` is the halo's centre above the base (piece units); the ring's
 * radius is the same for every piece, so the moon reads as one sign.
 */
const MoonHalo = ({ level, height }: { level: 0 | 1 | 2; height: number }) => {
  const invalidate = useThree((s) => s.invalidate);
  const mesh = useRef<Mesh>(null);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: {
          uColor: { value: new Color(SELECT) },
          uGlow: { value: 0 },
          uRing: { value: 0 },
          uScale: { value: 0.82 },
          uSize: { value: 1.02 },
          uHeight: { value: height },
          uPush: { value: 0.45 },
        },
        vertexShader: haloVertex,
        fragmentShader: haloFragment,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one halo per piece
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  material.uniforms.uHeight.value = height;
  const k = useRef(0);
  useEffect(() => invalidate(), [level, invalidate]);
  useFrame((_, delta) => {
    const goal = level;
    const step = Math.min(delta, 1 / 30) / 0.3;
    const next =
      goal > k.current ? Math.min(goal, k.current + step) : Math.max(goal, k.current - step);
    if (mesh.current) mesh.current.visible = next > 0;
    if (next === k.current) return;
    k.current = next;
    // 0..1: the hovered ring; 1..2: the full moonrise
    const hover = Math.min(next, 1);
    const rise = Math.max(0, next - 1);
    const e = 1 - (1 - rise) ** 3;
    const u = material.uniforms;
    u.uRing.value = 0.5 * hover + 0.4 * e;
    u.uGlow.value = 0.1 * hover + 0.32 * e;
    u.uScale.value = 0.85 + 0.15 * e;
    invalidate();
  });
  return (
    <mesh
      ref={mesh}
      geometry={haloQuad}
      material={material}
      visible={false}
      renderOrder={LAYER.shadow - 0.5}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

// --- On the floor -----------------------------------------------------------------

/**
 * Keeps its children on the floor while the piece above them is lifted
 * (Board wraps a body in the kit's Lift): it reads how far that Lift has
 * raised the body and moves back down by as much. It mounts a frame late on
 * purpose, so its frame callback runs after the Lift's.
 */
const OnFloor = ({ children }: { children: React.ReactNode }) => {
  const [late, setLate] = useState(false);
  useEffect(() => setLate(true), []);
  const group = useRef<Group>(null);
  return (
    <group ref={group}>
      {children}
      {late && <FollowFloor group={group} />}
    </group>
  );
};

const FollowFloor = ({ group }: { group: React.RefObject<Group | null> }) => {
  useFrame(() => {
    const g = group.current;
    const lift = g?.parent?.position.y ?? 0;
    if (g && g.position.y !== -lift) g.position.y = -lift;
  });
  return null;
};

const floorQuad = new PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2);

const floorVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const floorFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uWash;
  uniform vec3 uShadow;
  uniform float uShadowOpacity;
  uniform float uWashOpacity;
  varying vec2 vUv;
  void main() {
    vec4 t = texture2D(uMap, vUv);
    float wash = t.r * uWashOpacity;
    float shadow = t.g * uShadowOpacity;
    // The pigment laid over the shadow
    float a = wash + shadow * (1.0 - wash);
    if (a < 0.003) discard;
    vec3 col = (uWash * wash + uShadow * shadow * (1.0 - wash)) / a;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }`;

const floors = new Map<string, ShaderMaterial>();
/**
 * What a piece leaves on the paper, in one mesh: a soft shadow and a wash of
 * its level's pigment bled into the paper round its foot (piece units).
 */
const floorMaterial = (color: string) => {
  let m = floors.get(color);
  if (!m) {
    m = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      uniforms: {
        uMap: { value: floorTexture() },
        uWash: { value: new Color(color) },
        uShadow: { value: new Color('#01020a') },
        uShadowOpacity: { value: 0.62 },
        // Quieter than any marker: a level's pigment, never its highlight
        uWashOpacity: { value: 0.36 },
      },
      vertexShader: floorVertex,
      fragmentShader: floorFragment,
    });
    floors.set(color, m);
  }
  return m;
};

/** One piece's meshes, with its line, in the given materials. */
export const PieceMeshes = ({
  type,
  color,
  body,
  hull,
  foot,
}: {
  type: PieceType;
  color: PieceColor;
  body: Material;
  hull: Material;
  foot: Material;
}) => (
  <>
    <ChessPiece
      type={type}
      set={nocturneSet()}
      parts={{
        body,
        collar: detailMaterial[color],
        // The rook's accent is its whole hollow: left in the body's glaze, so
        // from above a rook still reads as its own army
        accent: type === PieceType.Rook ? body : detailMaterial[color],
        foot,
      }}
    />
    <mesh geometry={hullGeometry(type)} material={hull} raycast={noRaycast} />
  </>
);

/** Height of the halo's centre above the base: half the piece's height (piece units). */
const haloHeight = (type: PieceType) => pieceTop(nocturneSet(), type) * 0.5;

/**
 * A piece on its platform: a soft shadow and a wash of its level's pigment
 * on the paper (both stay down when the piece lifts), the piece with
 * its line and its foot band in the same pigment, and the moon halo that
 * rises behind it when it is picked up.
 */
export const makePieceBody = (levels: string[]) => {
  const NocturnePieceBody = ({
    type,
    color,
    selected,
    hovered,
    inCheck,
    level,
  }: PieceBodyProps) => {
    const state: PieceState = inCheck
      ? 'check'
      : selected
        ? 'selected'
        : hovered
          ? 'hovered'
          : 'rest';
    const pigment = levels[level ?? 0] ?? levels[0];
    return (
      <>
        <OnFloor>
          <mesh
            geometry={floorQuad}
            material={floorMaterial(pigment)}
            position={[0, 0.006, 0]}
            renderOrder={LAYER.shadow}
            raycast={noRaycast}
          />
        </OnFloor>
        <PieceMeshes
          type={type}
          color={color}
          body={bodyMaterial(color)}
          hull={hulls[color][state]}
          foot={footMaterial(pigment)}
        />
        <MoonHalo level={selected ? 2 : hovered ? 1 : 0} height={haloHeight(type)} />
      </>
    );
  };
  return NocturnePieceBody;
};
