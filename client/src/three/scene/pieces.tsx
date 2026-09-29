import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, PlaneGeometry, ShaderMaterial } from 'three';
import type { BufferGeometry } from 'three';
import { PieceType } from '../../engine/pieces';
import { prefersReducedMotion } from '../motion';
import { pieceTop, preloadPieceSet } from '../pieces';
import { LAYER } from './layers';
import { ON_FLOOR, useGlide } from '../pieceMotion';
import { noRaycast } from '../noRaycast';

import type { PieceBodyProps, PieceColor } from '../types';
import { bakedSet, preloadBakedSet, wholePiece as bakedPiece } from './occlusion';
import { LEVEL_COLORS, PALETTE } from './palette';
import { SelectionLight, selectState, stepSelection } from './selection';

// The armies: satin porcelain and charcoal, the shared Staunton set. Both are
// shaded by one small shader (headless browsers render in software, where
// the standard material is slow), one draw per piece: its body, collar,
// accent and foot are told apart by the part baked into each vertex, with the
// ambient occlusion baked beside it (occlusion.ts).
//
// The light rides with the camera, so the armies look the same from both
// seats and from above: a key high on the viewer's left, raking across the
// form so every edge has a lit side and a shadow side; a soft cool fill low
// on the right; and a dim cool kicker from behind on the right that edges
// the silhouette against the night. Crevices darken with the baked
// occlusion: the rook's well and the gaps of its battlements, the bishop's
// cut, the unicorn's twist, the knight's eye and mane, the coves under the
// collars.
//
// Porcelain is near white with a soft sheen. Charcoal is a clearly dark,
// lifted slate, matte with a restrained satin sheen; the parts that name a
// piece (its accent: the rook's sills and well, the bishop's cut, the
// unicorn's spiral, the queen's pearls, the king's cross, the knight's mane
// and eye) are a lighter satin pewter, so they catch the key where the body
// stays dark. Its edges are dim and cool, never white.
//
// The level: a thin band of the level's light round the foot (the set's foot
// part), passing through the colours of the levels crossed while the piece
// glides.
//
// Under the pointer a piece lifts a little, the key turns up on it, its band
// brightens, and a small soft light gathers on the glass under its base (it
// stays on the glass when the piece lifts: ON_FLOOR).
// Picked up, it lifts only a little more into its column of light
// (selection.tsx), lit faintly from below by it. In check, the whole king,
// cross and all, takes the red, and the red platform lights its base.

// Built and baked while the browser is idle, before the first board needs them
preloadPieceSet();
preloadBakedSet();

// --- The glaze ----------------------------------------------------------------------------

