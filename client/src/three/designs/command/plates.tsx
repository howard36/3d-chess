import { useEffect, useMemo, useRef } from 'react';
import { Color, DoubleSide, PlaneGeometry, ShaderMaterial } from 'three';
import type { Mesh } from 'three';
import { useLevelFocus } from '../kit/focus';
import { LAYER } from '../kit/layers';
import { noRaycast } from '../kit/noRaycast';
import { frameGeometry } from '../kit/plates';
import { EDGE_WIDTH, FRAME, LEVEL_COLORS, MARGIN, PALETTE } from './shared';

// Holographic glass platforms: one continuous slab per level, a faint
// checker of light, a little light gathered along the rim (edge-lit acrylic),
// a thin bright frame with a faint halo, and ruler ticks outside the frame at
// every square boundary, so squares can be counted without a single line
// across the glass.
//
// - Each level's frame, rim light and ticks take the level's colour, teal at
//   A to ice blue at E, matching its letter and the rings at its pieces' feet.
// - The lines are brightest on the side of the tower nearest the camera and
//   dim toward the back, so where the outlines of stacked platforms cross on
//   screen, the front edge of each reads over the back edge of the next.
// - Level focus: the level the player is pointing at (or has a piece picked up
//   on) brightens and thickens its frame and lifts its glass a little; the
//   other levels' lines dim.

/** How much the lines dim from the front of the tower to its back. */
const DEPTH_DIM = 0.45;
const depthFade = /* glsl */ `
  float depthFade(float depth, float centre) {
    return 1.0 - ${DEPTH_DIM.toFixed(2)} * smoothstep(-2.2, 2.6, depth - centre);
  }`;

const TICK_LENGTH = 0.11;
const TICK_WIDTH = 0.011;
const FOCUS_WIDTH = 0.05;
/** The frame's outer line (world units from the centre). */
const SIDE = FRAME.half + MARGIN + EDGE_WIDTH;
/** How far past the frame the quad reaches, to hold the ticks and the halo. */
const REACH = SIDE + TICK_LENGTH + 0.06;

/** Frame opacity at rest, and how far the other levels' lines dim while one is focused. */
const EDGE_OPACITY = 0.68;
const FOCUS_DIM = 0.5;

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
  uniform vec3 uLevel;
  uniform vec3 uTick;
  uniform float uLightAlpha;
  uniform float uDarkAlpha;
  uniform float uRimAlpha;
  uniform float uRimWidth;
  uniform float uTickAlpha;
  uniform float uHaloAlpha;
  uniform float uHalf;
  uniform float uPitch;
  uniform float uSide;
  uniform float uLine;
  uniform float uTickLength;
  uniform float uTickWidth;
  uniform float uFlip;
  uniform float uFocus;
  uniform float uDim;
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
    float lines = depthFade(vDepth, vCentre) * uDim;

    // Squares by file (+x) and rank (-z from White's side). Colour follows
    // x + y + z, so it is the same from both seats and a bishop keeps its colour.
    vec2 c = vec2(vP.x + uHalf, uHalf - vP.y) / uPitch;
    float odd = checker(c);
    float dark = mix(1.0 - odd, odd, uFlip);
    vec3 col = mix(uLight, uDark, dark);
    float alpha = (mix(uLightAlpha, uDarkAlpha, dark) + 0.035 * uFocus) * inside;

    // Light gathered along the rim, fading inward, in the level's colour
    float rim = exp(-max(uHalf - m, 0.0) / uRimWidth) * inside;
    col = mix(col, uLevel, clamp(rim * 1.2, 0.0, 1.0));
    alpha += rim * uRimAlpha * lines * (1.0 + uFocus);

    // A faint halo either side of the frame's bright core
    float halo = exp(-abs(m - uLine) / (0.028 + 0.02 * uFocus)) * (1.0 - inside * 0.6);
    col = mix(col, uLevel, clamp(halo * 1.5, 0.0, 1.0));
    alpha = max(alpha, halo * uHaloAlpha * lines * (1.0 + 1.2 * uFocus));

    // Ruler ticks beyond the frame, one at every square boundary
    float out_ = m - uSide;
    float along = a.x > a.y ? vP.y : vP.x;
    float fa = max(fwidth(along), 1e-4);
    float t = abs(fract((along + uHalf) / uPitch + 0.5) - 0.5) * uPitch;
    float tick = (1.0 - smoothstep(uTickWidth - fa, uTickWidth + fa, t))
      * smoothstep(-fm, fm, out_)
      * (1.0 - smoothstep(uTickLength - fm, uTickLength + fm, out_))
      * (1.0 - smoothstep(uHalf + uTickWidth, uHalf + uTickWidth + fa * 2.0, abs(along)));
    col = mix(col, mix(uTick, uLevel, 0.5), tick);
    alpha = max(alpha, tick * uTickAlpha * lines);

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
      uLevel: { value: new Color(LEVEL_COLORS[level]) },
      uTick: { value: new Color(PALETTE.glassTick) },
      uLightAlpha: { value: 0.09 },
      uDarkAlpha: { value: 0.07 },
      uRimAlpha: { value: 0.08 },
      uRimWidth: { value: 0.16 },
      uTickAlpha: { value: 0.6 },
      uHaloAlpha: { value: 0.16 },
      uHalf: { value: FRAME.half },
      uPitch: { value: FRAME.pitch },
      uSide: { value: SIDE },
      uLine: { value: FRAME.half + MARGIN + EDGE_WIDTH / 2 },
      uTickLength: { value: TICK_LENGTH },
      uTickWidth: { value: TICK_WIDTH },
      uFlip: { value: level % 2 },
      uFocus: { value: 0 },
      uDim: { value: 1 },
    },
    vertexShader,
    fragmentShader,
  });

