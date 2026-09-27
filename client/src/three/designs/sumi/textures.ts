import {
  CanvasTexture,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import type { Texture } from 'three';
import { GRID_SIZE } from '../../layout';
import { rng } from '../kit/textures';

// Everything Sumi paints on a 2D canvas at load: the washi of the platforms,
// the ink-wash mountains of the backdrop, and the splash a captured piece
// leaves on the paper. No image assets to ship.

const canvas = (w: number, h = w) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, ctx: c.getContext('2d')! };
};

const finish = (c: HTMLCanvasElement, { repeat = false, color = true } = {}): Texture => {
  const t = new CanvasTexture(c);
  if (color) t.colorSpace = SRGBColorSpace;
  if (repeat) t.wrapS = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
};

/** Smooth 1D value noise, periodic over `period` lattice cells. */
const periodicNoise = (period: number, random: () => number) => {
  const v = Array.from({ length: period }, random);
  return (x: number) => {
    const i = Math.floor(x);
    const f = x - i;
    const s = f * f * (3 - 2 * f);
    const a = v[((i % period) + period) % period];
    const b = v[(((i + 1) % period) + period) % period];
    return a + (b - a) * s;
  };
};

// --- Washi -----------------------------------------------------------------

/**
 * A platform's face, multiplied over what lies behind it: near-white washi
 * on the light squares and a faint ink wash on the dark ones, with the long
 * fibres of hand-made paper through both. `odd` flips the checker (squares
 * are coloured by x + y + z, so a bishop keeps its colour through the
 * levels). Multiplying never lightens, so a lacquer piece seen through a
 * platform stays black, and a porcelain one only dims a touch.
 */
export const washiTexture = (odd: boolean, light: number[], dark: number[]): Texture => {
  const size = 640;
  const { c, ctx } = canvas(size);
  const s = size / GRID_SIZE;
  const rgb = (v: number[], k = 0) =>
    `rgb(${v.map((x) => Math.round(Math.min(255, x + k))).join(',')})`;
  for (let i = 0; i < GRID_SIZE; i++) {
    for (let j = 0; j < GRID_SIZE; j++) {
      const isDark = (i + j + (odd ? 1 : 0)) % 2 === 0;
      // Canvas left to right is file a to e, bottom to top rank 1 to 5
      const x = i * s;
      const y = size - (j + 1) * s;
      ctx.fillStyle = rgb(isDark ? dark : light);
      ctx.fillRect(x, y, s, s);
      if (isDark) {
        // The wash pools a little at its rim, as ink does when it dries
        const g = ctx.createRadialGradient(
          x + s / 2,
          y + s / 2,
          s * 0.2,
          x + s / 2,
          y + s / 2,
          s * 0.72,
        );
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(40,30,20,0.05)');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, s, s);
      }
    }
  }
  // Fibres: long, faint, gently curved strokes, some darker, some paler
  const random = rng(odd ? 29 : 17);
  ctx.lineCap = 'round';
  for (let f = 0; f < 520; f++) {
    const x0 = random() * size;
    const y0 = random() * size;
    const len = size * (0.03 + random() ** 2 * 0.14);
    const a = random() * Math.PI * 2;
    const bend = (random() - 0.5) * 0.9;
    const pale = random() < 0.45;
    ctx.strokeStyle = pale
      ? `rgba(255,255,255,${0.25 + random() * 0.35})`
      : `rgba(90,72,52,${0.035 + random() * 0.05})`;
    ctx.lineWidth = 0.6 + random() * 1.3;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(
      x0 + Math.cos(a + bend) * len * 0.5,
      y0 + Math.sin(a + bend) * len * 0.5,
      x0 + Math.cos(a) * len,
      y0 + Math.sin(a) * len,
    );
    ctx.stroke();
  }
  // A fine tooth over everything
  const img = ctx.getImageData(0, 0, size, size);
  for (let p = 0; p < img.data.length; p += 4) {
    const n = (random() - 0.5) * 5;
    img.data[p] = Math.min(255, img.data[p] + n);
    img.data[p + 1] = Math.min(255, img.data[p + 1] + n);
    img.data[p + 2] = Math.min(255, img.data[p + 2] + n);
  }
  ctx.putImageData(img, 0, 0);
  return finish(c);
};

// --- Mountains ---------------------------------------------------------------

export interface MountainRange {
  /** Elevation (degrees, seen from the tower) the range's foot sits at. */
  base: number;
  /** Height of its tallest peak above the foot (degrees). */
  peak: number;
  /** Number of peaks round the full circle. */
  peaks: number;
  /** Widest peak, as a fraction of the circle. */
  width: number;
}

/**
 * The ridge lines of a panorama of ink-wash ranges, one texture row per
 * range: R is the ridge's elevation in degrees at each azimuth, G a fine
 * noise for the brush texture, B the height of the land there (0 to 1). Peaks are rounded, a little lopsided and
 * clustered, like the karst hills of a sumi-e landscape; the data wraps
 * round the circle, so the panorama has no seam.
 */