const glazeVertex = /* glsl */ `
  varying vec3 vN;
  varying float vUp;
  varying vec3 vW;
  varying vec3 vLocal;
  varying float vAo;
  varying float vPart;
  void main() {
    vLocal = position;
    vAo = uv.x;
    vPart = uv.y;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    vUp = normal.y;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const glazeFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uBase;
  uniform vec3 uAccent;
  uniform vec3 uWell;
  uniform vec3 uRim;
  uniform vec3 uBand;
  uniform vec3 uSelect;
  uniform vec3 uCheckColor;
  uniform vec3 uBurn;
  uniform float uKey;
  uniform float uFill;
  uniform float uAmbient;
  uniform float uKick;
  uniform float uRimMix;
  uniform float uRimPower;
  uniform float uSpec;
  uniform float uShine;
  uniform float uAccentSpec;
  uniform float uAccentShine;
  uniform float uOcc;
  uniform float uRelief;
  uniform float uTone;
  uniform float uEdge;
  uniform float uHover;
  uniform float uHold;
  uniform float uCheck;
  uniform float uTop;
  uniform float uCut;
  varying vec3 vN;
  varying float vUp;
  varying vec3 vW;
  varying vec3 vLocal;
  varying float vAo;
  varying float vPart;
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(
        mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
        mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x),
        f.y),
      mix(
        mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
        mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x),
        f.y),
      f.z);
  }
  void main() {
    float y = vLocal.y;
    float h = y / uTop;
    // A captured piece burns away from the crown down (uCut from 0 to 1;
    // below zero, whole)
    float burn = 1.0;
    if (uCut > -0.005) {
      float e = 0.7 * (1.0 - h) + 0.3 * noise(vLocal * 20.0) - uCut;
      if (e < 0.0) discard;
      burn = smoothstep(0.0, 0.05, e);
    }
    vec3 n = normalize(vN);
    if (!gl_FrontFacing) n = -n;
    vec3 v = normalize(cameraPosition - vW);
    // The rig rides with the camera (view space to world: the transpose)
    vec3 key = normalize((vec4(-0.62, 0.6, 0.5, 0.0) * viewMatrix).xyz);
    vec3 fill = normalize((vec4(0.8, -0.05, 0.6, 0.0) * viewMatrix).xyz);
    vec3 kick = normalize((vec4(0.7, 0.4, -0.6, 0.0) * viewMatrix).xyz);
    // The part (occlusion.ts): 0 body, 1 collar, 2 accent, 3 the rook's
    // well, 4 the foot band
    bool accent = abs(vPart - 2.0) < 0.5;
    bool well = abs(vPart - 3.0) <= 0.5;
    // (its side only: the cap under the foot, seen from below, stays the
    // body's, never a coloured disc under the piece)
    bool band = vPart > 3.5 && vUp > -0.5;
    float ao = mix(1.0, vAo, uOcc);
    // A touch deeper toward the foot
    vec3 albedo = accent ? uAccent : well ? uWell : mix(uBase, uColor, smoothstep(0.02, 0.42, y));
    albedo *= uTone;
    float kd = dot(n, key);
    // Wrapped a little: the shadow side turns away softly
    float lit = max((kd + 0.18) / 1.18, 0.0);
    float fd = max(dot(n, fill), 0.0);
    float sky = 0.5 + 0.5 * n.y;
    // Under the pointer the key turns up on it
    vec3 light = vec3(1.0, 0.985, 0.96) * lit * uKey * (1.0 + 0.32 * uHover) * mix(1.0, ao, 0.6)
      + vec3(0.72, 0.8, 1.0) * fd * uFill * ao
      + mix(vec3(0.13, 0.14, 0.17), vec3(0.4, 0.42, 0.47), sky) * uAmbient * ao;
    // Held, the column lights its lower body faintly from below
    float low = 1.0 - smoothstep(0.0, 0.55, h);
    float under = 0.5 + 0.5 * clamp(0.35 - n.y, 0.0, 1.0);
    light += uSelect * uHold * low * under * 0.4 * ao;
    // The carving's own relief, from how fast the surface turns under each
    // pixel: rounded edges catch a little more light, coves a little less,
    // so the collars, the battlements and the coronet read at a glance
    vec3 dpx = dFdx(vW);
    vec3 dpy = dFdy(vW);
    float curve = 0.5 * (dot(dFdx(n), dpx) / max(dot(dpx, dpx), 1e-12)
      + dot(dFdy(n), dpy) / max(dot(dpy, dpy), 1e-12));
    light *= 1.0 + uRelief * clamp(curve * 0.012, -0.7, 0.7);
    vec3 col = albedo * light;
    // A soft satin highlight, never a mirror; the accent's a little crisper
    vec3 hv = normalize(key + v);
    float spec = pow(max(dot(n, hv), 0.0), accent ? uAccentShine : uShine);
    col += vec3(1.0, 0.99, 0.97) * spec * (accent ? uAccentSpec : uSpec) * max(kd, 0.0) * ao;
    float facing = abs(dot(n, v));
    // Seen from above, a piece is almost all edge: the edges give way there
    float fromAbove = mix(1.0, 0.3, smoothstep(0.55, 0.95, abs(v.y)));
    // The kicker: a cool edge on the side away from the key
    float kk = max(dot(n, kick), 0.0) * pow(1.0 - facing, 1.4);
    col += uRim * kk * uKick * uEdge * ao * fromAbove;
    // The army's own rim, all round
    float rim = pow(1.0 - facing, uRimPower) * fromAbove;
    col = mix(col, uRim, clamp(uRimMix * uEdge * rim * ao, 0.0, 1.0));
    // The band at the foot: a strip of its level's light, lit a little
    if (band) {
      col = uBand * (0.62 + 0.3 * lit + 0.28 * uHover + 0.2 * uHold) * mix(1.0, ao, 0.35);
    }
    // In check the whole king takes the red, keeping its army's value, its
    // edge burns red, and the red platform under it lights its base
    if (uCheck > 0.0) {
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      // Lit from below: reddest at the base, the cross still clearly red
      float up = (1.0 - smoothstep(0.0, 0.45, h)) * (0.45 + 0.55 * clamp(0.4 - n.y, 0.0, 1.0));
      col = mix(col, uCheckColor * (lum * 1.45 + 0.012), uCheck * (0.5 + 0.3 * up));
      col += uCheckColor * uCheck * up * (0.08 + 0.5 * lum) * ao;
      col = mix(col, uCheckColor, clamp(uCheck * 0.5 * pow(1.0 - facing, 2.2) * fromAbove, 0.0, 1.0));
    }
    // The burning edge: a thin line of white light
    col = mix(uBurn, col, burn);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

interface Glaze {
  color: string;
  base: string;
  accent: string;
  /** The floor of the rook's well. */
  well: string;
  rim: string;
  key: number;
  fill: number;
  ambient: number;
  /** How light the albedo is. */
  tone: number;
  /** How strong the cool light along the edges is. */
  edge: number;
  /** The cool kicker from behind (charcoal only). */
  kick: number;
  rimMix: number;
  rimPower: number;
  spec: number;
  shine: number;
  accentSpec: number;
  accentShine: number;
  /** How much of the baked occlusion shows. */
  occlusion: number;
  /** How much the surface's curvature lightens edges and darkens coves. */
  relief: number;
}

const GLAZE: Record<PieceColor, Glaze> = {
  white: {
    color: PALETTE.porcelain,
    base: PALETTE.porcelainBase,
    accent: PALETTE.porcelainAccent,
    well: PALETTE.porcelainWell,
    rim: PALETTE.porcelainRim,
    key: 0.95,
    fill: 0.2,
    ambient: 0.72,
    tone: 1,
    edge: 1,
    kick: 0,
    rimMix: 0.24,
    rimPower: 2.6,
    spec: 0.2,
    shine: 18,
    accentSpec: 0.24,
    accentShine: 24,
    occlusion: 0.55,
    relief: 0.15,
  },
  black: {
    color: PALETTE.charcoal,
    base: PALETTE.charcoalBase,
    accent: PALETTE.charcoalAccent,
    well: PALETTE.charcoalWell,
    rim: PALETTE.charcoalRim,
    key: 1.6,
    fill: 0.26,
    ambient: 0.4,
    tone: 0.8,
    edge: 1.1,
    kick: 0.9,
    rimMix: 0.2,
    rimPower: 3,
    spec: 0.1,
    shine: 10,
    accentSpec: 0.3,
    accentShine: 22,
    occlusion: 0.85,
    relief: 0.35,
  },
};

const levelColors = LEVEL_COLORS.map((c) => new Color(c));

/** The colour of a fractional level, through the levels in between. */
const colorAtLevel = (level: number, out: Color) => {
  const l = Math.min(Math.max(level, 0), levelColors.length - 1);
  const k = Math.floor(l);
  const t = l - k;
  return out.copy(levelColors[k]).lerp(levelColors[Math.min(k + 1, levelColors.length - 1)], t);
};

/**
 * A piece's own material (its hover, hold, check and band ease on their
 * own). Its foot band shows the light of `level`.
 */
const bodyMaterial = (color: PieceColor, type: PieceType, level: number) => {
  const g = GLAZE[color];
  // The charcoal knight's accent is its whole carved mane, many small faces
  // turned to the key: a shade deeper and less glossy, so it stays pewter
  const mane = color === 'black' && type === PieceType.Knight;
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(g.color) },
      uBase: { value: new Color(g.base) },
      uAccent: { value: new Color(g.accent).multiplyScalar(mane ? 0.8 : 1) },
      uWell: { value: new Color(g.well) },
      uRim: { value: new Color(g.rim) },
      uBand: { value: colorAtLevel(level, new Color()) },
      uSelect: { value: new Color(PALETTE.select) },
      uCheckColor: { value: new Color(PALETTE.check) },
      uBurn: { value: new Color(PALETTE.light).multiplyScalar(1.4) },
      uKey: { value: g.key },
      uFill: { value: g.fill },
      uAmbient: { value: g.ambient },
      uKick: { value: g.kick },
      uRimMix: { value: g.rimMix },
      uRimPower: { value: g.rimPower },
      uSpec: { value: g.spec },
      uShine: { value: g.shine },
      uAccentSpec: { value: g.accentSpec * (mane ? 0.35 : 1) },
      uAccentShine: { value: g.accentShine },
      uOcc: { value: g.occlusion },
      uRelief: { value: g.relief },
      uTone: { value: g.tone },
      uEdge: { value: g.edge },
      uHover: { value: 0 },
      uHold: { value: 0 },
      uCheck: { value: 0 },
      uTop: { value: pieceTop(bakedSet(), type) },
      uCut: { value: -1 },
    },
    vertexShader: glazeVertex,
    fragmentShader: glazeFragment,
  });
};

/** The whole piece as one geometry, its occlusion and parts baked in (occlusion.ts). */
export const wholePiece = (type: PieceType): BufferGeometry => bakedPiece(type);

/**
 * A piece's own material, disposed with the caller: what PieceBody draws, and
 * what an effect that redraws a piece (a capture) should use so the piece
 * looks the same.
 */
export const usePieceMaterial = (color: PieceColor, type: PieceType, level: number) => {
  const material = useMemo(() => bodyMaterial(color, type, level), [color, type, level]);
  useEffect(() => () => material.dispose(), [material]);
  return material;
};

// --- The hover light on the glass -------------------------------------------------------------

// A small soft light inside the base of a hovered piece, in its level's colour
// (LEVEL_COLORS, blended between levels while gliding) lifted toward white.

const poolVertex = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const poolFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uPool;
  varying vec2 vP;
  void main() {
    float r = length(vP);
    float a = exp(-r * r / (0.13 * 0.13)) * (1.0 - smoothstep(0.16, 0.24, r)) * 0.4 * uPool;
    if (a < 0.003) discard;
    gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.5), min(a, 1.0));
    #include <colorspace_fragment>
  }`;

