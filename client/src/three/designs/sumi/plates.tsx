import { useEffect, useMemo } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  MultiplyBlending,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import { useLevelFocus } from '../kit/focus';
import { LAYER } from '../kit/layers';
import { towerFrame } from '../kit/layouts';
import { noRaycast } from '../kit/noRaycast';
import type { BoardLayout } from '../types';
import { washiTexture } from './textures';

// Washi platforms: one sheet of hand-made paper per level, the dark squares
// a faint ink wash, bordered by four brush strokes in the level's own ink.
// The sheet is multiplied over what lies behind it, as ink and paper really
// combine: it can only darken, faintly, so a lacquer piece under three sheets
// is still black and a porcelain one still reads white. The checker is kept
// to a whisper (three stacked sheets swing the value about a tenth), so the
// levels are told apart by their brushed edges and letters, not their fill.

export interface WashiPlatesProps {
  layout: BoardLayout;
  /** One ink per level, A to E, for the brushed perimeter. */
  inks: string[];
  /** Multiply colour of the light squares (0–255 per channel; 255 is clear). */
  light?: number[];
  /** Multiply colour of the dark squares. */
  dark?: number[];
  /** Width of the brush stroke along each edge (world units), before emphasis. */
  edgeWidth?: number;
  edgeOpacity?: number;
  /** How far the perimeter sits outside the outer squares. */
  margin?: number;
  /** The level to emphasise (focusLevelOf(GridProps.focus)); null for none. */
  focusLevel?: number | null;
}

// --- The brushed perimeter --------------------------------------------------------

const edgeVertex = /* glsl */ `
  attribute vec3 aTangent;
  attribute vec3 aNormal;
  attribute float aSide;
  attribute float aAlong;
  attribute float aSeed;
  uniform float uWidth;
  uniform float uFocus;
  uniform float uDim;
  varying float vAcross;
  varying float vHalf;
  varying float vAlong;
  varying float vSeed;
  varying float vNear;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 toCamera = normalize(cameraPosition - world.xyz);
    // The edge facing the viewer is brushed heavier than the far ones, as a
    // painter lays the near contour darkest
    vec2 ground = cameraPosition.xz - world.xz;
    float near = smoothstep(-0.1, 0.65, dot(aNormal.xz, normalize(ground + 1e-5)));
    // A hand's slight unevenness along the stroke
    float wobble = 1.0 + 0.14 * sin(aAlong * 7.0 + aSeed * 5.1) + 0.06 * sin(aAlong * 23.0 + aSeed);
    float halfWidth = 0.5 * uWidth * wobble * mix(0.8, 1.3, near) * (1.0 + 0.8 * uFocus);
    vec3 across = cross(normalize(mat3(modelMatrix) * aTangent), toCamera);
    float l = length(across);
    across = l > 1e-4 ? across / l : vec3(0.0, 1.0, 0.0);
    world.xyz += across * aSide * halfWidth;
    vAcross = aSide * halfWidth;
    vHalf = halfWidth;
    vAlong = aAlong;
    vSeed = aSeed;
    vNear = near;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const edgeFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uFocus;
  uniform float uDim;
  varying float vAcross;
  varying float vHalf;
  varying float vAlong;
  varying float vSeed;
  varying float vNear;
  float hash(float n) { return fract(sin(n) * 43758.5453123); }
  float vnoise(float x) {
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash(i), hash(i + 1.0), f);
  }
  void main() {
    float d = abs(vAcross);
    float aa = max(fwidth(vAcross), 1e-4);
    float body = 1.0 - smoothstep(vHalf - aa, vHalf + aa * 0.5, d);
    float u = vHalf > 1e-4 ? vAcross / vHalf : 0.0;
    // Dry ends: the brush lifts at each corner, breaking into bristle streaks
    float end = min(vAlong, 1.0 - vAlong);
    float dry = 1.0 - smoothstep(0.0, 0.07, end);
    float n = vnoise(u * 6.0 + vSeed * 13.0) * 0.8 + vnoise(vAlong * 40.0 + u) * 0.2;
    body *= smoothstep(dry * 0.85 - 0.08, dry * 0.85 + 0.08, n);
    // A touch of texture all along, and ink gathered at the stroke's edges
    body *= 0.86 + 0.14 * vnoise(vAlong * 60.0 + vSeed * 7.0);
    vec3 col = uColor * mix(1.0, 0.8, smoothstep(0.5, 1.0, abs(u)));
    float strength = uOpacity * mix(0.75, 1.0, vNear) * mix(1.0 - uDim, 1.0, uFocus);
    float a = body * min(1.0, strength + uFocus * 0.25);
    if (a < 0.003) discard;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }`;

const SAMPLES = 28;

/**
 * Four strokes round a square of half side `side`, each from one corner a
 * little past the next (the brush overruns at the corners), as camera-facing
 * ribbons: an ink line of steady width on screen from any angle, even edge-on.
 */
