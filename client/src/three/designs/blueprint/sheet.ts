import { CanvasTexture, SRGBColorSpace } from 'three';
import type { Texture } from 'three';
import { fbm } from '../kit/textures';

// The drawing sheet behind the board, in screen space: cyanotype blue with a
// fine drafting grid, a double border with zone letters, datum lines through
// the middle, a vignette, and the title block on the right.

export const BLUE = '#0d3f94';
export const HAND = '"Architects Daughter", "Comic Sans MS", cursive';
export const MONO = '"IBM Plex Mono", ui-monospace, monospace';

const mottle = fbm(23, 3, 4);
let cloud: HTMLCanvasElement | null = null;
// Uneven exposure of the print: a small noise image, stretched smooth.
const cloudTile = () => {
  if (cloud) return cloud;
  const w = 96;
  const h = 54;
  cloud = document.createElement('canvas');
  cloud.width = w;
  cloud.height = h;
  const ctx = cloud.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = mottle(x / w, y / h);
      const o = (y * w + x) * 4;
      const k = (n - 0.5) * 2;
      img.data[o] = k > 0 ? 120 : 0;
      img.data[o + 1] = k > 0 ? 170 : 10;
      img.data[o + 2] = k > 0 ? 255 : 40;
      img.data[o + 3] = Math.min(255, Math.abs(k) * 70);
    }
  }
  ctx.putImageData(img, 0, 0);
  return cloud;
};

const WHITE = (a: number) => `rgba(236, 244, 255, ${a})`;

export const drawSheet = (w: number, h: number, withType: boolean): Texture => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const u = h / 100;

  ctx.fillStyle = BLUE;
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(cloudTile(), 0, 0, w, h);

  // Drafting grid: fine lines, every fifth one heavier
  const step = 1.6 * u;
  const cx = w / 2;
  const cy = h / 2;
  const n = Math.ceil(Math.max(w, h) / step / 2) + 1;
  for (let i = -n; i <= n; i++) {
    const major = i % 5 === 0;
    ctx.fillStyle = WHITE(major ? 0.11 : 0.05);
    const t = major ? Math.max(1, 0.12 * u) : Math.max(1, 0.07 * u);
    ctx.fillRect(cx + i * step - t / 2, 0, t, h);
    ctx.fillRect(0, cy + i * step - t / 2, w, t);
  }

  // Datum lines through the centre, chain-dotted
  ctx.strokeStyle = WHITE(0.22);
  ctx.lineWidth = Math.max(1, 0.1 * u);
  ctx.setLineDash([5 * u, 0.8 * u, 0.8 * u, 0.8 * u]);
  ctx.beginPath();
  ctx.moveTo(4 * u, cy);
  ctx.lineTo(w - 4 * u, cy);
  ctx.moveTo(cx, 4 * u);
  ctx.lineTo(cx, h - 4 * u);
  ctx.stroke();
  ctx.setLineDash([]);

  // Vignette: the print darkens toward its edges
  const v = ctx.createRadialGradient(cx, cy, h * 0.35, cx, cy, Math.hypot(cx, cy));
  v.addColorStop(0, 'rgba(2, 16, 52, 0)');
  v.addColorStop(1, 'rgba(2, 16, 52, 0.55)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);

  // Border: a heavy frame and a hairline inside it, zone marks between them
  const outer = 1.6 * u;
  const inner = 3.4 * u;
  ctx.strokeStyle = WHITE(0.8);
  ctx.lineWidth = Math.max(1.5, 0.28 * u);
  ctx.strokeRect(inner, inner, w - inner * 2, h - inner * 2);
  ctx.lineWidth = Math.max(1, 0.1 * u);
  ctx.strokeRect(outer, outer, w - outer * 2, h - outer * 2);
  const zonesX = Math.max(4, Math.round(w / (h / 4)));
  ctx.fillStyle = WHITE(0.75);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `500 ${1.3 * u}px ${MONO}`;
  for (let i = 0; i < zonesX; i++) {
    const x0 = inner + ((w - inner * 2) * i) / zonesX;
    const xm = x0 + (w - inner * 2) / zonesX / 2;
    if (i > 0) {
      ctx.fillRect(x0, outer, Math.max(1, 0.1 * u), inner - outer);
      ctx.fillRect(x0, h - inner, Math.max(1, 0.1 * u), inner - outer);
    }
    if (withType) {
      ctx.fillText(String(zonesX - i), xm, (outer + inner) / 2);
      ctx.fillText(String(zonesX - i), xm, h - (outer + inner) / 2);
    }
  }
  for (let i = 0; i < 4; i++) {
    const y0 = inner + ((h - inner * 2) * i) / 4;
    const ym = y0 + (h - inner * 2) / 8;
    if (i > 0) {
      ctx.fillRect(outer, y0, inner - outer, Math.max(1, 0.1 * u));
      ctx.fillRect(w - inner, y0, inner - outer, Math.max(1, 0.1 * u));
    }
    if (withType) {
      ctx.fillText('DCBA'[i], (outer + inner) / 2, ym);
      ctx.fillText('DCBA'[i], w - (outer + inner) / 2, ym);
    }
  }

  if (withType) drawTitleBlock(ctx, w - inner - 40 * u, 13 * u, 40 * u, 25 * u, u);

  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
};

