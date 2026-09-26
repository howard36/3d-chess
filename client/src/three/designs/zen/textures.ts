import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import type { Texture } from 'three';
import { fbm, mixHex, paintedTexture, rng } from '../kit/textures';

// Everything the Zen Garden paints: maple trays inlaid with walnut, speckled
// granite and basalt for the pieces, bamboo, and the sumi-ink marks (dots,
// an ensō, a vermilion seal, a wash).

const canvas = (w: number, h = w) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, ctx: c.getContext('2d')! };
};

const finish = (c: HTMLCanvasElement, repeat = false): Texture => {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
};

/** A cheap per-pixel hash in [0, 1). */
const hash = (x: number, y: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

// --- Wood -------------------------------------------------------------------

const grain = fbm(11, 3, 5);
const figure = fbm(23, 2, 4);

/** Grain running along u: fine lines bent by a slow figure. */
const wood = (u: number, v: number, base: string, dark: string, lines: number) => {
  const n = grain(u * 0.35, v * 2.5);
  const f = figure(u * 0.5, v);
  const s = Math.abs(Math.sin((v * lines + n * 5 + f * 3) * Math.PI));
  const k = Math.pow(1 - s, 6) * 0.45 + n * 0.3 + f * 0.15;
  return mixHex(base, dark, Math.min(1, k));
};

/** Pale maple, for tray edges and the posts' caps. */
export const mapleTexture = paintedTexture((u, v) => wood(u, v, '#ecd6ae', '#b8935e', 26), {
  size: 256,
});

/**
 * The face of a tray: a maple field with a 5×5 grid of squares, the dark
 * ones walnut, divided by fine ebony stringing. `margin` is the fraction of
 * the face outside the grid on each side. `odd` flips the checker, so the
 * stacked levels read as one 3D checkerboard.
 */
export const trayTexture = (margin: number, odd: boolean) =>
  paintedTexture(
    (u, v) => {
      const gu = (u - margin) / (1 - 2 * margin);
      const gv = (v - margin) / (1 - 2 * margin);
      const inside = gu >= 0 && gu < 1 && gv >= 0 && gv < 1;
      const maple = () => wood(u, v, '#efdcb6', '#c29a62', 30);
      if (!inside) {
        // A dark ebony line frames the grid
        const d = Math.max(Math.abs(gu - 0.5), Math.abs(gv - 0.5)) - 0.5;
        return d < 0.01 ? mixHex('#3a2a1e', '#1f1712', 0.4) : maple();
      }
      const i = Math.floor(gu * 5);
      const j = Math.floor(gv * 5);
      const fu = gu * 5 - i;
      const fv = gv * 5 - j;
      // Ebony stringing between the squares
      const line = Math.min(fu, 1 - fu, fv, 1 - fv);
      if (line < 0.016) return mixHex('#3a2a1e', '#1f1712', 0.4);
      const dark = (i + j + (odd ? 1 : 0)) % 2 === 0;
      return dark ? wood(u + 0.37, v + 0.21, '#8a5f3e', '#4b3022', 34) : maple();
    },
    { size: 1024, repeat: false },
  );

// --- Stone -------------------------------------------------------------------

const cloud = fbm(5, 4, 4);

/** Pale granite: warm white with black, grey and rust flecks. */
export const graniteTexture = paintedTexture(
  (u, v) => {
    const n = cloud(u, v);
    const h = hash(Math.floor(u * 256), Math.floor(v * 256));
    const base = mixHex('#f1eee7', '#d9d4ca', n * 0.8);
    if (h > 0.985) return mixHex('#2b2a28', '#4a4744', n);
    if (h > 0.95) return mixHex('#a39e96', '#8a857d', n);
    if (h > 0.94) return mixHex('#c99c77', '#b8866a', n);
    return base;
  },
  { size: 256 },
);

/** Dark basalt: blue-black with faint grey crystals. */
export const basaltTexture = paintedTexture(
  (u, v) => {
    const n = cloud(u + 0.5, v + 0.5);
    const h = hash(Math.floor(u * 256) + 3.1, Math.floor(v * 256) + 7.7);
    const base = mixHex('#383a3f', '#474a50', n);
    if (h > 0.975) return mixHex('#7c7e84', '#9a9ca1', n);
    if (h > 0.95) return mixHex('#26272a', '#1c1d20', n);
    return base;
  },
  { size: 256 },
);

// --- Bamboo -----------------------------------------------------------------

/** A bamboo culm unrolled: faint vertical striation and a node every tile. */
export const bambooTexture = (() => {
  const { c, ctx } = canvas(64, 256);
  const random = rng(4);
  const g = ctx.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, '#8d9a58');
  g.addColorStop(0.45, '#b9bf7c');
  g.addColorStop(1, '#8a9454');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(${random() < 0.5 ? '60,70,30' : '230,230,180'},${0.05 + random() * 0.08})`;
    ctx.fillRect(random() * 64, 0, 1 + random() * 2, 256);
  }
  // The node: a dark ring with a pale swollen ridge above it
  ctx.fillStyle = 'rgba(70, 72, 36, 0.85)';
  ctx.fillRect(0, 236, 64, 5);
  ctx.fillStyle = 'rgba(226, 222, 170, 0.8)';
  ctx.fillRect(0, 230, 64, 5);
  ctx.fillStyle = 'rgba(90, 96, 48, 0.35)';
  ctx.fillRect(0, 241, 64, 8);
  return finish(c, true);
})();

// --- Ink marks ---------------------------------------------------------------

/** A sumi-ink dot with a ragged, bleeding edge. */
export const inkDotTexture = (() => {
  const size = 128;
  const { c, ctx } = canvas(size);
  const random = rng(8);
  const h = size / 2;
  const halo = ctx.createRadialGradient(h, h, 0, h, h, h);
  halo.addColorStop(0, 'rgba(24, 22, 22, 0.25)');
  halo.addColorStop(0.7, 'rgba(24, 22, 22, 0.12)');
  halo.addColorStop(1, 'rgba(24, 22, 22, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);
  const bumps = Array.from({ length: 9 }, () => [random() * 0.12, random() * Math.PI * 2]);
  ctx.beginPath();
  for (let i = 0; i <= 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    const r =
      size *
      0.3 *
      (1 + bumps.reduce((s, [amp, ph], k) => s + amp * Math.sin(a * (k + 2) + ph), 0) * 0.35);
    const x = h + Math.cos(a) * r;
    const y = h + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.fillStyle = 'rgba(20, 18, 18, 0.92)';
  ctx.fill();
  return finish(c);
})();

/** The start angle of the ensō stroke, for the shader that draws it in. */
export const ENSO_START = -Math.PI * 0.62;
/** How much of the full turn the stroke covers. */
export const ENSO_SWEEP = 0.9;

/**
 * An ensō: one loaded-brush circle, heavy where it starts, thinning and
 * breaking into dry-brush bristle streaks as it closes.
 */
export const ensoTexture = (() => {
  const size = 512;
  const { c, ctx } = canvas(size);
  const random = rng(15);
  const h = size / 2;
  const R = size * 0.4;
  const bristles = 26;
  const noise = fbm(31, 8, 3);
  ctx.lineCap = 'round';
  for (let b = 0; b < bristles; b++) {
    const off = (b / (bristles - 1) - 0.5) * 2;
    const steps = 220;
    const dry = 0.45 + random() * 0.5;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      // Heavy at the start, tapering and lifting off at the end
      const width = size * (0.085 * (1 - t * 0.55) - (t > 0.85 ? (t - 0.85) * 0.25 : 0));
      if (Math.abs(off) * 0.5 * width > width * 0.5 * (1 - t * 0.3)) continue;
      const gap = noise(b / bristles, t) > dry + (1 - t) * 0.35;
      if (gap && t > 0.35) continue;
      const a0 = ENSO_START + t * ENSO_SWEEP * Math.PI * 2;
      const a1 = ENSO_START + (t + 1.4 / steps) * ENSO_SWEEP * Math.PI * 2;
      const r = R + off * width * 0.5 + Math.sin(t * 9 + b) * size * 0.002;
      ctx.strokeStyle = `rgba(22, 20, 20, ${0.55 + 0.4 * (1 - t) * random()})`;
      ctx.lineWidth = (width / bristles) * 2.2;
      ctx.beginPath();
      ctx.arc(h, h, r, a0, a1);
      ctx.stroke();
    }
  }
  return finish(c);
})();

/** A vermilion hanko seal ring, stamped: ink thin in places, grainy at the edge. */
export const sealTexture = (() => {
  const size = 256;
  const { c, ctx } = canvas(size);
  const h = size / 2;
  ctx.strokeStyle = '#c63d2c';
  ctx.lineWidth = size * 0.075;
  ctx.beginPath();
  ctx.arc(h, h, size * 0.42, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = size * 0.022;
  ctx.beginPath();
  ctx.arc(h, h, size * 0.335, 0, Math.PI * 2);
  ctx.stroke();
  // Knock the ink back where the stamp didn't bite
  const img = ctx.getImageData(0, 0, size, size);
  const blotch = fbm(41, 6, 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4 + 3;
      const n = blotch(x / size, y / size);
      const speck = hash(x, y) > 0.9 ? 0.5 : 1;
      img.data[o] *= Math.min(1, Math.max(0, (n - 0.28) * 3.2)) * speck;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finish(c);
})();

/** A pale ink wash: a soft square, granulating, darker where it pooled at the rim. */
export const washTexture = paintedTexture(
  (u, v) => {
    const d = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2;
    const n = cloud(u * 0.5 + 0.2, v * 0.5 + 0.4);
    const edge = 1 - smooth(0.72 + n * 0.16, 0.95 + n * 0.05, d);
    const pool = smooth(0.55, 0.85, d) * edge;
    const a = (0.45 + 0.35 * n + 0.3 * pool) * edge;
    return [52, 62, 74, Math.round(255 * Math.min(1, a))];
  },
  { size: 128, repeat: false },
);

function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** A soft round shadow for things resting on the sand. */
export const contactShadow = (() => {
  const size = 128;
  const { c, ctx } = canvas(size);
  const h = size / 2;
  const g = ctx.createRadialGradient(h, h, 0, h, h, h);
  g.addColorStop(0, 'rgba(60, 50, 40, 0.55)');
  g.addColorStop(0.5, 'rgba(60, 50, 40, 0.25)');
  g.addColorStop(1, 'rgba(60, 50, 40, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return finish(c);
})();

/** A red sun: a flat vermilion disc with a soft, slightly uneven rim, as if brushed. */
export const sunTexture = (() => {
  const size = 256;
  const { c, ctx } = canvas(size);
  const h = size / 2;
  const g = ctx.createRadialGradient(h, h, 0, h, h, h);
  g.addColorStop(0, 'rgba(206, 64, 44, 0.95)');
  g.addColorStop(0.62, 'rgba(200, 60, 42, 0.9)');
  g.addColorStop(0.7, 'rgba(196, 58, 40, 0.35)');
  g.addColorStop(1, 'rgba(196, 58, 40, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return finish(c);
})();
