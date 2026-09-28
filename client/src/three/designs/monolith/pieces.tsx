import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BackSide,
  CustomBlending,
  MaxEquation,
  OneFactor,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  PlaneGeometry,
  PointsMaterial,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { Camera, Group, Mesh, Object3D } from 'three';
import { PieceType } from '../../../engine/pieces';
import { prefersReducedMotion } from '../../motion';
import { ChessPiece, PIECE_PARTS, partsGeometry, pieceSet, pieceTop } from '../../pieces';
import { LAYER } from '../kit/layers';
import { ON_FLOOR, useGlide } from '../kit/motion';
import { noRaycast } from '../kit/noRaycast';
import { dotTexture, rng } from '../kit/textures';
import type { PieceBodyProps, PieceColor } from '../types';
import { anyClaims, claimed } from './claims';
import type { ClaimKind } from './claims';
import { LEVEL_COLORS, PALETTE, RING_RADIUS } from './palette';

// The armies: satin porcelain and matte charcoal, the shared Staunton set.
// Porcelain is near white, with a soft sheen along its edges; charcoal is
// dark and matte, its form shown by the key light and a dim, cool rim that
// never lifts it toward white. Each piece stands in a thin ring of its
// level's light on the glass; the ring stays on the floor when the piece
// lifts (ON_FLOOR), and while a piece glides between levels its ring passes
// through the colours of the levels it crosses.
//
// Under the pointer a piece stirs: it lifts a little, its ring brightens, and
// a soft translucent sphere of white light glows behind its upper body.
// Picked up, the sphere goes at once and the piece is superposed: three
// faint outlines of it close in from either side and above as it rises, and
// it settles into a steady inner glow in a soft column of light rising from
// its ring. Put down, the glow and the column ease out. In check, the
// king's crown takes a narrow edge of red. The ring steps aside where a
// capture, check or last-move ring is drawn in its place (claims.ts).
//
// Every piece shades with one small shader (the review machine renders in
// software, where the standard material is slow): a key light over the
// viewer's left shoulder and a cool fill, both riding with the camera, so
// the armies look the same from both seats and from above. Each piece has
// its own body material (its glow eases on its own); the inlays are shared.

// --- The glaze --------------------------------------------------------------------------