const drawTitleBlock = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  bw: number,
  bh: number,
  u: number,
) => {
  ctx.save();
  ctx.fillStyle = 'rgba(9, 48, 120, 0.85)';
  ctx.fillRect(x, y, bw, bh);
  ctx.strokeStyle = WHITE(0.85);
  ctx.lineWidth = Math.max(1.5, 0.24 * u);
  ctx.strokeRect(x, y, bw, bh);
  ctx.lineWidth = Math.max(1, 0.1 * u);
  const rows = [y + bh * 0.42, y + bh * 0.63, y + bh * 0.82];
  ctx.beginPath();
  for (const r of rows) {
    ctx.moveTo(x, r);
    ctx.lineTo(x + bw, r);
  }
  const split = x + bw * 0.55;
  ctx.moveTo(split, rows[0]);
  ctx.lineTo(split, y + bh);
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  // Title, hand-lettered
  ctx.fillStyle = WHITE(0.95);
  ctx.font = `400 ${4.2 * u}px ${HAND}`;
  ctx.fillText('3D CHESS', x + 1.6 * u, y + bh * 0.24);
  ctx.font = `400 ${2.2 * u}px ${HAND}`;
  ctx.fillStyle = WHITE(0.8);
  ctx.fillText('RAUMSCHACH  ·  5 × 5 × 5', x + 1.6 * u, y + bh * 0.36);
  // Projection symbol, top right of the block
  const px = x + bw - 6 * u;
  const py = y + bh * 0.2;
  ctx.strokeStyle = WHITE(0.8);
  ctx.beginPath();
  ctx.arc(px + 2.6 * u, py, 1.1 * u, 0, Math.PI * 2);
  ctx.moveTo(px + 2.6 * u, py - 1.9 * u);
  ctx.lineTo(px + 2.6 * u, py + 1.9 * u);
  ctx.moveTo(px - 2.2 * u, py - 0.6 * u);
  ctx.lineTo(px - 0.3 * u, py - 1.1 * u);
  ctx.lineTo(px - 0.3 * u, py + 1.1 * u);
  ctx.lineTo(px - 2.2 * u, py + 0.6 * u);
  ctx.closePath();
  ctx.stroke();

  const cell = (label: string, value: string, cx: number, cy: number) => {
    ctx.font = `500 ${1.15 * u}px ${MONO}`;
    ctx.fillStyle = WHITE(0.6);
    ctx.fillText(label, cx + 0.8 * u, cy + 1.5 * u);
    ctx.font = `400 ${2 * u}px ${HAND}`;
    ctx.fillStyle = WHITE(0.95);
    ctx.fillText(value, cx + 0.8 * u, cy + bh * 0.19 - 0.6 * u);
  };
  cell('DWG NO.', 'RS-1907', x, rows[0]);
  cell('SCALE', '1 : 1', split, rows[0]);
  cell('DRAWN', 'F. MAACK', x, rows[1]);
  cell('REV', 'A', split, rows[1]);
  ctx.font = `600 ${1.6 * u}px ${MONO}`;
  ctx.fillStyle = WHITE(0.9);
  ctx.fillText('SHEET 1 OF 1', x + 0.8 * u, y + bh - 1.2 * u);
  ctx.fillText('A1', split + 0.8 * u, y + bh - 1.2 * u);
  ctx.restore();
};