const makeFrame = (level: number) =>
  new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new Color(LEVEL_COLORS[level]) },
      uOpacity: { value: EDGE_OPACITY },
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

const surface = new PlaneGeometry(REACH * 2, REACH * 2).rotateX(-Math.PI / 2);
const frame = frameGeometry(FRAME.half + MARGIN, EDGE_WIDTH, 0.04);
// The focused frame: wider, from the same inner line, a little deeper
const focusFrame = frameGeometry(FRAME.half + MARGIN, FOCUS_WIDTH, 0.05);

/** The five glass platforms of the tower, with level focus. Decorative: never raycast. */
export const HoloPlates = ({ focusLevel }: { focusLevel: number | null }) => {
  const materials = useMemo(
    () =>
      FRAME.levelY.map((_, z) => ({
        surface: makeSurface(z),
        frame: makeFrame(z),
        focus: makeFrame(z),
      })),
    [],
  );
  useEffect(
    () => () =>
      materials.forEach((m) => {
        m.surface.dispose();
        m.frame.dispose();
        m.focus.dispose();
      }),
    [materials],
  );
  const focusMeshes = useRef<(Mesh | null)[]>([]);
  useLevelFocus(
    focusLevel,
    (weights, any) => {
      weights.forEach((w, z) => {
        const m = materials[z];
        const dim = 1 - any * (1 - FOCUS_DIM) * (1 - w);
        m.surface.uniforms.uFocus.value = w;
        m.surface.uniforms.uDim.value = dim;
        m.frame.uniforms.uOpacity.value = EDGE_OPACITY * dim;
        m.focus.uniforms.uOpacity.value = w;
        const mesh = focusMeshes.current[z];
        if (mesh) mesh.visible = w > 0.002;
      });
    },
    { key: materials },
  );
  return (
    <group name="halo-plates">
      {FRAME.levelY.map((y, z) => (
        <group key={z} position={[0, y, 0]}>
          <mesh
            geometry={surface}
            material={materials[z].surface}
            position={[0, -0.002, 0]}
            renderOrder={LAYER.plate}
            raycast={noRaycast}
          />
          <mesh
            geometry={frame}
            material={materials[z].frame}
            renderOrder={LAYER.plateEdge}
            raycast={noRaycast}
          />
          <mesh
            ref={(mesh) => {
              focusMeshes.current[z] = mesh;
            }}
            geometry={focusFrame}
            material={materials[z].focus}
            renderOrder={LAYER.plateEdge}
            visible={false}
            raycast={noRaycast}
          />
        </group>
      ))}
    </group>
  );
};
