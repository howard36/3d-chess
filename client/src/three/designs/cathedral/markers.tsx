import { useEffect, useMemo, useRef } from 'react';
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
import type { Mesh } from 'three';
import { LAYER } from '../kit/layers';
import { LastMoveLine } from '../kit/line';
import { noRaycast } from '../kit/noRaycast';
import { rng } from '../kit/textures';
import type { LastMoveMarkerProps, MarkerProps, Vec3 } from '../types';
import { GILT, GILT_DEEP, IVORY, RUBY, RUBY_DEEP, SUNLIGHT } from './palette';

// Vitrail's marks, all lying flat on the glass like light and gilding laid
// on a window: a gilt quatrefoil where a piece may go; the same quatrefoil
// in ruby, opened round the victim's base and cusped with four thorns, for a
// capture; a candle-ivory rosette on each square of the last move, joined by
// a thin thread of the same light; a crown of ruby light round a king in
// check; and for the selection, a shaft of sunlight falling through the
// tower onto the piece, pooling on the glass round its base, motes of dust
// turning slowly in it. Every mark is one quad shaded by a signed-distance
// function, crisp and antialiased at any angle, with a thin dark keyline so
// it holds on pale glass as well as dark.

export const SHAPE = {
  quatrefoil: 0,
  capture: 1,
  rosette: 2,
  crown: 3,
  pool: 4,
  pane: 5,
} as const;
export type MarkShape = keyof typeof SHAPE;

