import {
  CanvasTexture,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  RGBAFormat,
} from 'three';
import type { Texture } from 'three';
import { fbm, rng } from '../kit/textures';

// Nocturne's canvas textures, made once on first use: the kozo fibres of the
// night paper the platforms are made of, and what every piece leaves on it
// (a soft shadow and a wash of its level's pigment).

const canvas = (size: number) => {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
};

let fibres: Texture | null = null;

/**
 * Long kozo fibres and a soft cloudy density, white on transparent (red
 * channel = fibres, green = density), tiling in both directions.
 */
export const fibreTexture = (): Texture => {
  if (fibres) return fibres;
  const size = 256;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  if (ctx) {
    const random = rng(7);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    // Cloudy density: soft blobs in green
    for (let i = 0; i < 70; i++) {
      const x = random() * size;
      const y = random() * size;
      const r = 14 + random() * 40;
      for (const [dx, dy] of [
        [0, 0],
        [size, 0],
        [-size, 0],
        [0, size],
        [0, -size],
      ]) {
        const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        g.addColorStop(0, `rgba(0, 255, 0, ${0.08 + random() * 0.1})`);
        g.addColorStop(1, 'rgba(0, 255, 0, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
    }
    // Fibres in red: long, thin, gently curving strands
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 0; i < 150; i++) {
      const x = random() * size;
      const y = random() * size;
      const a = random() * Math.PI * 2;
      const len = 20 + random() * 70;
      const bend = (random() - 0.5) * 0.9;
      ctx.strokeStyle = `rgba(255, 0, 0, ${0.18 + random() * 0.4})`;
      ctx.lineWidth = 0.5 + random() * 0.9;
      for (const [dx, dy] of [
        [0, 0],
        [size, 0],
        [-size, 0],
        [0, size],
        [0, -size],
        [size, size],
        [-size, -size],
        [size, -size],
        [-size, size],
      ]) {
        ctx.beginPath();
        ctx.moveTo(x + dx, y + dy);
        ctx.quadraticCurveTo(
          x + dx + Math.cos(a + bend) * len * 0.5,
          y + dy + Math.sin(a + bend) * len * 0.5,
          x + dx + Math.cos(a) * len,
          y + dy + Math.sin(a) * len,
        );
        ctx.stroke();
      }
    }
  }
  const t = new CanvasTexture(c);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 4;
  fibres = t;
  return t;
};

let floor: Texture | null = null;

/**
 * What a piece leaves on the paper, as data. The red channel is a wash of
 * pigment bled into the paper round the foot: full under the base, fading
 * softly outward to a feathered, fibrous edge (no line anywhere, so it can
 * never be taken for a brushed mark). The green channel is a soft contact
 * shadow. Laid on a quad 0.9 piece units across: the base is about 0.27
 * across its radius, the wash fades out by 0.4, the shadow by 0.36.
 */
export const floorTexture = (): Texture => {
  if (floor) return floor;
  const size = 256;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  if (ctx) {
    const random = rng(21);
    const image = ctx.createImageData(size, size);
    const unit = size / 0.9;
    const smooth = (a: number, b: number, x: number) => {
      const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
      return t * t * (3 - 2 * t);
    };
    // A ragged edge: the bleed reaches further in some directions
    const lobes = [0, 1, 2, 3, 4, 5].map(() => [random() * Math.PI * 2, 0.008 + random() * 0.012]);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const px = (x + 0.5 - size / 2) / unit;
        const py = (y + 0.5 - size / 2) / unit;
        const r = Math.hypot(px, py);
        const a = Math.atan2(py, px);
        let reach = 0.4;
        lobes.forEach(([phase, amp], k) => (reach += amp * Math.sin(a * (k + 2) + phase)));
        // Fibres: fine radial streaks where the pigment ran along the paper
        const fibre = 0.85 + 0.15 * Math.sin(a * 37 + Math.sin(a * 11) * 3);
        const wash = (1 - smooth(0.27, reach, r)) * (r > 0.3 ? fibre : 1);
        const q = Math.min(r / 0.36, 1);
        const shadow = (1 - q * q) ** 2;
        const i = (y * size + x) * 4;
        image.data[i] = Math.round(wash * 255);
        image.data[i + 1] = Math.round(shadow * 255);
        image.data[i + 2] = 0;
        image.data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }
  const t = new CanvasTexture(c);
  t.anisotropy = 4;
  floor = t;
  return t;
};

// --- The night sky's lookups -----------------------------------------------------

/** The four mountain ranges, far to near: base and height of their ridges, in degrees. */
export const RANGES = [0, 1, 2, 3].map((k) => ({
  base: -3 - 2.2 - 3.3 * k,
  amp: 3.2 + 1.1 * k,
  /** Noise cells round the horizon: nearer ranges are more broken. */
  cells: Math.round(2 * Math.PI * (2.4 + 1.3 * k)),
}));

let ridges: DataTexture | null = null;

/**
 * Everything about the ranges that depends only on the azimuth, one row per
 * range, far to near, 4096 samples round the horizon (so the sky shader
 * reads it instead of evaluating noise per pixel): red is the ridge's
 * elevation in degrees (rounded peaks, sharper crests), green the brush's
 * hair streaks in its wash, blue where its silver ridge line runs dry, and
 * alpha where its groves of pines stand. Every channel closes round the
 * horizon without a seam.
 */
export const ridgeTexture = (width = 4096): DataTexture => {
  if (ridges) return ridges;
  const data = new Uint16Array(width * RANGES.length * 4);
  RANGES.forEach((range, k) => {
    const body = fbm(11 + k * 7, range.cells, 3);
    const crest = fbm(13 + k * 7, Math.round(range.cells * 2.3), 3);
    const hair = fbm(17 + k, 240, 2);
    const dry = fbm(19 + k, 88, 2);
    const grove = fbm(23 + k, 31, 3);
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const n = body(u, 0.37);
      const r = 1 - Math.abs(crest(u, 0.61) * 2 - 1);
      const o = (k * width + x) * 4;
      data[o] = DataUtils.toHalfFloat(range.base + range.amp * (0.75 * n + 0.35 * r * n));
      data[o + 1] = DataUtils.toHalfFloat(hair(u, 0.2));
      data[o + 2] = DataUtils.toHalfFloat(dry(u, 0.4));
      data[o + 3] = DataUtils.toHalfFloat(grove(u, 0.8));
    }
  });
  const t = new DataTexture(data, width, RANGES.length, RGBAFormat, HalfFloatType);
  t.wrapS = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.needsUpdate = true;
  ridges = t;
  return t;
};

let noise: DataTexture | null = null;

/**
 * Tiling noise for the shaders, so none of them evaluates noise per pixel:
 * red a soft four-octave fbm (mist, billows), green a finer one, blue a
 * broad one (the peaks in the sea of cloud), alpha plain value noise on a
 * 64-cell lattice (brush pressure and bristles). Linear, without mipmaps,
 * so a lookup wrapping round the horizon has no seam.
 */
export const noiseTexture = (size = 256): DataTexture => {
  if (noise) return noise;
  const soft = fbm(31, 4, 4);
  const fine = fbm(37, 16, 3);
  const broad = fbm(41, 2, 4);
  const plain = fbm(43, 64, 1);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const o = (y * size + x) * 4;
      data[o] = Math.round(soft(u, v) * 255);
      data[o + 1] = Math.round(fine(u, v) * 255);
      data[o + 2] = Math.round(broad(u, v) * 255);
      data[o + 3] = Math.round(plain(u, v) * 255);
    }
  }
  const t = new DataTexture(data, size, size, RGBAFormat);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.needsUpdate = true;
  noise = t;
  return t;
};
