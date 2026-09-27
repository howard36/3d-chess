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
import { FLOOR_DECAL } from '../kit/motion';
import { noRaycast } from '../kit/noRaycast';
import type { PieceBodyProps, PieceColor } from '../types';
import { CHECK, INLAY_INK, INLAY_PEWTER, INK, LACQUER, PORCELAIN, RIM, SELECT } from './palette';
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
// light with a faint disc inside it, while the piece itself (line and all)
// keeps its army's value. A piece under the pointer gets the ring alone,
// faintly. In check, the line round the king's head turns vermilion over its
// seal.

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

/**
 * A standard material with a fresnel rim added after lighting: a soft edge
 * of `rim` colour where the surface turns away from the viewer. With `band`,
 * also a broad soft clear-coat highlight down the key side (the viewer's
 * left, where the camera's key light is), as a tall strip light would lay on
 * lacquer: it follows the camera, and it spares surfaces facing the viewer,
 * so a top-down view keeps every top dark.
 */
const withRim = (
  m: MeshStandardMaterial,
  rim: string,
  strength: number,
  power: number,
  band = 0,
) => {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = { value: new Color(rim) };
    shader.uniforms.uRimStrength = { value: strength };
    shader.uniforms.uRimPower = { value: power };
    shader.uniforms.uBand = { value: band };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        'uniform vec3 uRim;\nuniform float uRimStrength;\nuniform float uRimPower;\nuniform float uBand;\nvoid main() {',
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 rimView = normalize(vViewPosition);
          float facing = clamp(abs(dot(normal, rimView)), 0.0, 1.0);
          float rimK = pow(1.0 - facing, uRimPower);
          // Stronger toward the top: moonlight comes from above
          rimK *= 0.6 + 0.4 * clamp(normal.y * 0.5 + 0.5, 0.0, 1.0);
          outgoingLight += uRim * rimK * uRimStrength;
          if (uBand > 0.0) {
            float strip = exp(-pow((normal.x + 0.5) / 0.2, 2.0));
            strip *= 1.0 - smoothstep(0.55, 0.85, abs(normal.y));
            outgoingLight += uRim * strip * uBand;
          }
        }
        #include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => `nocturne-rim-${rim}-${strength}-${power}-${band}`;
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
              envMapIntensity: 1.0,
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
            0.16,
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
  varying float vY;
  void main() {
    vY = position.y;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * aOutline);
    // Inflate in proportion to depth: the line keeps one width on screen
    mv.xyz += n * uWidth * -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;

const hullFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uTopColor;
  uniform float uSplit;
  uniform float uOpacity;
  varying float vY;
  void main() {
    // Above the split (a king's head, in check) the line takes the top colour
    vec3 col = mix(uColor, uTopColor, smoothstep(uSplit - 0.02, uSplit + 0.02, vY));
    gl_FragColor = vec4(col, uOpacity);
    #include <colorspace_fragment>
  }`;

/**
 * The drawn line: the piece's own mesh, inflated and drawn from the back, so
 * only a rim of it shows round the silhouette. `width` is an angle (radians
 * of view per unit of depth); 0.0015 is about 1.6 px at a 720 px view. Above
 * `split` (piece units) it is drawn in `top` instead.
 */
export const hullMaterial = (
  color: string,
  width: number,
  {
    top = color,
    split = 1e3,
    opacity = 1,
  }: { top?: string; split?: number; opacity?: number } = {},
) =>
  new ShaderMaterial({
    side: BackSide,
    transparent: opacity < 1,
    depthWrite: opacity >= 1,
    uniforms: {
      uColor: { value: new Color(color) },
      uTopColor: { value: new Color(top) },
      uSplit: { value: split },
      uWidth: { value: width },
      uOpacity: { value: opacity },
    },
    vertexShader: hullVertex,
    fragmentShader: hullFragment,
  });

const LINE = 0.0014;
/** The lacquer's line: silver, a little dimmer than the marks, so black still reads as black. */
const SILVER_LINE = '#97a3c2';
/** Where a king's head begins (piece units): in check, only the line above it turns vermilion. */
const CROWN = 0.56;

/**
 * Each army's drawn line, the same in every state: a piece keeps its army's
 * value whatever happens to it (a thicker ink line would turn a small
 * porcelain piece to the black army's value, a glow round a lacquer one
 * would pale it toward porcelain). Hover and selection are said behind and
 * under the piece instead (the moon halo, the pool, the ring from above). In
 * check only the line round the king's head turns vermilion; the seal under
 * it carries the rest.
 */
export const lines: Record<PieceColor, { rest: ShaderMaterial; check: ShaderMaterial }> = {
  white: {
    rest: hullMaterial(INK, LINE),
    check: hullMaterial(INK, LINE, { top: CHECK, split: CROWN }),
  },
  black: {
    rest: hullMaterial(SILVER_LINE, LINE * 0.85),
    check: hullMaterial(SILVER_LINE, LINE * 0.85, { top: CHECK, split: CROWN }),
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
 * (Board wraps a lifted body in the kit's Lift, tagged `userData.lift`): it
 * reads how far that Lift has raised the body and moves back down by as
 * much. Anywhere else (a gallery, an effect) it leaves them where they are.
 * It mounts a frame late on purpose, so its frame callback runs after the
 * Lift's.
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
    const parent = g?.parent;
    const lift = parent?.userData.lift ? parent.position.y : 0;
    if (g && g.position.y !== -lift) g.position.y = -lift;
  });
  return null;
};

/**
 * The floor quad's side (piece units): room for the square footprint (0.92
 * of a square, in world units), even under a knight turned a little.
 */
const FLOOR = 1.5;
const floorQuad = new PlaneGeometry(FLOOR, FLOOR).rotateX(-Math.PI / 2);

const floorVertex = /* glsl */ `
  uniform float uSize;
  varying vec2 vUv;
  varying vec2 vOffset;
  varying float vUp;
  void main() {
    // The wash texture covers the middle 0.9 of a piece unit
    vUv = (uv - 0.5) * (uSize / 0.9) + 0.5;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec4 centre = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    // World offset from the piece's centre: the square stays square to the
    // board even under a turned knight
    vOffset = world.xz - centre.xz;
    vUp = normalize(cameraPosition - centre.xyz).y;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const floorFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uWash;
  uniform vec3 uShadow;
  uniform float uShadowOpacity;
  uniform float uWashOpacity;
  uniform float uHalf;
  uniform float uLine;
  varying vec2 vUv;
  varying vec2 vOffset;
  varying float vUp;
  void main() {
    vec2 inTex = step(vec2(0.0), vUv) * step(vUv, vec2(1.0));
    vec4 t = texture2D(uMap, clamp(vUv, 0.0, 1.0)) * inTex.x * inTex.y;
    float wash = t.r * uWashOpacity;
    float shadow = t.g * uShadowOpacity;
    // Seen from above, the piece's own square in its level's pigment, so it
    // reads against the right grid whatever level it stands on
    float birdsEye = smoothstep(0.84, 0.96, vUp);
    float box = max(abs(vOffset.x), abs(vOffset.y));
    float aa = max(fwidth(box), 1e-4);
    float square = (1.0 - smoothstep(uLine * 0.5 - aa, uLine * 0.5 + aa, abs(box - uHalf))) * birdsEye;
    wash = max(wash, square * 0.42);
    // The pigment laid over the shadow
    float a = wash + shadow * (1.0 - wash);
    if (a < 0.003) discard;
    vec3 col = (uWash * wash + uShadow * shadow * (1.0 - wash)) / a;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }`;

const floors = new Map<string, ShaderMaterial>();
/**
 * What a piece leaves on the paper, in one mesh: a soft shadow, a wash of
 * its level's pigment bled into the paper round its foot, and (seen from
 * above) the outline of its square in that pigment. `pitch` is the board's,
 * in world units.
 */
const floorMaterial = (color: string, pitch: number) => {
  const key = `${color}/${pitch}`;
  let m = floors.get(key);
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
        uSize: { value: FLOOR },
        uHalf: { value: pitch * 0.46 },
        uLine: { value: pitch * 0.03 },
      },
      vertexShader: floorVertex,
      fragmentShader: floorFragment,
    });
    floors.set(key, m);
  }
  return m;
};

/** One piece's meshes, with its line. */
export const PieceMeshes = ({
  type,
  color,
  body,
  line,
  foot,
}: {
  type: PieceType;
  color: PieceColor;
  body: Material;
  line: Material;
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
    <mesh geometry={hullGeometry(type)} material={line} raycast={noRaycast} />
  </>
);

/** Height of the halo's centre above the base: half the piece's height (piece units). */
const haloHeight = (type: PieceType) => pieceTop(nocturneSet(), type) * 0.5;

/**
 * A piece on its platform: a soft shadow and a wash of its level's pigment
 * on the paper (both stay down when the piece lifts, and are floor decals,
 * so the kit hides them under a toppled king), the piece with its line and
 * its foot band in the same pigment, and the moon halo that rises behind it
 * when it is picked up. `pitch` is the board's square, in world units.
 */
export const makePieceBody = (levels: string[], pitch: number) => {
  const NocturnePieceBody = ({
    type,
    color,
    selected,
    hovered,
    inCheck,
    level,
  }: PieceBodyProps) => {
    const pigment = levels[level ?? 0] ?? levels[0];
    return (
      <>
        <OnFloor>
          <mesh
            geometry={floorQuad}
            material={floorMaterial(pigment, pitch)}
            position={[0, 0.006, 0]}
            renderOrder={LAYER.shadow}
            raycast={noRaycast}
            userData={FLOOR_DECAL}
          />
        </OnFloor>
        <PieceMeshes
          type={type}
          color={color}
          body={bodyMaterial(color)}
          line={inCheck ? lines[color].check : lines[color].rest}
          foot={footMaterial(pigment)}
        />
        <MoonHalo level={selected ? 2 : hovered ? 1 : 0} height={haloHeight(type)} />
      </>
    );
  };
  return NocturnePieceBody;
};
