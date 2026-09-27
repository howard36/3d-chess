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
import type { Group } from 'three';
import { LAYER } from '../kit/layers';
import { LastMoveLine } from '../kit/line';
import { noRaycast } from '../kit/noRaycast';
import type { LastMoveMarkerProps, MarkerProps, Vec3 } from '../types';
import { CAPTURE, CHECK, LAST_MOVE, LEVELS, MOVE, SELECT } from './palette';

// The marks on the ice, in one language of ice crystals:
// - a legal destination is a frost star, a small six-pointed crystal lying
//   where the piece would stand;
// - a capture is the same star grown past the victim's base, gone red, with
//   a red core;
// - the last move's squares are hexagonal plates of Polaris gold, joined by
//   the thin gold line (the source a small plate, the destination a wide one
//   round the piece that moved);
// - the selection is an aurora ribbon winding slowly up round the piece,
//   over a ring of aurora light on the ice;
// - check is a red aurora curtain hanging round the king's square, over a
//   red hexagonal plate.
// Everything but the ribbon and the curtain holds still.

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
  uniform float uInner;
  uniform float uLine;
  uniform float uFill;
  uniform float uCoreAmt;
  uniform float uOpacity;
  uniform float uHover;
  uniform float uGlow;
  uniform vec3 uGem;
  uniform float uGemR;
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

  void main() {
    vec2 p = vP;
    float shape;
    if (uKind == 0) shape = sdStar6(p, uRadius, uInner);
    else shape = sdHex(p, uRadius);
    float stroke = abs(shape) - uLine * 0.5;
    float aa = max(fwidth(shape), 1e-4) * 1.1;
    float line = 1.0 - smoothstep(-aa, aa, stroke);
    float inside = 1.0 - smoothstep(-aa, aa, shape);
    // A faint halo just outside the outline: light in the ice
    float halo = exp(-max(shape, 0.0) / (uLine * 2.5)) * (1.0 - inside) * uGlow;
    // The core: a soft disc at the centre (the capture's red heart)
    float core = exp(-pow(length(p) / (uRadius * 0.45), 2.0)) * uCoreAmt;
    float k = 1.0 + 0.5 * uHover;
    vec3 col = uColor;
    float a = max(line * uOpacity * k, inside * (uFill + 0.1 * uHover));
    a = max(a, halo * 0.35 * k);
    col = mix(col, uCore, clamp(core * (1.0 - line), 0.0, 1.0));
    a = max(a, core * 0.8);
    // The gem at the heart of a destination's star, in its level's colour
    if (uGemR > 0.0) {
      float g = sdHex(p, uGemR);
      float ga = max(fwidth(g), 1e-4) * 1.1;
      float gem = 1.0 - smoothstep(-ga, ga, g);
      col = mix(col, uGem, gem);
      a = max(a, gem);
    }
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
  /** Star notch radius. */
  inner?: number;
  line: number;
  fill?: number;
  coreAmount?: number;
  opacity?: number;
  glow?: number;
  /** A small hexagonal gem at the centre in this colour (the destination's level). */
  gem?: string;
  gemRadius?: number;
  hovered?: boolean;
  /** Turn about the vertical, radians. */
  turn?: number;
}

/** One flat crystal glyph on the floor of a cell. */
const Glyph = ({
  floor,
  kind,
  color,
  core = color,
  radius,
  inner = radius * 0.42,
  line,
  fill = 0,
  coreAmount = 0,
  opacity = 0.95,
  glow = 0.6,
  gem,
  gemRadius = 0,
  hovered = false,
  turn = 0,
}: GlyphProps) => {
  const size = (radius + line * 4) * 2.2;
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
          uInner: { value: 0 },
          uLine: { value: 0 },
          uFill: { value: 0 },
          uCoreAmt: { value: 0 },
          uOpacity: { value: 1 },
          uHover: { value: 0 },
          uGlow: { value: 0 },
          uGem: { value: new Color() },
          uGemR: { value: 0 },
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
  u.uInner.value = inner;
  u.uLine.value = line;
  u.uFill.value = fill;
  u.uCoreAmt.value = coreAmount;
  u.uOpacity.value = opacity;
  u.uHover.value = hovered ? 1 : 0;
  u.uGlow.value = glow;
  if (gem) (u.uGem.value as Color).set(gem);
  u.uGemR.value = gem ? gemRadius : 0;
  u.uQuad.value = size;
  return (
    <mesh
      geometry={quad(size)}
      material={material}
      position={[floor[0], floor[1] + 0.014, floor[2]]}
      rotation={[-Math.PI / 2, 0, turn]}
      renderOrder={LAYER.marker}
      raycast={noRaycast}
    />
  );
};

// --- The aurora ribbon (selection) ----------------------------------------------

/**
 * Where the held piece stands (x, z). A destination straight above or below
 * it would hide under the piece (or inside the ribbon) seen from above, so
 * its star grows past the piece's base, like a capture's.
 */
