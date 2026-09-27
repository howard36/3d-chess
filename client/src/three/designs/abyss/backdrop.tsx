import { useEffect, useMemo } from 'react';
import {
  BackSide,
  CanvasTexture,
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  LinearFilter,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  ShaderMaterial,
  SphereGeometry,
} from 'three';
import { noRaycast } from '../kit/noRaycast';
import { fbm, paintedTexture, rng } from '../kit/textures';
import { WATER } from './palette';
import { TOWER_RADIUS } from './station';
import { view } from './view';

// The water outside the station, seen through its glass: a teal-black
// gradient lit faintly from far above, shafts of that light slanting down,
// a ring of rock stacks and arches with sea whips on the rim of the abyss,
// and specks of marine life hanging in the dark below. Everything is still
// and low in contrast, so pieces and marks always win; it reads the same
// from every azimuth (the formations are spread round the whole horizon)
// and from straight above (where the view drops into the abyss).
//
// The horizon band is painted once on a canvas (paths, not pixels), the
// rest is a light shader: a few texture reads per pixel.

/** The horizon band's span, degrees of elevation. */
const BAND_TOP = 18;
const BAND_BOTTOM = -30;
const W = 4096;
const H = 512;
/** Painted past each end of the strip, then cropped, so the wrap has no seam. */
const MARGIN = 64;

const yOf = (e: number) => ((BAND_TOP - e) / (BAND_TOP - BAND_BOTTOM)) * H;
const xOf = (u: number) => u * W;

