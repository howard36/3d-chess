import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Group, Mesh, Points } from 'three';
import { PieceType } from '../../../engine/pieces';
import { prefersReducedMotion } from '../../motion';
import { ChessPiece, PIECE_PARTS, partsGeometry, pieceSet, pieceTop } from '../../pieces';
import { LAYER } from '../kit/layers';
import { ON_FLOOR } from '../kit/motion';
import { noRaycast } from '../kit/noRaycast';
import type { PieceBodyProps, PieceColor } from '../types';
import { PALETTE, PIECE_SCALE } from './palette';
import { mate, steepness } from './plates';

// The armies: turned ivory and ebony, lit like a tournament hall at night.
// Ivory is warm and softly lit; ebony is a deep brown wood, clearly dark,
// with a restrained warm-grey edge that shows its form without ever paling
// it toward the ivory. The foot is the piece's own wood (no ring of level
// colour at the base: the platforms, letters and markers say the level),
// and a soft contact shadow grounds it on its board.
//
// Under the pointer a piece lifts a little and warms, as if a lamp had
// turned toward it, and a faint glow of that lamp falls round its foot.
// Picked up, the lamp comes on: a pool of warm light blooms on the board
// under it, edged by a fine hexagon (a nod to Lumen's), a ring of light
// breathes out once from it, and a soft halo rises behind the piece and
// settles. Put down (or when another piece is picked up) both fade away.
// In check, the king's foot catches the red of its square, a thin red edge
// runs round his head, and a crown of red light sits over his cross.
//
// At rest, every piece of an army and kind shares its materials; a piece
// takes its own only while something lights it.

/** The lights, in world space: Stage's CameraRig keeps them with the camera. */
export const rig = {
  key: { value: new Vector3(-0.4, 0.75, 0.55).normalize() },
  fill: { value: new Vector3(0.6, 0.1, 0.5).normalize() },
};

// --- The wood shader ----------------------------------------------------------------

// One small shader for every part of every piece, instead of the standard
// PBR material: the review machine renders in software, where a standard
// material is slow to compile and to draw. It lights a piece as the hall's
// rig would (a soft warm key over the camera's left shoulder, a dim neutral
// fill low on its right, a warm hemisphere), adds a broad highlight that
// shows the turning, and edges the silhouette in the army's own light.