const glazeVertex = /* glsl */ `
  varying vec3 vN;
  varying vec3 vW;
  varying vec3 vLocal;
  varying float vY;
  void main() {
    vY = position.y;
    vLocal = position;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const glazeFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uBase;
  uniform vec3 uRim;
  uniform vec3 uGlowColor;
  uniform vec3 uCheckColor;
  uniform float uGradient;
  uniform float uKey;
  uniform float uAmbient;
  uniform float uRimMix;
  uniform float uRimPower;
  uniform float uSpec;
  uniform float uShine;
  uniform float uGlow;
  uniform float uCheck;
  uniform float uTop;
  uniform float uCut;
  uniform vec3 uBurn;
  varying vec3 vN;
  varying vec3 vW;
  varying vec3 vLocal;
  varying float vY;
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
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  void main() {
    // A captured piece burns away from the crown down (uCut from 0 to 1;
    // below zero, whole)
    float burn = 1.0;
    if (uCut > -0.005) {
      float e = 0.7 * (1.0 - vY / uTop) + 0.3 * noise(vLocal * 20.0) - uCut;
      if (e < 0.0) discard;
      burn = smoothstep(0.0, 0.05, e);
    }
    vec3 n = normalize(vN);
    if (!gl_FrontFacing) n = -n;
    vec3 v = normalize(cameraPosition - vW);
    // The rig rides with the camera (view space to world: the transpose)
    vec3 key = normalize((vec4(-0.45, 0.78, 0.45, 0.0) * viewMatrix).xyz);
    vec3 fill = normalize((vec4(0.78, -0.08, 0.42, 0.0) * viewMatrix).xyz);
    // A touch deeper toward the foot
    vec3 albedo = mix(uBase, uColor, mix(1.0, smoothstep(0.02, 0.42, vY), uGradient));
    float kd = dot(n, key);
    float wrap = max((kd + 0.3) / 1.3, 0.0);
    float fd = max(dot(n, fill), 0.0);
    float sky = 0.5 + 0.5 * n.y;
    vec3 light = vec3(1.0, 0.985, 0.96) * wrap * uKey
      + vec3(0.7, 0.8, 1.0) * fd * 0.2
      + mix(vec3(0.16, 0.17, 0.2), vec3(0.4, 0.42, 0.47), sky) * uAmbient;
    vec3 col = albedo * light;
    // A broad satin highlight, never a mirror
    vec3 h = normalize(key + v);
    col += vec3(1.0, 0.99, 0.97) * pow(max(dot(n, h), 0.0), uShine) * uSpec * max(kd, 0.0);
    float facing = abs(dot(n, v));
    // Seen from above, a piece is almost all edge: the rim gives way there
    float fromAbove = mix(1.0, 0.3, smoothstep(0.55, 0.95, abs(v.y)));
    float rim = pow(1.0 - facing, uRimPower) * fromAbove;
    col = mix(col, uRim, clamp(uRimMix * rim, 0.0, 1.0));
    // Held, a steady glow from within, strongest face-on
    col += uGlowColor * uGlow * (0.3 + 0.7 * facing);
    // In check, a narrow edge of red round the top third
    float crown = pow(1.0 - facing, 2.4) * fromAbove * smoothstep(0.55, 0.78, vY / uTop);
    col = mix(col, uCheckColor, clamp(uCheck * 0.7 * crown, 0.0, 1.0));
    // The burning edge: a thin line of white light
    col = mix(uBurn, col, burn);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

interface Glaze {
  color: string;
  base: string;
  rim: string;
  key: number;
  ambient: number;
  rimMix: number;
  rimPower: number;
  spec: number;
  shine: number;
  /** The inner glow's colour and strength when held (hover takes a share). */
  glow: string;
  glowStrength: number;
}

const GLAZE: Record<PieceColor, Glaze> = {
  white: {
    color: PALETTE.porcelain,
    base: PALETTE.porcelainBase,
    rim: PALETTE.porcelainRim,
    key: 0.95,
    ambient: 0.72,
    rimMix: 0.28,
    rimPower: 2.6,
    spec: 0.22,
    shine: 18,
    glow: '#fff6e6',
    glowStrength: 0.17,
  },
  black: {
    color: PALETTE.charcoal,
    base: PALETTE.charcoalBase,
    rim: PALETTE.charcoalRim,
    key: 1.1,
    ambient: 0.8,
    rimMix: 0.36,
    rimPower: 3.2,
    spec: 0.1,
    shine: 12,
    glow: '#9fb2d6',
    glowStrength: 0.06,
  },
};

const glaze = (o: {
  color: string;
  base?: string;
  rim: string;
  key: number;
  ambient: number;
  rimMix: number;
  rimPower: number;
  spec: number;
  shine: number;
  glow?: string;
  top?: number;
}) =>
  new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(o.color) },
      uBase: { value: new Color(o.base ?? o.color) },
      uGradient: { value: o.base ? 1 : 0 },
      uRim: { value: new Color(o.rim) },
      uGlowColor: { value: new Color(o.glow ?? '#ffffff') },
      uCheckColor: { value: new Color(PALETTE.check) },
      uKey: { value: o.key },
      uAmbient: { value: o.ambient },
      uRimMix: { value: o.rimMix },
      uRimPower: { value: o.rimPower },
      uSpec: { value: o.spec },
      uShine: { value: o.shine },
      uGlow: { value: 0 },
      uCheck: { value: 0 },
      uTop: { value: o.top ?? 1 },
      uCut: { value: -1 },
      uBurn: { value: new Color(PALETTE.light).multiplyScalar(1.4) },
    },
    vertexShader: glazeVertex,
    fragmentShader: glazeFragment,
  });

/** A piece's own body material (its glow and check light ease on their own). */
export const bodyMaterial = (color: PieceColor, type: PieceType) => {
  const g = GLAZE[color];
  return glaze({ ...g, top: pieceTop(pieceSet(), type) });
};

// The inlays that name a piece (the bishop's cut, the knight's mane and eye,
// the unicorn's spiral, the queen's pearls, the king's cross): a pale grey
// glaze in porcelain, a graphite a shade lighter than the body in charcoal,
// each clearly its own army's value
const accents: Record<PieceColor, ShaderMaterial> = {
  white: glaze({
    color: PALETTE.porcelainAccent,
    rim: PALETTE.porcelainRim,
    key: 0.9,
    ambient: 0.85,
    rimMix: 0.2,
    rimPower: 2.6,
    spec: 0.25,
    shine: 24,
  }),
  black: glaze({
    color: PALETTE.charcoalAccent,
    rim: PALETTE.charcoalRim,
    key: 1.05,
    ambient: 0.8,
    rimMix: 0.25,
    rimPower: 3,
    spec: 0.18,
    shine: 20,
  }),
};
// The rook's accent is its whole hollow: seen from above it is most of the
// piece, so it keeps its army's own value
const wells: Record<PieceColor, ShaderMaterial> = {
  white: glaze({
    color: '#dcd8d0',
    rim: PALETTE.porcelainRim,
    key: 0.9,
    ambient: 0.85,
    rimMix: 0.2,
    rimPower: 2.6,
    spec: 0.15,
    shine: 16,
  }),
  black: glaze({
    color: '#24262b',
    rim: PALETTE.charcoalRim,
    key: 1.05,
    ambient: 0.8,
    rimMix: 0.25,
    rimPower: 3,
    spec: 0.1,
    shine: 12,
  }),
};
export const accentOf = (type: PieceType, color: PieceColor) =>
  type === PieceType.Rook ? wells[color] : accents[color];

/** The whole piece as one geometry, for its echoes (the flair, a capture). */
export const wholePiece = (type: PieceType): BufferGeometry =>
  partsGeometry(pieceSet(), type, PIECE_PARTS)!;

// --- The level ring ---------------------------------------------------------------------

const ringVertex = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const ringFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uRadius;
  uniform float uAmount;
  uniform float uGlow;
  varying vec2 vP;
  void main() {
    float r = length(vP);
    float d = abs(r - uRadius);
    float fw = max(fwidth(r), 1e-4);
    // A hairline of light, never thinner than about a pixel
    float w = max(0.012, fw * 0.8);
    float ring = (1.0 - smoothstep(w - fw, w + fw, d)) * min(0.012 / w, 1.0);
    // Its soft light on the glass, which gathers under the pointer
    float halo = exp(-d * d / (0.035 * 0.035)) * (0.08 + 0.3 * uGlow);
    float pool = (1.0 - smoothstep(0.0, uRadius, r)) * 0.07 * uGlow;
    float a = (ring * (0.85 + 0.15 * uGlow) + halo + pool) * uAmount;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * (1.0 + 0.35 * uGlow), min(a, 1.0));
    #include <colorspace_fragment>
  }`;

