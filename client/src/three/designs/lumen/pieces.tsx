import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BackSide,
  Color,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { BufferGeometry, Group, Object3D } from 'three';
import { PieceType } from '../../../engine/pieces';
import { ChessPiece, PIECE_PARTS, partsGeometry, pieceSet, pieceTop } from '../../pieces';
import { LAYER } from '../kit/layers';
import { FLOOR_DECAL } from '../kit/motion';
import { noRaycast } from '../kit/noRaycast';
import type { PieceBodyProps, PieceColor } from '../types';
import { LEVEL_COLORS, PALETTE } from './palette';
import { steepness } from './plates';

// Hard-light ceramic: solid, matte, opaque bodies (never see-through), each
// army carrying a luminous edge of its own light along its silhouette. Pearl
// pieces take a silver-ice edge and deep indigo inlays; graphite-violet
// pieces a cool silver edge and soft lilac inlays that glow, so the details that name
// a piece (the unicorn's spiral, the bishop's cut, the queen's pearls, the
// king's cross, the knight's mane) read on the dark army from anywhere. Each
// body deepens toward its base, and its foot band glows in its level's
// colour, above a footprint of the same light on the pane.
//
// The rim is computed from the view, so it wraps every piece the same way
// from both seats and from above. Materials are shared by every piece of an
// army and state; anything that fades one piece clones first (the design's
// own capture effect redraws the victim with a dissolve shader instead).

export type Glow = 'none' | 'hover' | 'selected' | 'check';

// --- The ceramic shader ------------------------------------------------------------------

// One small shader for every part of every piece, instead of the standard
// PBR material: the review machine renders in software, where a standard
// material is slow to compile and to draw. It lights a piece as the studio's
// rig would (a soft key over the camera's left shoulder and a cool fill low
// on its right, both riding with the camera, over a hemisphere of cool sky
// and the table's teal uplight), adds a broad, controlled highlight that
// shows the form, then wraps the silhouette in the army's light.

/** The light rig, in world space: Stage's CameraLights keeps it with the camera. */
export const rig = {
  key: { value: new Vector3(-0.4, 0.75, 0.55).normalize() },
  fill: { value: new Vector3(0.6, 0.1, 0.5).normalize() },
};

