import { useEffect, useMemo } from 'react';
import { BoxGeometry, Color, DoubleSide, PlaneGeometry, ShaderMaterial } from 'three';
import type { BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import { EDGE_WIDTH, FRAME, MARGIN, PALETTE } from './shared';

// Holographic glass platforms: one continuous slab per level, a faint
// checker of light, a little light gathered along the rim (edge-lit acrylic),
// a crisp frame, and ruler ticks outside the frame at every square boundary so
// squares can be counted without a single line across the glass. The lines
// are brightest on the side of the tower nearest the camera and dim toward
// the back, so where the outlines of stacked platforms cross on screen, the
// front edge of each one reads clearly over the back edge of the next.

/** How much the lines dim from the front of the tower to its back. */
const DEPTH_DIM = 0.5;
const depthFade = /* glsl */ `
  float depthFade(float depth, float centre) {
    return 1.0 - ${DEPTH_DIM.toFixed(2)} * smoothstep(-2.2, 2.6, depth - centre);
  }`;

const TICK_LENGTH = 0.11;
const TICK_WIDTH = 0.012;
/** How far past the frame the quad reaches, to hold the ticks. */
const REACH = FRAME.half + MARGIN + EDGE_WIDTH + TICK_LENGTH + 0.04;

const vertexShader = /* glsl */ `
  varying vec2 vP;
  varying float vDepth;
  varying float vCentre;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vP = w.xz;
    vec4 mv = viewMatrix * w;
    vDepth = -mv.z;
    vCentre = -(viewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).z;
    gl_Position = projectionMatrix * mv;
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 uLight;
  uniform vec3 uDark;
  uniform vec3 uRim;
  uniform vec3 uTick;
  uniform float uLightAlpha;
  uniform float uDarkAlpha;
  uniform float uRimAlpha;
  uniform float uRimWidth;
  uniform float uTickAlpha;
  uniform float uHalf;
  uniform float uPitch;
  uniform float uSide;
  uniform float uTickLength;
  uniform float uTickWidth;
  uniform float uFlip;
  varying vec2 vP;
  varying float vDepth;
  varying float vCentre;
  ${depthFade}

  // A box-filtered checker (0 on even squares, 1 on odd): calm at grazing angles
  float checker(vec2 p) {
    vec2 w = max(fwidth(p), vec2(1e-3));
    vec2 i = 2.0 * (abs(fract((p - 0.5 * w) * 0.5) - 0.5) - abs(fract((p + 0.5 * w) * 0.5) - 0.5)) / w;
    return 0.5 - 0.5 * i.x * i.y;
  }

  void main() {
    vec2 a = abs(vP);
    float m = max(a.x, a.y);
    float fm = max(fwidth(m), 1e-4);
    float inside = 1.0 - smoothstep(uHalf - fm, uHalf + fm, m);

    // Squares by file (+x) and rank (-z from White's side). Colour follows
    // x + y + z, so it is the same from both seats and a bishop keeps its colour.
    vec2 c = vec2(vP.x + uHalf, uHalf - vP.y) / uPitch;
    float odd = checker(c);
    float dark = mix(1.0 - odd, odd, uFlip);
    vec3 col = mix(uLight, uDark, dark);
    float alpha = mix(uLightAlpha, uDarkAlpha, dark) * inside;

    // Light gathered along the rim, fading inward
    float rim = exp(-max(uHalf - m, 0.0) / uRimWidth) * inside;
    col = mix(col, uRim, clamp(rim * 1.2, 0.0, 1.0));
    float near = depthFade(vDepth, vCentre);
    alpha += rim * uRimAlpha * near;

    // Ruler ticks beyond the frame, one at every square boundary
    float out_ = m - uSide;
    float along = a.x > a.y ? vP.y : vP.x;
    float fa = max(fwidth(along), 1e-4);
    float t = abs(fract((along + uHalf) / uPitch + 0.5) - 0.5) * uPitch;
    float tick = (1.0 - smoothstep(uTickWidth - fa, uTickWidth + fa, t))
      * smoothstep(-fm, fm, out_)
      * (1.0 - smoothstep(uTickLength - fm, uTickLength + fm, out_))
      * (1.0 - smoothstep(uHalf + uTickWidth, uHalf + uTickWidth + fa * 2.0, abs(along)));
    col = mix(col, uTick, tick);
    alpha = max(alpha, tick * uTickAlpha * near);

    if (alpha < 0.002) discard;
    gl_FragColor = vec4(col, alpha);
    #include <colorspace_fragment>
  }`;

const makeSurface = (level: number) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: {
      uLight: { value: new Color(PALETTE.glassLight) },
      uDark: { value: new Color(PALETTE.glassDark) },
      uRim: { value: new Color(PALETTE.glassEdge) },
      uTick: { value: new Color(PALETTE.glassTick) },
      uLightAlpha: { value: 0.105 },
      uDarkAlpha: { value: 0.075 },
      uRimAlpha: { value: 0.1 },
      uRimWidth: { value: 0.16 },
      uTickAlpha: { value: 0.7 },
      uHalf: { value: FRAME.half },
      uPitch: { value: FRAME.pitch },
      uSide: { value: FRAME.half + MARGIN + EDGE_WIDTH },
      uTickLength: { value: TICK_LENGTH },
      uTickWidth: { value: TICK_WIDTH },
      uFlip: { value: level % 2 },
    },
    vertexShader,
    fragmentShader,
  });

/** A square frame of four bars around a platform, its top flush with the surface. */
const frameGeometry = (inner: number, width: number, height: number): BufferGeometry => {
  const outer = inner + width;
  const bars = [
    new BoxGeometry(outer * 2, height, width).translate(0, -height / 2, inner + width / 2),
    new BoxGeometry(outer * 2, height, width).translate(0, -height / 2, -inner - width / 2),
    new BoxGeometry(width, height, inner * 2).translate(inner + width / 2, -height / 2, 0),
    new BoxGeometry(width, height, inner * 2).translate(-inner - width / 2, -height / 2, 0),
  ];
  const merged = mergeGeometries(bars);
  bars.forEach((b) => b.dispose());
  return merged;
};

const surface = new PlaneGeometry(REACH * 2, REACH * 2).rotateX(-Math.PI / 2);
const frame = frameGeometry(FRAME.half + MARGIN, EDGE_WIDTH, 0.045);
const frameMaterial = new ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: {
    uColor: { value: new Color(PALETTE.glassEdge) },
    uOpacity: { value: 0.9 },
  },
  vertexShader: /* glsl */ `
    varying float vDepth;
    varying float vCentre;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vDepth = -mv.z;
      vCentre = -(viewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uOpacity;
    varying float vDepth;
    varying float vCentre;
    ${depthFade}
    void main() {
      gl_FragColor = vec4(uColor, uOpacity * depthFade(vDepth, vCentre));
      #include <colorspace_fragment>
    }`,
});

/** The five glass platforms of the tower. Decorative: never raycast. */
export const HoloPlates = () => {
  const materials = useMemo(() => FRAME.levelY.map((_, z) => makeSurface(z)), []);
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);
  return (
    <group name="command-plates">
      {FRAME.levelY.map((y, z) => (
        <group key={z} position={[0, y, 0]}>
          <mesh
            geometry={surface}
            material={materials[z]}
            position={[0, -0.002, 0]}
            renderOrder={LAYER.plate}
            raycast={noRaycast}
          />
          <mesh
            geometry={frame}
            material={frameMaterial}
            renderOrder={LAYER.plateEdge}
            raycast={noRaycast}
          />
        </group>
      ))}
    </group>
  );
};
