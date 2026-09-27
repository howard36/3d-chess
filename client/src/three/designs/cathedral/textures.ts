import { CanvasTexture, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace } from 'three';
import type { Texture } from 'three';
import { rng } from '../kit/textures';
import { WINDOW, WINDOW_DEEP } from './palette';

// The nave, painted once onto two canvases at load: the round wall of a
// Gothic rotunda (arcade, triforium, clerestory windows and two great roses
// facing each other), and the stone floor far below with its labyrinth. The
// wall is drawn in world units along its circumference, so arches and roses
// keep their shape on the cylinder they are wrapped round. Both are painted
// dim and then softened, as if seen past the board slightly out of focus:
// there is detail to find, but nothing sharp enough to pull the eye.

/** Geometry of the room, shared with the stage that wraps the textures. */
export const NAVE = {
  floorY: -22,
  wallTop: 34,
  wallRadius: 42,
  bays: 12,
  /** Bays that hold a rose window (one facing each seat). */
  roses: [0, 6],
  /** How far the room is turned (radians), so a window rather than a pier stands behind the tower. */
  turn: (8 * Math.PI) / 180,
} as const;

const WALL_W = 4096;
const WALL_H = 1600;
const CIRCUMFERENCE = 2 * Math.PI * NAVE.wallRadius;
const BAY = CIRCUMFERENCE / NAVE.bays;
/** How bright the painted glass is (0–1): low, so the windows glow without glaring. */
const GLOW = 0.27;

type Ctx = CanvasRenderingContext2D;

/** A pointed (Gothic) arch of width `w` round `cx`, springing at `spring`, rising to `apex`, down to `bottom`. */
const lancet = (ctx: Ctx, cx: number, w: number, bottom: number, spring: number, apex: number) => {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  ctx.beginPath();
  ctx.moveTo(x0, bottom);
  ctx.lineTo(x0, spring);
  ctx.quadraticCurveTo(x0, spring + (apex - spring) * 0.72, cx, apex);
  ctx.quadraticCurveTo(x1, spring + (apex - spring) * 0.72, x1, spring);
  ctx.lineTo(x1, bottom);
  ctx.closePath();
};

const hexA = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

const stroke = (ctx: Ctx, color: string, width: number) => {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
};

