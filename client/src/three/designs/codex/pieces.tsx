import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
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
import { prefersReducedMotion } from '../../motion';
import { ChessPiece, pieceSet, pieceTop } from '../../pieces';
import { LAYER } from '../kit/layers';
import { ON_FLOOR } from '../kit/motion';
import { noRaycast } from '../kit/noRaycast';
import { ContactShadow } from '../kit/plates';
import { dotTexture, rng } from '../kit/textures';
import type { PieceBodyProps, PieceColor } from '../types';
import { PALETTE } from './palette';

// The armies: pale jade glass, opaque and satin, against a near-black
// green-graphite. Both are drawn by one small shader (the review machine
// renders in software, where the standard material is slow): a soft key over
// the camera's shoulder and a cool fill low on its other side, both riding
// with the camera so a piece is modelled the same way from every side; a
// broad satin highlight; and an edge light of the army's own. The jade's edge
// is pale; the graphite's is a faint, cool green, kept dim so the dark army
// stays dark from any angle, its form carried by the highlight and the
// gradient toward its foot rather than by a halo. The inlays that name a
// piece are a deep jade ink on the pale army and a pale jade on the dark one.
//
// No level ring: a piece stands on a soft contact shadow, and the level reads
// from the pane, its letter and the markers.
//
// State lives in the piece, every change eased over about 200 ms:
// - hover: a small lift (Board), an amber edge round the silhouette, and a
//   soft pool of warm light on the floor round the base;
// - selection "writes the piece in": a thin line of light draws itself round
//   the base, then a soft cone of light rises from it to the piece with a
//   few slow motes, and the edge warms a little more; released, the cone
//   sinks and the line erases itself back the way it came.
//
// (Round 4 tried power pips, the piece's material value as a row of dots on
// the floor at selection; they read as clutter rather than information, and
// were dropped.)
// All of it stays on the floor while the piece lifts (the kit's ON_FLOOR).

// --- The jade shader ---------------------------------------------------------------------

/** The light rig, in world space: Stage's CameraRig keeps it with the camera. */
export const rig = {
  key: { value: new Vector3(-0.4, 0.75, 0.55).normalize() },
  fill: { value: new Vector3(0.6, 0.1, 0.5).normalize() },
};

