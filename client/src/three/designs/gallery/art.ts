import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';
import type { Texture } from 'three';
import { rng } from '../kit/textures';

// The gallery's paintings: eight small canvases painted once into a 4 × 2
// atlas that the wall shader hangs one per bay. Each is a genre a museum
// would hang (a landscape, a colour field, a portrait in chiaroscuro, a
// moonlit sea, a geometric abstraction, a still life, a gestural
// abstraction, a starry swirl), painted in muted pigments: under the dim
// picture lights they read as art in the gloom, never as colour competing
// with the board.

const CELL = 256;

type Painter = (ctx: CanvasRenderingContext2D, random: () => number) => void;

const fill = (ctx: CanvasRenderingContext2D, color: string, x = 0, y = 0, w = CELL, h = CELL) => {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
};

const vertical = (ctx: CanvasRenderingContext2D, stops: [number, string][], y0 = 0, y1 = CELL) => {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  stops.forEach(([t, c]) => g.addColorStop(t, c));
  ctx.fillStyle = g;
  ctx.fillRect(0, y0, CELL, y1 - y0);
};

const blob = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  soft = 0.6,
) => {
  const g = ctx.createRadialGradient(x, y, r * (1 - soft), x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
};

const PAINTERS: Painter[] = [
  // A pastoral landscape: evening sky, layered hills, a still lake
  (ctx, random) => {
    vertical(ctx, [
      [0, '#6f7f95'],
      [0.45, '#c9a878'],
      [0.62, '#8a7a58'],
      [1, '#3c3a2a'],
    ]);
    for (let layer = 0; layer < 3; layer++) {
      ctx.fillStyle = ['#5d6348', '#434833', '#2c3022'][layer];
      ctx.beginPath();
      ctx.moveTo(0, CELL);
      for (let x = 0; x <= CELL; x += 8) {
        const y =
          140 +
          layer * 26 +
          Math.sin(x * 0.02 + layer * 2 + random()) * (18 - layer * 4) +
          random() * 4;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(CELL, CELL);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(190, 170, 130, 0.35)';
    ctx.fillRect(40, 205, 150, 6);
  },
  // A colour field: two soft rectangles floating on a deep ground
  (ctx) => {
    fill(ctx, '#5a2a26');
    ctx.filter = 'blur(5px)';
    fill(ctx, '#b0673a', 24, 26, 208, 110);
    fill(ctx, '#3a1c1e', 24, 152, 208, 78);
    ctx.filter = 'none';
  },
  // A portrait: a face and a collar catching the light out of darkness
  (ctx) => {
    fill(ctx, '#1d1914');
    blob(ctx, 128, 250, 120, 'rgba(60, 44, 30, 1)', 0.5);
    ctx.fillStyle = '#2b2119';
    ctx.beginPath();
    ctx.ellipse(128, 262, 96, 70, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#d8c7a6';
    ctx.beginPath();
    ctx.ellipse(128, 206, 52, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    blob(ctx, 124, 112, 58, 'rgba(214, 170, 128, 1)', 0.35);
    blob(ctx, 106, 104, 24, 'rgba(240, 206, 164, 0.8)', 0.9);
    ctx.fillStyle = 'rgba(30, 20, 14, 0.85)';
    ctx.beginPath();
    ctx.ellipse(128, 72, 62, 34, 0, Math.PI, 0);
    ctx.fill();
  },
  // A moonlit sea: a pale moon, its path on the water
  (ctx, random) => {
    vertical(ctx, [
      [0, '#1b2433'],
      [0.55, '#3b4b61'],
      [0.56, '#26303d'],
      [1, '#131820'],
    ]);
    blob(ctx, 170, 70, 26, 'rgba(236, 230, 206, 1)', 0.25);
    blob(ctx, 170, 70, 60, 'rgba(160, 170, 180, 0.35)', 1);
    for (let i = 0; i < 40; i++) {
      const y = 146 + i * 2.6;
      const w = 6 + i * 1.3 + random() * 8;
      ctx.fillStyle = `rgba(220, 214, 190, ${0.5 - i * 0.011})`;
      ctx.fillRect(170 - w / 2 + (random() - 0.5) * 10, y, w, 1.4);
    }
  },
  // A geometric abstraction: blocks and bars in muted primaries
  (ctx) => {
    fill(ctx, '#a39d90');
    fill(ctx, '#7a3a2f', 0, 0, 150, 120);
    fill(ctx, '#2f4260', 170, 190, 86, 66);
    fill(ctx, '#9c8040', 0, 214, 60, 42);
    ctx.fillStyle = '#1c1c1c';
    [
      [150, 0, 10, 256],
      [0, 120, 256, 10],
      [160, 180, 96, 10],
      [60, 130, 8, 126],
    ].forEach(([x, y, w, h]) => ctx.fillRect(x, y, w, h));
  },
  // A still life: a jug and fruit on a table, a dark ground
  (ctx) => {
    vertical(ctx, [
      [0, '#221d17'],
      [0.62, '#2d261d'],
      [0.63, '#5c4630'],
      [1, '#3a2c1e'],
    ]);
    ctx.fillStyle = '#8d8a7c';
    ctx.beginPath();
    ctx.ellipse(92, 128, 36, 50, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(74, 64, 36, 30);
    blob(ctx, 80, 112, 20, 'rgba(220, 214, 196, 0.8)', 0.9);
    blob(ctx, 158, 150, 22, 'rgba(176, 98, 44, 1)', 0.25);
    blob(ctx, 192, 156, 17, 'rgba(150, 142, 58, 1)', 0.25);
    blob(ctx, 176, 136, 15, 'rgba(120, 38, 40, 1)', 0.25);
  },
  // A gestural abstraction: sweeping strokes over a warm ground
  (ctx, random) => {
    fill(ctx, '#b9aa8c');
    ctx.lineCap = 'round';
    const colors = ['#2a2622', '#8a3b2a', '#3e5470', '#d9d0bd', '#6d6a3a'];
    for (let i = 0; i < 22; i++) {
      ctx.strokeStyle = colors[i % colors.length];
      ctx.globalAlpha = 0.55 + random() * 0.4;
      ctx.lineWidth = 4 + random() * 16;
      ctx.beginPath();
      const x = random() * CELL;
      const y = random() * CELL;
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(
        x + (random() - 0.5) * 200,
        y + (random() - 0.5) * 200,
        x + (random() - 0.5) * 200,
        y + (random() - 0.5) * 200,
        x + (random() - 0.5) * 160,
        y + (random() - 0.5) * 160,
      );
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },
  // A starry swirl over a dark village
  (ctx, random) => {
    fill(ctx, '#1d2c4e');
    ctx.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      const cx = random() * CELL;
      const cy = random() * 170;
      const r = 10 + random() * 40;
      ctx.strokeStyle = random() < 0.6 ? '#4a6590' : '#8fa3b8';
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 3 + random() * 3;
      ctx.beginPath();
      ctx.arc(cx, cy, r, random() * 6, random() * 6 + 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < 9; i++) blob(ctx, random() * CELL, random() * 150, 9, '#e3cf7a', 0.5);
    ctx.fillStyle = '#10151f';
    ctx.beginPath();
    ctx.moveTo(0, CELL);
    for (let x = 0; x <= CELL; x += 16) ctx.lineTo(x, 200 + random() * 26);
    ctx.lineTo(CELL, CELL);
    ctx.fill();
    ctx.fillStyle = '#0c1018';
    ctx.fillRect(40, 90, 14, 166);
  },
];

let atlas: Texture | null = null;

/** The eight paintings, 4 across and 2 down, one per atlas cell. */
export const paintingAtlas = (): Texture => {
  if (atlas) return atlas;
  const c = document.createElement('canvas');
  c.width = CELL * 4;
  c.height = CELL * 2;
  const ctx = c.getContext('2d')!;
  PAINTERS.forEach((paint, i) => {
    ctx.save();
    // Canvas rows run down; the shader's atlas rows run up
    ctx.translate((i % 4) * CELL, (1 - Math.floor(i / 4)) * CELL);
    ctx.beginPath();
    ctx.rect(0, 0, CELL, CELL);
    ctx.clip();
    paint(ctx, rng(17 + i * 31));
    ctx.restore();
  });
  atlas = new CanvasTexture(c);
  atlas.colorSpace = SRGBColorSpace;
  atlas.minFilter = LinearMipmapLinearFilter;
  atlas.anisotropy = 4;
  return atlas;
};