/** Mosaic glass inside the current clip: quarries and medallions in jewel colours, leaded. */
const glaze = (
  ctx: Ctx,
  random: () => number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  main: number,
  accent: number,
  brightness = GLOW,
) => {
  const q = 0.6;
  for (let y = y0; y < y1; y += q) {
    for (let x = x0; x < x1; x += q) {
      const k = 0.65 + random() * 0.6;
      const pick = random() < 0.14 ? accent : main;
      ctx.fillStyle = hexA(WINDOW_DEEP[pick], brightness * k);
      ctx.fillRect(x, y, q + 0.02, q + 0.02);
    }
  }
  const cx = (x0 + x1) / 2;
  const r = (x1 - x0) * 0.34;
  // Medallions only in wine and cobalt: round, warm-bright glass behind the
  // platforms must never look like a gilt or ivory play mark
  const ring = accent === 2 ? 2 : 0;
  for (let y = y0 + r * 1.6; y < y1 - r; y += r * 2.9) {
    ctx.beginPath();
    ctx.arc(cx, y, r, 0, Math.PI * 2);
    ctx.fillStyle = hexA(WINDOW[ring], brightness * 0.9);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, y, r * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = hexA(WINDOW[2 - ring], brightness * 0.85);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(4, 3, 6, 0.85)';
  ctx.lineWidth = 0.08;
  ctx.beginPath();
  for (let y = y0; y < y1; y += q * 2) {
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
  }
  ctx.moveTo(cx, y0);
  ctx.lineTo(cx, y1);
  ctx.stroke();
  for (let y = y0 + r * 1.6; y < y1 - r; y += r * 2.9) {
    ctx.beginPath();
    ctx.arc(cx, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
};

/** A window's light spilling onto the stone round it (an ellipse `rx` by `ry`). */
const halo = (ctx: Ctx, x: number, y: number, rx: number, ry: number, color: string, a: number) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(rx, ry);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, hexA(color, a));
  g.addColorStop(0.5, hexA(color, a * 0.35));
  g.addColorStop(1, hexA(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

// Heights on the wall (world y)
const ARCADE_APEX = -13.2;
const TRIFORIUM = [-12.4, -9.6] as const;
const CLERESTORY = [-8.8, 5.2, 8] as const; // sill, spring, apex
const ROSE_Y = 1.5;
const ROSE_R = 8.2;

/** Three lancets under an oculus, in a hood of stone. */
const clerestory = (ctx: Ctx, random: () => number, cx: number, bay: number) => {
  const main = [2, 0, 3, 1, 4, 2][bay % 6];
  const accent = (main + 2 + (bay % 2)) % 5;
  const [sill, spring, apex] = CLERESTORY;
  halo(ctx, cx, 1, 9, 13, WINDOW[main], 0.06);
  lancet(ctx, cx, 12, sill - 0.8, spring + 1.5, apex + 7.5);
  ctx.fillStyle = 'rgba(26, 22, 32, 0.6)';
  ctx.fill();
  stroke(ctx, 'rgba(62, 55, 72, 0.3)', 0.2);
  for (const dx of [-3.4, 0, 3.4]) {
    const top = dx === 0 ? apex + 1 : apex;
    ctx.save();
    lancet(ctx, cx + dx, 2.7, sill, spring, top);
    ctx.clip();
    glaze(ctx, random, cx + dx - 1.4, cx + dx + 1.4, sill, top + 0.1, main, accent);
    ctx.restore();
    lancet(ctx, cx + dx, 2.7, sill, spring, top);
    stroke(ctx, 'rgba(8, 6, 10, 0.95)', 0.26);
  }
  // An oculus with a six-lobed foil of cobalt (never four: that is the move mark)
  const oy = apex + 3.6;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, oy, 2.3, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = hexA(WINDOW_DEEP[0], GLOW);
  ctx.fillRect(cx - 2.5, oy - 2.5, 5, 5);
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * 1.05, oy + Math.sin(a) * 1.05, 0.72, 0, Math.PI * 2);
    ctx.fillStyle = hexA(WINDOW[2], GLOW * 0.9);
    ctx.fill();
    stroke(ctx, 'rgba(6, 4, 8, 0.9)', 0.09);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, oy, 2.3, 0, Math.PI * 2);
  stroke(ctx, 'rgba(8, 6, 10, 0.95)', 0.28);
};

/** A great rose: sixteen petals round a rosette, ringed by sixteen roundels. */
const rose = (ctx: Ctx, random: () => number, cx: number, cy: number, R: number, turn: number) => {
  halo(ctx, cx, cy, R * 1.8, R * 1.8, WINDOW[2], 0.07);
  halo(ctx, cx, cy, R * 1.1, R * 1.1, WINDOW[0], 0.04);
  ctx.beginPath();
  ctx.arc(cx, cy, R * 1.06, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(26, 22, 32, 0.75)';
  ctx.fill();
  stroke(ctx, 'rgba(70, 60, 80, 0.3)', 0.24);
  const N = 16;
  for (let i = 0; i < N; i++) {
    const a = ((i + 0.5) / N) * Math.PI * 2 + turn;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * R * 0.9, cy + Math.sin(a) * R * 0.9, R * 0.1, 0, Math.PI * 2);
    ctx.fillStyle = hexA(WINDOW[i % 2 ? 2 : 0], GLOW * 0.85);
    ctx.fill();
    stroke(ctx, 'rgba(6, 4, 8, 0.9)', 0.12);
  }
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + turn;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a - Math.PI / 2);
    const main = [2, 0, 2, 2][i % 4];
    ctx.save();
    lancet(ctx, 0, R * 0.2, R * 0.28, R * 0.62, R * 0.78);
    ctx.clip();
    glaze(
      ctx,
      random,
      -R * 0.12,
      R * 0.12,
      R * 0.26,
      R * 0.8,
      main,
      main === 2 ? 0 : 2,
      GLOW * 0.9,
    );
    ctx.restore();
    lancet(ctx, 0, R * 0.2, R * 0.28, R * 0.62, R * 0.78);
    stroke(ctx, 'rgba(6, 4, 8, 0.95)', 0.18);
    ctx.restore();
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + turn;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * R * 0.14, cy + Math.sin(a) * R * 0.14, R * 0.1, 0, Math.PI * 2);
    ctx.fillStyle = hexA(WINDOW[i % 2 ? 2 : 0], GLOW * 0.85);
    ctx.fill();
    stroke(ctx, 'rgba(6, 4, 8, 0.9)', 0.1);
  }
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.09, 0, Math.PI * 2);
  ctx.fillStyle = hexA(WINDOW[0], GLOW);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.8, 0, Math.PI * 2);
  stroke(ctx, 'rgba(10, 8, 12, 0.9)', 0.24);
};

