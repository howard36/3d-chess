import { CanvasTexture, LinearMipmapLinearFilter, RepeatWrapping } from 'three';
import type { Texture } from 'three';
import { rng } from '../kit/textures';

// Data textures for the snowfield and the ice, painted once in JS from
// tiling value noise. They are sampled with mipmaps, so the snow stays calm
// (no shimmer, no moiré) all the way to the horizon and under a software
// renderer, where the same noise computed per pixel would alias.

/** Smooth value noise in [0, 1] tiling on a `px` × `py` lattice (anisotropic when they differ). */
const tilingNoise = (px: number, py: number, random: () => number) => {
  const grid = Array.from({ length: px * py }, random);
  const at = (i: number, j: number) => grid[(((j % py) + py) % py) * px + (((i % px) + px) % px)];
  const s = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = s(x - i);
    const fy = s(y - j);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * fx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx;
    return a + (b - a) * fy;
  };
};

/** Fractal tiling noise over [0, 1)², `octaves` layers from a `px` × `py` lattice. */
const tilingFbm = (seed: number, px: number, py: number, octaves: number, gain = 0.5) => {
  const random = rng(seed);
  const layers = Array.from({ length: octaves }, (_, o) => ({
    n: tilingNoise(px * 2 ** o, py * 2 ** o, random),
    fx: px * 2 ** o,
    fy: py * 2 ** o,
    amp: gain ** o,
  }));
  const total = layers.reduce((a, l) => a + l.amp, 0);
  return (u: number, v: number) =>
    layers.reduce((a, l) => a + l.n(u * l.fx, v * l.fy) * l.amp, 0) / total;
};

const dataTexture = (
  size: number,
  paint: (x: number, y: number) => [number, number, number, number],
): Texture => {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = paint(x, y);
      const o = (y * size + x) * 4;
      for (let k = 0; k < 4; k++) img.data[o + k] = Math.max(0, Math.min(255, px[k] * 255));
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 4;
  // Data, not colour: no sRGB decode
  t.premultiplyAlpha = false;
  t.needsUpdate = true;
  return t;
};

/** A height field painted into a grid, with its slope-lit shade from `light` (x, y, z). */
const litHeights = (
  size: number,
  height: (u: number, v: number) => number,
  relief: number,
  light: [number, number, number],
) => {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) h[y * size + x] = height(x / size, y / size);
  const at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
  const [lx, ly, lz] = light;
  const ll = Math.hypot(lx, ly, lz);
  const lit = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * relief;
      const dy = (at(x, y + 1) - at(x, y - 1)) * relief;
      // Normal of the surface z = h(x, y), up is +z
      const nl = Math.hypot(dx, dy, 1);
      lit[y * size + x] = Math.max(0, (-dx * lx - dy * ly + lz) / (nl * ll));
    }
  }
  return { h, lit };
};

let snowDetail: Texture | null = null;
/**
 * The snow at walking scale, tiling: R the slope-lit shade of wind-cut
 * sastrugi (long ridges across the wind) over soft drifts, G a sparse
 * glitter of ice grains, B the raw drift height.
 */
export const snowDetailTexture = (): Texture => {
  if (snowDetail) return snowDetail;
  const size = 256;
  const drifts = tilingFbm(11, 3, 3, 4);
  // Stretched noise: ridges long in u, tight in v
  const ridges = tilingFbm(12, 2, 9, 4, 0.55);
  const { h, lit } = litHeights(
    size,
    (u, v) => {
      const r = ridges(u, v);
      // Sharpened into crests, the way the wind carves them
      const crest = 1 - Math.abs(r * 2 - 1);
      return drifts(u, v) * 0.7 + crest ** 2 * 0.35;
    },
    26,
    [0.55, 0.25, 0.8],
  );
  const random = rng(13);
  snowDetail = dataTexture(size, (x, y) => {
    const i = y * size + x;
    const grain = random() > 0.996 ? 0.6 + random() * 0.4 : 0;
    return [lit[i], grain, h[i], 1];
  });
  return snowDetail;
};

let snowMacro: Texture | null = null;
/**
 * The snowfield at the scale of a plateau, tiling: R broad drifts and
 * wind-scoured hollows (slope-lit), G where the aurora's light lies on the
 * snow, B where rock breaks through (above about 0.55).
 */
export const snowMacroTexture = (): Texture => {
  if (snowMacro) return snowMacro;
  const size = 256;
  // Long wind streaks over gentle drifts: from far above, a wind-swept plain
  const streaks = tilingFbm(24, 1, 7, 4, 0.55);
  const drift = tilingFbm(21, 2, 2, 4);
  const broad = (u: number, v: number) => streaks(u, v) * 0.6 + drift(u, v) * 0.4;
  const green = tilingFbm(22, 2, 2, 3);
  // Small scattered outcrops, not continents
  const rocks = tilingFbm(23, 30, 30, 2, 0.5);
  const { lit } = litHeights(size, broad, 7, [0.4, 0.6, 0.9]);
  snowMacro = dataTexture(size, (x, y) => {
    const u = x / size;
    const v = y / size;
    const g = Math.max(0, (green(u, v) - 0.45) * 3.2);
    return [lit[y * size + x], g, rocks(u, v), 1];
  });
  return snowMacro;
};

let frost: Texture | null = null;
/**
 * Frost for the ice tiles, tiling: R feathery crystal growth (ridged noise,
 * branching), G a fine rime of grains.
 */
export const frostTexture = (): Texture => {
  if (frost) return frost;
  const size = 256;
  const a = tilingFbm(31, 4, 4, 5, 0.55);
  const b = tilingFbm(32, 7, 7, 4, 0.6);
  const random = rng(33);
  frost = dataTexture(size, (x, y) => {
    const u = x / size;
    const v = y / size;
    // Ridged: thin bright veins where the noise crosses its middle
    const va = 1 - Math.abs(a(u, v) * 2 - 1);
    const vb = 1 - Math.abs(b(u, v) * 2 - 1);
    // Fewer, crisper feathers, and a light rime
    const veins = Math.max(va ** 14, vb ** 18 * 0.7);
    const rime = random() * 0.3 + b(u, v) * 0.3;
    return [veins, rime, 0, 1];
  });
  return frost;
};