const vertexShader = /* glsl */ `
  uniform float uQuad;
  varying vec2 vP;
  void main() {
    vP = (uv - 0.5) * uQuad;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const fragmentShader = /* glsl */ `
  uniform int uShape;
  uniform vec3 uColor;
  uniform vec3 uKey;
  uniform float uOpacity;
  uniform float uFill;
  uniform float uRadius;
  uniform float uWidth;
  uniform float uKeyAlpha;
  uniform float uHover;
  uniform float uGrow;
  varying vec2 vP;

  const float PI = 3.14159265;

  float sdQuatrefoil(vec2 p, float R) {
    float c = R * 0.43;
    float r = R - c;
    float d = length(p - vec2(c, 0.0)) - r;
    d = min(d, length(p + vec2(c, 0.0)) - r);
    d = min(d, length(p - vec2(0.0, c)) - r);
    d = min(d, length(p + vec2(0.0, c)) - r);
    return d;
  }
  float segment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }
  // A thorn along the diagonal, from radius a to b, tapering to its point
  float thorn(vec2 p, float a, float b, float w) {
    vec2 q = abs(p);
    vec2 d = vec2(0.70710678);
    vec2 pa = q - d * a;
    vec2 ba = d * (b - a);
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - w * (1.0 - 0.8 * h);
  }

  void main() {
    // Under the pointer a mark swells a little, as if the glass caught the light
    vec2 p = vP / max(uGrow * (1.0 + 0.12 * uHover), 0.001);
    float R = uRadius;
    float r = length(p);
    float ang = atan(p.y, p.x);
    float stroke = 1e3;   // signed distance to the stroke
    float area = 1e3;     // signed distance to what it encloses
    float glow = 0.0;     // soft light, added to the fill
    if (uShape == 0) {
      float q = sdQuatrefoil(p, R);
      stroke = abs(q) - uWidth * 0.5;
      area = q;
    } else if (uShape == 1) {
      float q = sdQuatrefoil(p, R);
      stroke = abs(q) - uWidth * 0.5;
      area = q;
      // Four thorns out from the cusps, toward the square's corners
      stroke = min(stroke, thorn(p, R * 0.66, R * 1.14, uWidth * 0.7));
    } else if (uShape == 2) {
      // Eight petals: a rosette
      float rr = R * (0.9 + 0.1 * abs(cos(ang * 4.0)));
      float s = (r - rr) * 0.9;
      stroke = abs(s) - uWidth * 0.5;
      area = s;
    } else if (uShape == 3) {
      // A crown of light: a band with eight tines, and a ruby floor within
      float seg = PI / 4.0;
      float phi = mod(ang + seg * 0.5, seg) - seg * 0.5;
      float tine = max(0.0, 1.0 - abs(phi) / (seg * 0.28));
      float outer = R + R * 0.24 * tine;
      stroke = max(R - uWidth - r, r - outer);
      area = r - R;
    } else if (uShape == 4) {
      // A pool of sunlight: bright at the heart, soft at the rim, ringed
      stroke = abs(r - R) - uWidth * 0.5;
      area = r - R;
      float k = r / (R * 1.25);
      glow = exp(-k * k * 2.6);
      // Faint petals of the window the light came through
      glow *= 0.82 + 0.18 * cos(ang * 8.0) * smoothstep(0.15, 0.6, k);
    } else {
      // A pane lit from within: a soft square
      vec2 q = abs(p) - vec2(R * 0.82);
      float b = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - R * 0.18;
      area = b;
      glow = 1.0 - smoothstep(-R * 0.5, R * 0.05, b);
    }
    float aa = max(fwidth(stroke), 1e-4);
    float line = 1.0 - smoothstep(-aa, aa, stroke);
    float key = 1.0 - smoothstep(-aa, aa, stroke - uWidth * 0.55);
    float ia = max(fwidth(area), 1e-4);
    float inside = 1.0 - smoothstep(-ia, ia, area);
    // Gilding catches the light unevenly round the stroke
    float sheen = 0.84 + 0.3 * (0.5 + 0.5 * sin(ang * 2.0 + 0.9));
    vec3 lit = uColor * sheen * (1.0 + 0.45 * uHover);
    float strength = uOpacity * (1.0 + 0.5 * uHover);
    float fill = (uFill + 0.26 * uHover) * inside + glow * uFill;
    float a = line * strength;
    float halo = max(key - line, 0.0) * uKeyAlpha;
    vec3 col = lit;
    float alpha = a + (1.0 - a) * fill;
    col = mix(uColor, lit, a / max(alpha, 1e-4));
    // The keyline goes under everything
    float outA = alpha + (1.0 - alpha) * halo;
    col = mix(uKey, col, alpha / max(outA, 1e-4));
    if (outA < 0.003) discard;
    gl_FragColor = vec4(col, min(outA, 1.0));
    #include <colorspace_fragment>
  }`;

const planes = new Map<number, PlaneGeometry>();
const planeFor = (size: number) => {
  let g = planes.get(size);
  if (!g) {
    g = new PlaneGeometry(size, size);
    planes.set(size, g);
  }
  return g;
};

export interface GlassMarkProps {
  floor: Vec3;
  shape: MarkShape;
  color: string;
  /** Keyline colour, drawn just outside the stroke. */
  keyColor?: string;
  keyAlpha?: number;
  /** Size of the shape (world units: the quatrefoil's outer reach). */
  radius: number;
  /** Stroke width (world units). */
  width?: number;
  opacity?: number;
  fill?: number;
  hovered?: boolean;
  /** Grow in from nothing over this long when mounted (0: at once). */
  growMs?: number;
  delayMs?: number;
  lift?: number;
  renderOrder?: number;
  additive?: boolean;
}

/** One flat mark on the glass at a cell's floor. */
export const GlassMark = ({
  floor,
  shape,
  color,
  keyColor = '#140c06',
  keyAlpha = 0.45,
  radius,
  width = 0.04,
  opacity = 0.95,
  fill = 0,
  hovered = false,
  growMs = 0,
  delayMs = 0,
  lift = 0.014,
  renderOrder = LAYER.marker,
  additive = false,
}: GlassMarkProps) => {
  const invalidate = useThree((s) => s.invalidate);
  const quad = radius * (shape === 'capture' ? 2.9 : shape === 'crown' ? 2.6 : 2.4);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: additive ? AdditiveBlending : undefined,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        uniforms: {
          uShape: { value: 0 },
          uColor: { value: new Color() },
          uKey: { value: new Color() },
          uOpacity: { value: 1 },
          uFill: { value: 0 },
          uRadius: { value: 0.3 },
          uWidth: { value: 0.04 },
          uKeyAlpha: { value: 0.4 },
          uHover: { value: 0 },
          uGrow: { value: growMs > 0 ? 0 : 1 },
          uQuad: { value: 1 },
        },
        vertexShader,
        fragmentShader,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- configured once per mount
    [additive],
  );
  useEffect(() => () => material.dispose(), [material]);
  const u = material.uniforms;
  u.uShape.value = SHAPE[shape];
  (u.uColor.value as Color).set(color);
  (u.uKey.value as Color).set(keyColor);
  u.uOpacity.value = opacity;
  u.uFill.value = fill;
  u.uRadius.value = radius;
  u.uWidth.value = width;
  u.uKeyAlpha.value = keyAlpha;
  u.uHover.value = hovered ? 1 : 0;
  u.uQuad.value = quad;

  // Grow in: a quick overshoot, like a drop of light landing
  const since = useRef(-delayMs);
  useEffect(() => invalidate(), [invalidate]);
  useFrame((_, delta) => {
    if (growMs <= 0 || since.current >= growMs) return;
    since.current += Math.min(delta, 1 / 20) * 1000;
    const k = Math.min(Math.max(since.current / growMs, 0), 1);
    const back = 1 + 2.2 * (k - 1) ** 3 + 1.2 * (k - 1) ** 2;
    u.uGrow.value = since.current < 0 ? 0.001 : Math.max(back, 0.001);
    invalidate();
  });

  return (
    <mesh
      geometry={planeFor(quad)}
      material={material}
      position={[floor[0], floor[1] + lift, floor[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={renderOrder}
      raycast={noRaycast}
    />
  );
};

// --- The selection's shaft of light ----------------------------------------------

const shaftVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const shaftFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    vec3 view = normalize(cameraPosition - vWorld);
    vec3 n = normalize(vNormalW);
    // Thickest through the middle of the beam, as a volume of lit dust would be
    float through = pow(abs(dot(n, view)), 1.6);
    // Soft at the floor, fading out toward the platform above
    float h = vUv.y;
    float along = smoothstep(0.0, 0.1, h) * pow(1.0 - h, 1.3);
    // Slow bands of brighter dust drifting down the beam
    float bands = 0.85 + 0.15 * sin(h * 14.0 + uTime * 0.9 + vUv.x * 12.566);
    float a = uStrength * through * along * bands;
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }`;

