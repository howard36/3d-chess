import { AdditiveBlending, Color, ShaderMaterial } from 'three';
import { shadeUniforms, TOWER_SHADE } from './mask';
import { GROUND_Y, PALETTE } from './palette';

// The richer sky's two programs (heavens.tsx, skyChart.ts, skyDetail.tsx):
// one for every star (the field, the constellations' stars, the Milky Way's
// dust, the hidden asterisms, the satellite) and one for every line (the
// constellations, and the knight's tour that only an event lights). Both
// draw the sky as it is overhead or, with `uMirror`, as the polished stone
// gives it back upside down: the object is mirrored about the ground by its
// matrix, and the light is weighed by the stone's fresnel where the eye's ray
// meets it. Everything sinks into the tower's shade (mask.ts), and like the
// rest of the garden it is light added in three.js's opaque list
// (backdropCache.tsx).

/**
 * GLSL: `float stoneWeight(vec3 world)`: 1 for the sky itself, or, mirrored,
 * how much of this point the polished stone gives back: the fresnel of a
 * dark polish (about 4% looking straight down, more toward grazing), none
 * near the tower's foot (where the ground is clear and dark) and none past
 * the plain's edge.
 */
const STONE = /* glsl */ `
  uniform float uMirror;
  uniform float uDim;
  float stoneWeight(vec3 world) {
    if (uMirror < 0.5) return 1.0;
    vec3 v = normalize(world - cameraPosition);
    float down = max(-v.y, 1e-3);
    float t = (cameraPosition.y - ${GROUND_Y.toFixed(3)}) / down;
    vec2 hit = cameraPosition.xz + v.xz * t;
    float r = length(hit);
    float edge = max(abs(hit.x), abs(hit.y));
    float fresnel = 0.04 + 0.96 * pow(1.0 - down, 5.0);
    return fresnel * smoothstep(7.0, 15.0, r) * (1.0 - smoothstep(95.0, 125.0, edge)) * uDim;
  }`;

const pointVertex = /* glsl */ `
  uniform float uDpr;
  uniform float uSizeScale;
  attribute float aSize;
  attribute float aBright;
  attribute vec3 aColor;
  varying float vBright;
  varying float vSize;
  varying vec3 vColor;
  varying vec3 vWorld;
  void main() {
    vBright = aBright;
    vColor = aColor;
    vSize = aSize * uSizeScale;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
    gl_PointSize = vSize * uDpr;
  }`;

const pointFragment = /* glsl */ `
  uniform float uOpacity;
  uniform float uSharp;
  varying float vBright;
  varying float vSize;
  varying vec3 vColor;
  varying vec3 vWorld;
  ${TOWER_SHADE}
  ${STONE}
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = length(p);
    // A star is a soft dot (as today's); a bright one a hot core in a
    // faint glow, so it reads as brighter, not just bigger
    float soft = 1.0 - smoothstep(0.3, 1.0, r);
    float core = 1.0 - smoothstep(0.0, 0.42, r);
    float big = smoothstep(2.4, 3.6, vSize) * uSharp;
    float a = mix(soft, core * 0.8 + soft * 0.32, big) * vBright * uOpacity;
    a *= stoneWeight(vWorld) * (1.0 - towerShade());
    if (a < 0.002) discard;
    gl_FragColor = vec4(vColor * a, 1.0);
    #include <colorspace_fragment>
  }`;

/** The stars' material: `opacity` scales every star, `sizeScale` their size (CSS px). */
export const skyPointMaterial = (o: {
  opacity?: number;
  sizeScale?: number;
  mirror?: boolean;
  dim?: { value: number };
  /** 0 draws every star as a soft dot (the reflection's softened copy). */
  sharp?: number;
}) =>
  new ShaderMaterial({
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      ...shadeUniforms(),
      uDpr: { value: 1 },
      uOpacity: { value: o.opacity ?? 1 },
      uSizeScale: { value: o.sizeScale ?? 1 },
      uSharp: { value: o.sharp ?? 1 },
      uMirror: { value: o.mirror ? 1 : 0 },
      uDim: o.dim ?? { value: 1 },
    },
    vertexShader: pointVertex,
    fragmentShader: pointFragment,
  });

/**
 * A constellation tracing itself in light (skyEvents.tsx): which figure
 * (its `aFigure`, -1 none), how far along its lines the light has run (0–1,
 * past 1 as it eases back) and how bright it is. Shared by every line
 * material, the reflection's too; still at rest.
 */
export const skyTrace = {
  uTraceFigure: { value: -1 },
  uTraceHead: { value: 0 },
  uTraceLight: { value: 0 },
};

const lineVertex = /* glsl */ `
  attribute float aAlong;
  attribute float aFigure;
  attribute float aBase;
  varying float vAlong;
  varying float vFigure;
  varying float vBase;
  varying vec3 vWorld;
  void main() {
    vAlong = aAlong;
    vFigure = aFigure;
    vBase = aBase;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const lineFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTraceFigure;
  uniform float uTraceHead;
  uniform float uTraceLight;
  varying float vAlong;
  varying float vFigure;
  varying float vBase;
  varying vec3 vWorld;
  ${TOWER_SHADE}
  ${STONE}
  void main() {
    float a = uOpacity * vBase;
    // The traced figure: its lines lit behind a soft running head
    float traced = 1.0 - step(0.5, abs(vFigure - uTraceFigure));
    float behind = uTraceHead - vAlong;
    float head = exp(-behind * behind / 0.0011);
    a += traced * uTraceLight * (step(0.0, behind) * 0.07 + head * 0.24);
    a *= stoneWeight(vWorld) * (1.0 - towerShade());
    if (a < 0.002) discard;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <colorspace_fragment>
  }`;

/** The constellations' lines (with aAlong, aFigure and aBase: skyChart.ts). */
export const skyLineMaterial = (o: {
  opacity: number;
  mirror?: boolean;
  dim?: { value: number };
}) =>
  new ShaderMaterial({
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      ...shadeUniforms(),
      ...skyTrace,
      uColor: { value: new Color(PALETTE.neon) },
      uOpacity: { value: o.opacity },
      uMirror: { value: o.mirror ? 1 : 0 },
      uDim: o.dim ?? { value: 1 },
    },
    vertexShader: lineVertex,
    fragmentShader: lineFragment,
  });
