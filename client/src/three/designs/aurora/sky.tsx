import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
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
} from 'three';
import { noRaycast } from '../kit/noRaycast';
import { dotTexture, rng } from '../kit/textures';
import { NIGHT } from './palette';
import { snowDetailTexture, snowMacroTexture } from './textures';

// The world round the tower: a polar plateau at night, seen from an
// observatory high above it. Far below lies a snowfield cut into sastrugi
// by the wind, with dark rock breaking through here and there and the
// aurora's colour lying faintly on it; two rings of snowy ranges rise from
// it all round the compass, with three small observatory domes on the near
// ridges (spread round, so no view is dressed and none is bare); above the
// horizon, a deep night with the aurora hung high in it. Everything is low
// in value and contrast so the board always wins. Only the aurora moves,
// slowly, and only well above the horizon, never behind the platforms from
// the opening view.

/** Height of the snowfield (world units): far below the tower, a real floor that parallaxes. */
export const GROUND_Y = -26;
const SKY_RADIUS = 520;

const hex = (c: string) => new Color(c);

const common = /* glsl */ `
  #define TAU 6.28318530718
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
    for (int k = 0; k < 5; k++) {
      s += amp * noiseP(a * period + seed, period);
      total += amp;
      amp *= 0.5;
      period *= 2.0;
    }
    return s / total;
  }
  // Where the aurora is showing round the sky (azimuth in turns), 0–1: drifts very slowly
  float auroraShow(float a, float t) {
    return smoothstep(0.28, 0.75, noiseP(a * 4.0 + t * 0.004, 4.0));
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

  // The aurora: curtains hanging from a wavering lower hem, brightest there
  // and fading upward from green through teal to violet, softly folded and
  // combed into rays. Two curtains at different heights.
  vec3 aurora(float a, float e, float t) {
    vec3 c = vec3(0.0);
    for (int k = 0; k < 2; k++) {
      float fk = float(k);
      float hemAt = 11.5 + fk * 9.0
        + 2.5 * (fbmP(a + fk * 0.37, 3.0, fk * 7.0 + t * 0.01) - 0.5) * 2.0
        + 1.6 * sin(a * TAU * 4.0 + fk * 2.0 + t * 0.04);
      float h = e - hemAt;
      if (h < -3.0) continue;
      float show = smoothstep(0.18, 0.65, noiseP(a * 4.0 + fk * 2.3 + t * 0.004, 4.0));
      // A sharp lower hem, brightest just above it, fading upward
      float hem = smoothstep(-1.0, 0.4, h) * (1.0 + 0.8 * exp(-max(h, 0.0) / 1.6));
      float fall = exp(-max(h, 0.0) / (6.0 + 5.0 * fk));
      // Folds: distinct bright sheets with dark gaps between, and fine rays within them
      float fold = fbmP(a, 18.0, fk * 13.0 + t * 0.012);
      float folds = smoothstep(0.35, 0.75, fold);
      float rays = 0.5 + 0.5 * noiseP(a * 220.0 + t * 0.05 + fk * 50.0, 220.0);
      rays = mix(1.0, rays, smoothstep(0.0, 4.0, h) * 0.8);
      vec3 col = mix(uAurLow, uAurMid, smoothstep(2.0, 9.0, h));
      col = mix(col, uAurHigh, smoothstep(7.0, 20.0, h));
      c += col * hem * fall * folds * rays * show;
    }
    return c;
  }

  void main() {
    vec3 dir = normalize(vWorld - cameraPosition);
    float e = degrees(asin(clamp(dir.y, -1.0, 1.0)));
    float a = fract(atan(dir.x, dir.z) / TAU + 1.0);
    float t = uTime;
    float show = auroraShow(a, t);
    vec3 col;
    if (dir.y > 0.0) {
      // The night: near-black at the zenith, a little bluer toward the
      // horizon, with a faint green airglow low down where the aurora is
      float up = e / 90.0;
      col = mix(uHorizon, uSky, smoothstep(0.0, 0.18, up));
      col = mix(col, uZenith, smoothstep(0.15, 0.85, up));
      // A faint cold glow low down (not green: nothing near the tower may read as a level's colour)
      col += vec3(0.05, 0.08, 0.12) * exp(-pow((e - 3.0) / 6.0, 2.0));
      if (e > 7.0) col += aurora(a, e, t) * 0.24 * smoothstep(7.0, 11.0, e);
    } else {
      // The snowfield: the plane far below, met by this view ray
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
      // Rock breaking through the snow, with a rim of drift on its lee
      float rock = smoothstep(0.8, 0.84, m.b + d1.b * 0.06);
      col = mix(col, mix(uRock, uSnowLow, 0.55), rock * 0.4);
      // The aurora's light lying on the snow, in patches, tinted along the plain
      float tint = 0.5 + 0.5 * sin(p.x * 0.011 + p.y * 0.007);
      col += mix(uAurLow, uAurHigh, tint * 0.6) * m.g * 0.045 * (0.5 + show);
      // Ice grains glinting close by
      col += vec3(0.6, 0.8, 1.0) * d1.g * 0.07 * (1.0 - smoothstep(30.0, 70.0, depth));
      // Into the haze, which the aurora colours faintly where it shows
      float haze = 1.0 - exp(-depth / 260.0);
      vec3 hz = uHaze + uAurLow * 0.012 * show;
      col = mix(col, hz, haze);
      // Right at the horizon, the haze glows a little
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
  uniform vec3 uWindow;
  varying vec3 vWorld;
  ${common}

  // Ridge height as a fraction of the ring's height, at azimuth a (turns):
  // broad massifs, sharp peaks on them (ridged noise), a little crag
  float ridge(float a) {
    float P = uPeriod;
    float n1 = noiseP(a * P + uSeed, P);
    float n2 = noiseP(a * P * 2.0 + uSeed * 2.0, P * 2.0);
    float n3 = noiseP(a * P * 7.0 + uSeed * 3.0, P * 7.0);
    float n4 = noiseP(a * P * 23.0 + uSeed * 5.0, P * 23.0);
    // Ridged: every crossing of the noise's middle is a sharp peak
    float peaks = n1 * 0.38 + pow(1.0 - abs(n2 * 2.0 - 1.0), 1.5) * 0.42
      + (1.0 - abs(n3 * 2.0 - 1.0)) * 0.14 + n4 * 0.06;
    return uLow + (1.0 - uLow) * smoothstep(0.2, 0.95, peaks);
  }

  void main() {
    float a = fract(atan(vWorld.x, vWorld.z) / TAU + 1.0);
    float v = (vWorld.y - uBase) / uHeight;
    float r = ridge(a);
    // Three small observatories on the ridges: the ridge levelled for
    // each, a drum, and a dome with its slit lit warm
    float top = -1.0;
    float slit = 0.0;
    float metal = 0.0;
    if (uDomes > 0.5) {
      for (int k = 0; k < 3; k++) {
        float a0 = 0.105 + float(k) * 0.3337 + float(k * k) * 0.021;
        float da = (fract(a - a0 + 0.5) - 0.5) / uDomeW;
        float seat = ridge(a0);
        if (abs(da) < 3.5) r = mix(seat, r, smoothstep(1.4, 3.5, abs(da)));
        if (abs(da) < 1.0 && v > seat - 0.01) {
          float drum = seat + 0.018;
          float t = drum + sqrt(max(1.0 - da * da, 0.0)) * 0.032;
          if (v <= t) {
            top = t;
            metal = 1.0;
            if (abs(da - 0.2) < 0.12 && v > drum + 0.004 && v < t - 0.006) slit = 1.0;
          }
        }
      }
    }
    if (v > max(r, top)) discard;
    float depth = r - v;
    // Faces: the ridge's slope measured over a span that widens with depth,
    // so each peak's two faces spread down from it as triangles, one lit
    // and one in shade, the way a range reads from afar
    float span = 0.0012 + depth * 0.05;
    float slope = (ridge(a + span) - ridge(a - span)) / (2.0 * span);
    float lit = clamp(0.5 + slope * 0.035, 0.0, 1.0);
    // Snow holds further down the lit faces
    float line = 0.1 + 0.22 * lit;
    float snow = smoothstep(line + 0.04, line - 0.04, depth) * (0.5 + 0.5 * lit);
    vec3 col = mix(uRock, uShade, smoothstep(0.0, 0.35, lit));
    col = mix(col, uSnow, snow);
    // The aurora's light on the snowfields
    col += mix(uAurLow, vec3(0.3, 0.9, 0.85), 0.4) * 0.07 * snow * (0.35 + 0.65 * auroraShow(a, uTime));
    // The ridge's crest catches the light: a thin line along the skyline
    float crest = 1.0 - smoothstep(0.0, 0.012, depth);
    col = mix(col, uSnow * 1.15, crest * (0.15 + 0.3 * lit));
    // Domes stay dark and low: never a pale shape a piece could be mistaken for
    if (metal > 0.5) col = mix(uShade, uSnow, 0.3);
    col = mix(col, uWindow * 0.3, slit);
    // Mist in the valleys, haze with distance
    col = mix(col, uHaze, smoothstep(0.18, 0.75, depth) * 0.75);
    col = mix(col, uHaze, uFog);
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
// centre) the far ring's peaks just touch the horizon, and the near ring's
// ridges stand in the band between the top of the tower and the horizon.
const RANGES: RangeSpec[] = [
  {
    radius: 440,
    height: 40,
    low: 0.62,
    seed: 3,
    period: 12,
    fog: 0.55,
    domes: false,
    snow: '#2b3f57',
    shade: '#17243a',
    order: -998,
  },
  {
    radius: 250,
    height: 28,
    low: 0.58,
    seed: 41,
    period: 8,
    fog: 0.22,
    domes: true,
    snow: '#2c425c',
    shade: '#142137',
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
        // A dome about 2.4 units across
        uDomeW: { value: 1.2 / (Math.PI * 2 * spec.radius) },
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

/** The whole backdrop: sky and aurora, stars, snowfield, ranges and observatories. */
export const PolarNight = () => (
  <>
    <Sky />
    <Stars />
    {RANGES.map((spec) => (
      <Range key={spec.radius} spec={spec} />
    ))}
  </>
);
