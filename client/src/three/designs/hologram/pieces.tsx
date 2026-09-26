import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  ShaderMaterial,
  TorusGeometry,
} from 'three';
import { PieceType } from '../../../engine/pieces';
import { StauntonParts } from '../classic/pieces';
import { noRaycast } from '../kit/noRaycast';
import type { PieceBodyProps, PieceColor } from '../types';

// Hologram pieces: light, not matter. Each piece is a dim, semi-opaque core
// (so a piece in front hides the one behind it instead of melting into it)
// wrapped in a fresnel rim of its army's light, with scanlines climbing
// through it, a projector flicker, and the odd glitch band slipping sideways.

export const HOLO: Record<PieceColor, string> = { white: '#3cf2ff', black: '#ff9a3c' };
const CORE: Record<PieceColor, string> = { white: '#0a4a5e', black: '#7a3a0a' };
export const ALERT = '#ff3344';

export type Glow = 'none' | 'hover' | 'selected' | 'check';
const BOOST: Record<Glow, number> = { none: 1, hover: 1.35, selected: 1.8, check: 1.6 };

/**
 * Uniforms every hologram material shares by reference: the clock, the
 * height of the scan plane sweeping the tower, and the current glitch band.
 * The stage's HoloClock drives them.
 */
export const holo = {
  uTime: { value: 0 },
  uScanY: { value: -100 },
  uGlitchY: { value: -100 },
  uGlitch: { value: 0 },
};

// A glitch asked for by an effect (a capture, the mate): until `until`, the
// projection tears at `strength`.
const glitch = { until: -1, strength: 1, now: 0 };

/** Makes the whole projection glitch for `ms`. */
export const glitchFor = (ms: number, strength = 1) => {
  glitch.until = glitch.now + ms / 1000;
  glitch.strength = strength;
};

/** Drives the shared uniforms: the scan plane climbs from `from` to `to` every 6 s. */
export const HoloClock = ({ from, to }: { from: number; to: number }) => {
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    glitch.now = t;
    holo.uTime.value = t;
    const cycle = (t % 6) / 6;
    holo.uScanY.value = cycle < 0.5 ? from + (cycle / 0.5) * (to - from) : -100;
    if (t < glitch.until) {
      // Torn: bands jump about fast and far
      const r = Math.abs(Math.sin(Math.floor(t * 30) * 12.9898)) % 1;
      holo.uGlitchY.value = from + r * (to - from);
      holo.uGlitch.value = (r > 0.5 ? 1 : -1) * 0.12 * glitch.strength;
      return;
    }
    // Now and then a thin band of the projection slips sideways
    const n = Math.floor(t / 2.3);
    const phase = t / 2.3 - n;
    const r = Math.abs(Math.sin(n * 91.7)) % 1;
    holo.uGlitchY.value = from + r * (to - from);
    holo.uGlitch.value = phase < 0.06 ? (r > 0.5 ? 1 : -1) * (0.04 + r * 0.04) : 0;
  });
  return null;
};

const vertexShader = /* glsl */ `
  uniform float uTime; uniform float uGlitchY; uniform float uGlitch;
  varying vec3 vN; varying vec3 vV; varying vec3 vWorld; varying vec3 vWN;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    float band = 1.0 - smoothstep(0.03, 0.07, abs(world.y - uGlitchY));
    world.x += band * uGlitch;
    vWorld = world.xyz;
    vWN = normalize(mat3(modelMatrix) * normal);
    vec4 mv = viewMatrix * world;
    vV = -mv.xyz;
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor; uniform vec3 uCore; uniform float uCoreAlpha; uniform float uBoost;
  uniform float uTime; uniform float uScanY; uniform float uDissolve;
  varying vec3 vN; varying vec3 vV; varying vec3 vWorld; varying vec3 vWN;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  void main() {
    if (uDissolve > 0.0) {
      // Breaks up into square blocks of light
      float h = hash(floor(vWorld * 18.0));
      if (h < uDissolve) discard;
    }
    vec3 n = normalize(vN);
    float ndv = abs(dot(n, normalize(vV)));
    float rim = pow(1.0 - ndv, 2.1);
    float key = clamp(dot(normalize(vWN), normalize(vec3(0.35, 0.85, 0.45))), 0.0, 1.0);
    float lines = pow(0.5 + 0.5 * sin(vWorld.y * 75.0 - uTime * 4.0), 6.0);
    float sweep = smoothstep(0.985, 1.0, sin(vWorld.y * 2.2 - uTime * 2.6));
    float scan = exp(-abs(vWorld.y - uScanY) * 5.0);
    float flicker = 0.94 + 0.06 * sin(uTime * 43.0 + vWorld.y * 2.0) * sin(uTime * 11.0);
    vec3 col = uCore * (0.45 + 0.75 * key)
      + uColor * (rim * 1.7 + lines * 0.16 + sweep * 0.5 + scan * 0.5) * uBoost;
    col *= flicker;
    float a = clamp(uCoreAlpha + rim * 0.55 + lines * 0.08, 0.0, 1.0);
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }`;