/**
 * Softens a canvas in place, as if seen a little out of focus. With `wrap`
 * the blur runs across the left and right edges as across any other column
 * (the wall wraps round), so the seam never shows.
 */
const soften = (canvas: HTMLCanvasElement, px: number, wrap = false) => {
  const pad = wrap ? Math.ceil(px * 4) : 0;
  const copy = document.createElement('canvas');
  copy.width = canvas.width + pad * 2;
  copy.height = canvas.height;
  const c = copy.getContext('2d')!;
  c.drawImage(canvas, pad, 0);
  if (wrap) {
    c.drawImage(canvas, canvas.width - pad, 0, pad, canvas.height, 0, 0, pad, canvas.height);
    c.drawImage(canvas, 0, 0, pad, canvas.height, canvas.width + pad, 0, pad, canvas.height);
  }
  const blurred = document.createElement('canvas');
  blurred.width = copy.width;
  blurred.height = copy.height;
  const b = blurred.getContext('2d')!;
  b.filter = `blur(${px}px)`;
  b.drawImage(copy, 0, 0);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(blurred, pad, 0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
};

let wall: Texture | null = null;

/**
 * The rotunda's wall, all the way round (u: along the wall, v: floor to
 * vault). Bay b is centred at u = (b + 0.5) / bays: wrap it with the
 * cylinder turned back half a bay to put bay 0 on +z.
 */
export const wallTexture = (): Texture => {
  if (wall) return wall;
  const c = document.createElement('canvas');
  c.width = WALL_W;
  c.height = WALL_H;
  const ctx = c.getContext('2d')!;
  const random = rng(29);
  const sx = WALL_W / CIRCUMFERENCE;
  const sy = WALL_H / (NAVE.wallTop - NAVE.floorY);

  // Stone: darkest at the floor and in the vault, faintly lit at the windows
  const bg = ctx.createLinearGradient(0, 0, 0, WALL_H);
  bg.addColorStop(0, '#040306');
  bg.addColorStop(0.3, '#0a090e');
  bg.addColorStop(0.55, '#0f0d14');
  bg.addColorStop(0.8, '#0a090d');
  bg.addColorStop(1, '#060508');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WALL_W, WALL_H);

  // From here on, world units: x along the wall, y up
  ctx.setTransform(sx, 0, 0, -sy, 0, NAVE.wallTop * sy);

  // Coursed stone: faint joints
  ctx.strokeStyle = 'rgba(40, 36, 46, 0.14)';
  ctx.lineWidth = 0.07;
  for (let y = NAVE.floorY; y < NAVE.wallTop; y += 1.2) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(CIRCUMFERENCE, y);
    ctx.stroke();
    const shift = (Math.round((y - NAVE.floorY) / 1.2) % 2) * 1.3;
    ctx.beginPath();
    for (let x = shift; x < CIRCUMFERENCE; x += 2.6) {
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + 1.2);
    }
    ctx.stroke();
  }

  for (let b = 0; b < NAVE.bays; b++) {
    const cx = (b + 0.5) * BAY;
    const isRose = (NAVE.roses as readonly number[]).includes(b);
    // The arcade: a tall arch into the dark aisle, far windows glimmering in it
    lancet(ctx, cx, 15, NAVE.floorY, -18.5, ARCADE_APEX);
    ctx.fillStyle = '#020103';
    ctx.fill();
    stroke(ctx, 'rgba(62, 55, 72, 0.4)', 0.4);
    ctx.save();
    lancet(ctx, cx, 15, NAVE.floorY, -18.5, ARCADE_APEX);
    ctx.clip();
    halo(ctx, cx, -18, 6, 5, WINDOW[(b * 2) % 5], 0.07);
    for (const dx of [-2.6, 0, 2.6]) {
      lancet(ctx, cx + dx, 1.6, -20.5, -17.4, -16);
      ctx.fillStyle = hexA(WINDOW_DEEP[(b * 2 + 5 + Math.round(dx)) % 5], 0.22);
      ctx.fill();
    }
    ctx.restore();

    // String courses, then the triforium's little arches
    ctx.fillStyle = 'rgba(56, 50, 64, 0.35)';
    ctx.fillRect(cx - BAY / 2, TRIFORIUM[0] - 0.5, BAY, 0.32);
    ctx.fillRect(cx - BAY / 2, TRIFORIUM[1] + 0.2, BAY, 0.26);
    for (let i = 0; i < 7; i++) {
      const x = cx - 7.8 + i * 2.6;
      lancet(ctx, x, 1.8, TRIFORIUM[0], TRIFORIUM[1] - 1.2, TRIFORIUM[1]);
      ctx.fillStyle = '#030204';
      ctx.fill();
      stroke(ctx, 'rgba(66, 58, 76, 0.35)', 0.14);
    }

    if (isRose) {
      rose(ctx, random, cx, ROSE_Y, ROSE_R, b * 0.2);
    } else {
      clerestory(ctx, random, cx, b);
    }
  }

  // Piers between the bays: clustered shafts rising into the vault
  for (let b = 0; b <= NAVE.bays; b++) {
    const px = b * BAY;
    const g = ctx.createLinearGradient(px - 1.8, 0, px + 1.8, 0);
    g.addColorStop(0, 'rgba(9, 8, 12, 0.9)');
    g.addColorStop(0.3, 'rgba(28, 25, 34, 0.95)');
    g.addColorStop(0.55, 'rgba(19, 17, 24, 0.95)');
    g.addColorStop(0.8, 'rgba(31, 27, 37, 0.95)');
    g.addColorStop(1, 'rgba(9, 8, 12, 0.9)');
    ctx.fillStyle = g;
    ctx.fillRect(px - 1.8, NAVE.floorY, 3.6, NAVE.wallTop - NAVE.floorY);
    // Vault ribs springing from the pier
    ctx.beginPath();
    ctx.moveTo(px, 17);
    ctx.quadraticCurveTo(px + BAY * 0.12, 27, px + BAY / 2, 31);
    ctx.moveTo(px, 17);
    ctx.quadraticCurveTo(px - BAY * 0.12, 27, px - BAY / 2, 31);
    stroke(ctx, 'rgba(44, 38, 52, 0.4)', 0.45);
  }

  soften(c, 2.5, true);
  wall = new CanvasTexture(c);
  wall.colorSpace = SRGBColorSpace;
  wall.wrapS = RepeatWrapping;
  wall.minFilter = LinearMipmapLinearFilter;
  wall.anisotropy = 4;
  return wall;
};