export const ridgeTexture = (ranges: MountainRange[], width = 2048): DataTexture => {
  const random = rng(53);
  const data = new Uint16Array(width * ranges.length * 4);
  ranges.forEach((range, k) => {
    const peaks = Array.from({ length: range.peaks }, () => {
      const w = range.width * (0.35 + random() * 0.65);
      return {
        c: random(),
        left: w * (0.7 + random() * 0.6),
        right: w * (0.7 + random() * 0.6),
        h: 0.3 + random() ** 1.4 * 0.7,
      };
    });
    const detail = periodicNoise(96, random);
    const fine = periodicNoise(700, random);
    const grain = periodicNoise(1400, random);
    for (let x = 0; x < width; x++) {
      const u = x / width;
      let h = 0.05 * detail(u * 96);
      for (const p of peaks) {
        let d = u - p.c;
        if (d > 0.5) d -= 1;
        if (d < -0.5) d += 1;
        const t = d < 0 ? -d / p.left : d / p.right;
        if (t < 1) h = Math.max(h, p.h * (1 - t * t) ** 1.25);
      }
      // Rock and tree texture along the ridge, in proportion to its height
      h *= 1 + 0.06 * (fine(u * 700) - 0.5) + 0.12 * (detail(u * 96 + 31) - 0.5);
      const o = (k * width + x) * 4;
      data[o] = DataUtils.toHalfFloat(range.base + range.peak * h);
      data[o + 1] = DataUtils.toHalfFloat(grain(u * 1400));
      // How much mountain stands here: the wash thins to nothing between peaks
      data[o + 2] = DataUtils.toHalfFloat(h);
      data[o + 3] = DataUtils.toHalfFloat(1);
    }
  });
  const t = new DataTexture(data, width, ranges.length, RGBAFormat, HalfFloatType);
  t.wrapS = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
};

// --- Ink splash --------------------------------------------------------------

/** A ragged closed blob: a circle whose radius wanders with a few harmonics. */
const blob = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  random: () => number,
) => {
  const harmonics = Array.from({ length: 7 }, (_, k) => ({
    k: k + 2,
    a: (random() * 0.14) / (1 + k * 0.4),
    p: random() * Math.PI * 2,
  }));
  ctx.beginPath();
  for (let i = 0; i <= 160; i++) {
    const a = (i / 160) * Math.PI * 2;
    const rr = r * (1 + harmonics.reduce((s, m) => s + m.a * Math.sin(a * m.k + m.p), 0));
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.fill();
};

/**
 * What a captured piece leaves on the paper, white on clear (tinted by its
 * material): `pool`, the ink it melts into, heavier at its rim where the ink
 * gathers; and `spatter`, the drops and thrown streaks when the attacker
 * lands in it.
 */
export const splashTextures = (() => {
  let made: { pool: Texture; spatter: Texture } | null = null;
  return () => {
    if (made) return made;
    const size = 256;
    const h = size / 2;
    const random = rng(71);

    const pool = canvas(size);
    pool.ctx.fillStyle = 'rgba(255,255,255,0.78)';
    blob(pool.ctx, h, h, size * 0.4, random);
    // The rim, where the ink gathers as it spreads
    pool.ctx.globalCompositeOperation = 'source-atop';
    const rim = pool.ctx.createRadialGradient(h, h, size * 0.2, h, h, size * 0.46);
    rim.addColorStop(0, 'rgba(255,255,255,0)');
    rim.addColorStop(1, 'rgba(255,255,255,1)');
    pool.ctx.fillStyle = rim;
    pool.ctx.fillRect(0, 0, size, size);

    const spatter = canvas(size);
    const ctx = spatter.ctx;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 11; i++) {
      // Thrown streaks: tapered spikes out from the pool, each ending in a drop
      const a = random() * Math.PI * 2;
      const r0 = size * 0.2;
      const r1 = size * (0.3 + random() * 0.17);
      const w = size * (0.014 + random() * 0.018);
      const nx = -Math.sin(a);
      const ny = Math.cos(a);
      ctx.beginPath();
      ctx.moveTo(h + Math.cos(a) * r0 + nx * w, h + Math.sin(a) * r0 + ny * w);
      ctx.lineTo(h + Math.cos(a) * r1, h + Math.sin(a) * r1);
      ctx.lineTo(h + Math.cos(a) * r0 - nx * w, h + Math.sin(a) * r0 - ny * w);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(h + Math.cos(a) * r1, h + Math.sin(a) * r1, w * 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 34; i++) {
      // Satellite drops
      const a = random() * Math.PI * 2;
      const r = size * (0.24 + random() ** 0.7 * 0.24);
      ctx.beginPath();
      ctx.arc(
        h + Math.cos(a) * r,
        h + Math.sin(a) * r,
        size * (0.008 + random() ** 2 * 0.026),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    made = { pool: finish(pool.c), spatter: finish(spatter.c) };
    return made;
  };
})();
