import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  PlaneGeometry,
  PointsMaterial,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { Group } from 'three';
import { PieceType } from '../../../engine/pieces';
import { ChessPiece, PIECE_PARTS, partsGeometry, pieceSet, pieceTop } from '../../pieces';
import { LAYER } from '../kit/layers';
import { ON_FLOOR, useGlide } from '../kit/motion';
import { noRaycast } from '../kit/noRaycast';
import { dotTexture, rng } from '../kit/textures';
import type { PieceBodyProps, PieceColor } from '../types';
import { claimAt } from './claims';
import { HEX, LEVEL_COLORS, PALETTE, PIECE_SCALE } from './palette';
import { steepness } from './plates';

// Hard-light ceramic: solid, matte, opaque bodies, pearl and graphite-violet.
// Pearl takes a pale silver edge and deep indigo inlays; graphite takes a
// dim, cool steel edge and muted lilac inlays, so the dark army shows its
// form without ever reading as light (Lumen's bright lilac rim made it read
// as white from some angles). Each body deepens toward its base.
//
// Every piece stands in a hexagon of its level's light, lying on the pane
// (ON_FLOOR: it stays down when the piece lifts). Its colour travels with
// the piece: gliding from one level to another, the hexagon passes through
// the colours of the levels between, as the piece passes them. Under the
// pointer it brightens gently. Picked up, the projector answers: a soft cone
// of pale gold light rises from the pane round the piece's foot, a few motes
// drifting up in it, while the hexagon warms toward gold, a spark of light
// drawing once round its outline. Seen from above, where the cone gives way,
// its footprint takes over: a soft pool of the same gold in the hexagon. Let
// go, the cone sinks back into the pane and the hexagon settles.
//
// The rim is computed from the view, so it wraps every piece the same way
// from both seats and from above. Materials are shared by every piece of an
// army and state; the hexagon is the piece's own (it animates).

export type Glow = 'none' | 'hover' | 'check';

// --- The ceramic shader ------------------------------------------------------------------

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
  uniform vec3 uLow;
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
    // The army's light along the silhouette. Seen from above, a turned piece
    // is nearly all silhouette to this term; it gives way there, so an army
    // keeps its own colour from any height
    float rim = pow(1.0 - abs(dot(n, v)), uRimPower);
    float fromAbove = mix(1.0, 0.35, smoothstep(0.55, 0.95, abs(v.y)));
    rim *= fromAbove;
    col = mix(col, uRim, clamp(uRimMix * rim, 0.0, 1.0));
    // A state's light (hover's, check's red) on the edge of the top third only
    float crown = pow(1.0 - abs(dot(n, v)), uCrownPower) * fromAbove;
    crown *= smoothstep(0.55, 0.75, vY / uTop);
    col = mix(col, uCrown, clamp(uCrownMix * crown, 0.0, 1.0));
    // A faint light shining up from the pane onto the foot (check's red)
    col += uLow * pow(1.0 - clamp(vY / (uTop * 0.45), 0.0, 1.0), 1.5);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// The studio's lights as the ceramic sees them, in three's physical units
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
  /** Light shining up onto the foot from the pane (check). */
  low?: Color;
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
      uLow: { value: o.low ?? new Color(0, 0, 0) },
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
  rimMix: number;
  rimPower: number;
  /** Hover's light on the top third's edge. */
  hover: { color: string; mix: number; power: number };
}

const LOOK: Record<PieceColor, Look> = {
  white: {
    color: PALETTE.white,
    base: PALETTE.whiteBase,
    rim: PALETTE.whiteRim,
    self: 0.04,
    spec: 0.3,
    rimMix: 0.5,
    rimPower: 2.6,
    hover: { color: '#ffffff', mix: 0.4, power: 1.8 },
  },
  black: {
    color: PALETTE.black,
    base: PALETTE.blackBase,
    rim: PALETTE.blackRim,
    self: 0.06,
    spec: 0.32,
    rimMix: 0.55,
    rimPower: 2.3,
    // A little more of its own cool edge: never a pale one
    hover: { color: '#8a95b6', mix: 0.45, power: 1.8 },
  },
};

