import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import type { Group, Mesh } from 'three';
import { LAYER } from '../kit/layers';
import { LastMoveLine } from '../kit/line';
import { noRaycast } from '../kit/noRaycast';
import type { LastMoveMarkerProps, MarkerProps, Vec3 } from '../types';
import { CAPTURE, CHECK, LAST_MOVE, LEVELS, MOVE, SELECT } from './palette';
import { held, steep } from './shared';

// The marks on the ice, in one language of ice crystals:
// - a legal destination is a frost star, a small six-pointed crystal lying
//   where the piece would stand, with a gem at its heart in its level's
//   colour, seated on a soft disc of dark ice so it holds on frosted tiles;
// - a capture is the same star grown past the victim's base, gone crimson,
//   with a crimson core;
// - the last move's squares are hexagonal plates of Polaris gold, joined by
//   the thin gold line; each carries its level's colour (a gem on the
//   source, an inner hexagon round the piece that moved);
// - the selection is the aurora itself: a corona of rays on the ice round
//   the held piece (seen through the pieces above it from overhead) and a
//   ribbon of curtain winding up it;
// - check is a red hexagon under the king and a red aurora glowing in the
//   gaps behind him.
// Everything but the selection and the check holds still.

const markerVertex = /* glsl */ `
  varying vec2 vP;
  uniform float uQuad;
  void main() {
    vP = (uv - 0.5) * uQuad;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const markerFragment = /* glsl */ `
  uniform int uKind;
  uniform vec3 uColor;
  uniform vec3 uCore;
  uniform float uRadius;
  uniform float uRadiusSteep;
  uniform float uInner;
  uniform float uLine;
  uniform float uFill;
  uniform float uCoreAmt;
  uniform float uOpacity;
  uniform float uHover;
  uniform float uGlow;
  uniform vec3 uGem;
  uniform float uGemR;
  uniform float uInnerHex;
  uniform float uSeat;
  uniform float uSteep;
  varying vec2 vP;

  // A six-pointed star: tips at radius R, notches at radius r
  float sdStar6(vec2 p, float R, float r) {
    float s = mod(atan(p.y, p.x) + 0.5235988, 1.0471976) - 0.5235988;
    vec2 q = length(p) * vec2(cos(s), abs(sin(s)));
    vec2 A = vec2(R, 0.0);
    vec2 B = r * vec2(0.8660254, 0.5);
    vec2 ba = B - A, qa = q - A;
    float h = clamp(dot(qa, ba) / dot(ba, ba), 0.0, 1.0);
    float d = length(qa - ba * h);
    float side = ba.x * qa.y - ba.y * qa.x;
    return side > 0.0 ? -d : d;
  }
  // A regular hexagon, flat sides, apothem r
  float sdHex(vec2 p, float r) {
    const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
    p = abs(p.yx);
    p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
    p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
    return length(p) * sign(p.y);
  }
  float fill(float d) {
    float a = max(fwidth(d), 1e-4) * 1.1;
    return 1.0 - smoothstep(-a, a, d);
  }

  void main() {
    vec2 p = vP;
    // From overhead, where every square shows at once, marks draw in a little
    float R = mix(uRadius, uRadiusSteep, uSteep);
    float glow = uGlow * (1.0 - 0.5 * uSteep);
    float shape = uKind == 0 ? sdStar6(p, R, R * uInner) : sdHex(p, R);
    float line = fill(abs(shape) - uLine * 0.5);
    float inside = fill(shape);
    // A faint halo just outside the outline: light in the ice
    float halo = exp(-max(shape, 0.0) / (uLine * 2.5)) * (1.0 - inside) * glow;
    // The core: a soft disc at the centre (the capture's crimson heart)
    float core = exp(-pow(length(p) / (R * 0.45), 2.0)) * uCoreAmt;
    float k = 1.0 + 0.5 * uHover;
    vec3 col = uColor;
    float a = max(line * uOpacity * k, inside * (uFill + 0.1 * uHover));
    a = max(a, halo * 0.35 * k);
    col = mix(col, uCore, clamp(core * (1.0 - line), 0.0, 1.0));
    a = max(a, core * 0.8);
    // The level: a gem at the heart, or a thin hexagon just inside the outline
    if (uGemR > 0.0) {
      float gem = fill(sdHex(p, uGemR));
      col = mix(col, uGem, gem);
      a = max(a, gem);
    }
    if (uInnerHex > 0.0) {
      float ring = fill(abs(sdHex(p, R - uLine * 1.6)) - uLine * 0.3) * uInnerHex;
      col = mix(col, uGem, ring * (1.0 - line));
      a = max(a, ring);
    }
    // Seated on a soft disc of dark ice, so a white star holds on frosted tiles
    float seat = uSeat * (1.0 - smoothstep(R * 0.9, R * 1.4, length(p)));
    col = mix(vec3(0.027, 0.063, 0.11), col, a / max(a + seat * (1.0 - a), 1e-4));
    a = a + seat * (1.0 - a);
    if (a < 0.003) discard;
    gl_FragColor = vec4(col * (1.0 + 0.2 * uHover), min(a, 1.0));
    #include <colorspace_fragment>
  }`;

const quads = new Map<number, PlaneGeometry>();
const quad = (size: number) => {
  let g = quads.get(size);
  if (!g) {
    g = new PlaneGeometry(size, size);
    quads.set(size, g);
  }
  return g;
};

interface GlyphProps {
  floor: Vec3;
  kind: 'star' | 'hex';
  color: string;
  core?: string;
  /** Outer radius (star tips; hexagon apothem), world units. */
  radius: number;
  /** The same, seen from overhead (default: `radius`). */
  steepRadius?: number;
  /** Star notch radius, as a share of the tips'. */
  inner?: number;
  line: number;
  fill?: number;
  coreAmount?: number;
  opacity?: number;
  glow?: number;
  hovered?: boolean;
  /** The level's colour, for the gem or the inner hexagon. */
  level?: string;
  /** A hexagonal gem at the centre, this radius. */
  gemRadius?: number;
  /** A thin hexagon in the level's colour just inside the outline. */
  innerHex?: boolean;
  /** Opacity of the dark ice disc under the glyph. */
  seat?: number;
}

/** One flat crystal glyph on the floor of a cell. */
const Glyph = ({
  floor,
  kind,
  color,
  core = color,
  radius,
  steepRadius = radius,
  inner = 0.42,
  line,
  fill = 0,
  coreAmount = 0,
  opacity = 0.95,
  glow = 0.6,
  hovered = false,
  level,
  gemRadius = 0,
  innerHex = false,
  seat = 0,
}: GlyphProps) => {
  const size = (Math.max(radius, steepRadius) * 1.45 + line * 4) * 2;
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        uniforms: {
          uKind: { value: 0 },
          uColor: { value: new Color() },
          uCore: { value: new Color() },
          uRadius: { value: 0 },
          uRadiusSteep: { value: 0 },
          uInner: { value: 0 },
          uLine: { value: 0 },
          uFill: { value: 0 },
          uCoreAmt: { value: 0 },
          uOpacity: { value: 1 },
          uHover: { value: 0 },
          uGlow: { value: 0 },
          uGem: { value: new Color() },
          uGemR: { value: 0 },
          uInnerHex: { value: 0 },
          uSeat: { value: 0 },
          uSteep: steep,
          uQuad: { value: 1 },
        },
        vertexShader: markerVertex,
        fragmentShader: markerFragment,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const u = material.uniforms;
  u.uKind.value = kind === 'star' ? 0 : 1;
  (u.uColor.value as Color).set(color);
  (u.uCore.value as Color).set(core);
  u.uRadius.value = radius;
  u.uRadiusSteep.value = steepRadius;
  u.uInner.value = inner;
  u.uLine.value = line;
  u.uFill.value = fill;
  u.uCoreAmt.value = coreAmount;
  u.uOpacity.value = opacity;
  u.uHover.value = hovered ? 1 : 0;
  u.uGlow.value = glow;
  if (level) (u.uGem.value as Color).set(level);
  u.uGemR.value = level ? gemRadius : 0;
  u.uInnerHex.value = level && innerHex ? 1 : 0;
  u.uSeat.value = seat;
  u.uQuad.value = size;
  return (
    <mesh
      geometry={quad(size)}
      material={material}
      position={[floor[0], floor[1] + 0.014, floor[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={LAYER.marker}
      raycast={noRaycast}
    />
  );
};

// --- Light behind the pieces ---------------------------------------------------

const curtainVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

/**
 * A light added onto the scene before any piece is drawn: pieces (the
 * king, and anyone behind him) are drawn over it, so it glows only in the
 * gaps between them and never tints a piece.
 */
export const underPieces = (fragmentShader: string, uniforms: Record<string, { value: unknown }>) =>
  new ShaderMaterial({
    // Opaque pass, drawn first (renderOrder below the pieces'), added on
    transparent: false,
    depthWrite: false,
    side: BackSide,
    blending: AdditiveBlending,
    uniforms,
    vertexShader: curtainVertex,
    fragmentShader,
  });

// --- The selection: the aurora's corona and a ribbon of curtain -----------------

/** Whether this floor is straight above or below the held piece. */
const useInHeldColumn = (floor: Vec3) => {
  const [inColumn, setInColumn] = useState(false);
  useFrame(() => {
    const now = Math.abs(floor[0] - held.x) < 1e-3 && Math.abs(floor[2] - held.z) < 1e-3;
    if (now !== inColumn) setInColumn(now);
  });
  return inColumn;
};

const RIBBON = { turns: 1.7, radius: 0.36, flare: 0.42, bottom: 0.01, band: 0.24, segments: 180 };

const ribbons = new Map<number, BufferGeometry>();
/**
 * A helical band, vertical like a strip of curtain, winding up round the
 * axis to `top` (world units, fitted to the held piece) and flaring a little
 * as it climbs, so from near eye level its turns show as loops.
 */
const ribbonGeometry = (top: number) => {
  const key = Math.round(top * 100);
  let g = ribbons.get(key);
  if (g) return g;
  const { turns, radius, flare, bottom, band, segments } = RIBBON;
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const s = i / segments;
    const th = s * turns * Math.PI * 2;
    const y = bottom + (top - bottom - band) * s;
    const r = radius + (flare - radius) * s * s;
    const x = Math.cos(th) * r;
    const z = Math.sin(th) * r;
    pos.push(x, y, z, x * 1.03, y + band, z * 1.03);
    uv.push(s, 0, s, 1);
    if (i < segments) {
      const a = i * 2;
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(index);
  ribbons.set(key, g);
  return g;
};

const ribbonVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const ribbonFragment = /* glsl */ `
  uniform float uTime;
  uniform float uIn;
  uniform vec3 uA;
  uniform vec3 uB;
  uniform vec3 uC;
  uniform vec2 uAxis;
  uniform float uRadius;
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    float s = vUv.x;
    float v = vUv.y;
    // Where the ribbon passes in front of the piece (between it and the
    // eye), it all but vanishes: light laid over the piece would wash out
    // its army's colour. At the sides and behind, it shows in full.
    vec2 toEye = cameraPosition.xz - uAxis;
    float level = length(toEye);
    vec2 e = toEye / max(level, 1e-4);
    vec2 rel = (vWorld.xz - uAxis) / uRadius;
    float front = dot(rel, e);
    float lateral = abs(rel.x * e.y - rel.y * e.x);
    float over = smoothstep(0.0, 0.35, front) * (1.0 - smoothstep(0.45, 0.72, lateral));
    // From straight above nothing lies over the piece
    float side = level / max(length(cameraPosition - vWorld), 1e-4);
    over *= smoothstep(0.15, 0.5, side);
    // Fades in at the foot, and out toward the crown so it never floats off it
    float ends = smoothstep(0.0, 0.06, s) * (1.0 - smoothstep(0.6, 0.88, s));
    // A curtain: a bright lower hem, fading upward
    float hem = pow(1.0 - v, 2.0) * 0.8 + (1.0 - smoothstep(0.1, 0.22, v)) * 0.9;
    // Fine vertical rays and a slow bright pulse climbing the ribbon
    float rays = 0.75 + 0.25 * sin(s * 150.0 + sin(s * 23.0) * 2.0);
    float climb = 0.7 + 0.3 * sin((s * 2.2 - uTime * 0.35) * 6.2831853);
    // It draws itself up from the foot when the piece is picked up
    float grow = smoothstep(uIn * 1.25 - 0.25, uIn * 1.25, s);
    vec3 col = mix(uA, uB, smoothstep(0.1, 0.5, s));
    col = mix(col, uC, smoothstep(0.45, 0.85, s));
    // The hem burns almost white
    col = mix(col, vec3(0.9, 1.0, 0.96), (1.0 - smoothstep(0.0, 0.18, v)) * 0.45);
    float a = ends * hem * rays * climb * (1.0 - grow) * 2.8 * (1.0 - 0.9 * over);
    if (a < 0.003) discard;
    gl_FragColor = vec4(col * (1.0 + max(a - 1.0, 0.0)), min(a, 1.0));
    #include <colorspace_fragment>
  }`;

// The aurora's corona, as seen looking straight up into it: rays of light
// radiating from the held piece, rooted in its level's colour and running
// out through the aurora's green, cyan and violet, turning slowly. Nothing
// else on the board has rays. Seen from overhead it is also drawn through
// any piece that stands above it, so the selection can never be hidden.
const coronaFragment = /* glsl */ `
  uniform float uTime;
  uniform float uIn;
  uniform float uSteep;
  uniform float uXray;
  uniform vec3 uA;
  uniform vec3 uB;
  uniform vec3 uC;
  uniform vec3 uLevel;
  varying vec2 vUv;
  float hash(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
  void main() {
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0;
    const float N = 12.0;
    float k = (atan(p.y, p.x) / 6.2831853 + 0.5) * N + uTime * 0.1;
    float cell = mod(floor(k), N);
    float f = fract(k) - 0.5;
    float len = 0.8 + 0.18 * hash(cell + 3.0);
    // Tapered blades: broad at the root, a point at the tip
    float t = clamp((r - 0.52) / max(len - 0.52, 1e-3), 0.0, 1.0);
    float w = (0.32 + 0.1 * hash(cell + 11.0)) * (1.0 - 0.85 * t);
    float fa = max(fwidth(k), 1e-4);
    float ray = 1.0 - smoothstep(w - fa, w + fa, abs(f));
    // Rays grow outward from the root as the piece is picked up
    float reach = 0.52 + (len - 0.52) * uIn;
    ray *= smoothstep(0.5, 0.55, r) * (1.0 - smoothstep(reach - 0.04, reach, r));
    // A glow at the roots, in the held level's colour
    float root = exp(-pow((r - 0.56) / 0.09, 2.0)) * 0.6;
    vec3 col = mix(uLevel, vec3(0.88, 1.0, 0.95), smoothstep(0.5, 0.6, r));
    col = mix(col, uA, smoothstep(0.62, 0.74, r));
    col = mix(col, uB, smoothstep(0.72, 0.86, r));
    col = mix(col, uC, smoothstep(0.86, 1.0, r));
    float a = max(root, ray) * uIn;
    // Depth-tested at low views, drawn through the pieces from overhead
    a *= uXray > 0.5 ? uSteep : 1.0 - uSteep;
    if (a < 0.003) discard;
    gl_FragColor = vec4(col, min(a, 1.0));
    #include <colorspace_fragment>
  }`;

const passVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const auroraUniforms = () => ({
  uTime: { value: 0 },
  uIn: { value: 0 },
  uA: { value: new Color(SELECT[0]) },
  uB: { value: new Color(SELECT[1]) },
  uC: { value: new Color(SELECT[2]) },
});

// The held piece's own aurora: a curtain of light hanging behind it, green
// at the hem and violet above, its rays drifting. Added on under the
// pieces, so it glows in the gaps round the held piece and never over it:
// from eye level, where the corona lies flat, this is what marks it.
const heldCurtainFragment = /* glsl */ `
  uniform float uTime;
  uniform float uIn;
  uniform vec3 uA;
  uniform vec3 uB;
  uniform vec3 uC;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  float hash(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
  float noise(float x, float period) {
    float i = floor(x);
    float f = fract(x);
    float u = f * f * (3.0 - 2.0 * f);
    return mix(hash(mod(i, period)), hash(mod(i + 1.0, period)), u);
  }
  void main() {
    float u = vUv.x;
    float v = vUv.y;
    if (v > uIn) discard;
    float hem = smoothstep(0.0, 0.03, v) * (0.5 + 0.5 * exp(-v / 0.12));
    float body = pow(1.0 - v, 1.6);
    float rays = 0.35 + 0.65 * noise(u * 36.0 + uTime * 0.25, 36.0);
    float face = smoothstep(0.05, 0.5, abs(dot(normalize(vNormalW), normalize(cameraPosition - vWorld))));
    vec3 col = mix(uA, uB, smoothstep(0.1, 0.5, v));
    col = mix(col, uC, smoothstep(0.45, 0.95, v));
    float a = hem * body * rays * face * 0.75;
    gl_FragColor = vec4(col * a, 1.0);
    #include <colorspace_fragment>
  }`;

const curtains = new Map<number, CylinderGeometry>();
/** A unit-tall open cylinder round the held square (scaled to the piece's height). */
const heldCurtainGeometry = (pitch: number) => {
  let g = curtains.get(pitch);
  if (!g) {
    g = new CylinderGeometry(0.43 * pitch, 0.43 * pitch, 1, 48, 1, true).translate(0, 0.5, 0);
    curtains.set(pitch, g);
  }
  return g;
};

/** Drawn after everything else, labels included: the corona seen through the pieces. */
const XRAY_ORDER = LAYER.label + 2;

/**
 * The selection: a corona of aurora rays on the ice round the held piece,
 * and a ribbon of curtain that draws itself up round the piece and keeps
 * winding slowly upward.
 */
export const makeSelection = (pitch: number, levelOf: (y: number) => number) => {
  const Selection = ({ floor }: MarkerProps) => {
    const spin = useRef<Group>(null);
    const ribbonMesh = useRef<Mesh>(null);
    const curtainMesh = useRef<Mesh>(null);
    const invalidate = useThree((s) => s.invalidate);
    const [fx, fy, fz] = floor;
    const { ribbon, corona, xray, curtain } = useMemo(() => {
      const coronaMaterial = (x: boolean) =>
        new ShaderMaterial({
          transparent: true,
          depthWrite: false,
          depthTest: !x,
          side: DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
          uniforms: {
            ...auroraUniforms(),
            uLevel: { value: new Color(LEVELS[levelOf(fy)]) },
            uSteep: steep,
            uXray: { value: x ? 1 : 0 },
          },
          vertexShader: passVertex,
          fragmentShader: coronaFragment,
        });
      return {
        ribbon: new ShaderMaterial({
          transparent: true,
          depthWrite: false,
          side: DoubleSide,
          blending: AdditiveBlending,
          uniforms: {
            ...auroraUniforms(),
            uAxis: { value: [0, 0] },
            uRadius: { value: RIBBON.radius * pitch },
          },
          vertexShader: ribbonVertex,
          fragmentShader: ribbonFragment,
        }),
        corona: coronaMaterial(false),
        xray: coronaMaterial(true),
        curtain: underPieces(heldCurtainFragment, auroraUniforms()),
      };
    }, [fy]);
    useEffect(
      () => () => {
        ribbon.dispose();
        corona.dispose();
        xray.dispose();
        curtain.dispose();
      },
      [ribbon, corona, xray, curtain],
    );
    useLayoutEffect(() => {
      ribbon.uniforms.uAxis.value = [fx, fz];
      held.x = fx;
      held.z = fz;
      return () => {
        if (held.x === fx && held.z === fz) held.x = held.z = NaN;
      };
    }, [fx, fz, ribbon]);
    const t = useRef(0);
    useFrame((state, delta) => {
      t.current += Math.min(delta, 1 / 20);
      const grow = Math.min(t.current / 0.45, 1);
      const ease = 1 - (1 - grow) ** 3;
      for (const m of [ribbon, corona, xray, curtain]) {
        m.uniforms.uTime.value = state.clock.elapsedTime;
        m.uniforms.uIn.value = ease;
      }
      const r = ribbonMesh.current;
      const g = ribbonGeometry(held.top);
      if (r && r.geometry !== g) r.geometry = g;
      curtainMesh.current?.scale.set(1, held.top + 0.3, 1);
      if (spin.current) spin.current.rotation.y = -state.clock.elapsedTime * 0.55;
      invalidate();
    });
    const size = pitch;
    return (
      <group position={floor}>
        <mesh
          material={corona}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.012, 0]}
          renderOrder={LAYER.marker}
          raycast={noRaycast}
        >
          <planeGeometry args={[size, size]} />
        </mesh>
        <mesh
          material={xray}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.012, 0]}
          renderOrder={XRAY_ORDER}
          raycast={noRaycast}
        >
          <planeGeometry args={[size, size]} />
        </mesh>
        <mesh
          ref={curtainMesh}
          geometry={heldCurtainGeometry(pitch)}
          material={curtain}
          renderOrder={-1}
          raycast={noRaycast}
        />
        <group ref={spin} scale={[pitch, 1, pitch]}>
          <mesh
            ref={ribbonMesh}
            geometry={ribbonGeometry(held.top)}
            material={ribbon}
            renderOrder={LAYER.trace}
            raycast={noRaycast}
          />
        </group>
      </group>
    );
  };
  return Selection;
};

// --- Check: a red aurora behind the king ----------------------------------------

const curtainFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  float hash(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
  float noise(float x, float period) {
    float i = floor(x);
    float f = fract(x);
    float u = f * f * (3.0 - 2.0 * f);
    return mix(hash(mod(i, period)), hash(mod(i + 1.0, period)), u);
  }
  void main() {
    float u = vUv.x;
    float v = vUv.y;
    // The hem wavers a little round the curtain; above it, rays fade out by the top
    float hemAt = 0.03 + 0.05 * noise(u * 10.0 + uTime * 0.2, 10.0);
    float hem = smoothstep(hemAt - 0.03, hemAt + 0.015, v);
    float glowHem = exp(-max(v - hemAt, 0.0) / 0.1);
    float body = pow(1.0 - v, 2.2);
    float rays = 0.3 + 0.7 * noise(u * 40.0 - uTime * 0.3, 40.0);
    // Soft where the wall turns edge-on, so it never shows a hard outline
    float face = smoothstep(0.05, 0.55, abs(dot(normalize(vNormalW), normalize(cameraPosition - vWorld))));
    float a = hem * (body * rays * 0.6 + glowHem * 0.5) * face;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <colorspace_fragment>
  }`;

const makeCheck = (pitch: number) => {
  const geometry = new CylinderGeometry(0.44 * pitch, 0.44 * pitch, 0.8, 48, 1, true).translate(
    0,
    0.4,
    0,
  );
  const Check = ({ floor }: MarkerProps) => {
    const invalidate = useThree((s) => s.invalidate);
    const material = useMemo(
      () =>
        underPieces(curtainFragment, {
          uTime: { value: 0 },
          uColor: { value: new Color(CHECK) },
        }),
      [],
    );
    useEffect(() => () => material.dispose(), [material]);
    useFrame((state) => {
      material.uniforms.uTime.value = state.clock.elapsedTime;
      invalidate();
    });
    return (
      <>
        <Glyph
          floor={floor}
          kind="hex"
          color={CHECK}
          radius={0.4 * pitch}
          line={0.06 * pitch}
          fill={0.2}
          glow={0.9}
        />
        <mesh
          geometry={geometry}
          material={material}
          position={floor}
          renderOrder={-1}
          raycast={noRaycast}
        />
      </>
    );
  };
  return Check;
};

// --- The set --------------------------------------------------------------------

/**
 * The marker set. `levelY` (towerFrame) tells a mark's level from its
 * floor's height, for the level colour it carries.
 */
export const makeMarkers = (pitch: number, levelY: number[], motionMs: number) => {
  const STAR = 0.25 * pitch;
  const STROKE = 0.045 * pitch;
  const levelOf = (y: number) =>
    levelY.reduce((best, ly, z) => (Math.abs(ly - y) < Math.abs(levelY[best] - y) ? z : best), 0);
  const levelColor = (floor: Vec3) => LEVELS[levelOf(floor[1])];

  const Quiet = ({ floor, hovered }: MarkerProps) => {
    // Straight above or below the held piece: grown out from under it
    const column = useInHeldColumn(floor);
    const radius = column ? 0.45 * pitch : STAR;
    return (
      <Glyph
        floor={floor}
        kind="star"
        color={MOVE}
        radius={hovered ? radius * 1.12 : radius}
        inner={column ? 0.53 : 0.4}
        line={STROKE}
        fill={column ? 0.1 : 0.2}
        glow={0.7}
        level={levelColor(floor)}
        gemRadius={0.075 * pitch}
        seat={column ? 0 : 0.25}
        hovered={hovered}
      />
    );
  };

  // Grown past the victim's base, so its crimson points show all round it
  const Capture = ({ floor, hovered }: MarkerProps) => (
    <Glyph
      floor={floor}
      kind="star"
      color={CAPTURE}
      core={CAPTURE}
      radius={0.47 * pitch}
      steepRadius={0.42 * pitch}
      inner={0.64}
      line={STROKE * 1.1}
      fill={0.14}
      coreAmount={0.55}
      glow={0.8}
      hovered={hovered}
    />
  );

  const LastMove = ({ from, to, fresh = false, arc = 0 }: LastMoveMarkerProps) => {
    // A move straight up or down: seen from above the source plate would
    // hide under the piece and the arrival plate, so it opens wider than both
    const vertical =
      Math.abs(from.floor[0] - to.floor[0]) < 1e-3 && Math.abs(from.floor[2] - to.floor[2]) < 1e-3;
    return (
      <>
        <Glyph
          floor={from.floor}
          kind="hex"
          color={LAST_MOVE}
          radius={(vertical ? 0.46 : 0.22) * pitch}
          line={0.04 * pitch}
          fill={0.16}
          opacity={0.85}
          level={levelColor(from.floor)}
          gemRadius={vertical ? 0 : 0.07 * pitch}
          innerHex={vertical}
        />
        <Glyph
          floor={to.floor}
          kind="hex"
          color={LAST_MOVE}
          radius={0.4 * pitch}
          line={0.045 * pitch}
          fill={0.06}
          opacity={0.95}
          level={levelColor(to.floor)}
          innerHex
        />
        <LastMoveLine
          from={from.floor}
          to={to.floor}
          arc={arc}
          color={LAST_MOVE}
          pulseColor="#fff3d1"
          radius={0.015}
          opacity={0.95}
          shade={0.3}
          pattern="solid"
          flowSpeed={0.5}
          pulse={0.6}
          pulseLength={0.35}
          lift={0.035}
          drawInMs={fresh ? 320 : 0}
          drawInDelayMs={fresh ? motionMs * 0.6 : 0}
        />
      </>
    );
  };

  return {
    Quiet,
    Capture,
    LastMove,
    Selection: makeSelection(pitch, levelOf),
    Check: makeCheck(pitch),
  };
};
