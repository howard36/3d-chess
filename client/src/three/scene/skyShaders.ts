import { AdditiveBlending, Color, ShaderMaterial } from 'three';
import { SHADE_AT_VERTEX, shadeUniforms } from './mask';
import { PALETTE } from './palette';

// The sky's two programs (heavens.tsx, skyChart.ts, skyDetail.tsx): one for
// every star (the field, the constellations' stars, the Milky Way's dust, the
// hidden asterisms, the satellite) and one for every line (the
// constellations). Everything sinks into the tower's shade (mask.ts), and
// like the rest of the garden it is light added in three.js's opaque list
// (backdropCache.tsx). The shade is worked out per vertex: a star is a few
// pixels across and a line a short run between two, so that is as good as
// per pixel and far cheaper in software.

const pointVertex = /* glsl */ `
  uniform float uDpr;
  attribute float aSize;
  attribute float aBright;
  attribute vec3 aColor;
  varying float vBright;
  varying float vSize;
  varying vec3 vColor;
  ${SHADE_AT_VERTEX}
  void main() {
    vColor = aColor;
    vSize = aSize;
    vec4 w = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * w;
    gl_PointSize = vSize * uDpr;
    vBright = aBright * (1.0 - shadeOfClip(gl_Position));
  }`;

const pointFragment = /* glsl */ `
  uniform float uOpacity;
  uniform float uSharp;
  varying float vBright;
  varying float vSize;
  varying vec3 vColor;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = length(p);
    // A star is a soft dot; a bright one a hot core in a
    // faint glow, so it reads as brighter, not just bigger
    float soft = 1.0 - smoothstep(0.3, 1.0, r);
    float core = 1.0 - smoothstep(0.0, 0.42, r);
    float big = smoothstep(2.4, 3.6, vSize) * uSharp;
    float a = mix(soft, core * 0.8 + soft * 0.32, big) * vBright * uOpacity;
    if (a < 0.002) discard;
    gl_FragColor = vec4(vColor * a, 1.0);
    #include <colorspace_fragment>
  }`;

/** The stars' material: `opacity` scales every star. */
export const skyPointMaterial = (o: {
  opacity?: number;
  /** 0 draws every star as a soft dot (the satellite). */
  sharp?: number;
}) =>
  new ShaderMaterial({
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      ...shadeUniforms(),
      uDpr: { value: 1 },
      uOpacity: { value: o.opacity ?? 1 },
      uSharp: { value: o.sharp ?? 1 },
    },
    vertexShader: pointVertex,
    fragmentShader: pointFragment,
  });

/**
 * A constellation tracing itself in light (skyEvents.tsx): which figure
 * (its `aFigure`, -1 none), how far along its lines the light has run (0–1,
 * past 1 as it eases back) and how bright it is. Shared by every line
 * material; still at rest.
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
  varying float vLit;
  ${SHADE_AT_VERTEX}
  void main() {
    vAlong = aAlong;
    vFigure = aFigure;
    vBase = aBase;
    vec4 w = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * w;
    vLit = 1.0 - shadeOfClip(gl_Position);
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
  varying float vLit;
  void main() {
    float a = uOpacity * vBase;
    // The traced figure: its lines lit behind a soft running head
    float traced = 1.0 - step(0.5, abs(vFigure - uTraceFigure));
    float behind = uTraceHead - vAlong;
    float head = exp(-behind * behind / 0.0011);
    a += traced * uTraceLight * (step(0.0, behind) * 0.07 + head * 0.24);
    a *= vLit;
    if (a < 0.002) discard;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <colorspace_fragment>
  }`;

/** The constellations' lines (with aAlong, aFigure and aBase: skyChart.ts). */
export const skyLineMaterial = (o: { opacity: number }) =>
  new ShaderMaterial({
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      ...shadeUniforms(),
      ...skyTrace,
      uColor: { value: new Color(PALETTE.neon) },
      uOpacity: { value: o.opacity },
    },
    vertexShader: lineVertex,
    fragmentShader: lineFragment,
  });