const poolPlane = new PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2);

const poolMaterial = (level: number) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    uniforms: {
      uColor: { value: colorAtLevel(level, new Color()) },
      uPool: { value: 0 },
    },
    vertexShader: poolVertex,
    fragmentShader: poolFragment,
  });

// --- The piece -------------------------------------------------------------------------------

/** Rates of the eases (per second): hover in, hold, the check light. */
const HOVER_RATE = 1 / 0.18;
const HOLD_RATE = 1 / 0.28;
const CHECK_RATE = 1 / 0.25;
const smooth = (x: number) => x * x * (3 - 2 * x);

/**
 * A Staunton piece in porcelain or charcoal, with its level band, its light on
 * the glass under the pointer, and its column of light when held. PieceMesh's
 * Lift raises it.
 */
export const PieceBody = (props: PieceBodyProps) => {
  const { type, color, selected, hovered, inCheck } = props;
  const level = props.level ?? 0;
  const invalidate = useThree((s) => s.invalidate);
  const glide = useGlide();
  const still = useMemo(prefersReducedMotion, []);

  // (its band's colour is set every frame: one material whatever the level)
  const body = usePieceMaterial(color, type, 0);
  const floorMaterial = useMemo(() => poolMaterial(level), [level]);
  useEffect(() => () => floorMaterial.dispose(), [floorMaterial]);
  const top = pieceTop(bakedSet(), type);

  // Eased weights; the floor light and the held light are mounted only while
  // they show
  const weights = useRef({ hover: 0, hold: 0, check: 0 });
  const held = useRef(selectState());
  const [awake, setAwake] = useState(false);
  const [lit, setLit] = useState(false);
  if ((hovered || selected) && !awake) setAwake(true);
  if (selected && !lit) setLit(true);
  useEffect(() => invalidate(), [hovered, selected, inCheck, invalidate]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const w = weights.current;
    const toward = (v: number, goal: number, rate: number) =>
      goal > v ? Math.min(goal, v + dt * rate) : Math.max(goal, v - dt * rate);
    const hover = toward(w.hover, hovered && !selected ? 1 : 0, HOVER_RATE);
    const hold = toward(w.hold, selected ? 1 : 0, HOLD_RATE);
    const c = toward(w.check, inCheck ? 1 : 0, CHECK_RATE);
    let moving = hover !== w.hover || hold !== w.hold || c !== w.check;
    w.hover = hover;
    w.hold = hold;
    w.check = c;
    const showing = stepSelection(held.current, selected, dt * 1000, still);
    const u = body.uniforms;
    u.uHover.value = smooth(hover);
    u.uHold.value = smooth(hold) * held.current.strength;
    u.uCheck.value = smooth(c);
    const f = floorMaterial.uniforms;
    f.uPool.value = smooth(hover);
    // While gliding, the band and the pool pass through the colours of the
    // levels crossed
    if (glide) {
      const p = glide.progress.current;
      const l = glide.fromLevel + (glide.toLevel - glide.fromLevel) * p;
      colorAtLevel(l, f.uColor.value);
      colorAtLevel(l, u.uBand.value);
    } else {
      colorAtLevel(level, f.uColor.value);
      colorAtLevel(level, u.uBand.value);
    }
    if (showing) moving = true;
    if (moving) invalidate();
    else {
      if (awake && !hovered && !selected && hover === 0 && hold === 0) setAwake(false);
      if (lit && !showing) setLit(false);
    }
  });

  return (
    <>
      <group userData={ON_FLOOR}>
        {awake && (
          <mesh
            geometry={poolPlane}
            material={floorMaterial}
            position={[0, 0.005, 0]}
            renderOrder={LAYER.shadow}
            raycast={noRaycast}
          />
        )}
        {lit && <SelectionLight state={held} top={top} />}
      </group>
      <mesh geometry={wholePiece(type)} material={body} />
    </>
  );
};