export const ringPlane = new PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2);
const levelColors = LEVEL_COLORS.map((c) => new Color(c));

/** The colour of a fractional level, through the levels in between. */
const colorAtLevel = (level: number, out: Color) => {
  const l = Math.min(Math.max(level, 0), levelColors.length - 1);
  const k = Math.floor(l);
  const t = l - k;
  return out.copy(levelColors[k]).lerp(levelColors[Math.min(k + 1, levelColors.length - 1)], t);
};

export const ringMaterial = (level: number) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    uniforms: {
      uColor: { value: colorAtLevel(level, new Color()) },
      uRadius: { value: RING_RADIUS },
      uAmount: { value: 1 },
      uGlow: { value: 0 },
    },
    vertexShader: ringVertex,
    fragmentShader: ringFragment,
  });

// --- The sphere of light (hover) -------------------------------------------------

const haloVertex = /* glsl */ `
  uniform float uHeight;
  uniform float uSize;
  uniform float uPush;
  varying vec2 vP;
  varying float vSide;
  void main() {
    vP = position.xy;
    // Seen from above the sphere would lie round the piece like a plate on
    // the floor: it belongs to side views, and fades out toward top-down
    vec3 anchor = (modelMatrix * vec4(0.0, uHeight, 0.0, 1.0)).xyz;
    vSide = 1.0 - smoothstep(0.62, 0.86, abs(normalize(cameraPosition - anchor).y));
    // A billboard round the upper body, pushed back from the viewer so the
    // piece stands in front of it
    vec4 centre = modelViewMatrix * vec4(0.0, uHeight, 0.0, 1.0);
    centre.xyz += normalize(centre.xyz) * uPush;
    centre.xy += position.xy * uSize;
    gl_Position = projectionMatrix * centre;
  }`;

const haloFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAmount;
  varying vec2 vP;
  varying float vSide;
  void main() {
    float r = length(vP);
    float fw = fwidth(r);
    // A translucent sphere: faint at its heart, brighter toward its limb,
    // with a soft light round it
    float body = (1.0 - smoothstep(0.86 - fw, 0.86 + fw, r)) * (0.16 + 0.5 * pow(r / 0.86, 4.0));
    float glow = exp(-pow(max(r - 0.86, 0.0) / 0.09, 2.0)) * 0.3;
    float a = (body + glow) * uAmount * vSide;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }`;

const haloQuad = new PlaneGeometry(2, 2);

// --- The cone of light (hold) --------------------------------------------------------------

const CONE_HEIGHT = 1.05;
// It rises out of the level ring itself, one figure with it
const CONE_BOTTOM = RING_RADIUS;
// Nearly straight: light rising from the ring, not a jar over the piece
const coneGeometry = new CylinderGeometry(
  CONE_BOTTOM * 0.9,
  CONE_BOTTOM,
  CONE_HEIGHT,
  40,
  1,
  true,
).translate(0, CONE_HEIGHT / 2, 0);

const coneVertex = /* glsl */ `
  varying float vH;
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    vH = position.y / ${CONE_HEIGHT.toFixed(3)};
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const coneFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAmount;
  uniform float uTime;
  varying float vH;
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    vec3 v = normalize(cameraPosition - vWorld);
    float facing = abs(dot(normalize(vNormal), v));
    // Soft at its edges, clear in front of the piece, gone by the top
    float edge = pow(1.0 - facing, 2.2);
    float fade = pow(1.0 - vH, 1.8) * smoothstep(0.0, 0.04, vH);
    // Very faint bands of light drifting up
    float bands = 0.88 + 0.12 * sin((vH * 4.0 - uTime * 0.35) * 6.2831853);
    // From above, the walls are all edge: they step back there
    float above = smoothstep(0.6, 0.95, abs(v.y));
    float skirt = exp(-vH / 0.06) * 0.14;
    float a = ((0.05 + 0.55 * edge * (1.0 - 0.65 * above)) * fade * bands + skirt) * uAmount;
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }`;

const poolFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAmount;
  varying vec2 vP;
  void main() {
    float r = length(vP) / ${CONE_BOTTOM.toFixed(3)};
    // The cone's footprint: soft light, no edge
    float a = exp(-r * r * 2.4) * 0.3 * uAmount;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }`;

const poolPlane = new PlaneGeometry(1.2, 1.2).rotateX(-Math.PI / 2);

const MOTES = 9;
let moteMap: ReturnType<typeof dotTexture> | null = null;

// --- The flair: superposition -------------------------------------------------------------

