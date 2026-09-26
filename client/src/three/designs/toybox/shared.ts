import { CanvasTexture, SRGBColorSpace } from 'three';
import type { Texture } from 'three';
import { towerBoardY, towerLayout } from '../kit/layouts';
import { fbm, paintedTexture } from '../kit/textures';

// Shared by the Toy Box modules: the tower's measurements, the palette and
// the little canvas textures (wood grain, soft shadows, stickers).

export const SPACING = 1.05;
export const layout = towerLayout({
  spacing: SPACING,
  levelGap: 2.1,
  viewDirection: [0.12, 0.38, 1],
});

/** Height of each tray's top surface, level A first. */
export const FLOORS = [0, 1, 2, 3, 4].map((z) => towerBoardY(layout, z));
/** Half the width of the playing surface (the 5×5 squares). */
export const HALF_BOARD = (SPACING * 5) / 2;
/** Half the width of a tray, rim included. */
export const HALF_TRAY = HALF_BOARD + 0.26;

export const NAVY = '#27366b';
export const CREAM = '#fff3dc';
export const RED = '#ff4b4b';
export const YELLOW = '#ffc21f';
export const TOY_COLORS = [
  '#ff4b4b',
  '#ffc21f',
  '#3e95e6',
  '#2fae7e',
  '#a883f0',
  '#ff8a3d',
  '#ff6fb5',
];

// One candy colour per level, bottom to top: the painted tray, and the light
// and dark squares inlaid in it.
export const LEVEL_PAINT: { tray: string; light: string; dark: string }[] = [
  { tray: '#2fae7e', light: '#b2efd2', dark: '#73d6ab' }, // mint
  { tray: '#f07a4f', light: '#ffd3bd', dark: '#ffa782' }, // peach
  { tray: '#3e95e6', light: '#c0e2ff', dark: '#82c1f7' }, // sky
  { tray: '#e3a21c', light: '#ffeaa0', dark: '#fccb52' }, // butter
  { tray: '#8a66e0', light: '#e2d5ff', dark: '#b79ff5' }, // lilac
];

// --- Canvas textures --------------------------------------------------------

export const drawTexture = (
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): Texture => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
};

const grainNoise = fbm(21, 3, 4);
/** Faint wood grain under the paint: near-white, tinted by a material colour. */
export const grainTexture = paintedTexture(
  (u, v) => {
    const n = grainNoise(u, v);
    const ring = Math.abs(Math.sin((v * 9 + n * 2.5 + u * 0.6) * Math.PI));
    const k = 236 + ring ** 6 * -26 + n * 22;
    return [k, k * 0.985, k * 0.96];
  },
  { size: 256 },
);

/** A soft round shadow, dark in the middle: the blob under every toy. */
export const blobTexture = drawTexture(64, 64, (ctx) => {
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.75, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
});

/** Rainbow candy-cane stripes, wrapped round the unicorn's horn. */
export const rainbowTexture = drawTexture(128, 128, (ctx) => {
  const colors = ['#ff4b4b', '#ff9a2e', '#ffd21f', '#3cc76a', '#3e95e6', '#8a66e0'];
  const band = 128 / colors.length;
  for (let i = -colors.length; i < colors.length * 2; i++) {
    ctx.fillStyle = colors[((i % colors.length) + colors.length) % colors.length];
    ctx.beginPath();
    // Diagonal bands: they wind round the cone as a spiral
    ctx.moveTo(i * band, 0);
    ctx.lineTo(i * band + band, 0);
    ctx.lineTo(i * band + band + 128, 128);
    ctx.lineTo(i * band + 128, 128);
    ctx.fill();
  }
});

const roundRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

/** A rounded square sticker: filled, or a dashed outline. */
export const squareTexture = (fill: boolean) =>
  drawTexture(128, 128, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    if (fill) {
      roundRect(ctx, 6, 6, 116, 116, 22);
      ctx.fill();
    } else {
      ctx.lineWidth = 11;
      ctx.setLineDash([20, 12]);
      roundRect(ctx, 10, 10, 108, 108, 20);
      ctx.stroke();
    }
  });

/** A comic speech bubble with a red "!" in it, floated over a king in check. */
export const alertTexture = drawTexture(128, 160, (ctx) => {
  ctx.lineJoin = 'round';
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = NAVY;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(64, 64, 52, 0.62 * Math.PI, 0.38 * Math.PI);
  ctx.lineTo(64, 148);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ff3346';
  roundRect(ctx, 53, 24, 22, 58, 10);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(64, 100, 12, 0, Math.PI * 2);
  ctx.fill();
});

/** A jagged comic "POW" starburst for the moment of a capture. */
export const powTexture = drawTexture(256, 256, (ctx) => {
  const spikes = 11;
  const star = (outer: number, inner: number) => {
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? outer * (0.86 + ((i * 37) % 11) / 55) : inner;
      const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
      ctx.lineTo(128 + Math.cos(a) * r, 128 + Math.sin(a) * r);
    }
    ctx.closePath();
  };
  ctx.lineJoin = 'round';
  star(122, 70);
  ctx.fillStyle = '#ff4b4b';
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = NAVY;
  ctx.stroke();
  star(92, 54);
  ctx.fillStyle = '#ffd21f';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(128, 128, 30, 0, Math.PI * 2);
  ctx.fill();
});

/** A cartoon sun: a warm halo, a ring of rounded rays and a buttery disc. */
export const sunTexture = drawTexture(256, 256, (ctx) => {
  const halo = ctx.createRadialGradient(128, 128, 30, 128, 128, 128);
  halo.addColorStop(0, 'rgba(255,236,150,0.9)');
  halo.addColorStop(0.5, 'rgba(255,226,130,0.35)');
  halo.addColorStop(1, 'rgba(255,226,130,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, 256, 256);
  ctx.save();
  ctx.translate(128, 128);
  ctx.fillStyle = '#ffd43b';
  for (let i = 0; i < 12; i++) {
    ctx.rotate(Math.PI / 6);
    ctx.beginPath();
    ctx.ellipse(0, -74, 9, 17, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(128, 128, 50, 0, Math.PI * 2);
  ctx.fillStyle = '#ffe066';
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = '#ffb31f';
  ctx.stroke();
});