const ceramicVertex = /* glsl */ `
  varying vec3 vN;
  varying vec3 vW;
  varying float vY;
  void main() {
    vY = position.y;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const ceramicFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uBase;
  uniform vec3 uRim;
  uniform vec3 uEmissive;
  uniform vec3 uKey;
  uniform vec3 uFill;
  uniform vec3 uKeyColor;
  uniform vec3 uFillColor;
  uniform vec3 uSky;
  uniform vec3 uGround;
  uniform float uGradient;
  uniform float uRimMix;
  uniform float uRimPower;
  uniform float uSpec;
  uniform float uShine;
  uniform float uTop;
  uniform vec3 uCrown;
  uniform float uCrownMix;
  uniform float uCrownPower;
  varying vec3 vN;
  varying vec3 vW;
  varying float vY;
  void main() {
    vec3 n = normalize(vN);
    if (!gl_FrontFacing) n = -n;
    vec3 v = normalize(cameraPosition - vW);
    // Deeper toward the base (piece units, base at 0)
    vec3 albedo = mix(uBase, uColor, mix(1.0, smoothstep(0.03, 0.42, vY), uGradient));
    float key = max(dot(n, uKey), 0.0);
    float fill = max(dot(n, uFill), 0.0);
    vec3 hemi = mix(uGround, uSky, 0.5 + 0.5 * n.y);
    vec3 col = albedo * (uKeyColor * key + uFillColor * fill + hemi);
    // A broad highlight, never a mirror
    vec3 h = normalize(uKey + v);
    col += uKeyColor * pow(max(dot(n, h), 0.0), uShine) * uSpec * key;
    col += uEmissive;
    // The army's light along the silhouette
    // Seen from above, a turned piece is nearly all silhouette to this term;
    // it gives way there, so an army keeps its own colour from any height
    float rim = pow(1.0 - abs(dot(n, v)), uRimPower);
    float fromAbove = mix(1.0, 0.35, smoothstep(0.55, 0.95, abs(v.y)));
    rim *= fromAbove;
    col = mix(col, uRim, clamp(uRimMix * rim, 0.0, 1.0));
    // A state's light (hover's silver, check's red) on the edge of the top
    // third only: the body below keeps its army's colour and form
    float crown = pow(1.0 - abs(dot(n, v)), uCrownPower) * fromAbove;
    crown *= smoothstep(0.55, 0.75, vY / uTop);
    col = mix(col, uCrown, clamp(uCrownMix * crown, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// The studio's lights as the ceramic sees them, in three's physical units:
// a light's colour times its intensity, over pi for a matte surface
const lit = (hex: string, intensity: number) => new Color(hex).multiplyScalar(intensity / Math.PI);
const LIGHTS = {
  uKeyColor: { value: lit('#f4f6ff', 2.3) },
  uFillColor: { value: lit('#9cc4ff', 0.55) },
  uSky: { value: lit('#c9d6ff', 0.75) },
  uGround: { value: lit('#2a3a52', 0.75) },
};

interface CeramicOptions {
  color: string;
  /** The colour it deepens to at its base (unset: an even colour). */
  base?: string;
  rim: string;
  rimMix: number;
  rimPower: number;
  emissive?: Color;
  spec?: number;
  shine?: number;
  /** The piece's height (piece units), for the top-third light. */
  top?: number;
  /** A state's light on the edge of the top third (hover, check). */
  crown?: { color: string; mix: number; power: number };
}

const ceramic = (o: CeramicOptions) =>
  new ShaderMaterial({
    uniforms: {
      ...LIGHTS,
      uKey: rig.key,
      uFill: rig.fill,
      uColor: { value: new Color(o.color) },
      uBase: { value: new Color(o.base ?? o.color) },
      uGradient: { value: o.base ? 1 : 0 },
      uRim: { value: new Color(o.rim) },
      uRimMix: { value: o.rimMix },
      uRimPower: { value: o.rimPower },
      uEmissive: { value: o.emissive ?? new Color(0, 0, 0) },
      uSpec: { value: o.spec ?? 0.25 },
      uShine: { value: o.shine ?? 28 },
      uTop: { value: o.top ?? 1 },
      uCrown: { value: new Color(o.crown?.color ?? '#000000') },
      uCrownMix: { value: o.crown?.mix ?? 0 },
      uCrownPower: { value: o.crown?.power ?? 2 },
    },
    vertexShader: ceramicVertex,
    fragmentShader: ceramicFragment,
  });

interface Look {
  color: string;
  base: string;
  rim: string;
  /** A little light of its own, so the shadowed side never goes dead. */
  self: number;
  spec: number;
  rimMix: Record<Glow, number>;
  rimPower: number;
}

const LOOK: Record<PieceColor, Look> = {
  white: {
    color: PALETTE.white,
    base: PALETTE.whiteBase,
    rim: PALETTE.whiteRim,
    self: 0.04,
    spec: 0.3,
    rimMix: { none: 0.6, hover: 0.6, selected: 0.6, check: 0.6 },
    rimPower: 2.6,
  },
  black: {
    color: PALETTE.black,
    base: PALETTE.blackBase,
    rim: PALETTE.blackRim,
    self: 0.1,
    spec: 0.35,
    rimMix: { none: 0.78, hover: 0.78, selected: 0.72, check: 0.78 },
    rimPower: 2,
  },
};

const makeBody = (side: PieceColor, glow: Glow, type: PieceType) => {
  const look = LOOK[side];
  // Hover, selection and check light a piece's edges only, never its body,
  // and never with a glow of their own (on the dark army even a trace of
  // red emission turns the body wine-red). Hover adds silver to the edge of
  // the top third; check adds a narrow red there, and the army's own rim
  // keeps its form; held, a piece keeps its own edge light (the scan shell's
  // outline carries the gold).
  const crown =
    glow === 'check'
      ? { color: PALETTE.check, mix: 0.55, power: 3 }
      : glow === 'hover'
        ? { color: look.rim, mix: side === 'white' ? 0.5 : 0.45, power: 1.6 }
        : undefined;
  return ceramic({
    color: look.color,
    base: look.base,
    rim: look.rim,
    rimMix: look.rimMix[glow],
    rimPower: look.rimPower,
    emissive: new Color(look.color).multiplyScalar(look.self),
    spec: look.spec,
    top: pieceTop(pieceSet(), type),
    crown,
  });
};

const bodies = new Map<string, ShaderMaterial>();
export const bodyMaterial = (side: PieceColor, glow: Glow, type: PieceType) => {
  const key = `${side}/${glow}/${type}`;
  let m = bodies.get(key);
  if (!m) {
    m = makeBody(side, glow, type);
    bodies.set(key, m);
  }
  return m;
};

// The inlays: deep indigo cut into pearl; lilac light set into graphite
export const accents: Record<PieceColor, ShaderMaterial> = {
  white: ceramic({
    color: PALETTE.whiteAccent,
    rim: PALETTE.whiteRim,
    rimMix: 0.3,
    rimPower: 2.6,
    emissive: new Color(PALETTE.whiteAccentGlow).multiplyScalar(0.35),
    spec: 0.3,
  }),
  black: ceramic({
    color: PALETTE.blackAccent,
    rim: PALETTE.blackRim,
    rimMix: 0.4,
    rimPower: 2,
    emissive: new Color(PALETTE.blackInlay).multiplyScalar(0.6),
    spec: 0.2,
  }),
};

// The rook's accent is its whole hollow (and sills): seen from above it is
// most of the piece, so it keeps its own army's value, pearl in pearl and
// graphite in graphite, with a little of the army's light in it
const wells: Record<PieceColor, ShaderMaterial> = {
  white: ceramic({
    color: '#c3cbdb',
    rim: PALETTE.whiteRim,
    rimMix: 0.3,
    rimPower: 2.6,
    emissive: new Color(PALETTE.whiteRim).multiplyScalar(0.05),
    spec: 0.2,
  }),
  black: ceramic({
    color: '#241f33',
    rim: PALETTE.blackRim,
    rimMix: 0.5,
    rimPower: 2,
    emissive: new Color(PALETTE.blackRim).multiplyScalar(0.08),
    spec: 0.3,
  }),
};
export const accentOf = (type: PieceType, color: PieceColor) =>
  type === PieceType.Rook ? wells[color] : accents[color];

// The foot band: the level's colour, glowing, so it holds in shade
export const feet = LEVEL_COLORS.map((c) =>
  ceramic({
    color: c,
    rim: c,
    rimMix: 0.3,
    rimPower: 2,
    emissive: new Color(c).multiplyScalar(0.45),
    spec: 0.15,
  }),
);

export const glowOf = ({ inCheck, selected, hovered }: PieceBodyProps): Glow =>
  inCheck ? 'check' : selected ? 'selected' : hovered ? 'hover' : 'none';

// --- Footprint -----------------------------------------------------------------------

// Under each piece, one quad: a soft contact shadow, and round the base a
// thin ring of its level's light with a soft halo, so which pane a piece
// stands on reads from its footprint, from above as well as from the side.
const footVertex = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const footFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uShadow;
  uniform float uRing;
  uniform float uRadius;
  uniform float uSteep;
  varying vec2 vP;
  void main() {
    float r = length(vP);
    float shadow = uShadow * (1.0 - smoothstep(0.1, uRadius, r));
    float d = abs(r - uRadius);
    float fw = max(fwidth(r), 1e-4);
    float w = max(0.008, fw * 0.75);
    float ring = (1.0 - smoothstep(w - fw, w + fw, d)) * min(0.008 / w, 1.0);
    float halo = exp(-d * d / (0.03 * 0.03)) * 0.25;
    float light = max(ring, halo) * uRing;
    // From above, the piece's own square in its level's colour, so every
    // piece sits in a square of its own level whatever grid leads
    float sq = abs(max(abs(vP.x), abs(vP.y)) - 0.575);
    float fs = max(fwidth(sq), 1e-4);
    float square = (1.0 - smoothstep(fs * 0.75, fs * 1.75, sq)) * 0.55 * uSteep;
    light = max(light, square);
    float a = max(shadow, light);
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * light / max(a, 1e-4), a);
    #include <colorspace_fragment>
  }`;