const moteVertex = /* glsl */ `
  uniform float uTime;
  uniform float uScale;
  uniform float uHeight;
  uniform float uRadius;
  attribute vec3 aSeed;
  varying float vAlpha;
  void main() {
    // Each mote drifts slowly down the beam, turning round its axis
    float t = uTime * (0.05 + 0.04 * aSeed.z) + aSeed.x;
    float h = fract(-t);
    float a = aSeed.y * 6.2831853 + uTime * 0.25 * (aSeed.z - 0.5);
    float rr = uRadius * (0.25 + 0.75 * fract(aSeed.x * 7.13));
    vec3 p = vec3(cos(a) * rr, h * uHeight, sin(a) * rr);
    vAlpha = smoothstep(0.0, 0.15, h) * smoothstep(1.0, 0.6, h) * (0.55 + 0.45 * sin(uTime * 1.7 + aSeed.x * 30.0));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = (0.022 + 0.018 * aSeed.z) * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;

const moteFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float a = smoothstep(0.5, 0.0, d) * vAlpha * 0.9;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }`;

const SHAFT_RADIUS = 0.36;
const shaftGeometry = new CylinderGeometry(
  SHAFT_RADIUS,
  SHAFT_RADIUS * 1.12,
  1,
  32,
  1,
  true,
).translate(0, 0.5, 0);
const MOTES = 18;
const moteGeometry = (() => {
  const g = new BufferGeometry();
  const random = rng(17);
  const seeds = new Float32Array(MOTES * 3);
  for (let i = 0; i < MOTES * 3; i++) seeds[i] = random();
  g.setAttribute('position', new BufferAttribute(new Float32Array(MOTES * 3), 3));
  g.setAttribute('aSeed', new BufferAttribute(seeds, 3));
  return g;
})();

/**
 * A shaft of sunlight falling onto the selected piece from the window high
 * above: a soft beam fading out below the platform above, with motes of
 * dust drifting slowly down it. It rises into view when the piece is
 * picked up.
 */
export const LightShaft = ({ floor, height }: { floor: Vec3; height: number }) => {
  const invalidate = useThree((s) => s.invalidate);
  const shaft = useRef<Mesh>(null);
  const { beam, motes } = useMemo(() => {
    const beam = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      // Only the far half of the beam: the near half would lay its light over
      // the piece and wash out its army's colour
      side: BackSide,
      uniforms: {
        uColor: { value: new Color(SUNLIGHT) },
        uStrength: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: shaftVertex,
      fragmentShader: shaftFragment,
    });
    const motes = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uColor: { value: new Color('#fff1cf') },
        uTime: { value: 0 },
        uScale: { value: 400 },
        uHeight: { value: height },
        uRadius: { value: SHAFT_RADIUS * 0.9 },
      },
      vertexShader: moteVertex,
      fragmentShader: moteFragment,
    });
    return { beam, motes };
  }, [height]);
  useEffect(
    () => () => {
      beam.dispose();
      motes.dispose();
    },
    [beam, motes],
  );
  const age = useRef(0);
  useEffect(() => invalidate(), [invalidate]);
  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 20);
    age.current += dt;
    const k = Math.min(age.current / 0.35, 1);
    const ease = 1 - (1 - k) ** 3;
    beam.uniforms.uStrength.value = 1.0 * ease;
    beam.uniforms.uTime.value = age.current;
    motes.uniforms.uTime.value = age.current;
    const size = state.size.height * state.viewport.dpr;
    motes.uniforms.uScale.value = size / (2 * Math.tan((36 * Math.PI) / 360));
    if (shaft.current) shaft.current.scale.set(1, height * (0.4 + 0.6 * ease), 1);
    // The dust keeps turning while the piece is held
    invalidate();
  });
  return (
    <group position={floor}>
      <mesh
        ref={shaft}
        geometry={shaftGeometry}
        material={beam}
        scale={[1, 0.001, 1]}
        renderOrder={LAYER.trace + 0.5}
        raycast={noRaycast}
      />
      <points
        geometry={moteGeometry}
        material={motes}
        renderOrder={LAYER.trace + 0.6}
        raycast={noRaycast}
        frustumCulled={false}
      />
    </group>
  );
};