/** A hologram material; `dissolve` materials are one-offs a capture burns away. */
export const makeHoloMaterial = (color: PieceColor, glow: Glow, accent = false) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: true,
    toneMapped: false,
    uniforms: {
      ...holo,
      uColor: { value: new Color(glow === 'check' ? ALERT : HOLO[color]) },
      uCore: { value: new Color(glow === 'check' ? '#5a0c12' : CORE[color]) },
      uCoreAlpha: { value: accent ? 0.9 : 0.62 },
      uBoost: { value: BOOST[glow] * (accent ? 1.8 : 1) },
      uDissolve: { value: 0 },
    },
    vertexShader,
    fragmentShader,
  });

const materials = new Map<string, ShaderMaterial>();
export const holoMaterial = (color: PieceColor, glow: Glow, accent = false) => {
  const key = `${color}-${glow}-${accent}`;
  let m = materials.get(key);
  if (!m) {
    m = makeHoloMaterial(color, glow, accent);
    materials.set(key, m);
  }
  return m;
};

// The emitter pad each piece stands on: a bright ring round a faint disc.
const pad = new CircleGeometry(0.27, 40);
const padRing = new TorusGeometry(0.27, 0.012, 6, 48);
const rings = new Map<string, MeshBasicMaterial>();
const ringMaterial = (color: PieceColor, glow: Glow) => {
  const key = `${color}-${glow}`;
  let m = rings.get(key);
  if (!m) {
    m = new MeshBasicMaterial({
      color: new Color(glow === 'check' ? ALERT : HOLO[color]).multiplyScalar(1.6 * BOOST[glow]),
      toneMapped: false,
    });
    rings.set(key, m);
  }
  return m;
};
const pads = new Map<string, ShaderMaterial>();
const padMaterial = (color: PieceColor, glow: Glow) => {
  const key = `${color}-${glow}`;
  let m = pads.get(key);
  if (!m) {
    m = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      toneMapped: false,
      uniforms: {
        uColor: {
          value: new Color(glow === 'check' ? ALERT : HOLO[color]).multiplyScalar(BOOST[glow]),
        },
        uTime: holo.uTime,
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uTime; varying vec2 vUv;
        void main() {
          float r = length(vUv - 0.5) * 2.0;
          float rings = 0.5 + 0.5 * sin(r * 22.0 - uTime * 5.0);
          float a = (0.05 + 0.1 * rings) * smoothstep(1.0, 0.6, r) + smoothstep(0.82, 0.97, r) * (1.0 - smoothstep(0.97, 1.0, r)) * 0.7;
          gl_FragColor = vec4(uColor * 1.4, a);
        }`,
    });
    pads.set(key, m);
  }
  return m;
};

const FOOT: Partial<Record<PieceType, number>> = {
  [PieceType.King]: 1.08,
  [PieceType.Queen]: 1.05,
  [PieceType.Rook]: 1.02,
};

export const PieceBody = ({ type, color, selected, hovered, inCheck }: PieceBodyProps) => {
  const glow: Glow = inCheck ? 'check' : selected ? 'selected' : hovered ? 'hover' : 'none';
  const s = FOOT[type] ?? 0.95;
  return (
    <>
      <StauntonParts
        type={type}
        material={holoMaterial(color, glow)}
        groove={holoMaterial(color, glow, true)}
      />
      <mesh
        geometry={pad}
        material={padMaterial(color, glow)}
        position={[0, 0.006, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={s}
        raycast={noRaycast}
      />
      <mesh
        geometry={padRing}
        material={ringMaterial(color, glow)}
        position={[0, 0.008, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[s, s, 1]}
        raycast={noRaycast}
      />
    </>
  );
};

/** A one-off copy of a piece that glitches and burns away (for captures). */
export const useDissolvingMaterial = (color: PieceColor) => {
  const material = useMemo(() => makeHoloMaterial(color, 'hover'), [color]);
  useEffect(() => () => material.dispose(), [material]);
  return material;
};