const footPlane = new PlaneGeometry(1.3, 1.3).rotateX(-Math.PI / 2);
const footprint = (c: string, ring: number) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    uniforms: {
      uColor: { value: new Color(c) },
      uShadow: { value: 0.55 },
      uRing: { value: ring },
      uRadius: { value: 0.335 },
      uSteep: steepness,
    },
    vertexShader: footVertex,
    fragmentShader: footFragment,
  });
/** Per level: at rest, and brighter under the pointer. */
export const footprints = LEVEL_COLORS.map((c) => ({
  rest: footprint(c, 0.6),
  hover: footprint(c, 1.4),
}));

/** Nearest ancestor that Board's Lift raises (tagged userData.lift). */
const liftOf = (o: Object3D | null): Object3D | null => {
  for (let a = o?.parent ?? null; a; a = a.parent) if (a.userData.lift) return a;
  return null;
};

const turn = new Quaternion();

/**
 * Keeps its children on the pane while the piece above them is lifted
 * (hovered or picked up), and square to the board while the piece is turned
 * (a knight faces along the ranks): the footprint and its square stay where
 * the piece stands.
 */
const Grounded = ({ children }: { children: React.ReactNode }) => {
  const group = useRef<Group>(null);
  const lift = useRef<Object3D | null>(null);
  useFrame(() => {
    const g = group.current;
    if (!g?.parent) return;
    if (!lift.current) lift.current = liftOf(g);
    const y = -(lift.current?.position.y ?? 0);
    if (g.position.y !== y) g.position.y = y;
    g.parent.getWorldQuaternion(turn).invert();
    if (!g.quaternion.equals(turn)) g.quaternion.copy(turn);
  });
  return <group ref={group}>{children}</group>;
};