/** Where the labyrinth lies on the floor (world x, z): a bay off the crossing. */
const LABYRINTH: [number, number] = [9.5, -8];

let floor: Texture | null = null;

/**
 * The floor under the tower: rings of dark paving round a labyrinth of
 * eleven circuits in pale stone, as at Chartres, and pools of coloured
 * light thrown down by the windows. Round, never square, so seen from above
 * it can never be mistaken for the board.
 */
export const floorTexture = (): Texture => {
  if (floor) return floor;
  const size = 2048;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const random = rng(41);
  const R = NAVE.wallRadius;
  const s = size / (2 * R);
  ctx.fillStyle = '#07060a';
  ctx.fillRect(0, 0, size, size);
  // World units, centred: x to the right, z down the canvas
  ctx.setTransform(s, 0, 0, s, size / 2, size / 2);

  // The labyrinth and the rings of paving round it lie off to one side of
  // the crossing, so from above they read as a floor, not a target under
  // the board
  ctx.save();
  ctx.translate(LABYRINTH[0], LABYRINTH[1]);

  // Paving in rings, each slab its own shade
  const inner = 1.9;
  const step = 0.58;
  const rings = 11;
  const outer = inner + rings * step;
  for (let r = outer + 0.9; r < R + Math.hypot(...LABYRINTH); r += 1.7) {
    const n = Math.max(8, Math.round((2 * Math.PI * r) / 2.6));
    const offset = random() * Math.PI;
    for (let i = 0; i < n; i++) {
      const a0 = offset + (i / n) * Math.PI * 2;
      const a1 = offset + ((i + 1) / n) * Math.PI * 2;
      const k = 0.7 + random() * 0.55;
      ctx.beginPath();
      ctx.arc(0, 0, r + 1.62, a0 + 0.06 / r, a1 - 0.06 / r);
      ctx.arc(0, 0, r + 0.08, a1 - 0.06 / r, a0 + 0.06 / r, true);
      ctx.closePath();
      ctx.fillStyle = `rgb(${Math.round(20 * k)}, ${Math.round(18 * k)}, ${Math.round(24 * k)})`;
      ctx.fill();
    }
  }

  ctx.restore();

  // Light from the windows, lying on the floor in soft coloured pools
  for (let b = 0; b < NAVE.bays; b++) {
    const a = (b / NAVE.bays) * Math.PI * 2 + NAVE.turn;
    const isRose = (NAVE.roses as readonly number[]).includes(b);
    const d = isRose ? 20 : 29;
    const x = Math.sin(a) * d;
    const z = Math.cos(a) * d;
    const main = isRose ? 2 : [2, 0, 3, 1, 4, 2][b % 6];
    halo(ctx, x, z, isRose ? 7 : 4, isRose ? 7 : 4, WINDOW[main], isRose ? 0.07 : 0.06);
    if (isRose) {
      for (let i = 0; i < 5; i++) {
        const t = (i / 5) * Math.PI * 2;
        halo(ctx, x + Math.cos(t) * 2.8, z + Math.sin(t) * 2.8, 2.6, 2.6, WINDOW[i], 0.05);
      }
    }
  }

  // The labyrinth: pale stone paths between dark lines
  ctx.save();
  ctx.translate(LABYRINTH[0], LABYRINTH[1]);
  ctx.beginPath();
  ctx.arc(0, 0, outer + 0.3, 0, Math.PI * 2);
  ctx.fillStyle = '#1d1a22';
  ctx.fill();
  ctx.strokeStyle = 'rgba(8, 7, 11, 0.85)';
  ctx.lineWidth = 0.12;
  for (let i = 0; i <= rings; i++) {
    const r = inner + i * step;
    const gap = i === rings ? 0.5 * Math.PI : ((i * 7) % 4) * (Math.PI / 2);
    const g = 0.12 / Math.max(r, 1);
    ctx.beginPath();
    ctx.arc(0, 0, r, gap + g + Math.PI / 2, gap - g + Math.PI / 2 + Math.PI * 2);
    ctx.stroke();
  }
  for (let q = 0; q < 4; q++) {
    const a = (q * Math.PI) / 2;
    for (let i = 1; i < rings; i++) {
      if ((i + q) % 3 === 0) continue;
      const r0 = inner + i * step;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a + 0.05) * r0, Math.sin(a + 0.05) * r0);
      ctx.lineTo(Math.cos(a + 0.05) * (r0 + step), Math.sin(a + 0.05) * (r0 + step));
      ctx.stroke();
    }
  }
  const teeth = 112;
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * (outer + 0.3), Math.sin(a) * (outer + 0.3), 0.17, 0, Math.PI * 2);
    ctx.fillStyle = '#16141a';
    ctx.fill();
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 0.95, Math.sin(a) * 0.95, 0.72, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 0.55, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Toward the walls the floor falls into shadow
  const shade = ctx.createRadialGradient(0, 0, R * 0.25, 0, 0, R);
  shade.addColorStop(0, 'rgba(4, 3, 6, 0)');
  shade.addColorStop(1, 'rgba(4, 3, 6, 0.8)');
  ctx.fillStyle = shade;
  ctx.fillRect(-R, -R, 2 * R, 2 * R);

  soften(c, 1.5);
  floor = new CanvasTexture(c);
  floor.colorSpace = SRGBColorSpace;
  floor.minFilter = LinearMipmapLinearFilter;
  floor.anisotropy = 8;
  return floor;
};