const hex = (c: string, a = 1) => {
  const n = parseInt(c.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

const mix = (a: string, b: string, t: number) =>
  `#${new Color(a).lerp(new Color(b), t).getHexString()}`;

interface Stack {
  /** Centre, 0–1 round the horizon. */
  u: number;
  /** Half-width, degrees. */
  w: number;
  /** Top, degrees of elevation. */
  top: number;
  /** An arch through it. */
  arch: boolean;
}

/** The band of rock formations and sea whips round the horizon. */
const paintBand = (): HTMLCanvasElement => {
  const random = rng(29);
  const rough = fbm(5, 8, 4);
  // Every layer is painted with a margin past both ends of the strip, from
  // functions that repeat round the horizon, and cropped at the end, so the
  // blur and the strokes run seamlessly across the wrap
  const layer = () => {
    const c = document.createElement('canvas');
    c.width = W + 2 * MARGIN;
    c.height = H;
    const ctx = c.getContext('2d')!;
    ctx.translate(MARGIN, 0);
    return { c, ctx };
  };

  // --- The far ridge: low, hazy, close to the water's own colour ----------------
  const farWaves = [3, 5, 8, 13, 21, 34].map((k, i) => ({
    k,
    a: 2.3 * 0.6 ** i,
    p: random() * Math.PI * 2,
  }));
  const farH = (u: number) =>
    -2.6 +
    farWaves.reduce((s, w) => s + w.a * Math.sin(2 * Math.PI * w.k * u + w.p), 0) +
    (rough(u, 0.2) - 0.5) * 1.6;
  const far = layer();
  {
    const { ctx } = far;
    ctx.beginPath();
    ctx.moveTo(-MARGIN, H);
    for (let x = -MARGIN; x <= W + MARGIN; x += 4) ctx.lineTo(x, yOf(farH(x / W)));
    ctx.lineTo(W + MARGIN, H);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, yOf(6), 0, yOf(-16));
    g.addColorStop(0, hex(mix(WATER.horizon, '#021016', 0.3), 0.9));
    g.addColorStop(0.6, hex(mix(WATER.horizon, '#021016', 0.4), 0.8));
    g.addColorStop(1, hex(mix(WATER.horizon, '#021016', 0.4), 0));
    ctx.fillStyle = g;
    ctx.fill();
  }

  // --- The near formations: stacks and arches on a rough rim ---------------------
  const count = 7;
  const stacks: Stack[] = Array.from({ length: count }, (_, i) => ({
    u: (i + 0.25 + random() * 0.5) / count,
    w: 5 + random() * 9,
    top: -2.5 + random() * 6,
    arch: i === 0 || i === 2 || i === 5,
  }));
  const rimH = (u: number) =>
    -8.5 + (rough(u, 0.6) - 0.5) * 4 + Math.sin(u * 2 * Math.PI * 9) * 0.6;
  const nearH = (u: number) => {
    let h = rimH(u);
    for (const s of stacks) {
      for (const shift of [-1, 0, 1]) {
        const dx = (Math.abs(u - s.u - shift) * 360) / s.w;
        if (dx >= 1) continue;
        const shoulder = s.top - dx ** 5 * (s.top - rimH(u));
        h = Math.max(h, shoulder + (rough(u * 3, 0.9) - 0.5) * 1.8);
      }
    }
    return h;
  };
  const near = layer();
  {
    const { ctx } = near;
    const outline = new Path2D();
    outline.moveTo(-MARGIN, yOf(nearH(-MARGIN / W)));
    for (let x = -MARGIN + 2; x <= W + MARGIN; x += 2) outline.lineTo(x, yOf(nearH(x / W)));
    const body = new Path2D(outline);
    body.lineTo(W + MARGIN, H);
    body.lineTo(-MARGIN, H);
    body.closePath();
    const g = ctx.createLinearGradient(0, yOf(8), 0, yOf(-24));
    const rock = mix(WATER.horizon, '#010a0e', 0.5);
    g.addColorStop(0, hex(rock, 1));
    g.addColorStop(0.5, hex(rock, 1));
    g.addColorStop(0.75, hex(mix(rock, WATER.below, 0.4), 0.8));
    g.addColorStop(1, hex(WATER.below, 0));
    ctx.fillStyle = g;
    ctx.fill(body);

    // The arches: holes through the widest stacks, showing the water beyond
    ctx.globalCompositeOperation = 'destination-out';
    for (const s of stacks.filter((t) => t.arch)) {
      for (const shift of [-1, 0, 1]) {
        const cx = xOf(s.u + shift);
        const aw = (s.w * 0.42 * W) / 360;
        const spring = yOf(Math.min(s.top - 4.2, 0));
        const foot = yOf(-13);
        ctx.beginPath();
        ctx.moveTo(cx - aw, foot);
        ctx.lineTo(cx - aw * 0.92, spring);
        ctx.ellipse(cx, spring, aw * 0.92, aw * 0.8, 0, Math.PI, 0);
        ctx.lineTo(cx + aw, foot);
        ctx.closePath();
        ctx.fillStyle = 'rgba(0,0,0,0.92)';
        ctx.fill();
      }
    }

    // Light from far above catching the tops of the rocks
    ctx.globalCompositeOperation = 'source-atop';
    ctx.strokeStyle = hex('#2a4d55', 0.4);
    ctx.lineWidth = 3;
    ctx.stroke(outline);

    // Sea whips and kelp on the rim, gathered in groves near the stacks
    ctx.globalCompositeOperation = 'source-over';
    const stalk = mix(WATER.horizon, '#010a0e', 0.5);
    for (let i = 0; i < 150; i++) {
      const grove = stacks[Math.floor(random() * count)];
      const u = (((grove.u + (random() - 0.5) * 0.09) % 1) + 1) % 1;
      const y0 = yOf(nearH(u)) + 6;
      const height = (2.5 + random() ** 1.5 * 8) * (H / (BAND_TOP - BAND_BOTTOM));
      const lean = (random() - 0.5) * height * 0.5;
      const width = 1.2 + random() * 1.8;
      const blades: [number, number][] = [];
      if (random() < 0.45) {
        for (let b = 0.3; b < 0.95; b += 0.16 + random() * 0.1) {
          blades.push([b, random() < 0.5 ? -1 : 1]);
        }
      }
      ctx.fillStyle = hex(stalk, 0.85);
      // Once, and again a full turn either way where it crosses the wrap
      for (const x0 of [xOf(u) - W, xOf(u), xOf(u) + W]) {
        if (x0 < -MARGIN - 40 || x0 > W + MARGIN + 40) continue;
        ctx.beginPath();
        ctx.moveTo(x0 - width, y0);
        ctx.quadraticCurveTo(
          x0 + lean * 0.2 - width * 0.5,
          y0 - height * 0.6,
          x0 + lean,
          y0 - height,
        );
        ctx.quadraticCurveTo(x0 + lean * 0.2 + width * 0.5, y0 - height * 0.6, x0 + width, y0);
        ctx.closePath();
        ctx.fill();
        // Blades along the kelp
        for (const [b, side] of blades) {
          ctx.beginPath();
          ctx.ellipse(
            x0 + lean * b * b + side * 4,
            y0 - height * b,
            5,
            1.6,
            side * 0.5,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }
    }
  }

  // --- Composite: haze on the far ridge, a little on the near --------------------
  const hazy = document.createElement('canvas');
  hazy.width = W + 2 * MARGIN;
  hazy.height = H;
  const hctx = hazy.getContext('2d')!;
  hctx.filter = 'blur(4px)';
  hctx.drawImage(far.c, 0, 0);
  hctx.filter = 'blur(1.2px)';
  hctx.drawImage(near.c, 0, 0);
  // Cropped to one full turn: its two ends now meet without a seam
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  out.getContext('2d')!.drawImage(hazy, MARGIN, 0, W, H, 0, 0, W, H);
  return out;
};

/** Shafts of faint light by azimuth (1D, tiling): a few broad and many thin. */
const raysTexture = (): DataTexture => {
  const n = 1024;
  const random = rng(41);
  const data = new Uint8Array(n * 4);
  const shafts = Array.from({ length: 34 }, () => ({
    u: random(),
    w: 0.002 + random() ** 2 * 0.012,
    a: 0.25 + random() * 0.75,
  }));
  for (let i = 0; i < n; i++) {
    const u = i / n;
    let v = 0;
    for (const s of shafts) {
      const d = Math.min(Math.abs(u - s.u), 1 - Math.abs(u - s.u));
      v += s.a * Math.exp(-((d / s.w) ** 2));
    }
    const b = Math.round(Math.min(v, 1) * 255);
    data.set([b, b, b, 255], i * 4);
  }
  const t = new DataTexture(data, n, 1, RGBAFormat);
  t.wrapS = RepeatWrapping;
  t.magFilter = t.minFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
};

/** Tiling fractal noise for the rock walls (no mipmaps: the wrap seam would show). */
const noiseTexture = () => {
  const n = fbm(13, 4, 5);
  const t = paintedTexture(
    (u, v) => {
      const x = Math.round(n(u, v) * 255);
      return [x, x, x];
    },
    { size: 256, color: false, repeat: true },
  );
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  return t;
};

const vertex = /* glsl */ `
  varying vec3 vDir;
  varying vec3 vWorld;
  void main() {
    vDir = position;
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const fragment = /* glsl */ `
  uniform sampler2D uBand;
  uniform sampler2D uRays;
  uniform vec3 uAbove;
  uniform vec3 uHorizon;
  uniform vec3 uBelow;
  uniform vec3 uDeep;
  uniform vec3 uRay;
  uniform vec3 uSpeck;
  uniform sampler2D uNoise;
  uniform vec3 uRock;
  uniform vec3 uLedge;
  uniform vec3 uAbyssGlow;
  uniform float uBandTop;
  uniform float uBandBottom;
  uniform float uTower;
  uniform float uRaised;
  varying vec3 vDir;
  varying vec3 vWorld;

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  void main() {
    vec3 d = normalize(vDir);
    float e = degrees(asin(clamp(d.y, -1.0, 1.0)));
    float u = atan(d.x, d.z) / 6.2831853 + 0.5;
    // How far this point of the water is from the tower on screen: 0 behind
    // it (its whole angular size from the camera), 1 well clear of it
    vec3 toHere = normalize(vWorld - cameraPosition);
    float angle = acos(clamp(dot(toHere, normalize(-cameraPosition)), -1.0, 1.0));
    float tower = asin(clamp(uTower / length(cameraPosition), 0.0, 1.0));
    float clear = smoothstep(tower * 1.0, tower * 1.4, angle);

    // The water: faint light far above, darkening into the abyss below
    vec3 col = e > 0.0
      ? mix(uHorizon, uAbove, pow(smoothstep(0.0, 70.0, e), 0.7))
      : mix(uHorizon, uBelow, smoothstep(0.0, -32.0, e));
    col = mix(col, uDeep, smoothstep(-30.0, -86.0, e));

    // Shafts of light slanting down from the surface, fading with depth
    float ray = texture2D(uRays, vec2(u, 0.5)).r;
    float reach = smoothstep(-70.0, -4.0, e) * (1.0 - 0.6 * smoothstep(20.0, 60.0, e));
    // ...and, seen from above, converging down into the abyss
    // (strongest round the edge of a top-down view, gone before they meet)
    float down = smoothstep(-40.0, -66.0, e) * (1.0 - smoothstep(-68.0, -86.0, e));
    col += uRay * ray * (reach + 0.18 * down);

    // Rock formations and sea whips on the rim of the abyss
    if (e < uBandTop && e > uBandBottom) {
      vec4 band = texture2D(uBand, vec2(u, (e - uBandBottom) / (uBandTop - uBandBottom)));
      // A notch darker at the edges of the view, fainter behind the tower
      col = mix(col, band.rgb * mix(1.0, 0.72, clear), band.a * mix(0.75, 1.0, clear));
    }

    // The walls of the abyss, dropping away below the rim into the dark:
    // mottled rock with ledges lit faintly along their tops
    float wall = smoothstep(-9.0, -22.0, e) * (1.0 - smoothstep(-50.0, -72.0, e));
    if (wall > 0.0) {
      vec2 wuv = vec2(u * 7.0, e / 24.0);
      float n = texture2D(uNoise, wuv).r;
      float n2 = texture2D(uNoise, wuv * vec2(3.0, 2.0) + 0.37).r;
      float rock = n * 0.7 + n2 * 0.3;
      float strata = sin((e + rock * 18.0) * 0.75);
      float ledge = smoothstep(0.72, 0.98, strata) * smoothstep(0.4, 0.62, rock);
      vec3 walls = mix(col, uRock, smoothstep(0.32, 0.72, rock)) + uLedge * ledge;
      col = mix(col, walls, wall);
    }
    // Far below, the faint glow of life on the floor of the abyss
    col += uAbyssGlow * smoothstep(-50.0, -90.0, e);

    // Seen from above the horizon, the water behind the tower darkens a
    // little, so the pieces' rims have something to stand out from.
    // At low views it lifts a touch instead: there the black glass stands
    // against it, and the brighter water sets its edges off.
    col *= mix(1.0 - 0.2 * uRaised + 0.1 * (1.0 - uRaised), 1.0, clear);

    // Specks of marine life, hanging still in the dark, never behind the
    // tower where they could pass for the selection's plankton
    vec3 cell = floor(d * 64.0);
    float h = hash13(cell);
    if (h > 0.972 && clear > 0.0) {
      vec3 spot = (cell + 0.35 + 0.3 * vec3(hash13(cell + 7.1), hash13(cell + 3.7), hash13(cell + 1.3))) / 64.0;
      float dist = length(d - normalize(spot)) * 64.0;
      float size = 0.035 + 0.05 * fract(h * 17.0);
      float aa = fwidth(dist) + 1e-4;
      float speck = 1.0 - smoothstep(size - aa, size + aa, dist);
      // A soft halo, kept well inside the cell so no cell edge ever shows
      float glow = exp(-dist / 0.07) * 0.3 * (1.0 - smoothstep(0.18, 0.3, dist));
      float depth = 0.3 + 0.7 * smoothstep(0.0, -45.0, e);
      col += uSpeck * (speck + glow) * depth * (0.3 + 0.7 * fract(h * 53.0)) * clear;
    }

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

/** The world outside: water, light shafts, the rim of the abyss and its specks. Static. */
export const AbyssWater = () => {
  const { geometry, material } = useMemo(() => {
    const band = new CanvasTexture(paintBand());
    band.colorSpace = SRGBColorSpace;
    band.wrapS = RepeatWrapping;
    band.wrapT = ClampToEdgeWrapping;
    band.minFilter = LinearFilter;
    band.generateMipmaps = false;
    const material = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uBand: { value: band },
        uRays: { value: raysTexture() },
        uAbove: { value: new Color(WATER.above) },
        uHorizon: { value: new Color(WATER.horizon) },
        uBelow: { value: new Color(WATER.below) },
        uDeep: { value: new Color(WATER.deep) },
        uRay: { value: new Color('#2f7f86').multiplyScalar(0.16) },
        uSpeck: { value: new Color('#8aa2c2').multiplyScalar(0.45) },
        uNoise: { value: noiseTexture() },
        uRock: { value: new Color('#0a1c21') },
        uLedge: { value: new Color('#2b6670').multiplyScalar(0.12) },
        uAbyssGlow: { value: new Color('#0f4a4a').multiplyScalar(0.28) },
        uTower: { value: TOWER_RADIUS },
        uRaised: view.raised,
        uBandTop: { value: BAND_TOP },
        uBandBottom: { value: BAND_BOTTOM },
      },
      vertexShader: vertex,
      fragmentShader: fragment,
    });
    return { geometry: new SphereGeometry(120, 64, 32), material };
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.uniforms.uBand.value.dispose();
      material.uniforms.uRays.value.dispose();
      material.uniforms.uNoise.value.dispose();
      material.dispose();
    },
    [geometry, material],
  );
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
