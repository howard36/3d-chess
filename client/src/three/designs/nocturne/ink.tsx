import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, DoubleSide, PlaneGeometry, ShaderMaterial } from 'three';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import type { Vec3 } from '../types';

// Nocturne's marks on the platforms, every one a brush mark in moonlit
// pigment, drawn procedurally on a flat quad so it stays crisp at any
// distance and lies exactly on the paper:
//
// - 'enso'     one open brush circle, heavy where the brush comes down and
//              thinning as it lifts (the full moon: where a piece may go);
// - 'crescent' a stroke swelling in the middle and tapering to two points
//              (the last move's squares), turned to face along the move;
// - 'seal'     a square hanko with a double border, pressed a little
//              unevenly (check);
// - 'pool'     a pool of moonlight with a fine ring at its rim (selection).
//
// Silver and gold marks carry flecks of mica that glint as the view turns,
// as mica does on a woodblock print: still while the camera is.

const MAX_FRAME = 1 / 30;

export type InkKind = 'enso' | 'crescent' | 'seal' | 'pool';
const KIND: Record<InkKind, number> = { enso: 0, crescent: 1, seal: 2, pool: 3 };

const vertexShader = /* glsl */ `
  varying vec2 vP;
  varying vec3 vWorld;
  uniform float uQuad;
  void main() {
    vP = (uv - 0.5) * uQuad;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const fragmentShader = /* glsl */ `
  uniform int uKind;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uFill;
  uniform float uR;
  uniform float uW;
  uniform float uGap;
  uniform float uStart;
  uniform float uProgress;
  uniform float uHover;
  uniform float uSeed;
  uniform float uDry;
  uniform float uMica;
  uniform vec3 uLevelColor;
  uniform float uLevelRing;
  varying vec2 vP;
  varying vec3 vWorld;

  const float TAU = 6.28318530718;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  // A hand's unsteadiness round a circle: periodic, so there is no seam
  float wobble(float a, float s) {
    return 0.5 * sin(3.0 * a + s * 1.7) + 0.3 * sin(5.0 * a + s * 4.1) + 0.2 * sin(9.0 * a + s * 2.3);
  }
  float roundBox(vec2 p, float b, float r) {
    vec2 q = abs(p) - vec2(b - r);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  float cover(float d, float aa) {
    return 1.0 - smoothstep(-aa, aa, d);
  }

  void main() {
    vec2 p = vP;
    float r = length(p);
    float aa = max(fwidth(r), 1e-4) * 1.2;
    float a = atan(p.y, p.x);
    float hover = 1.0 + 0.6 * uHover;
    float line = 0.0;
    float area = 0.0;
    float rim = 0.0;
    float dens = 1.0;

    if (uKind == 0 || uKind == 1) {
      // s runs 0..1 along the stroke from where the brush came down
      float span = 1.0 - uGap;
      float t = mod(a - uStart, TAU) / TAU;
      float s = t / span;
      float rr = uR * (1.0 + 0.012 * wobble(a, uSeed) + (uKind == 0 ? 0.03 * (s - 0.5) : 0.0));
      float w;
      if (uKind == 0) {
        // Ensō: loaded at the touch-down, thinning as the brush lifts
        w = uW * hover * mix(1.15, 0.5, pow(clamp(s, 0.0, 1.0), 1.2));
      } else {
        // Crescent: swelling to its middle, a point at each end
        w = uW * hover * pow(max(sin(3.14159 * clamp(s, 0.0, 1.0)), 0.0), 0.75);
      }
      float drawn = uProgress;
      w *= smoothstep(drawn, drawn - 0.08, s);
      float d = s <= min(drawn, 1.0) ? abs(r - rr) - w * 0.5 : 1.0;
      if (uKind == 0 && drawn > 0.0) {
        // The brush's round head where it touched down
        vec2 p0 = rr * vec2(cos(uStart), sin(uStart));
        d = min(d, length(p - p0) - uW * hover * 0.58);
      }
      line = cover(d, aa);
      // Dry brush toward the lift
      float across = clamp((r - rr) / max(w, 1e-4) + 0.5, 0.0, 1.0);
      float dry = uDry * smoothstep(0.55, 1.0, s) * (uKind == 0 ? 1.0 : 0.0);
      float n = vnoise(vec2(across * 9.0 + uSeed * 7.0, s * 3.0)) * 0.7 + vnoise(vec2(s * 30.0, across * 3.0)) * 0.3;
      line *= smoothstep(dry * 0.8 - 0.08, dry * 0.8 + 0.08, n);
      rim = smoothstep(0.3, 0.5, abs(across - 0.5)) * line;
      dens = 0.86 + 0.14 * vnoise(vec2(s * 12.0, uSeed));
      area = cover(r - rr + w * 0.5, aa);
    } else if (uKind == 2) {
      // Seal: a rounded square with a heavy outer border and a fine inner one
      float box = roundBox(p, uR, uR * 0.14);
      float w = uW * (1.0 + 0.12 * wobble(a, uSeed));
      float outer = cover(abs(box + w * 0.5) - w * 0.5, aa);
      float inner = cover(abs(box + w * 1.55) - w * 0.16, aa);
      // The stamp bit unevenly: specks where the ink did not take
      float bite = smoothstep(0.18, 0.32, vnoise(p * 55.0 + uSeed));
      line = max(outer, inner) * mix(0.55, 1.0, bite);
      area = cover(box + w * 1.8, aa) * (0.75 + 0.25 * vnoise(p * 18.0 + uSeed));
      rim = 0.0;
    } else {
      // A pool of moonlight, and the fine ring of its rim
      float rr = uR * uProgress;
      area = exp(-pow(r / max(rr, 1e-4), 2.0) * 2.2) * step(0.001, uProgress);
      line = cover(abs(r - rr) - uW * 0.5, aa) * step(0.001, uProgress);
    }

    float strength = uOpacity * dens * (1.0 + 0.3 * uHover);
    float alpha = max(line * strength, area * (uFill + 0.2 * uHover));
    if (alpha < 0.003 && uLevelRing <= 0.0) discard;
    // Under the pointer the pigment brightens toward moonlight
    vec3 col = mix(uColor, vec3(1.0), 0.35 * uHover) * mix(1.0, 0.8, rim);
    // Mica: flecks in the stroke that catch the light as the view turns
    if (uMica > 0.0) {
      vec2 cell = floor(p * 90.0);
      float h = hash(cell + uSeed);
      if (h > 0.86) {
        vec3 v = normalize(cameraPosition - vWorld);
        float glint = pow(max(0.0, sin(dot(v, vec3(h * 37.0, 11.0 * h, 23.0 * (1.0 - h))))), 16.0);
        col += vec3(1.0) * glint * uMica * line;
      }
    }
    alpha = min(alpha, 1.0);
    // The destination's level: a fine ring of its pigment inside the ensō
    if (uLevelRing > 0.0) {
      float lr = cover(abs(r - uR * 0.6) - uW * 0.16, aa) * uLevelRing;
      float a2 = alpha + lr * (1.0 - alpha);
      col = (col * alpha + uLevelColor * lr * (1.0 - alpha)) / max(a2, 1e-4);
      alpha = a2;
      if (alpha < 0.003) discard;
    }
    gl_FragColor = vec4(col, alpha);
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
  /** Wash inside the mark (0: none). */
  fill?: number;
  /** Ring radius, seal half-side or pool radius (world units). */
  radius?: number;
  /** Stroke width (world units). */
  width?: number;
  /** Fraction of the circle left open (ensō), or not drawn (crescent). */
  gap?: number;
  /** Where the brush comes down (radians, in the floor's plane); by default varies per square. */
  start?: number;
  hovered?: boolean;
  dry?: number;
  /** Mica glints in the stroke (0: none). */
  mica?: number;
  /** A fine ring of this colour inside an ensō: the level of the square it marks. */
  levelColor?: string;
  levelOpacity?: number;
  /** Draw the stroke in (or spread the pool) over this long; 0 shows it at once. */
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
  radius = 0.3,
  width = 0.06,
  gap = 0.08,
  start,
  hovered = false,
  dry = 0.45,
  mica = 0,
  levelColor,
  levelOpacity = 0.9,
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
          uR: { value: 0.3 },
          uW: { value: 0.06 },
          uGap: { value: 0.08 },
          uStart: { value: 0 },
          uProgress: { value: drawMs > 0 ? 0 : 1 },
          uHover: { value: 0 },
          uSeed: { value: 0 },
          uDry: { value: 0.45 },
          uMica: { value: 0 },
          uLevelColor: { value: new Color() },
          uLevelRing: { value: 0 },
        },
        vertexShader,
        fragmentShader,
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
  u.uStart.value = start ?? 2.3 + (seed - 0.5) * 0.9;
  u.uHover.value = hovered ? 1 : 0;
  u.uSeed.value = seed * 10;
  u.uDry.value = dry;
  u.uMica.value = mica;
  u.uLevelRing.value = levelColor ? levelOpacity : 0;
  if (levelColor) (u.uLevelColor.value as Color).set(levelColor);

  // Brush-in: eased once, then the mark holds still
  const elapsed = useRef(-delayMs / 1000);
  const done = useRef(drawMs <= 0);
  useEffect(() => invalidate(), [hovered, invalidate]);
  useFrame((_, delta) => {
    if (done.current) return;
    elapsed.current += Math.min(delta, MAX_FRAME);
    const k = Math.min(Math.max((elapsed.current * 1000) / drawMs, 0), 1);
    u.uProgress.value = kind === 'pool' ? 1 - (1 - k) ** 3 : 1 - (1 - k) ** 2;
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