const perimeterGeometry = (side: number): BufferGeometry => {
  const corners: [number, number][] = [
    [-side, side],
    [side, side],
    [side, -side],
    [-side, -side],
  ];
  const overrun = side * 0.035;
  const position: number[] = [];
  const tangent: number[] = [];
  const normal: number[] = [];
  const sideAttr: number[] = [];
  const along: number[] = [];
  const seed: number[] = [];
  const index: number[] = [];
  for (let e = 0; e < 4; e++) {
    const [ax, az] = corners[e];
    const [bx, bz] = corners[(e + 1) % 4];
    const len = Math.hypot(bx - ax, bz - az);
    const tx = (bx - ax) / len;
    const tz = (bz - az) / len;
    // Outward normal: the edge's midpoint, away from the centre
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    const ml = Math.hypot(mx, mz);
    const base = position.length / 3;
    for (let i = 0; i <= SAMPLES; i++) {
      const k = i / SAMPLES;
      const x = ax - tx * overrun + (bx - ax + tx * 2 * overrun) * k;
      const z = az - tz * overrun + (bz - az + tz * 2 * overrun) * k;
      for (const s of [-1, 1]) {
        position.push(x, 0.004, z);
        tangent.push(tx, 0, tz);
        normal.push(mx / ml, 0, mz / ml);
        sideAttr.push(s);
        along.push(k);
        seed.push(e + 1);
      }
    }
    for (let i = 0; i < SAMPLES; i++) {
      const a = base + i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  g.setAttribute('aTangent', new BufferAttribute(new Float32Array(tangent), 3));
  g.setAttribute('aNormal', new BufferAttribute(new Float32Array(normal), 3));
  g.setAttribute('aSide', new BufferAttribute(new Float32Array(sideAttr), 1));
  g.setAttribute('aAlong', new BufferAttribute(new Float32Array(along), 1));
  g.setAttribute('aSeed', new BufferAttribute(new Float32Array(seed), 1));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
};

// --- Platforms ------------------------------------------------------------------

export const WashiPlates = ({
  layout,
  inks,
  light = [250, 249, 245],
  dark = [241, 237, 230],
  edgeWidth = 0.05,
  edgeOpacity = 0.86,
  margin = 0.05,
  focusLevel = null,
}: WashiPlatesProps) => {
  const frame = towerFrame(layout);
  const side = frame.half + margin;
  const lightKey = light.join(',');
  const darkKey = dark.join(',');
  const surfaces = useMemo(
    () =>
      [false, true].map(
        (odd) =>
          new MeshBasicMaterial({
            map: washiTexture(odd, light, dark),
            blending: MultiplyBlending,
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            toneMapped: false,
            fog: false,
          }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- colours compared by value
    [lightKey, darkKey],
  );
  useEffect(
    () => () =>
      surfaces.forEach((m) => {
        m.map?.dispose();
        m.dispose();
      }),
    [surfaces],
  );
  const inkKey = inks.join(',');
  const edges = useMemo(
    () =>
      frame.levelY.map(
        (_, z) =>
          new ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            uniforms: {
              uColor: { value: new Color(inks[z] ?? inks[inks.length - 1]) },
              uOpacity: { value: edgeOpacity },
              uWidth: { value: edgeWidth },
              uFocus: { value: 0 },
              uDim: { value: 0 },
            },
            vertexShader: edgeVertex,
            fragmentShader: edgeFragment,
          }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- inks compared by value
    [inkKey, edgeOpacity, edgeWidth, frame.levelY.length],
  );
  useEffect(() => () => edges.forEach((m) => m.dispose()), [edges]);
  const geometries = useMemo(
    () => ({
      surface: new PlaneGeometry(frame.half * 2, frame.half * 2),
      edge: perimeterGeometry(side),
    }),
    [frame.half, side],
  );
  useEffect(
    () => () => {
      geometries.surface.dispose();
      geometries.edge.dispose();
    },
    [geometries],
  );

  // Level focus: the attended level's stroke goes bolder and fully inked,
  // the others fade back, over a short calm ease
  useLevelFocus(
    focusLevel,
    (weights, any) => {
      weights.forEach((w, z) => {
        const m = edges[z];
        if (!m) return;
        m.uniforms.uFocus.value = w;
        m.uniforms.uDim.value = any * 0.3;
      });
    },
    { levels: frame.levelY.length, key: edges },
  );

  return (
    <group name="washi-plates">
      {frame.levelY.map((y, z) => (
        <group key={z} position={[0, y, 0]}>
          <mesh
            geometry={geometries.surface}
            // Squares are coloured by x + y + z: the checker flips per level
            material={surfaces[z % 2]}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, -0.002, 0]}
            renderOrder={LAYER.plate}
            raycast={noRaycast}
          />
          <mesh
            geometry={geometries.edge}
            material={edges[z]}
            renderOrder={LAYER.plateEdge}
            raycast={noRaycast}
            frustumCulled={false}
          />
        </group>
      ))}
    </group>
  );
};
