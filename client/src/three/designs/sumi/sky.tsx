import { useEffect, useMemo } from 'react';
import { BackSide, Color, CylinderGeometry, ShaderMaterial, Vector3 } from 'three';
import { noRaycast } from '../kit/noRaycast';
import { GradientSky } from '../kit/sky';
import { MOUNTAIN_INKS, PAPER } from './palette';
import { ridgeTexture } from './textures';
import type { MountainRange } from './textures';

// Far to near: each nearer range sits lower in the view, is darker, and
// fades into a deeper bank of mist.
const RANGES: MountainRange[] = [
  { base: -2, peak: 8, peaks: 20, width: 0.032 },
  { base: -5.5, peak: 10, peaks: 13, width: 0.04 },
  { base: -10, peak: 12, peaks: 8, width: 0.05 },
];
/** Opacity of each range's ink at its ridge. */
const ALPHA = [0.11, 0.14, 0.17];
/** How far (degrees) each range's wash reaches down into the mist. */
const FADE = [2.6, 3.6, 5];

const RADIUS = 90;
const DEG = Math.PI / 180;
const TOP = RADIUS * Math.tan(10 * DEG);
const BOTTOM = RADIUS * Math.tan(-36 * DEG);

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const fragment = /* glsl */ `
  uniform sampler2D uRidge;
  uniform vec3 uInk[3];
  uniform vec3 uAlpha;
  uniform vec3 uFade;
  uniform float uTop;
  uniform float uBottom;
  uniform float uRadius;
  varying vec2 vUv;

  void main() {
    float y = mix(uBottom, uTop, vUv.y);
    float e = degrees(atan(y / uRadius));
    float aa = max(fwidth(e), 1e-3);
    // Composite far to near, premultiplied
    vec3 col = vec3(0.0);
    float alpha = 0.0;
    for (int k = 0; k < 3; k++) {
      vec4 r = texture2D(uRidge, vec2(vUv.x, (float(k) + 0.5) / 3.0));
      float below = r.r - e;
      // A soft brushed contour along the ridge...
      float edge = smoothstep(-aa - 0.15, aa + 0.15, below);
      // ...a little more ink just under it, where the brush first touched...
      float line = exp(-max(below, 0.0) / 0.5) * 0.3;
      // ...and the wash, fading down into the mist, streaked by the brush's hairs
      float wash = exp(-max(below, 0.0) / uFade[k]);
      float hair = 0.86 + 0.14 * r.g;
      // Only peaks are inked: between them the range dissolves into mist
      float land = smoothstep(0.08, 0.4, r.b);
      float a = clamp(uAlpha[k] * edge * land * (wash * hair + line), 0.0, 1.0);
      col = col * (1.0 - a) + uInk[k] * a;
      alpha = alpha * (1.0 - a) + a;
    }
    vec3 ink = col / max(alpha, 1e-4);
    // Horizontal banks of mist drifting across the ranges (still: they are
    // painted, not animated), thicker in some directions than others
    float mist = 0.0;
    for (int j = 0; j < 3; j++) {
      float m = -3.6 - float(j) * 4.4;
      float band = exp(-pow((e - m) / (0.7 + 0.25 * float(j)), 2.0));
      float drift = 0.55 + 0.45 * sin(vUv.x * 6.2831853 * (2.0 + float(j)) + float(j) * 2.1);
      mist = max(mist, band * drift);
    }
    alpha *= 1.0 - 0.7 * mist;
    if (alpha < 0.002) discard;
    gl_FragColor = vec4(ink, alpha);
    #include <colorspace_fragment>
  }`;

/**
 * The world the tower floats in: warm paper from zenith to the mist below,
 * and ink-wash peaks rising out of that mist all the way round, low in
 * contrast so pieces and markers always win. The ridges are computed per
 * pixel from a strip of heights, so they stay crisp at any zoom. Static:
 * nothing here moves.
 */
export const PaperSky = () => {
  const { geometry, material } = useMemo(() => {
    const geometry = new CylinderGeometry(RADIUS, RADIUS, TOP - BOTTOM, 128, 1, true);
    geometry.translate(0, (TOP + BOTTOM) / 2, 0);
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: BackSide,
      fog: false,
      uniforms: {
        uRidge: { value: ridgeTexture(RANGES) },
        uInk: { value: MOUNTAIN_INKS.map((c) => new Color(c)) },
        uAlpha: { value: new Vector3(...ALPHA) },
        uFade: { value: new Vector3(...FADE) },
        uTop: { value: TOP },
        uBottom: { value: BOTTOM },
        uRadius: { value: RADIUS },
      },
      vertexShader: vertex,
      fragmentShader: fragment,
    });
    return { geometry, material };
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.uniforms.uRidge.value.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return (
    <>
      <GradientSky
        top={PAPER.top}
        horizon={PAPER.horizon}
        bottom={PAPER.bottom}
        exponent={0.55}
        radius={150}
      />
      <mesh
        geometry={geometry}
        material={material}
        renderOrder={-999}
        raycast={noRaycast}
        frustumCulled={false}
      />
    </>
  );
};