const held = { x: NaN, z: NaN };

const useInHeldColumn = (floor: Vec3) => {
  const [inColumn, setInColumn] = useState(false);
  useFrame(() => {
    const now = Math.abs(floor[0] - held.x) < 1e-3 && Math.abs(floor[2] - held.z) < 1e-3;
    if (now !== inColumn) setInColumn(now);
  });
  return inColumn;
};

const RIBBON = { turns: 1.85, radius: 0.36, bottom: 0.01, top: 1.0, band: 0.13, segments: 200 };

/** A helical band, vertical like a strip of curtain, winding up round the axis. */
const ribbonGeometry = (() => {
  let g: BufferGeometry | null = null;
  return () => {
    if (g) return g;
    const { turns, radius, bottom, top, band, segments } = RIBBON;
    const pos: number[] = [];
    const uv: number[] = [];
    const index: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const s = i / segments;
      const th = s * turns * Math.PI * 2;
      const y = bottom + (top - bottom - band) * s;
      const x = Math.cos(th) * radius;
      const z = Math.sin(th) * radius;
      pos.push(x, y, z, x, y + band, z);
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
    return g;
  };
})();

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
    float over = smoothstep(0.0, 0.35, front) * (1.0 - smoothstep(0.55, 0.85, lateral));
    // From straight above nothing lies over the piece
    float side = level / max(length(cameraPosition - vWorld), 1e-4);
    over *= smoothstep(0.15, 0.5, side);
    // Fades in at the foot and out at the head
    float ends = smoothstep(0.0, 0.06, s) * smoothstep(1.0, 0.7, s);
    // A curtain: a bright lower hem, fading upward
    float hem = pow(1.0 - v, 2.0) * 0.8 + (1.0 - smoothstep(0.1, 0.22, v)) * 0.9;
    // Fine vertical rays and a slow bright pulse climbing the ribbon
    float rays = 0.75 + 0.25 * sin(s * 150.0 + sin(s * 23.0) * 2.0);
    float climb = 0.7 + 0.3 * sin((s * 2.2 - uTime * 0.35) * 6.2831853);
    // It draws itself up from the foot when the piece is picked up
    float grow = smoothstep(uIn * 1.25 - 0.25, uIn * 1.25, s);
    vec3 col = mix(uA, uB, smoothstep(0.1, 0.55, s));
    col = mix(col, uC, smoothstep(0.55, 0.95, s));
    // The hem burns almost white
    col = mix(col, vec3(0.9, 1.0, 0.96), (1.0 - smoothstep(0.0, 0.18, v)) * 0.45);
    float a = ends * hem * rays * climb * (1.0 - grow) * 2.4 * (1.0 - 0.9 * over);
    if (a < 0.003) discard;
    gl_FragColor = vec4(col * (1.0 + max(a - 1.0, 0.0)), min(a, 1.0));
    #include <colorspace_fragment>
  }`;

// The aurora's corona, as seen looking straight up into it: rays of
// light radiating from the held piece, green at their roots and violet at
// their tips, turning slowly. Nothing else on the
// board has rays, so a top-down view knows the selection at once.
const haloFragment = /* glsl */ `
  uniform float uTime;
  uniform float uIn;
  uniform vec3 uA;
  uniform vec3 uB;
  uniform vec3 uC;
  varying vec2 vUv;
  float hash(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
  void main() {
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0;
    const float N = 22.0;
    float k = (atan(p.y, p.x) / 6.2831853 + 0.5) * N + uTime * 0.2;
    float cell = mod(floor(k), N);
    float f = fract(k) - 0.5;
    float len = 0.84 + 0.14 * hash(cell + 3.0);
    float w = 0.13 + 0.1 * hash(cell + 11.0);
    float fa = max(fwidth(k), 1e-4);
    float ray = 1.0 - smoothstep(w - fa, w + fa, abs(f));
    // Rays grow outward from the hem as the piece is picked up
    float reach = 0.7 + (len - 0.7) * uIn;
    float ra = max(fwidth(r), 1e-4);
    ray *= smoothstep(0.7, 0.74, r) * (1.0 - smoothstep(reach - 0.16, reach, r));
    // A soft glow at the rays' roots (no ring: rings are the levels' mark)
    float root = exp(-pow((r - 0.7) / 0.07, 2.0)) * 0.3;
    vec3 col = mix(uA, uB, smoothstep(0.7, 0.84, r));
    col = mix(col, uC, smoothstep(0.82, 0.98, r));
    col = mix(col, vec3(0.85, 1.0, 0.95), (1.0 - smoothstep(0.7, 0.8, r)) * 0.4 * ray);
    float a = max(root, ray * 0.95) * uIn;
    if (a < 0.003) discard;
    gl_FragColor = vec4(col, a);
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

/**
 * The selection: an aurora ribbon that draws itself up round the held
 * piece and keeps winding slowly upward, over a ring of aurora light on the
 * ice (which is what a top-down view sees).
 */
export const makeSelection = (pitch: number) => {
  const Selection = ({ floor }: MarkerProps) => {
    const spin = useRef<Group>(null);
    const invalidate = useThree((s) => s.invalidate);
    const { ribbon, halo } = useMemo(
      () => ({
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
        halo: new ShaderMaterial({
          transparent: true,
          depthWrite: false,
          side: DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
          uniforms: auroraUniforms(),
          vertexShader: passVertex,
          fragmentShader: haloFragment,
        }),
      }),
      [],
    );
    useEffect(
      () => () => {
        ribbon.dispose();
        halo.dispose();
      },
      [ribbon, halo],
    );
    const [fx, , fz] = floor;
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
      for (const m of [ribbon, halo]) {
        m.uniforms.uTime.value = state.clock.elapsedTime;
        m.uniforms.uIn.value = ease;
      }
      if (spin.current) spin.current.rotation.y = -state.clock.elapsedTime * 0.55;
      invalidate();
    });
    const r = pitch * 0.5;
    return (
      <group position={floor}>
        <mesh
          material={halo}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.012, 0]}
          renderOrder={LAYER.marker}
          raycast={noRaycast}
        >
          <planeGeometry args={[r * 2, r * 2]} />
        </mesh>
        <group ref={spin} scale={[pitch, 1, pitch]}>
          <mesh
            geometry={ribbonGeometry()}
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

// --- Check: a red aurora curtain ------------------------------------------------

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
    // The hem wavers a little round the curtain; above it, rays fade upward
    float hemAt = 0.03 + 0.05 * noise(u * 10.0 + uTime * 0.2, 10.0);
    float hem = smoothstep(hemAt - 0.03, hemAt + 0.015, v);
    float glowHem = exp(-max(v - hemAt, 0.0) / 0.08);
    float body = pow(1.0 - v, 2.0);
    float rays = 0.3 + 0.7 * noise(u * 40.0 - uTime * 0.3, 40.0);
    // Soft where the wall turns edge-on, so it never shows a hard outline
    float face = smoothstep(0.05, 0.55, abs(dot(normalize(vNormalW), normalize(cameraPosition - vWorld))));
    float a = hem * (body * rays * 0.6 + glowHem * 0.5) * face;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor, min(a, 1.0));
    #include <colorspace_fragment>
  }`;

const makeCheck = (pitch: number) => {
  const geometry = new CylinderGeometry(0.44 * pitch, 0.44 * pitch, 1.05, 48, 1, true).translate(
    0,
    0.525,
    0,
  );
  const Check = ({ floor }: MarkerProps) => {
    const invalidate = useThree((s) => s.invalidate);
    const material = useMemo(
      () =>
        new ShaderMaterial({
          transparent: true,
          depthWrite: false,
          // Only the far wall: the curtain hangs behind the king, never over it
          side: BackSide,
          blending: AdditiveBlending,
          uniforms: { uTime: { value: 0 }, uColor: { value: new Color(CHECK) } },
          vertexShader: curtainVertex,
          fragmentShader: curtainFragment,
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
          renderOrder={LAYER.trace}
          raycast={noRaycast}
        />
      </>
    );
  };
  return Check;
};

// --- The set --------------------------------------------------------------------

/**
 * The marker set. `levelY` (towerFrame) tells a destination's level from
 * its floor's height, for the gem at the heart of its star.
 */
export const makeMarkers = (pitch: number, levelY: number[], motionMs: number) => {
  const STAR = 0.25 * pitch;
  const levelOf = (y: number) =>
    levelY.reduce((best, ly, z) => (Math.abs(ly - y) < Math.abs(levelY[best] - y) ? z : best), 0);
  const STROKE = 0.045 * pitch;

  const Quiet = ({ floor, hovered }: MarkerProps) => {
    const column = useInHeldColumn(floor);
    const radius = column ? 0.45 * pitch : STAR;
    return (
      <Glyph
        floor={floor}
        kind="star"
        color={MOVE}
        radius={hovered ? radius * 1.12 : radius}
        inner={column ? 0.24 * pitch : STAR * 0.4}
        line={STROKE}
        fill={column ? 0.1 : 0.2}
        glow={0.7}
        gem={LEVELS[levelOf(floor[1])]}
        gemRadius={0.075 * pitch}
        hovered={hovered}
      />
    );
  };

  // Grown past the victim's base, so its red points show all round it
  const Capture = ({ floor, hovered }: MarkerProps) => (
    <Glyph
      floor={floor}
      kind="star"
      color={CAPTURE}
      core={CAPTURE}
      radius={0.47 * pitch}
      inner={0.3 * pitch}
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
        />
        <Glyph
          floor={to.floor}
          kind="hex"
          color={LAST_MOVE}
          radius={0.4 * pitch}
          line={0.045 * pitch}
          fill={0.06}
          opacity={0.95}
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

  return { Quiet, Capture, LastMove, Selection: makeSelection(pitch), Check: makeCheck(pitch) };
};