// --- The scan shell --------------------------------------------------------------------

// Picked up, a piece is scanned: a wireframe shell of its own form, proud
// of its surface, builds from the base up behind a bright scan line while its
// meridians turn once round it, then fades, leaving only a fine outline of
// gold light round the silhouette. Both are drawn on the shell's back faces,
// which the piece itself hides but for a band at its edge: the scan plays
// round the piece's outline, never over its body, so the held piece keeps
// its own army's colour throughout. The wireframe is drawn by the shader
// (rings of latitude, meridians), so it follows the real form of every piece
// at no extra geometry.

const shellVertex = /* glsl */ `
  uniform float uInflate;
  varying vec3 vLocal;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vLocal = position;
    vec3 p = position + normal * uInflate;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }`;

const shellFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTop;
  uniform float uScan;
  uniform float uTurn;
  uniform float uHold;
  varying vec3 vLocal;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float h = vLocal.y / uTop;
    if (h > uScan + 0.02) discard;
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    float rim = pow(1.0 - facing, 2.2);
    // Rings of latitude and turning meridians
    float lat = vLocal.y / 0.055;
    float lon = (atan(vLocal.z, vLocal.x) / 6.2831853 + uTurn) * 14.0;
    float fl = fwidth(lat);
    float fo = fwidth(lon);
    float latL = 1.0 - smoothstep(0.08, 0.08 + fl * 1.5, 1.0 - abs(fract(lat) - 0.5) * 2.0);
    float lonL = 1.0 - smoothstep(0.06, 0.06 + fo * 1.5, 1.0 - abs(fract(lon) - 0.5) * 2.0);
    // Dense lines fade rather than shimmer
    latL *= 1.0 - smoothstep(0.25, 0.6, fl);
    lonL *= 1.0 - smoothstep(0.25, 0.6, fo);
    float wire = max(latL, lonL);
    // The scan line itself, bright at the building edge
    float front = exp(-pow((h - uScan) / 0.035, 2.0)) * step(uScan, 1.02);
    float building = 1.0 - uHold;
    float a = (rim * 0.6 + wire * 0.55 * (0.4 + 0.6 * rim)) * building + front * 0.9;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <colorspace_fragment>
  }`;

// The held outline: only the grazing back faces, the true silhouette, not
// the rings of back faces a crown, a collar or a tier leaves uncovered
const outlineFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uHold;
  uniform float uSteep;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float f = abs(dot(normalize(vNormal), normalize(vView)));
    float edge = 1.0 - smoothstep(0.15, 0.4, f);
    gl_FragColor = vec4(uColor * 0.6 * uHold * edge * mix(1.0, 0.5, uSteep), 1.0);
    #include <colorspace_fragment>
  }`;