const jadeVertex = /* glsl */ `
  varying vec3 vN;
  varying vec3 vW;
  varying float vY;
  varying float vX;
  void main() {
    vY = position.y;
    vX = position.x;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const jadeFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uBase;
  uniform vec3 uRim;
  uniform vec3 uWarmColor;
  uniform vec3 uCheckColor;
  uniform vec3 uKey;
  uniform vec3 uFill;
  uniform vec3 uKeyColor;
  uniform vec3 uFillColor;
  uniform vec3 uSky;
  uniform vec3 uGround;
  uniform float uGradient;
  uniform float uWrap;
  uniform float uSelf;
  uniform float uSpec;
  uniform float uShine;
  uniform float uRimMix;
  uniform float uRimPower;
  uniform float uWarm;
  uniform float uWarmMix;
  uniform float uWarmPower;
  uniform float uCheck;
  uniform float uTop;
  uniform float uCut;
  uniform vec3 uCutColor;
  varying vec3 vN;
  varying vec3 vW;
  varying float vY;
  varying float vX;
  void main() {
    #ifdef CUT
      // Struck from the book: the piece is erased in thin bands from its
      // crown down, each band from one side across, like lines of type
      // struck out
      float band = floor(vY / uTop * 14.0) / 14.0;
      float across = clamp(0.5 + 0.5 * vX / 0.3, 0.0, 1.0);
      float cut = (1.0 - band) * 0.82 + across * 0.18 - uCut;
      if (cut < 0.0) discard;
    #endif
    vec3 n = normalize(vN);
    if (!gl_FrontFacing) n = -n;
    vec3 v = normalize(cameraPosition - vW);
    // Deeper toward the foot (piece units, base at 0)
    vec3 albedo = mix(uBase, uColor, mix(1.0, smoothstep(0.02, 0.4, vY), uGradient));
    // A wrapped key: light passes a little round the form, like jade
    float key = max((dot(n, uKey) + uWrap) / (1.0 + uWrap), 0.0);
    float fill = max(dot(n, uFill), 0.0);
    vec3 hemi = mix(uGround, uSky, 0.5 + 0.5 * n.y);
    vec3 col = albedo * (uKeyColor * key + uFillColor * fill + hemi + uSelf);
    // A broad satin highlight, never a mirror
    vec3 h = normalize(uKey + v);
    col += uKeyColor * pow(max(dot(n, h), 0.0), uShine) * uSpec * max(dot(n, uKey), 0.0);
    // The army's edge light, giving way from above (where a turned piece is
    // nearly all silhouette), so an army keeps its own value from any height
    float facing = abs(dot(n, v));
    float fromAbove = mix(1.0, 0.4, smoothstep(0.55, 0.95, abs(v.y)));
    float rim = pow(1.0 - facing, uRimPower) * fromAbove;
    col = mix(col, uRim, clamp(uRimMix * rim, 0.0, 1.0));
    // Hover and selection warm only the very edge of the silhouette, a
    // narrow amber line of light, so the body keeps its army's colour
    float warmEdge = pow(1.0 - facing, uWarmPower) * fromAbove;
    col = mix(col, uWarmColor, clamp(uWarm * uWarmMix * warmEdge, 0.0, 1.0));
    // Check: a narrow red light on the edge of the top third
    float crown = pow(1.0 - facing, 2.6) * fromAbove * smoothstep(0.5, 0.75, vY / uTop);
    col = mix(col, uCheckColor, clamp(uCheck * 0.6 * crown, 0.0, 1.0));
    #ifdef CUT
      // The erasing edge glows in the army's light
      col = mix(col, uCutColor, (1.0 - smoothstep(0.0, 0.05, cut)) * step(0.0, uCut));
    #endif
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// The rig's lights as the jade sees them, in three's physical units: a
// light's colour times its intensity, over pi for a matte surface
const lit = (hex: string, intensity: number) => new Color(hex).multiplyScalar(intensity / Math.PI);
const LIGHTS = {
  uKeyColor: { value: lit('#f4fbf7', 2.35) },
  uFillColor: { value: lit('#8fd8c2', 0.5) },
  uSky: { value: lit('#bfe3d4', 0.62) },
  uGround: { value: lit('#18342c', 0.6) },
};

interface JadeOptions {
  color: string;
  /** The colour it deepens to at its foot (unset: an even colour). */
  base?: string;
  rim: string;
  rimMix: number;
  rimPower: number;
  /** Light of its own, so the shadowed side never goes dead. */
  self?: number;
  spec?: number;
  shine?: number;
  wrap?: number;
  /** How strong the warm edge is at full warmth (selection; hover is 0.6 of it). */
  warmMix?: number;
  /** How narrow the warm edge is (a higher power hugs the silhouette). */
  warmPower?: number;
  warmColor?: string;
  /** The piece's height (piece units), for the check light on its top third. */
  top?: number;
}

const jade = (o: JadeOptions, cut = false) =>
  new ShaderMaterial({
    defines: cut ? { CUT: '' } : {},
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
      uWarmColor: { value: new Color(o.warmColor ?? PALETTE.warm) },
      uWarmMix: { value: o.warmMix ?? 0 },
      uWarmPower: { value: o.warmPower ?? 2.4 },
      uWarm: { value: 0 },
      uCheckColor: { value: new Color(PALETTE.check) },
      uCheck: { value: 0 },
      uTop: { value: o.top ?? 1 },
      uSelf: { value: o.self ?? 0 },
      uSpec: { value: o.spec ?? 0.25 },
      uShine: { value: o.shine ?? 24 },
      uWrap: { value: o.wrap ?? 0.25 },
      uCut: { value: -1 },
      uCutColor: { value: new Color(o.rim).multiplyScalar(1.4) },
    },
    vertexShader: jadeVertex,
    fragmentShader: jadeFragment,
  });

interface Look {
  color: string;
  base: string;
  rim: string;
  rimMix: number;
  rimPower: number;
  self: number;
  spec: number;
  shine: number;
  wrap: number;
  warmMix: number;
  warmPower: number;
  warmColor: string;
}

const LOOK: Record<PieceColor, Look> = {
  white: {
    color: PALETTE.white,
    base: PALETTE.whiteBase,
    rim: PALETTE.whiteRim,
    rimMix: 0.45,
    rimPower: 2.4,
    self: 0.05,
    spec: 0.28,
    shine: 18,
    wrap: 0.35,
    // Hover (0.6 of it) lays a clear amber edge round the pale army
    warmMix: 0.7,
    warmPower: 2.2,
    warmColor: PALETTE.warm,
  },
  black: {
    color: PALETTE.black,
    base: PALETTE.blackBase,
    rim: PALETTE.blackRim,
    rimMix: 0.34,
    rimPower: 2.3,
    self: 0.06,
    spec: 0.42,
    shine: 26,
    wrap: 0.1,
    // On the dark army the warm edge is a deeper amber, kept to the very
    // silhouette, so a held piece never reads pale or brown
    warmMix: 0.3,
    warmPower: 3.2,
    warmColor: '#c8923e',
  },
};

/**
 * The body of one piece: its own material (hover, selection and check are
 * eased per piece), sharing the rig and lights with every other.
 */
const bodyMaterial = (side: PieceColor, type: PieceType) => {
  const look = LOOK[side];
  return jade({ ...look, top: pieceTop(pieceSet(), type) });
};

// The inlays: deep jade ink cut into the pale army; pale jade on the dark
const INKS: Record<PieceColor, JadeOptions> = {
  white: {
    color: PALETTE.whiteInk,
    rim: '#6fb49c',
    rimMix: 0.25,
    rimPower: 2.4,
    self: 0.08,
    spec: 0.3,
  },
  black: {
    color: PALETTE.blackInk,
    rim: '#c9eadc',
    rimMix: 0.2,
    rimPower: 2.4,
    self: 0.12,
    spec: 0.25,
  },
};
// The rook's accent is its whole hollow (and sills): seen from above it is
// most of the piece, so it keeps its own army's value
const WELLS: Record<PieceColor, JadeOptions> = {
  white: { color: '#c6d6cd', rim: PALETTE.whiteRim, rimMix: 0.3, rimPower: 2.4, self: 0.04 },
  black: { color: '#131a17', rim: PALETTE.blackRim, rimMix: 0.25, rimPower: 2.3, self: 0.03 },
};
const inlayOf = (type: PieceType, color: PieceColor) =>
  type === PieceType.Rook ? WELLS[color] : INKS[color];

const accents = {
  white: { ink: jade(INKS.white), well: jade(WELLS.white) },
  black: { ink: jade(INKS.black), well: jade(WELLS.black) },
};
export const accentOf = (type: PieceType, color: PieceColor) =>
  accents[color][type === PieceType.Rook ? 'well' : 'ink'];

/**
 * A piece's body and inlays in its army's materials, able to be struck out
 * (`uCut` from -0.01, whole, to 1.05, gone): the capture redraws its victim
 * with these, so it looks exactly as it stood until it is erased.
 */
export const erasable = (side: PieceColor, type: PieceType) => {
  const top = pieceTop(pieceSet(), type);
  const body = jade({ ...LOOK[side], top }, true);
  const accent = jade({ ...inlayOf(type, side), top }, true);
  accent.uniforms.uCutColor.value.copy(body.uniforms.uCutColor.value);
  return { body, accent };
};

// --- Facing the viewer --------------------------------------------------------------------

const toward = new Vector3();
const screenUp = new Vector3();
const yaw = new Quaternion();
const parentTurn = new Quaternion();
const UP = new Vector3(0, 1, 0);

/**
 * Turns its children about the vertical so their +z points at the viewer's
 * heading: the camera's direction projected on the floor, blended with its
 * screen-down so it holds (and never flips) looking straight down. Not the
 * direction to the camera's position: every piece's floor notes then face the
 * same way, from any height.
 */
const FacingViewer = ({ children }: { children: React.ReactNode }) => {
  const group = useRef<Group>(null);
  useFrame(({ camera }) => {
    const g = group.current;
    if (!g?.parent) return;
    const e = camera.matrixWorld.elements;
    // Column 2 is the camera's back (toward the viewer), column 1 its up
    toward.set(e[8], 0, e[10]);
    screenUp.set(e[4], 0, e[6]);
    toward.sub(screenUp);
    if (toward.lengthSq() < 1e-10) return;
    yaw.setFromAxisAngle(UP, Math.atan2(toward.x, toward.z));
    g.parent.getWorldQuaternion(parentTurn).invert();
    g.quaternion.copy(parentTurn.multiply(yaw));
  });
  return <group ref={group}>{children}</group>;
};

// --- Floor quads -------------------------------------------------------------------------

const floorVertex = /* glsl */ `
  varying vec2 vP;
  void main() {
    // The quad lies on the floor (its geometry turned flat): x across, -z up,
    // so the viewer's side (+z) is -y
    vP = vec2(position.x, -position.z);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

// --- The warm floor glow --------------------------------------------------------------------

const glowVertex = floorVertex;

// A soft pool of warm light on the floor round the base, under hover and
// selection: the piece's lighting change, echoed where it stands
const glowFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vP;
  void main() {
    float r = length(vP) / 0.52;
    float a = exp(-r * r * 2.2) * (1.0 - smoothstep(0.8, 1.0, r)) * uOpacity;
    if (a < 0.002) discard;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <colorspace_fragment>
  }`;

const glowPlane = new PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2);

const WarmGlow = ({ strength }: { strength: React.RefObject<number> }) => {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: {
          uColor: { value: new Color(PALETTE.warm) },
          uOpacity: { value: 0 },
        },
        vertexShader: glowVertex,
        fragmentShader: glowFragment,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame(() => {
    material.uniforms.uOpacity.value = strength.current ?? 0;
  });
  return (
    <mesh
      geometry={glowPlane}
      material={material}
      position={[0, 0.008, 0]}
      renderOrder={LAYER.shadow + 0.5}
      raycast={noRaycast}
    />
  );
};

// --- The selection: written in -------------------------------------------------------------

/** Radius of the line written round the base (piece units: 0.4 of a square). */
const SCRIPT_RADIUS = 0.47;
const CONE_HEIGHT = 1.0;
const CONE_TOP = 0.2;

const scriptVertex = floorVertex;

// The line, drawn round from the viewer's side (the quad's -y) by a bright
// pen tip, and a faint floor inside it once it closes
const scriptFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uReveal;
  uniform float uFlash;
  uniform float uOpacity;
  uniform float uR;
  varying vec2 vP;
  void main() {
    float r = length(vP);
    // Angle round from the front, 0 to 1, counterclockwise from above
    float ang = fract((atan(vP.y, vP.x) + 1.5707963) / 6.2831853);
    float d = abs(r - uR) - 0.009;
    float aa = max(fwidth(d), 1e-4);
    float line = 1.0 - smoothstep(-aa, aa, d);
    float drawn = step(ang, uReveal);
    // The pen: a short bright stretch behind the tip while it writes
    float behind = (uReveal - ang) * 6.2831853 * uR;
    float pen = exp(-max(behind, 0.0) / 0.06) * drawn * step(uReveal, 0.999);
    float halo = exp(-max(d, 0.0) * max(d, 0.0) / (0.03 * 0.03)) * 0.35;
    float floorFill = (1.0 - smoothstep(uR - 0.02, uR, r)) * 0.045 * step(0.999, uReveal);
    float a = (max(line, halo) * drawn * (0.75 + 0.9 * pen + 0.8 * uFlash) + floorFill) * uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * (1.0 + 0.4 * pen + 0.3 * uFlash), min(a, 1.0));
    #include <colorspace_fragment>
  }`;

const coneVertex = /* glsl */ `
  varying float vH;
  varying vec3 vNormal;
  varying vec3 vWorld;
  uniform float uHeight;
  void main() {
    vH = position.y / uHeight;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

// A soft cone of light: bright at its edges, clear in front of the piece,
// fading as it rises, faint bands drifting slowly up it; `uRise` is how far
// up it has grown (0 to 1), with a soft front
const coneFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uRise;
  varying float vH;
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    float front = 1.0 - smoothstep(uRise - 0.12, uRise, vH);
    if (front < 0.003) discard;
    vec3 v = normalize(cameraPosition - vWorld);
    float facing = abs(dot(normalize(vNormal), v));
    float edge = pow(1.0 - facing, 2.0);
    // Fading as it rises, and sooner over its upper part, so it reads as
    // light rising round the piece rather than a shade over it
    float fade = pow(1.0 - vH, 1.6) * smoothstep(0.0, 0.04, vH) * (1.0 - smoothstep(0.35, 0.8, vH));
    float bands = 0.82 + 0.18 * sin((vH * 4.0 - uTime * 0.35) * 6.2831853);
    float skirt = exp(-vH / 0.05) * 0.3;
    float a = ((0.008 + 0.85 * edge) * fade * bands + skirt) * uOpacity * front;
    // Seen from straight above the cone is a disc round the piece: it thins
    a *= mix(1.0, 0.35, smoothstep(0.75, 0.97, abs(v.y)));
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }`;

const scriptPlane = new PlaneGeometry(1.3, 1.3).rotateX(-Math.PI / 2);
const coneGeometry = new CylinderGeometry(
  CONE_TOP,
  SCRIPT_RADIUS - 0.01,
  CONE_HEIGHT,
  40,
  1,
  true,
).translate(0, CONE_HEIGHT / 2, 0);

const MOTES = 6;
let moteTex: ReturnType<typeof dotTexture> | null = null;
const moteTexture = () => (moteTex ??= dotTexture(0.8));

/**
 * The selection written in, and written out again: `k` is the whole state,
 * driven by PieceBody (see its useFrame): write (0–1), rise (0–1), flash,
 * and the motes' light.
 */
interface ScriptState {
  write: number;
  rise: number;
  flash: number;
  motes: number;
}

const Written = ({ state }: { state: React.RefObject<ScriptState> }) => {
  const clock = useRef(0);
  const { line, cone, motes, moteMaterial, seeds } = useMemo(() => {
    const line = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      uniforms: {
        uColor: { value: new Color(PALETTE.select) },
        uReveal: { value: 0 },
        uFlash: { value: 0 },
        uOpacity: { value: 1 },
        uR: { value: SCRIPT_RADIUS },
      },
      vertexShader: scriptVertex,
      fragmentShader: scriptFragment,
    });
    const cone = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
      uniforms: {
        uColor: { value: new Color(PALETTE.select) },
        uTime: { value: 0 },
        uOpacity: { value: 0.9 },
        uRise: { value: 0 },
        uHeight: { value: CONE_HEIGHT },
      },
      vertexShader: coneVertex,
      fragmentShader: coneFragment,
    });
    const random = rng(7);
    const seeds = Array.from({ length: MOTES }, (_, i) => ({
      angle: (i / MOTES) * Math.PI * 2 + random() * 0.6,
      radius: 0.14 + random() * 0.22,
      phase: random(),
      speed: 0.09 + random() * 0.07,
    }));
    const motes = new BufferGeometry();
    motes.setAttribute('position', new BufferAttribute(new Float32Array(MOTES * 3), 3));
    motes.setAttribute('color', new BufferAttribute(new Float32Array(MOTES * 3), 3));
    const moteMaterial = new PointsMaterial({
      size: 0.075,
      map: moteTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      sizeAttenuation: true,
    });
    return { line, cone, motes, moteMaterial, seeds };
  }, []);
  useEffect(
    () => () => {
      line.dispose();
      cone.dispose();
      motes.dispose();
      moteMaterial.dispose();
    },
    [line, cone, motes, moteMaterial],
  );
  const tint = useMemo(() => new Color(PALETTE.select), []);
  const still = prefersReducedMotion();
  useFrame((_, delta) => {
    const s = state.current;
    if (!s) return;
    if (!still) clock.current += Math.min(delta, 1 / 20);
    line.uniforms.uReveal.value = s.write;
    line.uniforms.uFlash.value = s.flash;
    cone.uniforms.uRise.value = s.rise;
    cone.uniforms.uTime.value = clock.current;
    const pos = motes.getAttribute('position') as BufferAttribute;
    const col = motes.getAttribute('color') as BufferAttribute;
    seeds.forEach((m, i) => {
      const h = (m.phase + clock.current * m.speed) % 1;
      const y = h * CONE_HEIGHT * 0.85 * s.rise;
      const r = m.radius * (1 - 0.3 * h);
      const a = m.angle + clock.current * 0.25;
      pos.setXYZ(i, Math.cos(a) * r, y, Math.sin(a) * r);
      const f = Math.sin(Math.PI * h) * s.motes;
      col.setXYZ(i, tint.r * f, tint.g * f, tint.b * f);
    });
    pos.needsUpdate = true;
    col.needsUpdate = true;
  });
  return (
    <>
      <mesh
        geometry={scriptPlane}
        material={line}
        position={[0, 0.014, 0]}
        renderOrder={LAYER.marker + 0.3}
        raycast={noRaycast}
      />
      <mesh
        geometry={coneGeometry}
        material={cone}
        renderOrder={LAYER.trace + 0.5}
        raycast={noRaycast}
      />
      <points
        geometry={motes}
        material={moteMaterial}
        renderOrder={LAYER.trace + 0.6}
        raycast={noRaycast}
        frustumCulled={false}
      />
    </>
  );
};