const woodVertex = /* glsl */ `
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

const woodFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uBase;
  uniform vec3 uRim;
  uniform vec3 uKey;
  uniform vec3 uFill;
  uniform vec3 uKeyColor;
  uniform vec3 uFillColor;
  uniform vec3 uSky;
  uniform vec3 uGround;
  uniform vec3 uLamp;
  uniform vec3 uCheckColor;
  uniform float uRimMix;
  uniform float uRimPower;
  uniform float uSpec;
  uniform float uShine;
  uniform float uSelf;
  uniform float uTop;
  uniform float uWarm;
  uniform float uCheck;
  varying vec3 vN;
  varying vec3 vW;
  varying float vY;
  void main() {
    vec3 n = normalize(vN);
    if (!gl_FrontFacing) n = -n;
    vec3 v = normalize(cameraPosition - vW);
    float h = clamp(vY / uTop, 0.0, 1.0);
    // Deeper toward the base, as turned wood darkens where it is handled least
    vec3 albedo = mix(uBase, uColor, smoothstep(0.02, 0.45, vY));
    float key = max(dot(n, uKey), 0.0);
    float fill = max(dot(n, uFill), 0.0);
    vec3 hemi = mix(uGround, uSky, 0.5 + 0.5 * n.y);
    // The lamp: under the pointer (and held) a warm light turns toward the
    // piece from the key's side
    vec3 light = uKeyColor * key * (1.0 + 0.45 * uWarm) + uFillColor * fill + hemi;
    light += uLamp * uWarm * (0.12 + 0.3 * key);
    vec3 col = albedo * light + albedo * uSelf;
    // A broad highlight, never a mirror
    vec3 hv = normalize(uKey + v);
    col += uKeyColor * pow(max(dot(n, hv), 0.0), uShine) * uSpec * key;
    // The army's edge light; from above a turned piece is nearly all edge to
    // this term, so it gives way there and the army keeps its own value
    float rim = pow(1.0 - abs(dot(n, v)), uRimPower);
    float fromAbove = mix(1.0, 0.35, smoothstep(0.55, 0.95, abs(v.y)));
    col = mix(col, uRim, clamp(uRimMix * rim * fromAbove, 0.0, 1.0));
    // In check, a thin red edge round the crown, and the foot caught by the
    // red of the king's square (only the foot: on ebony even a little red
    // light over the whole body would turn it wine-red)
    float low = 1.0 - smoothstep(0.0, 0.22, h);
    float under = 0.45 + 0.55 * clamp(0.5 - 0.5 * n.y, 0.0, 1.0);
    col += uCheckColor * uCheck * low * under * 0.1;
    float crown = rim * smoothstep(0.55, 0.8, h) * fromAbove;
    col = mix(col, uCheckColor, clamp(uCheck * crown * 0.3, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// The hall's lights as the wood sees them, in three's physical units: a
// light's colour times its intensity, over pi for a matte surface
const lit = (hex: string, intensity: number) => new Color(hex).multiplyScalar(intensity / Math.PI);
const LIGHTS = {
  uKeyColor: { value: lit('#fff0dc', 2.3) },
  uFillColor: { value: lit('#cfc8d8', 0.5) },
  uSky: { value: lit('#eadcc6', 0.62) },
  uGround: { value: lit('#3a2a1e', 0.62) },
  uLamp: { value: lit(PALETTE.lamp, 1.6) },
  uCheckColor: { value: new Color(PALETTE.check) },
};

interface Look {
  color: string;
  base: string;
  rim: string;
  rimMix: number;
  rimPower: number;
  spec: number;
  shine: number;
  self: number;
}

const BODY: Record<PieceColor, Look> = {
  white: {
    color: PALETTE.ivory,
    base: PALETTE.ivoryBase,
    rim: PALETTE.ivoryRim,
    rimMix: 0.45,
    rimPower: 2.6,
    spec: 0.26,
    shine: 26,
    self: 0.05,
  },
  black: {
    color: PALETTE.ebony,
    base: PALETTE.ebonyBase,
    rim: PALETTE.ebonyRim,
    rimMix: 0.5,
    rimPower: 2.4,
    spec: 0.34,
    shine: 34,
    self: 0.08,
  },
};

// The details that name a piece (the knight's mane and eyes, the bishop's
// cut, the unicorn's twist, the queen's pearls, the king's cross): walnut
// inlaid in ivory, dull bronze in ebony
const ACCENT: Record<PieceColor, Look> = {
  white: { ...BODY.white, color: PALETTE.ivoryAccent, base: PALETTE.ivoryAccent, rimMix: 0.3 },
  black: { ...BODY.black, color: PALETTE.ebonyAccent, base: PALETTE.ebonyAccent, rimMix: 0.35 },
};

// The rook's accent is its whole hollow: seen from above it is most of the
// piece, so it keeps its army's value, a shade deeper than the body
const WELL: Record<PieceColor, Look> = {
  white: { ...BODY.white, color: '#d9c9ae', base: '#d9c9ae', rimMix: 0.3 },
  black: { ...BODY.black, color: '#23180f', base: '#23180f', rimMix: 0.4 },
};

/**
 * A wood material of its own for one piece: it shares the rig and the lights
 * with every other piece (the uniform objects themselves), and keeps its own
 * warmth and check light, which ease per piece.
 */
const wood = (look: Look, top: number) =>
  new ShaderMaterial({
    uniforms: {
      ...LIGHTS,
      uKey: rig.key,
      uFill: rig.fill,
      uColor: { value: new Color(look.color) },
      uBase: { value: new Color(look.base) },
      uRim: { value: new Color(look.rim) },
      uRimMix: { value: look.rimMix },
      uRimPower: { value: look.rimPower },
      uSpec: { value: look.spec },
      uShine: { value: look.shine },
      uSelf: { value: look.self },
      uTop: { value: top },
      uWarm: { value: 0 },
      uCheck: { value: 0 },
    },
    vertexShader: woodVertex,
    fragmentShader: woodFragment,
  });

/** The materials of one piece: its body and its accent, lit together. */
export const pieceMaterials = (color: PieceColor, type: PieceType) => {
  const top = pieceTop(pieceSet(), type);
  return {
    body: wood(BODY[color], top),
    accent: wood(type === PieceType.Rook ? WELL[color] : ACCENT[color], top),
  };
};

// --- On the board, under the piece -------------------------------------------------

// One quad at the piece's foot draws everything that lies on the board: the
// contact shadow, the faint glow of the lamp under a hovered piece, and the
// held piece's pool of light in its hexagon with the ring it breathes out.
// It darkens and lights in one pass (premultiplied: the light adds, the
// shadow shades), in piece units.

const floorVertex = /* glsl */ `
  uniform float uQuad;
  varying vec2 vP;
  void main() {
    vP = position.xz * uQuad;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const floorFragment = /* glsl */ `
  uniform vec3 uLamp;
  uniform vec3 uRed;
  uniform float uShadow;
  uniform float uHover;
  uniform float uPool;
  uniform float uRing;
  uniform float uRingR;
  uniform float uRed2;
  uniform float uHex;
  uniform float uEdge;
  uniform float uSteep;
  varying vec2 vP;

  // iq's hexagon, r the inradius
  float hexagon(vec2 p, float r) {
    const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
    p = abs(p);
    p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
    p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
    return length(p) * sign(p.y);
  }

  void main() {
    float r = length(vP);
    // The contact shadow: dense under the base, gone by the square's middle
    float shadow = uShadow * (1.0 - smoothstep(0.06, 0.4, r)) * (1.0 - 0.6 * uPool);
    // The lamp's glow round a hovered piece's foot
    float glow = exp(-r * r / (0.34 * 0.34)) * 0.16 * uHover;
    // The held piece's pool, brightest just outside its foot, inside a fine
    // hexagon of the same light
    float hx = hexagon(vP, uHex);
    float fw = max(fwidth(hx), 1e-4);
    float w = max(0.012, fw * 0.8);
    float edge = (1.0 - smoothstep(w - fw, w + fw, abs(hx))) * min(0.012 / w, 1.0);
    float inside = 1.0 - smoothstep(-0.06, 0.0, hx);
    float pool = inside * (0.05 + 0.13 * exp(-pow((r - 0.3) / 0.16, 2.0))) + edge * 0.5 * uEdge;
    // From straight above the pool keeps its hexagon but quietens its fill
    pool *= mix(1.0, 0.75, uSteep);
    // The ring it breathes out when the lamp comes on
    float rh = hexagon(vP, uRingR);
    float rw = max(0.014, fwidth(rh));
    float ring = (1.0 - smoothstep(rw * 0.5, rw * 1.5, abs(rh))) * uRing;
    float light = glow + pool * uPool + ring;
    vec3 c = mix(uLamp, uRed, uRed2) * light;
    float a = shadow;
    if (a + light < 0.003) discard;
    gl_FragColor = vec4(c, a);
    #include <colorspace_fragment>
  }`;

const FLOOR_SIZE = 1.5;
const floorQuad = new PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE).rotateX(-Math.PI / 2);
/** The hexagon's inradius, piece units (just inside the square). */
const HEX = 0.43 / PIECE_SCALE;

