import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import { LAYER } from '../kit/layers';
import { ribbonData, tracePath } from '../kit/markerGeometry';
import type { TracePathOptions } from '../kit/markerGeometry';
import { noRaycast } from '../kit/noRaycast';
import type { Vec3 } from '../types';

// Sumi's marks on the platforms, all brushwork: an ensō (one open brush
// circle, heavy where the brush touches down and thinning as it lifts), the
// same ensō turned into a target for a capture, a square seal for check, an
// ink bloom under the selected piece, and the last move's brush stroke. Each
// is a flat quad shaded procedurally, so it stays crisp at any distance, and
// is drawn on the kit's layers, over every platform.

const MAX_FRAME = 1 / 30;

export type InkKind = 'enso' | 'seal' | 'bloom';
const KIND: Record<InkKind, number> = { enso: 0, seal: 1, bloom: 2 };

const inkVertex = /* glsl */ `
  varying vec2 vP;
  uniform float uQuad;
  void main() {
    vP = (uv - 0.5) * uQuad;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const inkFragment = /* glsl */ `
  uniform int uKind;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uFill;
  uniform float uR;
  uniform float uW;
  uniform float uGap;
  uniform float uStart;
  uniform float uProgress;
  uniform float uCapture;
  uniform float uTick;
  uniform float uHover;
  uniform float uSeed;
  uniform float uDry;
  varying vec2 vP;

  const float TAU = 6.28318530718;

  float hash(float n) { return fract(sin(n) * 43758.5453123); }
  float vnoise(float x) {
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash(i), hash(i + 1.0), f);
  }
  // A hand's unsteadiness round a circle: periodic, so there is no seam
  float wobble(float a, float s) {
    return 0.5 * sin(3.0 * a + s * 1.7) + 0.3 * sin(5.0 * a + s * 4.1) + 0.2 * sin(9.0 * a + s * 2.3);
  }
  float roundBox(vec2 p, float b, float r) {
    vec2 q = abs(p) - vec2(b - r);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  // A tick along +x out from the ring, tapering to a point as it leaves
  float tick(vec2 q, float r, float len, float w) {
    float k = clamp((q.x - r) / len, 0.0, 1.0);
    float tw = w * mix(1.0, 0.3, k);
    return max(abs(q.y) - tw * 0.5, max((r - w * 0.3) - q.x, q.x - (r + len)));
  }

  void main() {
    vec2 p = vP;
    float r = length(p);
    float aa = max(fwidth(r), 1e-4) * 1.25;
    float a = atan(p.y, p.x);
    // Under the pointer: a bolder stroke and a faint wash of its colour inside
    float hover = 1.0 + 0.25 * uHover;
    float line = 0.0;   // stroke coverage
    float rim = 0.0;    // pooled ink at a stroke's edges (darker)
    float area = 0.0;   // wash inside the mark
    float dens = 1.0;   // ink density along the stroke

    if (uKind == 0) {
      // Ensō: s runs 0..1 along the stroke from where the brush touched down
      float span = 1.0 - uGap;
      float t = mod(a - uStart, TAU) / TAU;
      float s = t / span;
      float rr = uR * (1.0 + 0.035 * (s - 0.5) + 0.012 * wobble(a, uSeed));
      float w = uW * hover * mix(1.16, 0.46, pow(clamp(s, 0.0, 1.0), 1.25));
      // Lifting off: the tip tapers to a point where the stroke ends
      float drawn = uProgress;
      w *= smoothstep(drawn, drawn - 0.1, s);
      float d = s <= drawn ? abs(r - rr) - w * 0.5 : 1.0;
      // The brush's touch-down: a round head
      float w0 = uW * hover * 1.16;
      vec2 p0 = uR * (1.0 - 0.0175) * vec2(cos(uStart), sin(uStart));
      if (drawn > 0.0) d = min(d, length(p - p0) - w0 * 0.5);
      line = 1.0 - smoothstep(-aa, aa, d);
      // Dry brush: fine gaps along the stroke, opening up as the ink runs out
      float across = clamp((r - rr) / max(w, 1e-4) + 0.5, 0.0, 1.0);
      float dry = uDry * smoothstep(0.5, 1.0, s);
      float n = vnoise(across * 11.0 + uSeed * 7.0) * 0.7 + vnoise(s * 26.0 + across * 3.0) * 0.3;
      line *= smoothstep(dry * 0.75 - 0.08, dry * 0.75 + 0.08, n);
      rim = smoothstep(0.28, 0.5, abs(across - 0.5)) * line;
      dens = 0.88 + 0.12 * vnoise(s * 13.0 + uSeed * 3.0);
      area = 1.0 - smoothstep(-aa, aa, r - rr + w * 0.5);
      if (uCapture > 0.5) {
        // The capture cue: four brushed ticks out from the ring, a crosshair
        // round the piece to be taken (outward, so the piece never hides them)
        vec2 q = abs(p);
        float tk = min(tick(q, uR, uTick, uW * hover), tick(q.yx, uR, uTick, uW * hover));
        line = max(line, 1.0 - smoothstep(-aa, aa, tk));
      }
    } else if (uKind == 1) {
      // Seal: a rounded square with a brushed, slightly uneven border
      float box = roundBox(p, uR, uR * 0.16);
      float w = uW * (1.0 + 0.14 * wobble(a, uSeed));
      float d = abs(box) - w * 0.5;
      line = 1.0 - smoothstep(-aa, aa, d);
      area = 1.0 - smoothstep(-aa, aa, box);
      rim = smoothstep(0.2, 0.5, abs(box) / max(w, 1e-4)) * line;
    } else {
      // Bloom: ink dropped on damp paper, spreading to a ragged edge where it pools
      float k = uProgress;
      float rb = uR * k * (1.0 + 0.06 * wobble(a, uSeed));
      area = (1.0 - smoothstep(rb - 0.05, rb, r)) * (0.75 + 0.25 * smoothstep(0.0, rb, r));
      line = exp(-pow((r - (rb - 0.022)) / 0.018, 2.0)) * step(0.001, k);
    }

    float strength = uOpacity * dens * (1.0 + 0.3 * uHover);
    float alpha = max(line * strength, area * (uFill + 0.16 * uHover));
    if (alpha < 0.003) discard;
    vec3 col = uColor * mix(1.0, 0.72, rim);
    gl_FragColor = vec4(col, min(alpha, 1.0));
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

/** A stable pseudo-random value per square, so each brush mark is a little different. */
export const seedOf = (floor: Vec3) =>
  Math.abs(Math.sin(floor[0] * 12.9898 + floor[1] * 4.1414 + floor[2] * 78.233) * 43758.5453) % 1;

export interface InkMarkProps {
  floor: Vec3;
  kind?: InkKind;
  color: string;
  opacity?: number;
  fill?: number;
  /** Ring radius, seal half-side or bloom radius (world units). */
  radius?: number;
  /** Stroke width (world units). */
  width?: number;
  /** Fraction of the circle an ensō leaves open. */
  gap?: number;
  /** Where the brush touches down (radians); by default varies a little per square. */
  start?: number;
  capture?: boolean;
  tick?: number;
  hovered?: boolean;
  dry?: number;
  /** Draw the stroke in (or spread the bloom) over this long; 0 shows it at once. */
  drawMs?: number;
  delayMs?: number;
  /** Side of the quad it is drawn on. */
  quad?: number;
  lift?: number;
  renderOrder?: number;
}

/** One brush mark lying on the platform at a square's floor. */
export const InkMark = ({
  floor,
  kind = 'enso',
  color,
  opacity = 0.9,
  fill = 0,
  radius = 0.34,
  width = 0.06,
  gap = 0.1,
  start,
  capture = false,
  tick = 0.13,
  hovered = false,
  dry = 0.45,
  drawMs = 0,
  delayMs = 0,
  quad = 1,
  lift = 0.012,
  renderOrder = LAYER.marker,
}: InkMarkProps) => {
  const invalidate = useThree((s) => s.invalidate);
  const seed = seedOf(floor);
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
          uOpacity: { value: 1 },
          uFill: { value: 0 },
          uQuad: { value: 1 },
          uR: { value: 0.34 },
          uW: { value: 0.06 },
          uGap: { value: 0.1 },
          uStart: { value: 0 },
          uProgress: { value: drawMs > 0 ? 0 : 1 },
          uCapture: { value: 0 },
          uTick: { value: 0.13 },
          uHover: { value: 0 },
          uSeed: { value: 0 },
          uDry: { value: 0.45 },
        },
        vertexShader: inkVertex,
        fragmentShader: inkFragment,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one material per mark
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  const u = material.uniforms;
  u.uKind.value = KIND[kind];
  (u.uColor.value as Color).set(color);
  u.uOpacity.value = opacity;
  u.uFill.value = fill;
  u.uQuad.value = quad;
  u.uR.value = radius;
  u.uW.value = width;
  u.uGap.value = gap;
  // The brush comes down near the upper left, as a right hand would start
  u.uStart.value = start ?? 2.2 + (seed - 0.5) * 0.9;
  u.uCapture.value = capture ? 1 : 0;
  u.uTick.value = tick;
  u.uHover.value = hovered ? 1 : 0;
  u.uSeed.value = seed * 10;
  u.uDry.value = dry;

  // Brush-in: eased once, then the mark holds still and the loop idles
  const elapsed = useRef(-delayMs / 1000);
  const done = useRef(drawMs <= 0);
  useFrame((_, delta) => {
    if (done.current) return;
    elapsed.current += Math.min(delta, MAX_FRAME);
    const k = Math.min(Math.max((elapsed.current * 1000) / drawMs, 0), 1);
    u.uProgress.value = kind === 'bloom' ? 1 - (1 - k) ** 3 : 1 - (1 - k) ** 2;
    if (k >= 1) done.current = true;
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

// --- The last move's brush stroke ---------------------------------------------

/** Length of a trace along its path (the largest `aAlong`). */
const lengthOf = (g: BufferGeometry) => {
  const along = g.getAttribute('aAlong');
  let max = 0;
  for (let i = 0; i < along.count; i++) max = Math.max(max, along.getX(i));
  return max;
};

const traceVertex = /* glsl */ `
  attribute vec3 aTangent;
  attribute float aSide;
  attribute float aHalf;
  attribute float aAlong;
  uniform float uShaftEnd;
  varying float vAcross;
  varying float vHalf;
  varying float vAlong;
  void main() {
    // The brush enters light and presses down: thin at the source, full by a third of the way
    float taper = aAlong < uShaftEnd ? mix(0.38, 1.0, smoothstep(0.0, uShaftEnd * 0.45, aAlong)) : 1.0;
    float halfWidth = aHalf * taper;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 t = normalize(mat3(modelMatrix) * aTangent);
    vec3 toCamera = normalize(cameraPosition - world.xyz);
    vec3 across = cross(t, toCamera);
    float l = length(across);
    across = l > 1e-4 ? across / l : vec3(1.0, 0.0, 0.0);
    world.xyz += across * aSide * halfWidth;
    vAcross = aSide * halfWidth;
    vHalf = halfWidth;
    vAlong = aAlong;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const traceFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uEdge;
  uniform float uOpacity;
  uniform float uShaftEnd;
  uniform float uChevron;
  uniform float uSeed;
  uniform float uDraw;
  varying float vAcross;
  varying float vHalf;
  varying float vAlong;

  float hash(float n) { return fract(sin(n) * 43758.5453123); }
  float vnoise(float x) {
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash(i), hash(i + 1.0), f);
  }

  void main() {
    // Brushed in from the source: nothing beyond the brush's tip yet
    if (vAlong > uDraw) discard;
    float d = abs(vAcross);
    float aa = max(fwidth(vAcross), 1e-4);
    float body = 1.0 - smoothstep(vHalf - aa, vHalf + aa * 0.5, d);
    float u = vHalf > 1e-4 ? vAcross / vHalf : 0.0;
    // A crisp indigo edge keeps the stroke legible over paper and glass
    float edgeW = min(0.022, vHalf * 0.3);
    float rim = smoothstep(vHalf - edgeW - aa, vHalf - edgeW + aa, d);
    vec3 col = uColor;
    // Dry-brush streaks where the brush entered light
    float dry = 1.0 - smoothstep(0.0, uShaftEnd * 0.4, vAlong);
    float n = vnoise(u * 5.0 + 5.0 + uSeed) * 0.75 + vnoise(vAlong * 14.0) * 0.25;
    body *= mix(1.0, smoothstep(0.32, 0.5, n), dry * 0.85);
    if (uChevron > 0.0 && vAlong < uShaftEnd - uChevron * 0.35) {
      // Paler chevrons along the shaft, pointing the way the piece went
      float phase = fract((vAlong - d * 1.3) / uChevron);
      float ab = max(fwidth(phase), 1e-4);
      float band = smoothstep(0.0, ab, phase) * (1.0 - smoothstep(0.3 - ab, 0.3, phase));
      col = mix(col, vec3(1.0), band * 0.42 * (1.0 - rim));
    }
    col = mix(col, uEdge, rim);
    float a = body * uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }`;

export interface BrushTraceProps extends TracePathOptions {
  from: Vec3;
  to: Vec3;
  color: string;
  edgeColor: string;
  opacity?: number;
  width?: number;
  headLength?: number;
  headWidth?: number;
  chevrons?: number;
  /** Brush the stroke in from the source over this long (0: at once). */
  drawMs?: number;
  delayMs?: number;
}

/**
 * The last move as one brush stroke from the source square to the
 * destination: straight along a platform, arcing between levels (the kit's
 * path), thin where the brush enters and full-bodied at the arrowhead
 * beside the piece that moved, with pale chevrons pointing the way.
 */
export const BrushTrace = ({
  from,
  to,
  color,
  edgeColor,
  opacity = 1,
  width = 0.11,
  headLength = 0.3,
  headWidth = 0.32,
  chevrons = 0.4,
  drawMs = 0,
  delayMs = 0,
  ...pathOptions
}: BrushTraceProps) => {
  const invalidate = useThree((s) => s.invalidate);
  const key = JSON.stringify([from, to, width, headLength, headWidth, pathOptions]);
  const { geometry, shaftEnd } = useMemo(() => {
    const data = ribbonData(tracePath(from, to, pathOptions), { width, headLength, headWidth });
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(data.position, 3));
    g.setAttribute('aTangent', new BufferAttribute(data.tangent, 3));
    g.setAttribute('aSide', new BufferAttribute(data.side, 1));
    g.setAttribute('aHalf', new BufferAttribute(data.halfWidth, 1));
    g.setAttribute('aAlong', new BufferAttribute(data.along, 1));
    g.setIndex(data.index);
    g.computeBoundingSphere();
    return { geometry: g, shaftEnd: data.length - Math.min(headLength, data.length * 0.6) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the values themselves
  }, [key]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        uniforms: {
          uColor: { value: new Color() },
          uEdge: { value: new Color() },
          uOpacity: { value: 1 },
          uShaftEnd: { value: 1 },
          uChevron: { value: 0 },
          uSeed: { value: 0 },
          uDraw: { value: drawMs > 0 ? -1 : 1e6 },
        },
        vertexShader: traceVertex,
        fragmentShader: traceFragment,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one material per stroke
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const u = material.uniforms;
  (u.uColor.value as Color).set(color);
  (u.uEdge.value as Color).set(edgeColor);
  u.uOpacity.value = opacity;
  u.uShaftEnd.value = shaftEnd;
  u.uChevron.value = chevrons;
  u.uSeed.value = seedOf(from) * 10;

  // The brush sweeps from the source, quick then settling, and flicks the head on last
  const total = useMemo(() => lengthOf(geometry), [geometry]);
  const elapsed = useRef(-delayMs / 1000);
  const done = useRef(drawMs <= 0);
  useFrame((_, delta) => {
    if (done.current) return;
    elapsed.current += Math.min(delta, MAX_FRAME);
    const k = Math.min(Math.max((elapsed.current * 1000) / drawMs, 0), 1);
    u.uDraw.value = elapsed.current < 0 ? -1 : (1 - (1 - k) ** 2) * total + (k >= 1 ? 1 : 0);
    if (k >= 1) done.current = true;
    invalidate();
  });

  return (
    <mesh
      geometry={geometry}
      material={material}
      renderOrder={LAYER.trace}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};