const makeBody = (side: PieceColor, glow: Glow, type: PieceType) => {
  const look = LOOK[side];
  // Hover and check light a piece's top edge only, never its body: the body
  // keeps its army's colour and form
  const crown =
    glow === 'check'
      ? { color: PALETTE.check, mix: 0.5, power: 3 }
      : glow === 'hover'
        ? look.hover
        : undefined;
  return ceramic({
    color: look.color,
    base: look.base,
    rim: look.rim,
    rimMix: look.rimMix,
    rimPower: look.rimPower,
    emissive: new Color(look.color).multiplyScalar(look.self),
    spec: look.spec,
    top: pieceTop(pieceSet(), type),
    crown,
    // In check, the king's red platform lights his foot a little
    low: glow === 'check' ? new Color(PALETTE.check).multiplyScalar(0.12) : undefined,
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

// The inlays: deep indigo cut into pearl; muted lilac set into graphite
const accents: Record<PieceColor, ShaderMaterial> = {
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
    rimMix: 0.35,
    rimPower: 2.2,
    emissive: new Color(PALETTE.blackInlay).multiplyScalar(0.35),
    spec: 0.2,
  }),
};

// The rook's accent is its whole hollow (and sills): seen from above it is
// most of the piece, so it keeps its own army's value
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
    color: '#221e30',
    rim: PALETTE.blackRim,
    rimMix: 0.4,
    rimPower: 2.2,
    emissive: new Color(PALETTE.blackRim).multiplyScalar(0.04),
    spec: 0.3,
  }),
};
const accentOf = (type: PieceType, color: PieceColor) =>
  type === PieceType.Rook ? wells[color] : accents[color];

const glowOf = ({ inCheck, hovered, selected }: PieceBodyProps): Glow =>
  inCheck ? 'check' : hovered && !selected ? 'hover' : 'none';

// --- The hexagon ---------------------------------------------------------------------

// One quad on the pane, square to the board, shaded by a signed distance:
// the hexagon's thread of light, a soft halo, a faint contact shadow under
// the piece, and, under the pointer or picked up, a soft glow within.

const hexVertex = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

/** GLSL: iq's hexagon (r the inradius, flat sides along x). */
export const HEXAGON_SDF = /* glsl */ `
  float hexagon(vec2 p, float r) {
    const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
    p = abs(p);
    p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
    p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
    return length(p) * sign(p.y);
  }`;

const hexFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uSelect;
  uniform float uR;
  uniform float uWidth;
  uniform float uHover;
  uniform float uSel;
  uniform float uDraw;
  uniform float uShow;
  uniform float uSteep;
  varying vec2 vP;
  ${HEXAGON_SDF}
  void main() {
    // The quad lies in x and z; the hexagon's flat sides face the ranks
    vec2 p = vec2(vP.x, vP.y);
    float r = length(p);
    float d = hexagon(p, uR);
    float fw = max(fwidth(d), 1e-4);
    float w = max(uWidth, fw * 0.75);
    float line = (1.0 - smoothstep(w - fw, w + fw, abs(d))) * min(uWidth / w, 1.0);
    float halo = exp(-d * d / (0.035 * 0.035)) * 0.13;
    // A faint contact shadow: the piece stands on the pane (from above,
    // where it would tint the hexagon into a tile, it all but goes)
    float shadow = 0.5 * (1.0 - smoothstep(0.08, uR * 0.95, r)) * (1.0 - 0.7 * uSteep);
    // Picked up, a spark draws once round the outline, lighting it as it goes
    float along = fract(atan(p.x, -p.y) / 6.2831853 + 1.0);
    float behind = step(along, uDraw);
    float gap = uDraw - along;
    float head = exp(-gap * gap / 0.0016) * step(0.0, gap) * step(uDraw, 0.999);
    float lift = 1.0 + 0.35 * uHover + 0.6 * uSel * behind;
    float light = (line * (0.58 + head * 1.6) + halo * (1.0 + 1.0 * uHover + 1.2 * uSel)) * lift;
    // Within: a soft glow of its level's light under the pointer or the hand
    float inside = 1.0 - smoothstep(-0.02, 0.01, d);
    float within = inside * (0.07 * uHover + 0.06 * uSel) * (0.4 + 0.6 * smoothstep(0.0, uR, r));
    light = min((light + within) * uShow, 1.0);
    // Held and seen from above, where the cone gives way, its footprint: a
    // soft pool of the projector's gold filling the hexagon
    float pool = inside * uSel * uSteep * 0.22 * (0.5 + 0.5 * smoothstep(0.0, uR, r)) * uShow;
    float a = max(shadow * uShow, min(light + pool, 1.0));
    if (a < 0.003) discard;
    // Held, the outline warms toward the projector's gold, the more so from above
    vec3 col = mix(uColor, vec3(1.0), 0.12 * uHover);
    col = mix(col, uSelect, uSel * behind * (0.35 + 0.35 * uSteep));
    col = mix(col, uSelect, clamp(head * 0.8, 0.0, 1.0));
    gl_FragColor = vec4((col * light + uSelect * pool) / max(a, 1e-4), a);
    #include <colorspace_fragment>
  }`;

const hexPlane = new PlaneGeometry(1.2, 1.2).rotateX(-Math.PI / 2);
const levelColors = LEVEL_COLORS.map((c) => new Color(c));
/** A level's colour at a fractional level: between two levels, their blend. */
const colorAtLevel = (target: Color, level: number) => {
  const k = Math.min(Math.max(level, 0), levelColors.length - 1);
  const i = Math.min(Math.floor(k), levelColors.length - 2);
  return target.copy(levelColors[i]).lerp(levelColors[i + 1], k - i);
};

const DRAW_MS = 520;
const HOVER_MS = 180;
const SELECT_MS = 260;
const RELEASE_MS = 260;

const turn = new Quaternion();
const at = new Vector3();

/**
 * The hexagon at the piece's foot. It lies on the pane (Board's Lift keeps its
 * group down), square to the board whatever way the piece faces.
 */
const Hexagon = ({
  level,
  hovered,
  selected,
}: {
  level: number;
  hovered: boolean;
  selected: boolean;
}) => {
  const invalidate = useThree((s) => s.invalidate);
  const glide = useGlide();
  const square = useRef<Group>(null);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        uniforms: {
          uColor: { value: new Color(LEVEL_COLORS[level]) },
          uSelect: { value: new Color(PALETTE.select) },
          uR: { value: HEX / PIECE_SCALE },
          uWidth: { value: 0.011 / PIECE_SCALE },
          uHover: { value: 0 },
          uSel: { value: 0 },
          uDraw: { value: 1 },
          uShow: { value: 1 },
          uSteep: steepness,
        },
        vertexShader: hexVertex,
        fragmentShader: hexFragment,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one per piece; the level is set each frame
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const state = useRef({ hover: 0, sel: 0, draw: 1, show: 1 });
  // Every new selection draws the outline again
  useEffect(() => {
    if (selected) state.current.draw = 0;
    invalidate();
  }, [selected, invalidate]);
  useEffect(() => invalidate(), [hovered, level, invalidate]);

  useFrame((_, delta) => {
    const g = square.current;
    if (!g?.parent) return;
    const s = state.current;
    const u = material.uniforms;
    const dt = Math.min(delta, 1 / 20) * 1000;
    let moving = false;
    const toward = (v: number, goal: number, ms: number) => {
      const next = goal > v ? Math.min(goal, v + dt / ms) : Math.max(goal, v - dt / ms);
      if (next !== goal) moving = true;
      return next;
    };
    s.hover = toward(s.hover, hovered ? 1 : 0, HOVER_MS);
    s.sel = toward(s.sel, selected ? 1 : 0, selected ? SELECT_MS : RELEASE_MS);
    s.draw = toward(s.draw, 1, DRAW_MS);
    // Eased for the eye; the ramps above are linear in time
    const ease = (x: number) => x * x * (3 - 2 * x);
    u.uHover.value = ease(s.hover);
    u.uSel.value = ease(s.sel);
    u.uDraw.value = 1 - (1 - s.draw) ** 2;
    // Square to the board, whatever way the piece is turned
    g.parent.getWorldQuaternion(turn).invert();
    if (!g.quaternion.equals(turn)) g.quaternion.copy(turn);
    // The colour of the level it is passing, while it glides
    const k = glide
      ? glide.fromLevel + (glide.toLevel - glide.fromLevel) * glide.progress.current
      : level;
    colorAtLevel(u.uColor.value as Color, k);
    if (glide && glide.progress.current < 1) moving = true;
    // Stepping aside for a marker that has taken this square's hexagon over
    g.getWorldPosition(at);
    // (a held king in check keeps its own hexagon: its spark and light show
    // over the check's platform)
    s.show = toward(
      s.show,
      claimAt(at.x, at.y, at.z, undefined, selected ? 'check' : undefined) ? 0 : 1,
      120,
    );
    u.uShow.value = s.show;
    if (moving) invalidate();
  });

  return (
    <group ref={square}>
      <mesh
        geometry={hexPlane}
        material={material}
        position={[0, 0.005, 0]}
        renderOrder={LAYER.shadow}
        raycast={noRaycast}
      />
    </group>
  );
};

// --- The projector's answer: a cone of light -----------------------------------------------

const CONE_HEIGHT = 0.64;
// Inside the hexagon, so its foot never draws a circle round it; narrowing
// as it rises, like light, not a cup
const CONE_BOTTOM = HEX / PIECE_SCALE - 0.03;
const CONE_TOP = CONE_BOTTOM * 0.6;
const coneGeometry = new CylinderGeometry(
  CONE_TOP,
  CONE_BOTTOM,
  CONE_HEIGHT,
  48,
  1,
  true,
).translate(0, CONE_HEIGHT / 2, 0);

const coneVertex = /* glsl */ `
  uniform float uHeight;
  varying float vH;
  varying float vAngle;
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    vH = position.y / uHeight;
    vAngle = atan(position.z, position.x);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const coneFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uReach;
  uniform float uStrength;
  uniform float uTime;
  varying float vH;
  varying float vAngle;
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    if (vH > uReach) discard;
    vec3 v = normalize(cameraPosition - vWorld);
    float facing = abs(dot(normalize(vNormal), v));
    // Brighter toward its edges, clear in front of the piece: soft light,
    // not a glass cup
    float edge = pow(1.0 - facing, 2.4);
    // Rising from the pane, fading upward and at its (growing) top
    float fade = pow(1.0 - vH, 2.4) * (1.0 - smoothstep(uReach - 0.45, uReach, vH));
    // No rim: the edge light gives out over the top 30% of its reach
    edge *= 1.0 - smoothstep(0.7 * uReach, uReach, vH);
    // Projected light: fine striations round the cone, drifting very slowly
    float rays = 0.5 + 0.5 * sin(vAngle * 18.0 + 1.7 * sin(vAngle * 5.0 + uTime * 0.2));
    rays = mix(0.78, 1.0, rays);
    float skirt = exp(-vH / 0.04) * 0.12;
    // From straight above the cone's wall would lie round the piece as a ring
    float side = 1.0 - 0.8 * smoothstep(0.7, 0.97, abs(v.y));
    // Faint bands of light rising slowly up through it
    float bands = 0.8 + 0.2 * sin((vH * 4.0 - uTime * 0.35) * 6.2831853);
    float a = ((0.05 + 0.42 * edge) * fade * rays * bands + skirt) * uStrength * side;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <colorspace_fragment>
  }`;

const MOTES = 7;
let moteTexture: ReturnType<typeof dotTexture> | null = null;

const ENTER_MS = 420;

/**
 * The cone, grown when the piece is picked up and sunk back when it is let
 * go (`held`); it calls `onGone` once it has sunk.
 */
const SelectionCone = ({ held, onGone }: { held: boolean; onGone: () => void }) => {
  const invalidate = useThree((s) => s.invalidate);
  const k = useRef(0);
  const clock = useRef(0);
  const flair = useRef(0);
  const gone = useRef(false);
  const { material, motes, seeds, moteMaterial } = useMemo(() => {
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
      uniforms: {
        uColor: { value: new Color(PALETTE.select) },
        uReach: { value: 0 },
        uStrength: { value: 0 },
        uTime: { value: 0 },
        uHeight: { value: CONE_HEIGHT },
      },
      vertexShader: coneVertex,
      fragmentShader: coneFragment,
    });
    const random = rng(5);
    const seeds = Array.from({ length: MOTES }, () => ({
      angle: random() * Math.PI * 2,
      radius: 0.08 + random() * 0.18,
      phase: random(),
      speed: 0.09 + random() * 0.08,
    }));
    const motes = new BufferGeometry();
    motes.setAttribute('position', new BufferAttribute(new Float32Array(MOTES * 3), 3));
    motes.setAttribute('color', new BufferAttribute(new Float32Array(MOTES * 3), 3));
    const moteMaterial = new PointsMaterial({
      size: 0.05,
      map: (moteTexture ??= dotTexture(0.8)),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      sizeAttenuation: true,
    });
    return { material, motes, seeds, moteMaterial };
  }, []);
  useEffect(
    () => () => {
      material.dispose();
      motes.dispose();
      moteMaterial.dispose();
    },
    [material, motes, moteMaterial],
  );
  useEffect(() => {
    if (held) flair.current = 0;
    invalidate();
  }, [held, invalidate]);
  const tint = useMemo(() => new Color(PALETTE.select), []);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    clock.current += dt;
    const ms = dt * 1000;
    k.current = held
      ? Math.min(1, k.current + ms / ENTER_MS)
      : Math.max(0, k.current - ms / RELEASE_MS);
    flair.current = Math.min(1, flair.current + ms / 900);
    if (!held && k.current <= 0) {
      if (!gone.current) onGone();
      gone.current = true;
      return;
    }
    gone.current = false;
    const grow = 1 - (1 - k.current) ** 3;
    // A moment of flair as it rises (brighter, then settling), none as it sinks
    const f = held ? Math.sin(Math.PI * Math.min(flair.current * 1.3, 1)) : 0;
    const u = material.uniforms;
    u.uReach.value = grow * 1.02;
    u.uStrength.value = (0.55 + 0.45 * f) * (held ? 1 : grow);
    u.uTime.value = clock.current;
    const pos = motes.getAttribute('position') as BufferAttribute;
    const col = motes.getAttribute('color') as BufferAttribute;
    seeds.forEach((s, i) => {
      const h = (s.phase + clock.current * s.speed) % 1;
      const y = h * CONE_HEIGHT * 0.9 * grow;
      const r = s.radius * (1 - 0.3 * h);
      const a = s.angle + clock.current * 0.25;
      pos.setXYZ(i, Math.cos(a) * r, y, Math.sin(a) * r);
      const b = Math.sin(Math.PI * h) * 0.9 * grow;
      col.setXYZ(i, tint.r * b, tint.g * b, tint.b * b);
    });
    pos.needsUpdate = true;
    col.needsUpdate = true;
    invalidate();
  });
  return (
    <>
      <mesh
        geometry={coneGeometry}
        material={material}
        renderOrder={LAYER.trace}
        raycast={noRaycast}
      />
      <points
        geometry={motes}
        material={moteMaterial}
        renderOrder={LAYER.trace + 0.1}
        raycast={noRaycast}
        frustumCulled={false}
      />
    </>
  );
};

// --- The piece -----------------------------------------------------------------------

/**
 * A Staunton piece in hard-light ceramic, standing in its hexagon of level
 * light, and, while picked up (and briefly after), in the projector's cone.
 */
export const PieceBody = (props: PieceBodyProps) => {
  const level = props.level ?? 0;
  const body = bodyMaterial(props.color, glowOf(props), props.type);
  // The cone stays up after the piece is let go, until it has sunk away
  const [cone, setCone] = useState(false);
  useEffect(() => {
    if (props.selected) setCone(true);
  }, [props.selected]);
  return (
    <>
      <group userData={ON_FLOOR}>
        <Hexagon level={level} hovered={props.hovered} selected={props.selected} />
        {cone && <SelectionCone held={props.selected} onGone={() => setCone(false)} />}
      </group>
      <ChessPiece
        type={props.type}
        // The foot band is the body's own: the hexagon says the level
        parts={{ body, accent: accentOf(props.type, props.color), foot: body }}
      />
    </>
  );
};

/** The whole piece as one geometry, for effects that redraw it (echoes, dissolves). */
export const wholePiece = (type: PieceType): BufferGeometry =>
  partsGeometry(pieceSet(), type, PIECE_PARTS)!;