const SCAN_MS = 560;
const HOLD_MS = 300;

const shellGeometry = (type: PieceType): BufferGeometry =>
  partsGeometry(pieceSet(), type, PIECE_PARTS)!;

const ScanShell = ({ type }: { type: PieceType }) => {
  const invalidate = useThree((s) => s.invalidate);
  const elapsed = useRef(0);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: BackSide,
        uniforms: {
          uColor: { value: new Color(PALETTE.select) },
          uTop: { value: pieceTop(pieceSet(), type) },
          uScan: { value: 0 },
          uTurn: { value: 0 },
          uHold: { value: 0 },
          // Wide enough that the build shows as a band round the silhouette
          uInflate: { value: 0.04 },
        },
        vertexShader: shellVertex,
        fragmentShader: shellFragment,
      }),
    [type],
  );
  const outline = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: BackSide,
        // Shares the build's colour and hold, closer in to the surface
        uniforms: { ...material.uniforms, uInflate: { value: 0.022 }, uSteep: steepness },
        vertexShader: shellVertex,
        fragmentShader: outlineFragment,
      }),
    [material],
  );
  useEffect(
    () => () => {
      material.dispose();
      outline.dispose();
    },
    [material, outline],
  );
  useEffect(() => invalidate(), [invalidate]);
  useFrame((_, delta) => {
    const total = SCAN_MS + HOLD_MS;
    if (elapsed.current >= total) return;
    // Clamped loosely: on a slow machine it still settles in about its own time
    elapsed.current = Math.min(elapsed.current + Math.min(delta, 1 / 8) * 1000, total);
    const t = Math.min(elapsed.current / SCAN_MS, 1);
    const e = 1 - (1 - t) ** 3;
    const u = material.uniforms;
    u.uScan.value = t >= 1 ? 2 : e * 1.02;
    u.uTurn.value = e;
    u.uHold.value = Math.max(0, (elapsed.current - SCAN_MS) / HOLD_MS);
    invalidate();
  });
  const geometry = shellGeometry(type);
  return (
    <>
      <mesh
        geometry={geometry}
        material={material}
        renderOrder={LAYER.marker + 0.5}
        raycast={noRaycast}
      />
      <mesh
        geometry={geometry}
        material={outline}
        renderOrder={LAYER.marker + 0.5}
        raycast={noRaycast}
      />
    </>
  );
};

// --- The piece -----------------------------------------------------------------------

/**
 * A Staunton piece in hard-light ceramic, standing on its footprint (which
 * stays on the pane when the piece lifts), and, when picked up, inside its
 * scan shell.
 */
export const PieceBody = (props: PieceBodyProps) => {
  const level = props.level ?? 0;
  const body = bodyMaterial(props.color, glowOf(props), props.type);
  return (
    <>
      <Grounded>
        <mesh
          geometry={footPlane}
          material={footprints[level][props.hovered ? 'hover' : 'rest']}
          position={[0, 0.004, 0]}
          renderOrder={LAYER.shadow}
          raycast={noRaycast}
          // Topple hides it while a mated king is down
          userData={FLOOR_DECAL}
        />
      </Grounded>
      <ChessPiece
        type={props.type}
        parts={{ body, accent: accentOf(props.type, props.color), foot: feet[level] }}
      />
      {props.selected && <ScanShell type={props.type} />}
    </>
  );
};

/** The whole piece as one geometry, for effects that redraw it (echoes, dissolves). */
export const wholePiece = (type: PieceType): BufferGeometry => shellGeometry(type);
