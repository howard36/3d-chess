import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import { towerFrame } from '../kit/layouts';
import { noRaycast } from '../kit/noRaycast';
import { dotTexture, rng } from '../kit/textures';
import type { BoardLayout } from '../types';
import { NIGHT } from './palette';
import { elevationOf } from './shared';
import { snowDetailTexture, snowMacroTexture } from './textures';

// The world round the tower: a polar plateau at night, seen from an
// observatory high above it. Far below lies a snowfield cut into sastrugi
// by the wind, with a little rock breaking through; two rings of snowy
// ranges rise from it all round the compass, moonlit on their windward
// faces, with three small observatories on the near crests (spread round,
// so no view is dressed and none is bare); above them the night, and low
// over the far ranges the aurora's arc, its green hem just clearing the
// peaks and its curtains rising into violet. Everything is low in value and
// contrast so the board always wins. Only the aurora moves, slowly, and
// never behind the tower: inside the tower's outline on screen (with a
// margin) it holds still, whatever the orbit.

/** Height of the snowfield (world units): far below the tower, a real floor that parallaxes. */
export const GROUND_Y = -26;
const SKY_RADIUS = 520;

const hex = (c: string) => new Color(c);

/**
 * Where the tower lies on screen, as a rectangle in drawing-buffer pixels
 * (x0, y0, x1, y1, from the bottom left), grown by a margin: the aurora
 * holds still inside it. Shared by every backdrop material.
 */
export const towerMask = {
  rect: { value: new Vector4(0, 0, 0, 0) },
  soft: { value: 40 },
};

const common = /* glsl */ `
  #define TAU 6.28318530718
  uniform vec4 uMask;
  uniform float uMaskSoft;
  float hash(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
  // Value noise on a lattice of 'period' cells round the circle, so it wraps
  float noiseP(float x, float period) {
    float i = floor(x);
    float f = fract(x);
    float u = f * f * (3.0 - 2.0 * f);
    return mix(hash(mod(i, period)), hash(mod(i + 1.0, period)), u);
  }
  float fbmP(float a, float period, float seed) {
    float s = 0.0, amp = 0.5, total = 0.0;
    for (int k = 0; k < 4; k++) {
      s += amp * noiseP(a * period + seed, period);
      total += amp;
      amp *= 0.5;
      period *= 2.0;
    }
    return s / total;
  }
  // 1 well outside the tower's outline on screen, 0 inside it: where the aurora may move
  float live() {
    vec2 lo = uMask.xy - gl_FragCoord.xy;
    vec2 hi = gl_FragCoord.xy - uMask.zw;
    return smoothstep(0.0, uMaskSoft, max(max(lo.x, hi.x), max(lo.y, hi.y)));
  }
  // How strongly the aurora shows above this azimuth (turns), 0.35–1: all
  // round the sky. calm (0–1) blends toward its average over time, which is
  // what the aurora shows behind the tower: there it neither moves nor
  // carries detail, so its edge meets the moving part softly
  float auroraShow(float a, float t, float calm) {
    float s = 0.35 + 0.65 * smoothstep(0.2, 0.8, noiseP(a * 5.0 + t * 0.01, 5.0));
    return mix(s, 0.68, calm);
  }
  // The curtains' folds along the arc: bright sheets and dim gaps, drifting
  float auroraFolds(float a, float t, float calm) {
    return mix(smoothstep(0.3, 0.75, fbmP(a, 16.0, t * 0.035)), 0.5, calm);
  }
`;

const vertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const skyFragment = /* glsl */ `
  uniform float uTime;
  uniform float uGround;
  uniform vec3 uZenith;
  uniform vec3 uSky;
  uniform vec3 uHorizon;
  uniform vec3 uHaze;
  uniform vec3 uSnowLow;
  uniform vec3 uSnowHigh;
  uniform vec3 uRock;
  uniform vec3 uAurLow;
  uniform vec3 uAurMid;
  uniform vec3 uAurHigh;
  uniform sampler2D uDetail;
  uniform sampler2D uMacro;
  varying vec3 vWorld;
  ${common}

  // The aurora at time t: a low arc whose green hem just clears the far
  // peaks, its curtains rising through teal into violet, and a fainter
  // band high overhead. Rays comb both.
  vec3 aurora(float a, float e, float t, float calm) {
    vec3 c = vec3(0.0);
    float show = auroraShow(a, t, calm);
    for (int k = 0; k < 2; k++) {
      float fk = float(k);
      // The low arc's hem sits just over the far peaks: at the opening view its
      // brightest light falls between the HUD's panels and the ridge line
      float base = k == 0 ? -0.3 : 16.0;
      float sway = k == 0 ? 1.4 : 4.0;
      float hemLive = base + sway * (fbmP(a + fk * 0.37, 3.0, fk * 7.0 + t * 0.02) - 0.5) * 2.0
        + 0.8 * sin(a * TAU * 5.0 + fk * 2.0 + t * 0.06);
      float hemCalm = base + sway * (fbmP(a + fk * 0.37, 3.0, fk * 7.0) - 0.5) * 2.0
        + 0.8 * sin(a * TAU * 5.0 + fk * 2.0);
      float hemAt = calm > 0.999 ? hemCalm : mix(hemLive, hemCalm, calm);
      float h = e - hemAt;
      if (h < -2.0) continue;
      float hem = smoothstep(-0.9, 0.25, h) * (1.0 + 0.9 * exp(-max(h, 0.0) / 1.1));
      float fall = exp(-max(h, 0.0) / (k == 0 ? 7.0 : 10.0));
      float folds = mix(0.25, 1.0, auroraFolds(a + fk * 0.21, t, calm));
      float rays = 0.55 + 0.45 * noiseP(a * 260.0 + t * 0.06 + fk * 50.0, 260.0);
      rays = mix(1.0, mix(rays, 0.78, calm), smoothstep(0.0, 2.5, h));
      vec3 col = mix(uAurLow, uAurMid, smoothstep(1.5, 7.0, h));
      col = mix(col, uAurHigh, smoothstep(5.0, 16.0, h));
      c += col * hem * fall * folds * rays * show * (k == 0 ? 1.0 : 0.55);
    }
    return c;
  }

  void main() {
    vec3 dir = normalize(vWorld - cameraPosition);
    float e = degrees(asin(clamp(dir.y, -1.0, 1.0)));
    float a = fract(atan(dir.x, dir.z) / TAU + 1.0);
    vec3 col;
    if (dir.y > 0.0) {
      // The night: near-black at the zenith, a little bluer toward the horizon
      float up = e / 90.0;
      col = mix(uHorizon, uSky, smoothstep(0.0, 0.16, up));
      col = mix(col, uZenith, smoothstep(0.15, 0.85, up));
      col += vec3(0.04, 0.06, 0.09) * exp(-pow(e / 5.0, 2.0));
      // The aurora: moving outside the tower's outline, still inside it
      float m = live();
      vec3 aur = aurora(a, e, uTime, 1.0 - m);
      col += aur * 0.34 * smoothstep(0.3, 1.5, e);
    } else {
      // The snowfield: the plane far below, met by this view ray. Still.
      float depth = (cameraPosition.y - uGround) / max(-dir.y, 1e-4);
      vec2 p = cameraPosition.xz + dir.xz * depth;
      vec4 d1 = texture2D(uDetail, p / 16.0);
      vec2 q = mat2(0.8, -0.6, 0.6, 0.8) * p;
      vec4 d2 = texture2D(uDetail, q / 41.0 + 0.31);
      vec4 m = texture2D(uMacro, mat2(0.87, 0.5, -0.5, 0.87) * p / 240.0);
      float near = 1.0 - smoothstep(40.0, 220.0, depth);
      float detail = d1.r * 0.55 + d2.r * 0.45;
      float shade = 0.5 + (m.r - 0.5) * 0.22 + (mix(0.5, detail, near) - 0.5) * 0.6;
      col = mix(uSnowLow, uSnowHigh, shade);
      // Rock breaking through the snow
      float rock = smoothstep(0.8, 0.84, m.b + d1.b * 0.06);
      col = mix(col, mix(uRock, uSnowLow, 0.55), rock * 0.4);
      // The aurora's light lying on the snow, faintly, in patches
      col += mix(uAurLow, uAurHigh, 0.35) * m.g * 0.03;
      // Ice grains glinting close by
      col += vec3(0.6, 0.8, 1.0) * d1.g * 0.07 * (1.0 - smoothstep(30.0, 70.0, depth));
      // Into the haze toward the horizon
      col = mix(col, uHaze, 1.0 - exp(-depth / 260.0));
      col = mix(col, uHorizon, smoothstep(-1.2, 0.0, e));
    }
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const rangeFragment = /* glsl */ `
  uniform float uTime;
  uniform float uBase;
  uniform float uHeight;
  uniform float uLow;
  uniform float uSeed;
  uniform float uPeriod;
  uniform float uFog;
  uniform float uDomes;
  uniform float uDomeW;
  uniform vec3 uHaze;
  uniform vec3 uRock;
  uniform vec3 uSnow;
  uniform vec3 uShade;
  uniform vec3 uAurLow;
  uniform vec3 uAurHigh;
  uniform vec3 uWindow;
  varying vec3 vWorld;
  ${common}

  // Ridge height as a fraction of the ring's height, at azimuth a (turns):
  // ridged octaves (sharp crests, every one a peak) over broad massifs
  float ridge(float a) {
    float h = 0.0, amp = 0.5, total = 0.0, f = uPeriod;
    for (int i = 0; i < 5; i++) {
      float n = noiseP(a * f + uSeed * float(i + 1), f);
      float r = 1.0 - abs(n * 2.0 - 1.0);
      h += amp * r * r;
      total += amp;
      amp *= 0.5;
      f *= 2.0;
    }
    h /= total;
    float massif = noiseP(a * uPeriod * 0.5 + uSeed * 7.0, uPeriod * 0.5);
    // Stretched to the full range and sharpened, so the ranges stand as peaks
    float peak = pow(smoothstep(0.12, 0.7, h), 1.6) * (0.3 + 0.7 * massif);
    return uLow + (1.0 - uLow) * peak;
  }

  // The aurora's light on the snow at time t: bands sweeping slowly along the ranges
  vec3 auroraLight(float a, float v, float t, float calm) {
    float band = auroraFolds(a, t, calm) * auroraShow(a, t, calm);
    return mix(uAurLow, uAurHigh, smoothstep(0.4, 1.0, v)) * band;
  }

  void main() {
    float a = fract(atan(vWorld.x, vWorld.z) / TAU + 1.0);
    float v = (vWorld.y - uBase) / uHeight;
    float r = ridge(a);
    // Three small observatories on the near crests: the crest levelled for
    // each, a dark drum and dome with a lit slit, and a low hut beside it
    // with one lit window
    float building = 0.0;
    float light = 0.0;
    if (uDomes > 0.5) {
      for (int k = 0; k < 3; k++) {
        float a0 = 0.105 + float(k) * 0.3337 + float(k * k) * 0.021;
        float da = (fract(a - a0 + 0.5) - 0.5) / uDomeW;
        float seat = ridge(a0);
        if (abs(da) < 4.0) r = mix(seat, r, smoothstep(2.6, 4.0, abs(da)));
        float drum = seat + 0.035;
        float dome = drum + sqrt(max(1.0 - da * da, 0.0)) * 0.07;
        float hut = abs(da - 1.9) < 0.75 && v < seat + 0.03 ? 1.0 : 0.0;
        if ((abs(da) < 1.0 && v <= dome) || hut > 0.5) {
          if (v > seat - 0.02) {
            building = 1.0;
            if (abs(da - 0.18) < 0.12 && v > drum + 0.008 && v < dome - 0.012) light = 1.0;
            if (abs(da - 2.1) < 0.14 && abs(v - seat - 0.014) < 0.007) light = 1.0;
          }
        }
      }
    }
    if (v > r && building < 0.5) discard;
    float depth = max(r - v, 0.0);
    // Faces: the ridge's slope measured over a span that widens with depth,
    // so each peak's two faces spread down from it as triangles, the
    // windward one moonlit, the lee in shadow
    float span = 0.001 + depth * 0.045;
    float slope = (ridge(a + span) - ridge(a - span)) / (2.0 * span);
    float lit = clamp(0.5 + slope * 0.03, 0.0, 1.0);
    // Snow holds on the upper faces, further down the lit ones, and in the
    // couloirs that score the rock below
    float line = 0.08 + 0.2 * lit;
    float gully = noiseP(a * uPeriod * 44.0 + depth * 4.0, uPeriod * 44.0);
    float below = depth - line;
    float couloir = smoothstep(0.72, 0.86, gully) * smoothstep(0.0, 0.02, below)
      * (1.0 - smoothstep(0.04, 0.16, below)) * lit;
    float snow = max(smoothstep(line + 0.03, line - 0.03, depth), couloir * 0.5);
    vec3 col = mix(uRock, uShade, smoothstep(0.1, 0.6, lit));
    col = mix(col, mix(uShade, uSnow, 0.25 + 0.75 * lit), snow);
    // The crest catches the moonlight: a fine line along the skyline
    col = mix(col, uSnow * 1.1, (1.0 - smoothstep(0.0, 0.01, depth)) * lit * 0.5);
    // The aurora's light passing along the snow (still inside the tower's outline)
    float m = live();
    vec3 aur = auroraLight(a, v, uTime, 1.0 - m);
    col += aur * snow * (0.3 + 0.7 * lit) * 0.16;
    if (building > 0.5) col = vec3(0.035, 0.05, 0.075);
    col = mix(col, uWindow, light * 0.85);
    // Mist in the valleys, haze with distance
    col = mix(col, uHaze, smoothstep(0.2, 0.8, depth) * 0.8 * (1.0 - building));
    col = mix(col, uHaze, uFog * (1.0 - light * 0.6));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

/**
 * The sky and the snowfield: one sphere round the scene, shaded per pixel
 * from the view ray (the sky at infinity, the snowfield as the plane the ray
 * meets). The textures are mipmapped, so the snow stays calm to the horizon.
 */
const Sky = () => {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
        uniforms: {
          uTime: { value: 0 },
          uGround: { value: GROUND_Y },
          uZenith: { value: hex(NIGHT.zenith) },
          uSky: { value: hex(NIGHT.sky) },
          uHorizon: { value: hex(NIGHT.horizon) },
          uHaze: { value: hex(NIGHT.haze) },
          uSnowLow: { value: hex(NIGHT.snowLow) },
          uSnowHigh: { value: hex(NIGHT.snowHigh) },
          uRock: { value: hex(NIGHT.rock) },
          uAurLow: { value: hex(NIGHT.auroraLow) },
          uAurMid: { value: hex(NIGHT.auroraMid) },
          uAurHigh: { value: hex(NIGHT.auroraHigh) },
          uDetail: { value: snowDetailTexture() },
          uMacro: { value: snowMacroTexture() },
          uMask: towerMask.rect,
          uMaskSoft: towerMask.soft,
        },
        vertexShader: vertex,
        fragmentShader: skyFragment,
      }),
    [],
  );
  const geometry = useMemo(() => new SphereGeometry(SKY_RADIUS, 48, 24), []);
  useEffect(
    () => () => {
      material.dispose();
      geometry.dispose();
    },
    [material, geometry],
  );
  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
  });
  return (
    <mesh
      geometry={geometry}
      material={material}
      renderOrder={-1000}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

interface RangeSpec {
  radius: number;
  height: number;
  /** Lowest ridge, as a fraction of the height. */
  low: number;
  seed: number;
  /** Peaks round the compass (lattice cells). */
  period: number;
  fog: number;
  domes: boolean;
  snow: string;
  shade: string;
  order: number;
}

// Far to near. From the opening view (camera about 4 above the tower's
// centre) the far ring's peaks reach just past the horizon, under the
// aurora's hem, and the near ring's crests stand in the band between the
// top of the tower and the horizon.
const RANGES: RangeSpec[] = [
  {
    radius: 440,
    height: 42,
    low: 0.5,
    seed: 3,
    period: 14,
    fog: 0.42,
    domes: false,
    snow: '#43556f',
    shade: '#1b2537',
    order: -998,
  },
  {
    radius: 250,
    height: 30,
    low: 0.42,
    seed: 41,
    period: 10,
    fog: 0.12,
    domes: true,
    snow: NIGHT.mountainSnow,
    shade: NIGHT.mountainShade,
    order: -997,
  },
];

/** A ring of snowy ranges standing on the snowfield, round the whole compass. */
const Range = ({ spec }: { spec: RangeSpec }) => {
  const { geometry, material } = useMemo(() => {
    const base = GROUND_Y - 1;
    const geometry = new CylinderGeometry(
      spec.radius,
      spec.radius,
      spec.height,
      160,
      1,
      true,
    ).translate(0, base + spec.height / 2, 0);
    const material = new ShaderMaterial({
      side: DoubleSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uBase: { value: base },
        uHeight: { value: spec.height },
        uLow: { value: spec.low },
        uSeed: { value: spec.seed },
        uPeriod: { value: spec.period },
        uFog: { value: spec.fog },
        uDomes: { value: spec.domes ? 1 : 0 },
        // A dome about 4.4 units across
        uDomeW: { value: 2.2 / (Math.PI * 2 * spec.radius) },
        uAurHigh: { value: hex(NIGHT.auroraHigh) },
        uMask: towerMask.rect,
        uMaskSoft: towerMask.soft,
        uHaze: { value: hex(NIGHT.haze) },
        uRock: { value: hex(NIGHT.rock) },
        uSnow: { value: hex(spec.snow) },
        uShade: { value: hex(spec.shade) },
        uAurLow: { value: hex(NIGHT.auroraLow) },
        uWindow: { value: hex(NIGHT.window) },
      },
      vertexShader: vertex,
      fragmentShader: rangeFragment,
    });
    return { geometry, material };
  }, [spec]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
  });
  return (
    <mesh
      geometry={geometry}
      material={material}
      renderOrder={spec.order}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

/**
 * Stars above the horizon only, fixed: the night holds still. Polaris
 * stands at the zenith, the brightest of them.
 */
const Stars = () => {
  const { geometry, material } = useMemo(() => {
    const random = rng(71);
    const count = 1600;
    const pos = new Float32Array((count + 1) * 3);
    const size = new Float32Array(count + 1);
    const tint = new Float32Array((count + 1) * 3);
    const c = new Color();
    const tints = ['#ffffff', '#d7e6ff', '#fff1dc', '#cfe9ff'];
    let n = 0;
    while (n < count) {
      // Uniform over the sky from 3° up, a little thinner low down
      const y = Math.sin(3 * (Math.PI / 180)) + random() * (1 - Math.sin(3 * (Math.PI / 180)));
      if (random() > 0.45 + y) continue;
      const t = random() * Math.PI * 2;
      const r = Math.sqrt(1 - y * y);
      const R = SKY_RADIUS * 0.8;
      pos.set([R * r * Math.cos(t), R * y, R * r * Math.sin(t)], n * 3);
      size[n] = 0.6 + random() ** 5 * 2.4;
      c.set(tints[Math.floor(random() * tints.length)]);
      const dim = 0.3 + random() * 0.5;
      tint.set([c.r * dim, c.g * dim, c.b * dim], n * 3);
      n++;
    }
    pos.set([0, SKY_RADIUS * 0.8, 0], count * 3);
    size[count] = 4;
    tint.set([1, 0.97, 0.9], count * 3);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(pos, 3));
    geometry.setAttribute('aSize', new BufferAttribute(size, 1));
    geometry.setAttribute('aTint', new BufferAttribute(tint, 3));
    // Opaque (drawn in the opaque pass, before the board) but added onto the sky
    const material = new ShaderMaterial({
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      fog: false,
      uniforms: { uMap: { value: dotTexture(0.75) }, uDpr: { value: 1 } },
      vertexShader: /* glsl */ `
        uniform float uDpr;
        attribute float aSize;
        attribute vec3 aTint;
        varying vec3 vTint;
        void main() {
          vTint = aTint;
          // At infinity: along their direction from the camera, whatever the orbit
          vec3 w = cameraPosition + (modelMatrix * vec4(position, 1.0)).xyz;
          gl_PointSize = aSize * uDpr * 1.6;
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vTint;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a;
          gl_FragColor = vec4(vTint * a, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    return { geometry, material };
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useFrame((state) => {
    material.uniforms.uDpr.value = state.viewport.dpr;
  });
  return (
    <points
      geometry={geometry}
      material={material}
      renderOrder={-999}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
};

const corner = new Vector3();
const size = new Vector2();

/**
 * Measures where the tower lies on screen each frame (its bounding box,
 * pieces and a held piece's lift included, projected), grown by 15% of its
 * size, for the backdrop's still zone.
 */
const TowerMask = ({ layout }: { layout: BoardLayout }) => {
  const { half, levelY } = towerFrame(layout);
  useFrame(({ camera, gl }) => {
    gl.getDrawingBufferSize(size);
    const reach = half + 0.1;
    const y0 = levelY[0] - 0.1;
    const y1 = levelY[levelY.length - 1] + 0.95;
    let x0 = Infinity;
    let x1 = -Infinity;
    let ya = Infinity;
    let yb = -Infinity;
    let behind = false;
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? reach : -reach, i & 2 ? y1 : y0, i & 4 ? reach : -reach);
      corner.applyMatrix4(camera.matrixWorldInverse);
      if (corner.z > -0.01) behind = true;
      corner.applyMatrix4(camera.projectionMatrix);
      const px = (corner.x * 0.5 + 0.5) * size.x;
      const py = (corner.y * 0.5 + 0.5) * size.y;
      x0 = Math.min(x0, px);
      x1 = Math.max(x1, px);
      ya = Math.min(ya, py);
      yb = Math.max(yb, py);
    }
    const rect = towerMask.rect.value;
    if (behind) {
      rect.set(-1e5, -1e5, 1e5, 1e5);
    } else {
      const gx = (x1 - x0) * 0.075;
      const gy = (yb - ya) * 0.075;
      rect.set(x0 - gx, ya - gy, x1 + gx, yb + gy);
    }
    towerMask.soft.value = size.y * 0.05;
  });
  return null;
};

/**
 * The aurora drifts slowly, so it needs no more than about ten frames a
 * second, and none at all while the view looks down past the ranges (from
 * there nothing in the backdrop moves). The canvas renders on demand; this
 * asks for a frame at that pace. The request rides the display's frame
 * callback; the aurora itself moves on r3f's clock.
 */
const AmbientPace = ({ fps = 10 }: { fps?: number }) => {
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    let id = 0;
    let last = -Infinity;
    const tick = (now: number) => {
      if (now - last >= 1000 / fps && elevationOf(camera.position) < 32) {
        last = now;
        invalidate();
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [fps, invalidate, camera]);
  return null;
};

/** The whole backdrop: sky and aurora, stars, snowfield, ranges and observatories. */
export const PolarNight = ({ layout }: { layout: BoardLayout }) => (
  <>
    <TowerMask layout={layout} />
    <AmbientPace />
    <Sky />
    <Stars />
    {RANGES.map((spec) => (
      <Range key={spec.radius} spec={spec} />
    ))}
  </>
);