const echoMaterial = (color: string, top: number) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    // The brighter of the outlines where they cross, never their sum
    blending: CustomBlending,
    blendEquation: MaxEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    uniforms: {
      uColor: { value: new Color(color) },
      uOpacity: { value: 0 },
      uTop: { value: top },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying float vY;
      void main() {
        vY = position.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTop;
      varying vec3 vN;
      varying vec3 vV;
      varying float vY;
      void main() {
        // Only its outline, and only above the base: the flat steps of the
        // base, seen edge-on, would fill in as a grey smudge on the glass
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 4.5);
        float a = 1.8 * f * uOpacity * smoothstep(0.14, 0.34, vY / uTop);
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor * a, 1.0);
        #include <colorspace_fragment>
      }`,
  });

const FLAIR_MS = 560;
/** Peak strength of the outlines: quieter round charcoal. */
const FLAIR_OPACITY: Record<PieceColor, number> = { white: 0.3, black: 0.22 };
/** Where each outline starts, across the view and up (piece units). */
const ECHOES: [number, number][] = [
  [-0.32, 0.04],
  [0.32, 0.04],
  [0, 0.22],
];

const right = new Vector3();
const up = new Vector3();
const back = new Vector3();
const turn = new Quaternion();
/** The camera's right, up and forward, in the frame of `parent` (reused scratch vectors). */
const viewAxes = (camera: Camera, parent: Object3D | null) => {
  right.setFromMatrixColumn(camera.matrixWorld, 0);
  up.setFromMatrixColumn(camera.matrixWorld, 1);
  back.setFromMatrixColumn(camera.matrixWorld, 2).negate();
  if (parent) {
    parent.getWorldQuaternion(turn).invert();
    right.applyQuaternion(turn);
    up.applyQuaternion(turn);
    back.applyQuaternion(turn);
  }
  // Outlines close in across the view and from above the piece
  up.set(0, Math.max(up.y, 0.4), 0);
};

/** Three faint outlines of the piece close in on it as it is picked up, once. */
const Flair = ({ type, color }: { type: PieceType; color: PieceColor }) => {
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);
  const meshes = useRef<(Mesh | null)[]>([]);
  const elapsed = useRef(0);
  const [done, setDone] = useState(false);
  const materials = useMemo(
    () => ECHOES.map(() => echoMaterial(PALETTE.light, pieceTop(pieceSet(), type))),
    [type],
  );
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);
  useEffect(() => invalidate(), [invalidate]);
  useFrame((_, delta) => {
    if (done) return;
    elapsed.current += Math.min(delta, 1 / 8) * 1000;
    const t = Math.min(elapsed.current / FLAIR_MS, 1);
    // Eased in fast and settling: they arrive as the piece reaches its height
    // They close in fast and are gone before they reach the piece's own
    // edge, so they never ring it in light (a charcoal piece keeps its value)
    const e = 1 - (1 - t) ** 2.4;
    const parent = meshes.current[0]?.parent ?? null;
    viewAxes(camera, parent);
    ECHOES.forEach(([x, y], i) => {
      const m = meshes.current[i];
      if (!m) return;
      const k = 1 - e;
      // A little behind the piece along the view, so it hides where they
      // overlap and only their outlines show round it
      m.position
        .copy(right)
        .multiplyScalar(x * k)
        .addScaledVector(up, y * k)
        .addScaledVector(back, 0.14);
      m.scale.setScalar(1 + 0.06 * k);
      const f = Math.min(t / 0.72, 1);
      materials[i].uniforms.uOpacity.value = FLAIR_OPACITY[color] * Math.sin(Math.PI * f) * (1 - f);
    });
    if (t >= 1) setDone(true);
    else invalidate();
  });
  if (done) return null;
  const geometry = wholePiece(type);
  return (
    <>
      {materials.map((m, i) => (
        <mesh
          key={i}
          ref={(o) => {
            meshes.current[i] = o;
          }}
          geometry={geometry}
          material={m}
          renderOrder={LAYER.trace + 0.4}
          raycast={noRaycast}
        />
      ))}
    </>
  );
};

// --- Hover and hold -------------------------------------------------------------------------

/** Rates of the eases (per second): hover in and out, pick up, put down. */
const HOVER_RATE = 1 / 0.18;
const HOLD_RATE = 1 / 0.3;
const RELEASE_RATE = 1 / 0.26;
const DROP_RATE = 1 / 0.06;
const smooth = (x: number) => x * x * (3 - 2 * x);

interface AuraProps {
  type: PieceType;
  color: PieceColor;
  /** Eased 0–1 weights, written by the body every frame. */
  weights: { current: { hover: number; hold: number } };
  time: { current: number };
}

/** The sphere of light behind the upper body (hover only). */
const Sphere = ({ type, color, weights }: AuraProps) => {
  const top = pieceTop(pieceSet(), type);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: {
          uColor: { value: new Color(PALETTE.light) },
          uAmount: { value: 0 },
          uHeight: { value: top * 0.62 },
          uSize: { value: Math.max(0.3, top * 0.44) },
          uPush: { value: 0.38 },
        },
        vertexShader: haloVertex,
        fragmentShader: haloFragment,
      }),
    [top],
  );
  useEffect(() => () => material.dispose(), [material]);
  // A little dimmer behind porcelain, so the piece keeps its edge against it
  const strength = color === 'white' ? 0.55 : 0.75;
  useFrame(() => {
    // Under the pointer only: picked up, it goes at once and the cone takes over
    material.uniforms.uAmount.value = strength * 0.62 * smooth(weights.current.hover);
  });
  return (
    <mesh
      geometry={haloQuad}
      material={material}
      renderOrder={LAYER.shadow - 0.5}
      frustumCulled={false}
      raycast={noRaycast}
    />
  );
};

/** The cone of light rising from the square, its soft footprint and a few motes (hold). */
const Cone = ({ weights, time }: AuraProps) => {
  const { cone, pool, motes, moteMaterial, seeds } = useMemo(() => {
    const color = new Color(PALETTE.light);
    const cone = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      // Its far wall only: the piece stands in front of it, so the cone never
      // lays light over the piece itself (a charcoal piece stays charcoal)
      side: BackSide,
      blending: AdditiveBlending,
      uniforms: { uColor: { value: color }, uAmount: { value: 0 }, uTime: { value: 0 } },
      vertexShader: coneVertex,
      fragmentShader: coneFragment,
    });
    const pool = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uColor: { value: color }, uAmount: { value: 0 } },
      vertexShader: ringVertex,
      fragmentShader: poolFragment,
    });
    const random = rng(7);
    const seeds = Array.from({ length: MOTES }, () => ({
      angle: random() * Math.PI * 2,
      radius: 0.08 + random() * 0.24,
      phase: random(),
      speed: 0.08 + random() * 0.07,
    }));
    const motes = new BufferGeometry();
    motes.setAttribute('position', new BufferAttribute(new Float32Array(MOTES * 3), 3));
    motes.setAttribute('color', new BufferAttribute(new Float32Array(MOTES * 3), 3));
    moteMap ??= dotTexture(0.8);
    const moteMaterial = new PointsMaterial({
      size: 0.035,
      map: moteMap,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      sizeAttenuation: true,
    });
    return { cone, pool, motes, moteMaterial, seeds };
  }, []);
  useEffect(
    () => () => {
      cone.dispose();
      pool.dispose();
      motes.dispose();
      moteMaterial.dispose();
    },
    [cone, pool, motes, moteMaterial],
  );
  const still = prefersReducedMotion();
  useFrame(() => {
    const k = weights.current.hold;
    const e = k * k * (3 - 2 * k);
    cone.uniforms.uAmount.value = e;
    cone.uniforms.uTime.value = time.current;
    pool.uniforms.uAmount.value = e;
    const pos = motes.getAttribute('position') as BufferAttribute;
    const col = motes.getAttribute('color') as BufferAttribute;
    const t = still ? 0 : time.current;
    seeds.forEach((s, i) => {
      const h = (s.phase + t * s.speed) % 1;
      const r = s.radius * (1 - 0.35 * h);
      const a = s.angle + t * 0.25;
      pos.setXYZ(i, Math.cos(a) * r, h * CONE_HEIGHT * 0.9, Math.sin(a) * r);
      const f = Math.sin(Math.PI * h) * 0.75 * e;
      col.setXYZ(i, f, f, f);
    });
    pos.needsUpdate = true;
    col.needsUpdate = true;
  });
  return (
    <>
      <mesh
        geometry={poolPlane}
        material={pool}
        position={[0, 0.006, 0]}
        renderOrder={LAYER.shadow + 0.2}
        raycast={noRaycast}
      />
      <mesh
        geometry={coneGeometry}
        material={cone}
        renderOrder={LAYER.trace + 0.3}
        raycast={noRaycast}
      />
      <points
        geometry={motes}
        material={moteMaterial}
        renderOrder={LAYER.trace + 0.35}
        frustumCulled={false}
        raycast={noRaycast}
      />
    </>
  );
};

// --- The piece -------------------------------------------------------------------------------

const at = new Vector3();
const RING_YIELDS: ClaimKind[] = ['capture', 'check', 'trace'];

/**
 * A Staunton piece in porcelain or charcoal, standing in its level ring
 * (which stays on the glass when the piece lifts), with its sphere of light
 * under the pointer, and its flair, glow and cone of light when held.
 */
export const PieceBody = (props: PieceBodyProps) => {
  const { type, color, selected, hovered, inCheck } = props;
  const level = props.level ?? 0;
  const invalidate = useThree((s) => s.invalidate);
  const glide = useGlide();
  const body = useMemo(() => bodyMaterial(color, type), [color, type]);
  const ring = useMemo(() => ringMaterial(level), [level]);
  useEffect(() => () => body.dispose(), [body]);
  useEffect(() => () => ring.dispose(), [ring]);
  const floor = useRef<Group>(null);

  // Hover and hold ease in and out; the sphere and cone are mounted only
  // while they show
  const weights = useRef({ hover: 0, hold: 0 });
  const check = useRef(0);
  const time = useRef(0);
  const [awake, setAwake] = useState(false);
  const [holding, setHolding] = useState(false);
  if ((hovered || selected) && !awake) setAwake(true);
  if (selected && !holding) setHolding(true);
  // Each new pick-up replays the flair
  const [flairs, setFlairs] = useState(0);
  const [wasSelected, setWasSelected] = useState(selected);
  if (selected !== wasSelected) {
    setWasSelected(selected);
    if (selected) setFlairs((n) => n + 1);
  }
  useEffect(() => invalidate(), [hovered, selected, inCheck, invalidate]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const w = weights.current;
    const toward = (v: number, goal: number, rate: number) =>
      goal > v ? Math.min(goal, v + dt * rate) : Math.max(goal, v - dt * rate);
    // Picked up, the hover light goes at once (the flair and the cone take over)
    const hover = toward(w.hover, hovered && !selected ? 1 : 0, selected ? DROP_RATE : HOVER_RATE);
    const hold = toward(w.hold, selected ? 1 : 0, selected ? HOLD_RATE : RELEASE_RATE);
    const c = toward(check.current, inCheck ? 1 : 0, 1 / 0.25);
    const moving = hover !== w.hover || hold !== w.hold || c !== check.current;
    w.hover = hover;
    w.hold = hold;
    check.current = c;
    if (hold > 0) time.current += dt;
    // The inner glow: a share under the pointer, all of it held
    const g = GLAZE[color].glowStrength;
    const eased = hold * hold * (3 - 2 * hold);
    const lit = smooth(hover);
    body.uniforms.uGlow.value = g * (0.35 * lit + eased);
    body.uniforms.uCheck.value = c;
    ring.uniforms.uGlow.value = Math.max(lit, eased);
    // While gliding, the ring passes through the colours of the levels crossed
    if (glide) {
      const p = glide.progress.current;
      colorAtLevel(
        glide.fromLevel + (glide.toLevel - glide.fromLevel) * p,
        ring.uniforms.uColor.value,
      );
    } else {
      colorAtLevel(level, ring.uniforms.uColor.value);
    }
    // A capture, check or last-move ring drawn here takes the ring's place
    // (claims.ts)
    let amount = 1;
    if (anyClaims() && floor.current) {
      floor.current.getWorldPosition(at);
      if (claimed(at, RING_YIELDS)) amount = 0;
    }
    ring.uniforms.uAmount.value = amount;
    if (moving || hold > 0) invalidate();
    else if (!hovered && !selected && hover === 0 && hold === 0) {
      if (awake) setAwake(false);
      if (holding) setHolding(false);
    } else if (holding && !selected && hold === 0) setHolding(false);
  });

  return (
    <>
      <group ref={floor} userData={ON_FLOOR}>
        <mesh
          geometry={ringPlane}
          material={ring}
          position={[0, 0.005, 0]}
          renderOrder={LAYER.shadow}
          raycast={noRaycast}
        />
        {holding && <Cone type={type} color={color} weights={weights} time={time} />}
      </group>
      <ChessPiece
        type={type}
        parts={{ body, collar: body, foot: body, accent: accentOf(type, color) }}
      />
      {awake && <Sphere type={type} color={color} weights={weights} time={time} />}
      {selected && flairs > 0 && !prefersReducedMotion() && (
        <Flair key={flairs} type={type} color={color} />
      )}
    </>
  );
};