// --- Timings -------------------------------------------------------------------------------

/** Hover and its release: the warm edge and the floor glow ease over this long. */
const HOVER_MS = 200;
/** Writing the line round the base. */
const WRITE_MS = 320;
/** The cone rising, starting as the line closes. */
const RISE_START_MS = 230;
const RISE_MS = 340;
/** How long the selection keeps animating in before it holds (the flair settles). */
const ENTER_MS = RISE_START_MS + RISE_MS + 520;
/** The release: the cone sinks and the line erases itself. */
const RELEASE_MS = 260;

/** The floor glow's strength under a hovered piece, and under a held one (beneath its cone). */
const GLOW = { hover: 0.13, selected: 0.1 };

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeIn = (t: number) => t * t;
const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1);
const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * A value that eases to each new goal over `ms`, smoothly at both ends,
 * from wherever it is when the goal changes (the markers' hover curve).
 */
class Ease {
  from = 0;
  to = 0;
  t = 1;
  value = 0;
  constructor(private ms: number) {}
  /** Advances by `dt` ms toward `goal`; true while still moving. */
  step(goal: number, dt: number) {
    if (goal !== this.to) {
      this.from = this.value;
      this.to = goal;
      this.t = 0;
    }
    this.t = Math.min(1, this.t + dt / this.ms);
    this.value = this.from + (this.to - this.from) * smooth(this.t);
    return this.t < 1;
  }
}

// --- The piece -------------------------------------------------------------------------

/**
 * A Staunton piece in jade or graphite on its contact shadow, with its
 * floor notes (the warm glow and the written selection) kept on the floor
 * while it lifts.
 */
export const PieceBody = (props: PieceBodyProps) => {
  const { type, color, selected, hovered, inCheck } = props;
  const invalidate = useThree((s) => s.invalidate);
  const body = useMemo(() => bodyMaterial(color, type), [color, type]);
  useEffect(() => () => body.dispose(), [body]);

  // The glow and the written selection are mounted while
  // shown or fading out, then unmounted: one state change each way
  const [glowOn, setGlowOn] = useState(false);
  const [scriptOn, setScriptOn] = useState(false);
  if ((selected || hovered) && !glowOn) setGlowOn(true);
  if (selected && !scriptOn) setScriptOn(true);

  const eases = useRef({
    warm: new Ease(HOVER_MS),
    glow: new Ease(HOVER_MS),
    check: new Ease(220),
  });
  const glow = useRef(0);
  const script = useRef<ScriptState>({ write: 0, rise: 0, flash: 0, motes: 0 });
  // Where the release starts from (the state when `selected` turned false)
  const releaseFrom = useRef<ScriptState | null>(null);
  const since = useRef(0);
  const wasSelected = useRef(false);

  useEffect(() => invalidate(), [selected, hovered, inCheck, invalidate]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20) * 1000;
    const e = eases.current;
    let moving = false;

    // The lighting change: a warm edge (a little on hover, more held) and a
    // soft warm pool on the floor round the base
    moving = e.warm.step(selected ? 1 : hovered ? 0.6 : 0, dt) || moving;
    body.uniforms.uWarm.value = e.warm.value;
    moving = e.glow.step(selected ? GLOW.selected : hovered ? GLOW.hover : 0, dt) || moving;
    glow.current = e.glow.value;
    if (!moving && e.glow.value === 0 && glowOn) setGlowOn(false);
    moving = e.check.step(inCheck ? 1 : 0, dt) || moving;
    body.uniforms.uCheck.value = e.check.value;

    // The selection: written in on every new selection, out on release
    if (selected !== wasSelected.current) {
      wasSelected.current = selected;
      since.current = 0;
      releaseFrom.current = selected ? null : { ...script.current };
    }
    const s = script.current;
    if (selected) {
      since.current += dt;
      const t = since.current;
      s.write = easeOut(clamp01(t / WRITE_MS));
      s.rise = easeOut(clamp01((t - RISE_START_MS) / RISE_MS));
      // The moment of flair: the line flares as it closes, then settles
      const f = (t - WRITE_MS * 0.85) / 380;
      s.flash = f > 0 && f < 1 ? Math.sin(Math.PI * Math.sqrt(f)) * (1 - f) : 0;
      s.motes = clamp01((t - RISE_START_MS - 120) / 400);
      if (t < ENTER_MS) moving = true;
    } else if (releaseFrom.current) {
      since.current += dt;
      const k = clamp01(since.current / RELEASE_MS);
      const from = releaseFrom.current;
      // The cone sinks first; the line erases itself behind it
      s.rise = from.rise * (1 - easeIn(clamp01(k / 0.75)));
      s.write = from.write * (1 - easeIn(clamp01((k - 0.2) / 0.8)));
      s.flash = 0;
      s.motes = from.motes * (1 - clamp01(k / 0.5));
      if (k < 1) moving = true;
      else {
        releaseFrom.current = null;
        setScriptOn(false);
      }
    }
    if (moving) invalidate();
  });

  return (
    <>
      <group userData={ON_FLOOR}>
        <ContactShadow radius={0.38} opacity={0.5} />
        {glowOn && <WarmGlow strength={glow} />}
        {scriptOn && (
          <FacingViewer>
            {/* A king in check is written in a little smaller, inside the
                diamond of its crown, so the two read as one figure */}
            <group scale={inCheck ? [0.7, 1, 0.7] : [1, 1, 1]}>
              <Written state={script} />
            </group>
          </FacingViewer>
        )}
      </group>
      <ChessPiece type={type} parts={{ body, accent: accentOf(type, color) }} />
    </>
  );
};
