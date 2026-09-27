import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import {
  BackSide,
  Camera,
  Color,
  HalfFloatType,
  Matrix4,
  Mesh,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { MOON, MOON_HAZE, MOUNTAINS, NIGHT, RIDGE_SILVER } from './palette';
import { noiseTexture, ridgeTexture } from './textures';

// The night the tower floats in, painted in one shader on a sphere round the
// scene: silver ink on indigo paper. Far above a sea of cloud, four ranges of
// ink-wash mountains ring the horizon, each drawn with a moonlit silver ridge
// line and washed down into a bank of mist; pines stand along the nearer
// ridges and a pagoda on a far one; a large soft moon hangs low behind the
// mist with a faint halo round it. Looking down (the bird's-eye view) there
// is only the sea of cloud, its billows traced in faint silver contours, and
// a few dark peaks breaking through it.
//
// Everything is computed from the view direction, so it is crisp at any zoom
// and right from every side. Nothing in it moves: it is a painting. Every
// view ray is tested against the tower's own box (from the current camera,
// at any distance and angle), and where it passes through or near it the
// silver lines (ridges, contours, stars, the moon's ring) and the
// piece-like shapes (pines, the pagoda) give way entirely and the moon all
// but vanishes, so nothing bright or shaped like a piece ever shows through
// the platforms.

const RADIUS = 160;
const DEG = Math.PI / 180;

/** The world's horizon sits a little below eye level: we are high above the valley. */
const HORIZON = -3;
/**
 * The moon: azimuth and elevation in degrees. Low over the far ranges to the
 * right of the tower in the opening view (which looks toward azimuth 196°,
 * its top edge on the horizon), clear of every HUD panel, and small and dim:
 * the brightest silver belongs to the marks.
 */
const MOON_AZ = 176;
const MOON_EL = -6.2;
const MOON_R = 2.4;
/** The pagoda: azimuth (on the second range, off to the left of the opening view). */
const TEMPLE_AZ = 242;
/**
 * The calm zone: the tower's box (half its width and height, world units,
 * platforms, pieces on the top level and a margin included) and how far past
 * it (along the view ray) the calm fades back into the full backdrop.
 */
const TOWER_HALF = [2.8, 3.2];
const TOWER_FADE = 1.6;

const dir = (azDeg: number, elDeg: number) =>
  new Vector3(
    Math.sin(azDeg * DEG) * Math.cos(elDeg * DEG),
    Math.sin(elDeg * DEG),
    Math.cos(azDeg * DEG) * Math.cos(elDeg * DEG),
  );

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uSky;
  uniform vec3 uHorizon;
  uniform vec3 uMist;
  uniform vec3 uSea;
  uniform vec3 uDeep;
  uniform vec3 uRange[4];
  uniform vec3 uSilver;
  uniform vec3 uMoon;
  uniform vec3 uHaze;
  uniform vec3 uMoonDir;
  uniform float uMoonR;
  uniform float uTempleAz;
  uniform sampler2D uRidges;
  uniform sampler2D uNoise;
  uniform vec2 uTowerHalf;
  uniform float uTowerFade;
  varying vec3 vWorld;

  const float PI = 3.14159265;
  const float HZ = ${HORIZON.toFixed(1)};

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm3(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) {
      v += a * vnoise(p);
      p = p * 2.07 + vec2(11.3, 5.7);
      a *= 0.5;
    }
    return v / 0.875;
  }
  // The ranges' lookups (ridge, hair, dry, grove) at an azimuth, for range k
  vec4 rangeAt(float u, float k) {
    return texture2D(uRidges, vec2(u, (k + 0.5) / 4.0));
  }
  // A pine as a painter draws one: a leaning trunk and flat pads of needles
  float pine(vec2 q, float h, float lean) {
    float x = q.x - lean * q.y;
    float y = q.y;
    float d = step(abs(x), h * 0.035) * step(0.0, y) * step(y, h * 0.9);
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float py = h * (0.34 + 0.19 * fi);
      float w = h * (0.44 - 0.085 * fi);
      float t = h * (0.075 - 0.008 * fi);
      float side = (mod(fi, 2.0) - 0.5) * 0.18 * h;
      vec2 e = vec2((x - side) / w, (y - py) / t);
      d = max(d, step(dot(e, e), 1.0));
    }
    return d;
  }
  // A three-storey pagoda on a ridge, in degrees about its foot
  float pagoda(vec2 q) {
    float s = 0.0;
    float y0 = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float bw = 0.5 - 0.09 * fi;
      float bh = 0.42 - 0.05 * fi;
      // The storey
      s = max(s, step(abs(q.x), bw) * step(y0, q.y) * step(q.y, y0 + bh));
      // Its roof: broad, thin, with eaves curling up at the ends
      float rw = 1.05 - 0.2 * fi;
      float ry = y0 + bh;
      float k = clamp(abs(q.x) / rw, 0.0, 1.0);
      float bottom = ry + 0.16 * k * k * k - 0.02;
      float top = ry + 0.2 - 0.12 * k;
      s = max(s, step(abs(q.x), rw) * step(bottom, q.y) * step(q.y, top));
      y0 = top - 0.03;
    }
    // The spire, with its rings
    float spire = step(abs(q.x), 0.035) * step(y0, q.y) * step(q.y, y0 + 1.0);
    float rings = step(abs(q.x), 0.1) * step(0.5, fract((q.y - y0) * 7.0)) * step(y0 + 0.2, q.y) * step(q.y, y0 + 0.75);
    return max(s, max(spire, rings));
  }

  void main() {
    vec3 d = normalize(vWorld - cameraPosition);
    float e = degrees(asin(clamp(d.y, -1.0, 1.0)));
    float az = atan(d.x, d.z);
    // Round the horizon, 0..1 (the lookups wrap, so there is no seam)
    float u = az / 6.28318530718 + 0.5;
    float aa = max(fwidth(e), 1e-3);

    // The calm zone: toward the tower, the backdrop holds still and quiet
    // The view ray against the tower's box (slabs): how far it misses, along
    // the ray; negative where it passes through the tower
    vec3 half3 = vec3(uTowerHalf.x, uTowerHalf.y, uTowerHalf.x);
    vec3 inv = 1.0 / (d + sign(d) * 1e-6 + vec3(equal(d, vec3(0.0))) * 1e-6);
    vec3 t0 = (-half3 - cameraPosition) * inv;
    vec3 t1 = (half3 - cameraPosition) * inv;
    vec3 tMin = min(t0, t1);
    vec3 tMax = max(t0, t1);
    float tNear = max(max(tMin.x, tMin.y), tMin.z);
    float tFar = min(min(tMax.x, tMax.y), tMax.z);
    float miss = tFar < 0.0 ? 1e3 : tNear - tFar;
    float outside = smoothstep(0.0, uTowerFade, miss);
    float detail = outside;

    // --- The night paper ------------------------------------------------------
    vec3 col;
    if (e > HZ) {
      float k = clamp((e - HZ) / 70.0, 0.0, 1.0);
      col = mix(uHorizon, uSky, smoothstep(0.0, 0.25, k));
      col = mix(col, uZenith, smoothstep(0.2, 1.0, k));
    } else {
      float k = clamp((HZ - e) / 87.0, 0.0, 1.0);
      col = mix(uMist, uSea, smoothstep(0.0, 0.18, k));
      col = mix(col, uDeep, smoothstep(0.35, 1.0, k));
    }

    // --- The moon -------------------------------------------------------------
    float mAng = degrees(acos(clamp(dot(d, uMoonDir), -1.0, 1.0)));
    // Haze: a wide soft glow and a tighter one, and the faint 22° halo ring
    float moonCalm = mix(0.06, 1.0, outside);
    col += uHaze * (0.08 * exp(-mAng / 9.0) + 0.06 * exp(-mAng / 2.6)) * moonCalm;
    col += uHaze * 0.035 * exp(-pow((mAng - 22.0) / 1.1, 2.0)) * outside;
    float disc = 1.0 - smoothstep(uMoonR - 0.25 - aa, uMoonR + 0.1 + aa, mAng);
    if (disc > 0.0) {
      // Faint maria and a darker limb, low in contrast: a moon seen through mist
      vec2 mp = vec2(az * 57.3, e) * 0.9;
      float maria = smoothstep(0.45, 0.75, fbm3(mp * 0.55 + 3.0));
      float limb = sqrt(max(0.0, 1.0 - pow(mAng / uMoonR, 2.0)));
      vec3 moon = uMoon * (0.8 + 0.2 * limb) * (1.0 - 0.13 * maria);
      col = mix(col, moon, disc * 0.25 * moonCalm);
    }

    // --- Stars, sparse and still, above the horizon --------------------------
    if (e > HZ + 1.0) {
      vec2 sp = vec2(mod(degrees(az) + 360.0, 360.0) * cos(radians(e)), e) * 0.9;
      vec2 cell = floor(sp);
      float h = hash(cell);
      if (h > 0.93) {
        vec2 c = cell + 0.5 + (vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5) * 0.6;
        float r = length(sp - c);
        float star = exp(-r * r * 40.0) * (h - 0.93) * 12.0;
        star *= smoothstep(HZ + 1.0, HZ + 8.0, e) * smoothstep(4.0, 12.0, mAng);
        col += uSilver * star * 0.35 * detail;
      }
    }

    // --- Mountains, far to near, each washed down into its mist ---------------
    // Far below every ridge only the ranges' thin wash is left: laid on flat,
    // without the per-range work (the sea of cloud covers it there anyway)
    if (e <= -26.0) {
      for (int k = 0; k < 4; k++) col = mix(col, uRange[k], 0.22);
    } else if (e < 8.0) {
      for (int k = 0; k < 4; k++) {
        float fk = float(k);
        float base = HZ - 2.2 - fk * 3.3;
        vec4 range = rangeAt(u, fk);
        float r = range.r;
        float below = r - e;
        float inside = smoothstep(-aa, aa, below);
        // The pagoda stands on the second range
        if (k == 1 && below > -3.2 && below < 0.6) {
          float daz = degrees(atan(sin(az - uTempleAz), cos(az - uTempleAz)));
          if (abs(daz) < 2.0) {
            vec2 q = vec2(daz * cos(radians(e)), e - (r - 0.25));
            // (like every piece-like shape, it gives way behind the tower)
            inside = max(inside, pagoda(q * 1.15) * outside);
          }
        }
        // Pines along the two nearest ridges, in clusters (only near the ridge)
        if (k >= 2 && below > -2.6 && below < 0.6) {
          // A whole number of trees round the horizon, so the row closes
          float count = floor(360.0 / (0.55 + 0.25 * (fk - 2.0)));
          float spacing = 360.0 / count;
          float t = u * count;
          float h = 1.0 + 0.55 * (fk - 2.0);
          for (int j = -1; j <= 1; j++) {
            float idx = floor(t) + float(j);
            float grove = rangeAt((idx + 0.5) / count, fk).a;
            float here = hash(vec2(mod(idx, count), fk));
            // Groves with gaps between them, trees of uneven size
            if (grove > 0.58 && here > 0.35) {
              float th = h * (0.4 + 1.0 * (here - 0.35) / 0.65) * (0.8 + 0.5 * grove);
              vec2 q = vec2((t - idx - 0.5) * spacing * cos(radians(e)), e - (r - 0.15));
              float lean = (hash(vec2(mod(idx, count), 9.0)) - 0.5) * 0.35;
              inside = max(inside, pine(q, th, lean) * outside);
            }
          }
        }
        if (inside <= 0.0) continue;
        // The wash: full at the ridge, thinning downward into mist
        float wash = mix(1.0, 0.25, smoothstep(0.0, 5.0 + fk * 2.0, below));
        float hair = 0.9 + 0.1 * range.g;
        col = mix(col, uRange[k], inside * wash * hair);
        // The moonlit ridge line in silver: brighter toward the moon, dry in places
        float toMoon = 0.55 + 0.45 * cos(az - radians(${MOON_AZ.toFixed(1)}));
        float dry = smoothstep(0.4, 0.6, range.b);
        float line = exp(-pow(max(below, 0.0) / (0.12 + 0.03 * fk), 2.0)) * step(-aa, below);
        col += uSilver * line * (0.08 + 0.05 * fk) * toMoon * dry * detail;
        // Mist gathering at the foot of this range, in banks (a whole number
        // of tiles round the horizon, so the mist closes)
        float mist = exp(-pow((e - (base - 1.8)) / (1.6 + 0.4 * fk), 2.0));
        vec2 mp = vec2(u * (3.0 + fk), e * 0.06 + fk * 0.31);
        float m1 = texture2D(uNoise, mp).r;
        col = mix(col, uMist, mist * smoothstep(0.3, 0.75, m1) * 0.55);
      }
    }

    // --- The sea of cloud below ----------------------------------------------
    if (e < HZ - 6.0) {
      float fade = smoothstep(HZ - 6.0, HZ - 22.0, e);
      vec2 g = d.xz / max(-d.y, 0.05) * 6.0;
      float n = texture2D(uNoise, g * 0.055).r * 0.75 + texture2D(uNoise, g * 0.03 + 0.37).g * 0.25;
      // Billows catching the moon
      vec3 billow = mix(uSea, uMist * 0.72, smoothstep(0.45, 0.8, n));
      col = mix(col, billow, fade * 0.85);
      // Silver contours round the billow tops, as clouds are painted
      float v = n * 5.0;
      float dv = max(fwidth(v), 1e-4);
      float c = 1.0 - smoothstep(0.35, 1.0, abs(fract(v + 0.5) - 0.5) / dv);
      c *= smoothstep(0.48, 0.62, n) * clamp(0.6 / (dv * 8.0), 0.0, 1.0);
      col += uSilver * c * 0.028 * fade * detail;
      // Dark peaks breaking through, their moonward edge lit
      float isl = texture2D(uNoise, g * 0.036 + vec2(0.4, 0.12)).b;
      float land = smoothstep(0.6, 0.72, isl);
      col = mix(col, uRange[3], land * fade * 0.45);
      float edge = exp(-pow((isl - 0.68) / 0.02, 2.0));
      col += uSilver * edge * 0.015 * fade * detail;
      // The moon's glow on the cloud tops toward it
      float path = max(0.0, dot(normalize(d.xz), normalize(uMoonDir.xz)));
      col += uHaze * pow(path, 12.0) * 0.1 * smoothstep(HZ - 6.0, HZ - 30.0, e) * n;
    }

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

/**
 * The backdrop. The painting is costly (it is computed per pixel, crisp at
 * any zoom), so it is painted into a texture the size of the canvas, shown
 * as the scene's background, and repainted only when the camera moves or
 * the canvas resizes. The rest of the time a frame only copies it.
 */
export const NightSky = () => {
  const scene = useThree((s) => s.scene);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const { sky, material, target } = useMemo(() => {
    const geometry = new SphereGeometry(RADIUS, 64, 32);
    const material = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: {
        uZenith: { value: new Color(NIGHT.zenith) },
        uSky: { value: new Color(NIGHT.sky) },
        uHorizon: { value: new Color(NIGHT.horizon) },
        uMist: { value: new Color(NIGHT.mist) },
        uSea: { value: new Color(NIGHT.sea) },
        uDeep: { value: new Color(NIGHT.deep) },
        uRange: { value: MOUNTAINS.map((c) => new Color(c)) },
        uSilver: { value: new Color(RIDGE_SILVER) },
        uMoon: { value: new Color(MOON) },
        uHaze: { value: new Color(MOON_HAZE) },
        uMoonDir: { value: dir(MOON_AZ, MOON_EL) },
        uMoonR: { value: MOON_R },
        uTempleAz: { value: TEMPLE_AZ * DEG },
        uRidges: { value: ridgeTexture() },
        uNoise: { value: noiseTexture() },
        uTowerHalf: { value: TOWER_HALF },
        uTowerFade: { value: TOWER_FADE },
      },
      vertexShader,
      fragmentShader,
    });
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    const sky = new Scene();
    sky.add(mesh);
    // Half floats: the night's dark gradients would band in 8 bits
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
    return { sky, material, target };
  }, []);
  useEffect(
    () => () => {
      sky.traverse((o) => (o as Mesh).geometry?.dispose());
      material.dispose();
      target.dispose();
    },
    [sky, material, target],
  );
  useEffect(() => {
    const previous = scene.background;
    scene.background = target.texture;
    return () => {
      scene.background = previous;
    };
  }, [scene, target]);

  const painted = useRef({ view: new Matrix4(), projection: new Matrix4() });
  const dirty = useRef(true);
  useEffect(() => {
    target.setSize(
      Math.max(1, Math.round(size.width * dpr)),
      Math.max(1, Math.round(size.height * dpr)),
    );
    dirty.current = true;
  }, [target, size.width, size.height, dpr]);

  // Painted from inside the scene's own render, just before its background
  // is drawn: never a frame late, and never when a frame is skipped
  useEffect(() => {
    const previous = scene.onBeforeRender;
    scene.onBeforeRender = function (this: Scene, ...args) {
      previous.apply(this, args);
      const [renderer, , camera] = args as unknown as [WebGLRenderer, Scene, Camera];
      const last = painted.current;
      const moved =
        !last.view.equals(camera.matrixWorld) || !last.projection.equals(camera.projectionMatrix);
      if (!moved && !dirty.current) return;
      const current = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(sky, camera);
      renderer.setRenderTarget(current);
      last.view.copy(camera.matrixWorld);
      last.projection.copy(camera.projectionMatrix);
      dirty.current = false;
    };
    return () => {
      scene.onBeforeRender = previous;
    };
  }, [scene, sky, target]);
  return null;
};