// --- The set -----------------------------------------------------------------------

export interface MarkerSetOptions {
  pitch: number;
  /** Height of the air between one platform and the next (for the shaft). */
  gap: number;
  /** How long a move glides (the last move's marks wait for it to land). */
  moveMs: number;
}

export const makeMarkers = ({ pitch, gap, moveMs }: MarkerSetOptions) => {
  const QUATREFOIL = 0.36 * pitch;
  const CAPTURE = 0.46 * pitch;
  const ROSETTE = 0.39 * pitch;

  /** A legal destination: a small gilt quatrefoil. */
  const Quiet = ({ floor, hovered }: MarkerProps) => (
    <GlassMark
      floor={floor}
      shape="quatrefoil"
      color={GILT}
      keyColor={GILT_DEEP}
      radius={QUATREFOIL}
      width={0.05 * pitch}
      fill={0.16}
      hovered={hovered}
    />
  );

  /** A capture: the quatrefoil in ruby glass, opened round the victim, with four thorns. */
  const Capture = ({ floor, hovered }: MarkerProps) => (
    <GlassMark
      floor={floor}
      shape="capture"
      color={RUBY}
      keyColor={RUBY_DEEP}
      radius={CAPTURE}
      width={0.052 * pitch}
      fill={0.2}
      hovered={hovered}
    />
  );

  /** The selection: sunlight pooling round the piece's base, and the shaft it falls in. */
  const Selection = ({ floor }: MarkerProps) => (
    <>
      <GlassMark
        floor={floor}
        shape="pool"
        color={SUNLIGHT}
        radius={0.4 * pitch}
        width={0.026 * pitch}
        opacity={0.85}
        fill={0.34}
        keyAlpha={0}
        growMs={300}
        renderOrder={LAYER.shadow + 0.5}
        lift={0.008}
      />
      <LightShaft floor={floor} height={gap * 0.92} />
    </>
  );

  /**
   * The last move: an ivory rosette on the square it left and on the square
   * it reached, joined by a thin thread of candlelight from centre to
   * centre. A fresh move draws its thread in behind the gliding piece, and
   * the destination's rosette blooms as it lands.
   */
  const LastMove = ({ from, to, fresh = false, arc = 0 }: LastMoveMarkerProps) => (
    <>
      <GlassMark
        floor={from.floor}
        shape="rosette"
        color={IVORY}
        keyColor="#2a1d10"
        radius={ROSETTE * 0.78}
        width={0.028 * pitch}
        opacity={0.62}
        fill={0.07}
        keyAlpha={0.3}
      />
      <GlassMark
        floor={to.floor}
        shape="rosette"
        color={IVORY}
        keyColor="#2a1d10"
        radius={ROSETTE}
        width={0.032 * pitch}
        opacity={0.88}
        fill={0.05}
        keyAlpha={0.3}
        growMs={fresh ? 320 : 0}
        delayMs={moveMs * 0.85}
      />
      <LastMoveLine
        from={from.floor}
        to={to.floor}
        arc={arc}
        color={IVORY}
        pulseColor="#fff7e2"
        radius={0.013}
        opacity={0.9}
        shade={0.3}
        pulse={0.55}
        pulseLength={0.35}
        flowSpeed={0.45}
        outline="#3a2a18"
        outlineWidth={0.006}
        drawInMs={fresh ? moveMs * 0.9 : 0}
      />
    </>
  );

  /** Check: the king's square turns to ruby glass inside a crown of red light. */
  const Check = ({ floor }: MarkerProps) => (
    <>
      <GlassMark
        floor={floor}
        shape="pane"
        color={RUBY}
        radius={0.47 * pitch}
        opacity={0}
        fill={0.28}
        keyAlpha={0}
        renderOrder={LAYER.shadow + 0.4}
        lift={0.006}
      />
      <GlassMark
        floor={floor}
        shape="crown"
        color={RUBY}
        keyColor={RUBY_DEEP}
        radius={0.4 * pitch}
        width={0.045 * pitch}
        opacity={1}
        keyAlpha={0.5}
        growMs={420}
      />
    </>
  );

  return { Quiet, Capture, Selection, LastMove, Check };
};
