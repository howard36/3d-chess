import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import type { Texture } from 'three';

// Procedural textures drawn on a 2D canvas: no image assets to ship or
// fetch. Each is built once per call site (call these at module level or in
// a useMemo), and colour textures are tagged sRGB so they light correctly.

const canvas = (w: number, h = w) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, ctx: c.getContext('2d')! };
};

const finish = (c: HTMLCanvasElement, { color = true, repeat = false } = {}): Texture => {
  const t = new CanvasTexture(c);
  if (color) t.colorSpace = SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  t.needsUpdate = true;
  return t;
};

/** A soft round dot, white on transparent: the sprite for glowing particles. */
export const dotTexture = (softness = 0.5, size = 64): Texture => {
  const { c, ctx } = canvas(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(Math.max(0.01, 1 - softness), 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return finish(c);
};

/** A four-pointed twinkle, for sparkles and stars. */
export const sparkTexture = (size = 64): Texture => {
  const { c, ctx } = canvas(size);
  const h = size / 2;
  const g = ctx.createRadialGradient(h, h, 0, h, h, h);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.15, 'rgba(255,255,255,0.7)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.08)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'lighter';
  for (const [w, len] of [
    [size * 0.035, h],
    [size * 0.02, h * 0.6],
  ]) {
    const lg = ctx.createLinearGradient(0, h, size, h);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.5, 'rgba(255,255,255,0.9)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(h - len, h - w / 2, len * 2, w);
    ctx.save();
    ctx.translate(h, h);
    ctx.rotate(Math.PI / 2);
    ctx.translate(-h, -h);
    ctx.fillRect(h - len, h - w / 2, len * 2, w);
    ctx.restore();
  }
  return finish(c);
};

/**
 * An n×n checkerboard of two colours, with an optional border inset drawn
 * in `line` — the face of one level's board.
 */
export const checkerTexture = ({
  light,
  dark,
  n = 5,
  line,
  lineWidth = 0.02,
  size = 512,
}: {
  light: string;
  dark: string;
  n?: number;
  line?: string;
  lineWidth?: number;
  size?: number;
}): Texture => {
  const { c, ctx } = canvas(size);
  const s = size / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      ctx.fillStyle = (i + j) % 2 === 0 ? dark : light;
      ctx.fillRect(i * s, j * s, s, s);
    }
  }
  if (line) {
    ctx.strokeStyle = line;
    ctx.lineWidth = lineWidth * size;
    for (let i = 0; i <= n; i++) {
      ctx.beginPath();
      ctx.moveTo(i * s, 0);
      ctx.lineTo(i * s, size);
      ctx.moveTo(0, i * s);
      ctx.lineTo(size, i * s);
      ctx.stroke();
    }
  }
  return finish(c);
};

/** A vertical gradient through the given stops (top first). */
export const gradientTexture = (stops: [number, string][], size = 256): Texture => {
  const { c, ctx } = canvas(4, size);
  const g = ctx.createLinearGradient(0, 0, 0, size);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, size);
  return finish(c);
};

// A small deterministic PRNG, so procedural textures look the same on every
// load (and in every recorded frame).
export const rng = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Value noise in [0, 1], smooth, tiling on a `period`-cell lattice. */
const valueNoise = (period: number, random: () => number) => {
  const grid = Array.from({ length: period * period }, random);
  const at = (i: number, j: number) =>
    grid[(((j % period) + period) % period) * period + (((i % period) + period) % period)];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = smooth(x - i);
    const fy = smooth(y - j);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * fx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx;
    return a + (b - a) * fy;
  };
};

/** Fractal noise sampler in [0, 1], tiling across [0, 1)². */
export const fbm = (seed = 1, base = 4, octaves = 5) => {
  const random = rng(seed);
  const layers = Array.from({ length: octaves }, (_, o) => ({
    noise: valueNoise(base * 2 ** o, random),
    freq: base * 2 ** o,
    amp: 0.5 ** o,
  }));
  const total = layers.reduce((a, l) => a + l.amp, 0);
  return (u: number, v: number) =>
    layers.reduce((a, l) => a + l.noise(u * l.freq, v * l.freq) * l.amp, 0) / total;
};

/**
 * Paints a texture pixel by pixel from `shade(u, v) -> [r, g, b]` (0–255).
 * For marble veins, wood grain, lava cracks and the like.
 */
export const paintedTexture = (
  shade: (u: number, v: number) => [number, number, number] | [number, number, number, number],
  { size = 256, color = true, repeat = true } = {},
): Texture => {
  const { c, ctx } = canvas(size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a = 255] = shade(x / size, y / size);
      const o = (y * size + x) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finish(c, { color, repeat });
};

/** Linear interpolation between two hex colours, as 0–255 channels. */
export const mixHex = (a: string, b: string, t: number): [number, number, number] => {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (p: number, s: number) => (p >> s) & 255;
  return [16, 8, 0].map((s) => ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t) as [number, number, number];
};