const floorMaterial = () =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    uniforms: {
      uLamp: { value: new Color(PALETTE.lamp) },
      uRed: { value: new Color(PALETTE.check) },
      uShadow: { value: 0.42 },
      uHover: { value: 0 },
      uPool: { value: 0 },
      uRing: { value: 0 },
      uRingR: { value: HEX },
      uRed2: { value: 0 },
      uHex: { value: HEX },
      uEdge: { value: 1 },
      uQuad: { value: 1 },
      uSteep: steepness,
    },
    vertexShader: floorVertex,
    fragmentShader: floorFragment,
  });

// --- The halo -------------------------------------------------------------------------

// A soft disc of lamp light behind the held piece, drawn facing the viewer
// and pushed away from them so the piece stands in front of it. Seen from
// above it would lie round the piece like a ring on the board, so it belongs
// to side views and fades out toward top-down (the pool says it there).

const haloVertex = /* glsl */ `
  uniform float uSize;
  uniform float uHeight;
  uniform float uPush;
  varying vec2 vP;
  varying float vSide;
  void main() {
    vP = position.xy * 2.0;
    vec3 anchor = (modelMatrix * vec4(0.0, uHeight, 0.0, 1.0)).xyz;
    vSide = 1.0 - smoothstep(0.7, 0.9, abs(normalize(cameraPosition - anchor).y));
    vec4 centre = modelViewMatrix * vec4(0.0, uHeight, 0.0, 1.0);
    centre.xyz += normalize(centre.xyz) * uPush;
    centre.xy += position.xy * uSize;
    gl_Position = projectionMatrix * centre;
  }`;

const haloFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uGlow;
  varying vec2 vP;
  varying float vSide;
  void main() {
    float r = length(vP);
    // A soft disc with a gently brighter rim, fading out past it
    float disc = (1.0 - smoothstep(0.55, 0.95, r)) * (0.45 + 0.4 * smoothstep(0.2, 0.8, r));
    float rim = exp(-pow((r - 0.78) / 0.12, 2.0)) * 0.35;
    float a = (disc + rim) * uGlow * vSide;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }`;

const haloQuad = new PlaneGeometry(1, 1);

const haloMaterial = () =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uColor: { value: new Color(PALETTE.lamp) },
      uGlow: { value: 0 },
      uSize: { value: 0.9 },
      uHeight: { value: 0.4 },
      uPush: { value: 0.42 },
    },
    vertexShader: haloVertex,
    fragmentShader: haloFragment,
  });

// --- Motes -------------------------------------------------------------------------------

// A few motes of lamp light drifting slowly up from the held piece's pool,
// like dust in the light of a lamp: placed by the shader from one clock, so
// nothing is written per frame but a uniform.

const MOTES = 6;
const moteGeometry = (() => {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(MOTES * 3), 3));
  g.setAttribute(
    'aSeed',
    new BufferAttribute(
      Float32Array.from({ length: MOTES }, (_, i) => (i * 0.618034) % 1),
      1,
    ),
  );
  return g;
})();

const moteVertex = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uAlpha;
  uniform float uScale;
  uniform float uSize;
  varying float vA;
  void main() {
    float t = fract(uTime / 2.8 + aSeed);
    float ang = aSeed * 18.85 + uTime * 0.3;
    float r = 0.17 + 0.13 * fract(aSeed * 7.31);
    vec3 p = vec3(cos(ang) * r, 0.03 + t * 0.6, sin(ang) * r);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uScale / -mv.z;
    vA = sin(3.14159265 * t) * uAlpha;
  }`;

const moteFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.15, 1.0, d)) * vA;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }`;

const moteMaterial = () =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uColor: { value: new Color(PALETTE.lamp) },
      uTime: { value: 0 },
      uAlpha: { value: 0 },
      uScale: { value: 360 },
      uSize: { value: 0.12 },
    },
    vertexShader: moteVertex,
    fragmentShader: moteFragment,
  });

// --- The crown over a king in check ----------------------------------------------------

// A crown of red light seated just above the cross of a king in check: a thin
// ring set with twelve upright ticks, the quarters taller, like a clock's
// dial (the plate under the king keeps the time). It rides with the king
// when he is picked up, and goes out when he is mated. Piece units.

const CROWN_R = 0.18 / PIECE_SCALE;
const CROWN_LIFT = 0.035;
const crownGeometry = (() => {
  const parts: BufferGeometry[] = [new TorusGeometry(CROWN_R, 0.01, 5, 40).rotateX(Math.PI / 2)];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const tall = i % 3 === 0 ? 0.09 : 0.058;
    parts.push(
      new BoxGeometry(0.017, tall, 0.017)
        .rotateY(-a)
        .translate(Math.cos(a) * CROWN_R, tall / 2, Math.sin(a) * CROWN_R),
    );
  }
  for (const part of parts) {
    for (const name of Object.keys(part.attributes)) {
      if (name !== 'position') part.deleteAttribute(name);
    }
  }
  const merged = mergeGeometries(parts.map((part) => part.toNonIndexed()))!;
  parts.forEach((part) => part.dispose());
  return merged;
})();

const crownMaterial = () =>
  new MeshBasicMaterial({
    color: new Color(PALETTE.check),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
    fog: false,
  });

// --- The piece -----------------------------------------------------------------------

/** How long the lamp takes to come on when a piece is picked up (the flair). */
const ENTER_MS = 620;
/** How long it takes to go out when the piece is put down. */
const RELEASE_MS = 260;
/** How long hover's warmth, the foot's glow and the check light take to ease in or out. */
const EASE_MS = 200;

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const toward = (v: number, goal: number, step: number) =>
  goal > v ? Math.min(goal, v + step) : Math.max(goal, v - step);

const turn = new Quaternion();

// At rest (no pointer, no selection, no check) every piece of an army and
// kind shares one pair of wood materials and one shadow; a piece takes
// materials of its own only while something lights it, and gives them back
// once it has eased back to rest.
const restWood = new Map<string, ReturnType<typeof pieceMaterials>>();
const restMaterials = (color: PieceColor, type: PieceType) => {
  const key = `${color}/${type}`;
  let m = restWood.get(key);
  if (!m) {
    m = pieceMaterials(color, type);
    restWood.set(key, m);
  }
  return m;
};
let restShadow: ShaderMaterial | null = null;
const restFloor = () => (restShadow ??= floorMaterial());

/** The materials of a piece that is lit: its own, so its light eases alone. */
const litMaterials = (color: PieceColor, type: PieceType) => ({
  ...pieceMaterials(color, type),
  floor: floorMaterial(),
  halo: haloMaterial(),
  motes: moteMaterial(),
  crown: type === PieceType.King ? crownMaterial() : null,
});
type Lit = ReturnType<typeof litMaterials>;
const disposeLit = (m: Lit) => {
  m.body.dispose();
  m.accent.dispose();
  m.floor.dispose();
  m.halo.dispose();
  m.motes.dispose();
  m.crown?.dispose();
};

interface Glow {
  pool: number;
  glow: number;
  rise: number;
}

/**
 * A Staunton piece in ivory or ebony on its contact shadow, and (see the
 * top of this file) the lamp that warms it under the pointer and lights it
 * when picked up, with its release when put down; a king in check wears the
 * crown of red light.
 */
export const PieceBody = ({ type, color, selected, hovered, inCheck }: PieceBodyProps) => {
  const invalidate = useThree((s) => s.invalidate);
  const lit = selected || hovered || inCheck;
  const [active, setActive] = useState(lit);
  useLayoutEffect(() => {
    if (lit) setActive(true);
  }, [lit]);
  const own = useMemo(() => (active ? litMaterials(color, type) : null), [active, color, type]);
  useEffect(
    () => () => {
      if (own) disposeLit(own);
    },
    [own],
  );
  const rest = restMaterials(color, type);

  const top = pieceTop(pieceSet(), type);
  // Point sizes in pixels per unit of depth: half the drawing buffer's height
  const pointScale = useThree((st) => (st.size.height * st.viewport.dpr) / 2);
  const floorGroup = useRef<Group>(null);
  const floorMesh = useRef<Mesh>(null);
  const haloMesh = useRef<Mesh>(null);
  const moteMesh = useRef<Points>(null);
  const crownMesh = useRef<Mesh>(null);
  // Eased state: hover's warmth and the foot's glow, the check light and its
  // crown, and the lamp: a clock since it came on, what it showed last, and
  // a release that fades from wherever the lamp was when it was put down
  const s = useRef({
    warm: 0,
    foot: 0,
    check: 0,
    crown: 0,
    crownOut: 0,
    since: 0,
    held: false,
    release: 0,
    shown: { pool: 0, glow: 0, rise: 1 } as Glow,
    from: { pool: 0, glow: 0, rise: 1 } as Glow,
    resting: false,
  });
  useEffect(() => {
    // Picked up (again): the lamp comes on from the start
    if (selected) s.current.since = 0;
    invalidate();
  }, [selected, invalidate]);
  useEffect(() => {
    // Checked: the crown arrives
    if (inCheck) s.current.crown = 0;
    invalidate();
  }, [inCheck, invalidate]);
  useEffect(() => {
    s.current.resting = false;
    invalidate();
  }, [hovered, active, invalidate]);

  useFrame((_, delta) => {
    if (!own) return;
    const st = s.current;
    const dt = Math.min(delta, 1 / 20);
    const ease = dt / (EASE_MS / 1000);
    const still = prefersReducedMotion();
    let moving = false;
    const warmGoal = selected ? 1 : hovered ? 0.7 : 0;
    const footGoal = hovered && !selected ? 1 : 0;
    const checkGoal = inCheck ? 1 : 0;
    st.warm = toward(st.warm, warmGoal, ease);
    st.foot = toward(st.foot, footGoal, ease);
    st.check = toward(st.check, checkGoal, ease);
    moving ||= st.warm !== warmGoal || st.foot !== footGoal || st.check !== checkGoal;
    const check = st.check;

    let pool = 0;
    let ring = 0;
    let ringR = HEX;
    let rise = 1;
    let glow = 0;
    if (selected) {
      st.since = still ? ENTER_MS : Math.min(st.since + dt * 1000, ENTER_MS);
      if (st.since < ENTER_MS) moving = true;
      // The pool blooms a little past its rest and settles; the ring
      // breathes out once (once the pool has formed, so the two never
      // double); the halo rises from the foot and settles
      const bloom = Math.min(st.since / 220, 1);
      pool = easeOut(bloom) * (1 + 0.35 * Math.sin(Math.PI * Math.min(st.since / 480, 1)));
      const k = Math.min(Math.max(st.since - 120, 0) / 460, 1);
      ringR = HEX * (1.04 + 0.3 * easeOut(k));
      ring = still || st.since < 120 ? 0 : 0.5 * (1 - k) * Math.min((st.since - 120) / 60, 1);
      rise = easeOut(Math.min(st.since / 420, 1));
      glow = rise * (1 + 0.5 * Math.sin(Math.PI * Math.min(st.since / 520, 1)));
      st.held = true;
    } else if (st.held) {
      // Put down: the release starts from what the lamp was showing
      st.held = false;
      st.release = 1;
      st.from = { ...st.shown };
    }
    if (st.release > 0) {
      // A release still under way (also when picked up again) fades on
      st.release = Math.max(0, st.release - dt / (RELEASE_MS / 1000));
      const e = st.release * st.release;
      pool = Math.max(pool, st.from.pool * e);
      glow = Math.max(glow, st.from.glow * e);
      if (!selected) rise = st.from.rise * (0.85 + 0.15 * e);
      moving = true;
    }
    st.shown = { pool, glow, rise };

    const f = own.floor.uniforms;
    f.uHover.value = st.foot;
    f.uPool.value = pool;
    f.uRing.value = ring;
    f.uRingR.value = ringR;
    // A king in check keeps the red plate's square to itself: its pool
    // takes the red, and drops its hexagon, so the two never nest
    f.uRed2.value = check * 0.7;
    f.uEdge.value = 1 - check;
    // The quad grows while the lamp is on, to hold the ring it breathes out
    const quad = pool > 0 ? 1.5 : 1;
    f.uQuad.value = quad;
    floorMesh.current?.scale.setScalar(quad);
    const h = own.halo.uniforms;
    h.uGlow.value = glow * (1 - 0.5 * check) * 0.26;
    h.uHeight.value = top * (0.15 + 0.42 * rise);
    h.uSize.value = 0.5 + 0.28 * rise;
    if (haloMesh.current) haloMesh.current.visible = glow > 0.002;
    // The motes drift while the lamp is on (still, with reduced motion)
    const m = own.motes.uniforms;
    m.uAlpha.value = Math.min(pool, 1) * (1 - check) * 0.75;
    m.uScale.value = pointScale;
    if (pool > 0 && !still) {
      m.uTime.value += dt;
      moving = true;
    }
    if (moteMesh.current) moteMesh.current.visible = m.uAlpha.value > 0.002;
    for (const w of [own.body, own.accent]) {
      w.uniforms.uWarm.value = st.warm;
      w.uniforms.uCheck.value = check;
    }
    // The crown: it arrives settling from a little higher and wider with a
    // flash, then holds still; at mate it sinks a little and goes out
    if (own.crown) {
      st.crown += dt;
      const arrive = still ? 1 : easeOut(Math.min(st.crown / 0.35, 1));
      const flash = still ? 0 : Math.exp(-st.crown / 0.22);
      st.crownOut = mate.over ? Math.min(1, st.crownOut + dt / 0.7) : 0;
      if (st.crown < 1.2 || (mate.over && st.crownOut < 1)) moving = true;
      // (in at once with the check, out with the eased check light)
      const on = inCheck ? Math.min(1, st.crown / 0.06) : check;
      own.crown.opacity = on * (0.75 + 0.6 * flash) * (1 - st.crownOut);
      const c = crownMesh.current;
      if (c) {
        c.visible = own.crown.opacity > 0.003;
        c.scale.setScalar(1.35 - 0.35 * arrive);
        c.position.y = top + CROWN_LIFT + 0.12 * (1 - arrive) - 0.12 * st.crownOut;
      }
    }
    // The hexagon keeps square to the board, whichever way the piece faces
    const g = floorGroup.current;
    if (g?.parent && pool > 0) {
      g.parent.getWorldQuaternion(turn).invert();
      if (!g.quaternion.equals(turn)) g.quaternion.copy(turn);
    }
    if (moving) invalidate();
    // Back at rest: hand the shared materials back
    else if (!lit && !st.resting && st.warm === 0 && st.foot === 0 && check === 0) {
      st.resting = true;
      setActive(false);
    }
  });

  const wood = own ?? rest;
  return (
    <>
      <group ref={floorGroup} userData={ON_FLOOR}>
        <mesh
          ref={floorMesh}
          geometry={floorQuad}
          material={own?.floor ?? restFloor()}
          position={[0, 0.004, 0]}
          renderOrder={LAYER.shadow}
          raycast={noRaycast}
        />
        {own && (
          <points
            ref={moteMesh}
            geometry={moteGeometry}
            material={own.motes}
            visible={false}
            renderOrder={LAYER.trace + 0.4}
            raycast={noRaycast}
            frustumCulled={false}
          />
        )}
      </group>
      <ChessPiece type={type} parts={{ body: wood.body, accent: wood.accent }} />
      {own && (
        <mesh
          ref={haloMesh}
          geometry={haloQuad}
          material={own.halo}
          visible={false}
          renderOrder={LAYER.shadow - 0.5}
          raycast={noRaycast}
          frustumCulled={false}
        />
      )}
      {own?.crown && (
        <mesh
          ref={crownMesh}
          geometry={crownGeometry}
          material={own.crown}
          visible={false}
          position={[0, top + CROWN_LIFT, 0]}
          renderOrder={LAYER.trace + 0.3}
          raycast={noRaycast}
        />
      )}
    </>
  );
};

/** The whole piece as one geometry, for effects that redraw it. */
export const wholePiece = (type: PieceType): BufferGeometry =>
  partsGeometry(pieceSet(), type, PIECE_PARTS)!;
