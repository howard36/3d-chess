import { CanvasTexture, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace } from 'three';
import { GRID_SIZE } from '../../layout';
import type { Orientation } from '../../layout';
import { rng } from '../kit/textures';
import { APERTURE, FLOOR_Y, FRAME } from './palette';

// The studio's drawings, painted once on CPU canvases (painting through a
// software GPU, as the review machine has, would stall the first frame): the
// glass wall's panorama, four famous positions and a chess clock drawn in
// thin light, and the coordinates engraved round the projector table's rim.
// stage.tsx hangs them in the room.

export const WALL_RADIUS = 30;
export const WALL_HEIGHT = 26;
// Heights on the wall (world y): the window sill, the horizon, the head
const SILL_Y = -2.2;
const HORIZON_Y = 2.6;
const HEAD_Y = 10.5;
export const BAYS = 16;
/** The solid bays, where the framed positions hang... */
export const FRAMED_BAYS = [2, 6, 10, 14];
/** ...and the one where a chess clock is drawn. */
export const CLOCK_BAY = 8;
const SOLID_BAYS = [...FRAMED_BAYS, CLOCK_BAY];

/** The wall's panorama, painted once: windows, city bokeh, solid bays. */
export const panorama = (): CanvasTexture => {
  const W = 2048;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  // A CPU canvas: painting through a software GPU (the review machine's)
  // would stall the first frame for a long time
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const rowOf = (y: number) => H * (1 - (y - FLOOR_Y) / WALL_HEIGHT);
  const sill = rowOf(SILL_Y);
  const horizon = rowOf(HORIZON_Y);
  const head = rowOf(HEAD_Y);
  const random = rng(11);

  // The room's dark wall
  ctx.fillStyle = '#04060c';
  ctx.fillRect(0, 0, W, H);
  // Through the glass: a night sky, hazier toward the horizon
  const sky = ctx.createLinearGradient(0, head, 0, sill);
  sky.addColorStop(0, '#060913');
  sky.addColorStop(0.5, '#0f1429');
  sky.addColorStop(0.62, '#12172e');
  sky.addColorStop(1, '#080b16');
  ctx.fillStyle = sky;
  ctx.fillRect(0, head, W, sill - head);

  // The skyline, soft: blocks a shade darker than the haze
  ctx.save();
  ctx.filter = 'blur(3px)';
  for (let x = -40; x < W + 40; ) {
    const w = 14 + random() * 46;
    const h = 6 + random() ** 2 * 60;
    ctx.fillStyle = random() < 0.5 ? '#070914' : '#080b17';
    ctx.fillRect(x, horizon - h, w, sill - horizon + h);
    x += w * (0.6 + random() * 0.5);
  }
  ctx.restore();

  // City lights, blurred to bokeh: amber-white and pale white, none a
  // level's hue, none near the markers' gold, coral or ice
  const hues = ['#ffd2a8', '#ffdcb8', '#ffe6cc', '#fff0e0', '#dfe6f2', '#c8d2e2'];
  const disc = (x: number, y: number, r: number, color: string, alpha: number) => {
    for (const dx of [0, -W, W]) {
      if (dx !== 0 && Math.abs(x + dx - W / 2) > W / 2 + r) continue;
      const g = ctx.createRadialGradient(x + dx, y, 0, x + dx, y, r);
      g.addColorStop(0, color);
      g.addColorStop(0.55, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = alpha;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x + dx, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 800; i++) {
    const depth = random() ** 1.6;
    const y = horizon - 6 + depth * (sill - horizon + 4);
    const r = 1.2 + depth * 7 * (0.5 + random());
    disc(
      random() * W,
      y,
      r,
      hues[Math.floor(random() * hues.length)],
      0.04 + random() * 0.13 * (1 - depth * 0.5),
    );
  }
  for (let i = 0; i < 60; i++) {
    disc(
      random() * W,
      horizon - 4 - random() * 50,
      1 + random() * 2,
      '#ffe2c2',
      0.07 + random() * 0.08,
    );
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // Mullions and a transom; the bays where drawings hang are solid wall
  const bay = W / BAYS;
  const transom = rowOf(7.9);
  for (let i = 0; i < BAYS; i++) {
    const x = i * bay;
    if (SOLID_BAYS.includes(i)) {
      ctx.fillStyle = '#05070e';
      ctx.fillRect(x, head - 6, bay, sill - head + 12);
      // A soft picture light over the drawing hung there
      const wy = rowOf(FRAME_Y + 2.6);
      const wash = ctx.createRadialGradient(x + bay / 2, wy, 0, x + bay / 2, wy, bay * 0.8);
      wash.addColorStop(0, 'rgba(210, 220, 240, 0.07)');
      wash.addColorStop(1, 'rgba(210, 220, 240, 0)');
      ctx.fillStyle = wash;
      ctx.fillRect(x, head, bay, H - head);
    }
    ctx.fillStyle = '#03050a';
    ctx.fillRect(x - 3, head - 8, 7, sill - head + 16);
    ctx.fillStyle = 'rgba(120, 130, 160, 0.14)';
    ctx.fillRect(x + 4, head - 8, 1, sill - head + 16);
    if (SOLID_BAYS.includes(i)) continue;
    // The room's own light, softly caught in the glass beside each mullion
    const sheen = ctx.createLinearGradient(x + 5, 0, x + 40, 0);
    sheen.addColorStop(0, 'rgba(170, 180, 205, 0.06)');
    sheen.addColorStop(1, 'rgba(170, 180, 205, 0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(x + 5, head, 35, sill - head);
  }
  ctx.fillStyle = '#03050a';
  for (let i = 0; i < BAYS; i++) {
    if (!SOLID_BAYS.includes(i)) ctx.fillRect(i * bay, transom - 3, bay, 5);
  }
  ctx.fillRect(0, head - 8, W, 9);
  ctx.fillRect(0, sill - 2, W, 8);
  // A cove light under the sill
  const cove = ctx.createLinearGradient(0, sill + 6, 0, sill + 26);
  cove.addColorStop(0, 'rgba(215, 222, 235, 0.08)');
  cove.addColorStop(1, 'rgba(215, 222, 235, 0)');
  ctx.fillStyle = cove;
  ctx.fillRect(0, sill + 6, W, 20);

  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
};

// Four famous positions, framed on the solid bays of the wall: eight-by-eight
// boards drawn in thin light, the pieces as small glyphs (the white army
// solid light, the black army in outline), a caption beneath.
export const POSITIONS = [
  // The Opera Game, after 17.Rd8#
  { fen: '1n1Rkb1r/p4ppp/4q3/4p1B1/4P3/8/PPP2PPP/2K5', caption: 'MORPHY · PARIS 1858' },
  // The Immortal Game, after 23.Be7#
  { fen: 'r1bk3r/p2pBpNp/n4n2/1p1NP2P/6P1/3P4/P1P1K3/q5b1', caption: 'ANDERSSEN · LONDON 1851' },
  // Saavedra's study: White to play and win
  { fen: '8/8/1KP5/3r4/8/8/8/k7', caption: 'SAAVEDRA · 1895' },
  // Réti's study: White to play and draw
  { fen: '7K/8/k1P5/7p/8/8/8/8', caption: 'RÉTI · 1921' },
];

/** Piece glyphs in a unit square (y down): one closed outline each, as x, y pairs. */
const GLYPHS: Record<string, number[]> = {
  // The pawn (its head is drawn as a circle)
  p: [0.42, 0.47, 0.58, 0.47, 0.68, 0.84, 0.32, 0.84],
  // The rook
  r: [
    0.28, 0.16, 0.38, 0.16, 0.38, 0.25, 0.45, 0.25, 0.45, 0.16, 0.55, 0.16, 0.55, 0.25, 0.62, 0.25,
    0.62, 0.16, 0.72, 0.16, 0.72, 0.4, 0.66, 0.44, 0.7, 0.84, 0.3, 0.84, 0.34, 0.44, 0.28, 0.4,
  ],
  // The knight
  n: [
    0.3, 0.84, 0.38, 0.6, 0.22, 0.54, 0.16, 0.44, 0.3, 0.28, 0.4, 0.1, 0.48, 0.2, 0.62, 0.22, 0.76,
    0.44, 0.72, 0.84,
  ],
  // The bishop
  b: [
    0.5, 0.1, 0.64, 0.3, 0.62, 0.46, 0.56, 0.54, 0.66, 0.84, 0.34, 0.84, 0.44, 0.54, 0.38, 0.46,
    0.36, 0.3,
  ],
  // The queen
  q: [
    0.22, 0.2, 0.34, 0.42, 0.4, 0.14, 0.5, 0.4, 0.6, 0.14, 0.66, 0.42, 0.78, 0.2, 0.7, 0.58, 0.72,
    0.84, 0.28, 0.84, 0.3, 0.58,
  ],
  // The king
  k: [
    0.46, 0.06, 0.54, 0.06, 0.54, 0.12, 0.6, 0.12, 0.6, 0.19, 0.54, 0.19, 0.54, 0.28, 0.7, 0.3,
    0.64, 0.56, 0.7, 0.84, 0.3, 0.84, 0.36, 0.56, 0.3, 0.3, 0.46, 0.28, 0.46, 0.19, 0.4, 0.19, 0.4,
    0.12, 0.46, 0.12,
  ],
};

export const positionDrawing = (fen: string, caption: string): CanvasTexture => {
  const W = 512;
  const H = 600;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const draw = () => {
    ctx.clearRect(0, 0, W, H);
    // The frame: a thin line of light, and a hairline inside it
    ctx.strokeStyle = 'rgba(190, 210, 240, 0.55)';
    ctx.lineWidth = 3;
    ctx.strokeRect(6, 6, W - 12, H - 12);
    ctx.strokeStyle = 'rgba(190, 210, 240, 0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(18, 18, W - 36, H - 36);
    // The board
    const x0 = 48;
    const y0 = 48;
    const s = (W - 96) / 8;
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        if ((i + j) % 2 === 0) {
          ctx.fillStyle = 'rgba(190, 210, 240, 0.07)';
          ctx.fillRect(x0 + i * s, y0 + j * s, s, s);
        }
      }
    }
    ctx.strokeStyle = 'rgba(190, 210, 240, 0.3)';
    ctx.lineWidth = 1;
    for (let k = 1; k < 8; k++) {
      ctx.beginPath();
      ctx.moveTo(x0 + k * s, y0);
      ctx.lineTo(x0 + k * s, y0 + 8 * s);
      ctx.moveTo(x0, y0 + k * s);
      ctx.lineTo(x0 + 8 * s, y0 + k * s);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(200, 220, 250, 0.7)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0, y0, 8 * s, 8 * s);
    // The pieces
    fen.split('/').forEach((row, j) => {
      let i = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) {
          i += Number(ch);
          continue;
        }
        const white = ch === ch.toUpperCase();
        const outline = GLYPHS[ch.toLowerCase()];
        ctx.beginPath();
        for (let k = 0; k < outline.length; k += 2) {
          const px = x0 + (i + outline[k]) * s;
          const py = y0 + (j + outline[k + 1]) * s;
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        if (white) {
          ctx.fillStyle = 'rgba(235, 242, 255, 0.95)';
          ctx.fill();
        } else {
          ctx.strokeStyle = 'rgba(190, 210, 240, 0.85)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        // A pawn's head
        if (ch.toLowerCase() === 'p') {
          ctx.beginPath();
          ctx.arc(x0 + (i + 0.5) * s, y0 + (j + 0.34) * s, s * 0.13, 0, Math.PI * 2);
          if (white) ctx.fill();
          else ctx.stroke();
        }
        i++;
      }
    });
    ctx.fillStyle = 'rgba(190, 210, 240, 0.6)';
    ctx.font = '500 20px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(caption, W / 2, H - 42);
  };
  draw();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 4;
  // The caption's face may still be loading: draw again once it has
  if (typeof document !== 'undefined' && document.fonts?.load) {
    const redraw = () => {
      draw();
      t.needsUpdate = true;
    };
    document.fonts.load('500 20px "IBM Plex Mono"').then(redraw, redraw);
  }
  return t;
};

export const FRAME_SIZE = 4.2;
// Hung low, so that from wherever one of them lies behind the tower it lies
// behind its panes (and the mask), never in the clear air above it
export const FRAME_Y = -1.8;

/**
 * A chess clock in thin light: the case, two dials (one running, one with
 * its flag raised), the two buttons on top, one pressed.
 */
export const clockDrawing = (): CanvasTexture => {
  const W = 768;
  const H = 480;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const line = (alpha: number, width: number) => {
    ctx.strokeStyle = `rgba(200, 218, 248, ${alpha})`;
    ctx.lineWidth = width;
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // The case: a low wedge, wider at its foot
  line(0.8, 3);
  ctx.beginPath();
  ctx.moveTo(70, 420);
  ctx.lineTo(698, 420);
  ctx.lineTo(660, 130);
  ctx.lineTo(108, 130);
  ctx.closePath();
  ctx.stroke();
  line(0.3, 1.5);
  ctx.beginPath();
  ctx.moveTo(384, 140);
  ctx.lineTo(384, 410);
  ctx.stroke();
  // The buttons: the left one up, the right one pressed
  line(0.75, 3);
  ctx.strokeRect(200, 92, 84, 38);
  ctx.strokeRect(484, 116, 84, 14);
  // The dials
  const dial = (cx: number, cy: number, hour: number, minute: number, flag: boolean) => {
    line(0.85, 3);
    ctx.beginPath();
    ctx.arc(cx, cy, 104, 0, Math.PI * 2);
    ctx.stroke();
    line(0.25, 1.5);
    ctx.beginPath();
    ctx.arc(cx, cy, 92, 0, Math.PI * 2);
    ctx.stroke();
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const r0 = k % 3 === 0 ? 72 : 80;
      line(k % 3 === 0 ? 0.8 : 0.5, k % 3 === 0 ? 3 : 2);
      ctx.beginPath();
      ctx.moveTo(cx + Math.sin(a) * r0, cy - Math.cos(a) * r0);
      ctx.lineTo(cx + Math.sin(a) * 88, cy - Math.cos(a) * 88);
      ctx.stroke();
    }
    const hand = (turn: number, length: number, width: number) => {
      const a = turn * Math.PI * 2;
      line(0.95, width);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.sin(a) * length, cy - Math.cos(a) * length);
      ctx.stroke();
    };
    hand(hour / 12, 48, 4);
    hand(minute / 60, 74, 2.5);
    if (flag) {
      // The flag, raised by the minute hand as the hour runs out
      ctx.fillStyle = 'rgba(200, 218, 248, 0.7)';
      ctx.beginPath();
      ctx.moveTo(cx + 6, cy - 88);
      ctx.lineTo(cx + 26, cy - 80);
      ctx.lineTo(cx + 8, cy - 70);
      ctx.closePath();
      ctx.fill();
    }
  };
  dial(246, 280, 4.9, 55, true);
  dial(522, 280, 5.3, 18, false);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
};

// The rim's engraving: the board's coordinates cut into the bezel, facing out
// to whoever sits at that side, each letter or number where its file or rank
// meets the rim: files a–e along White's and Black's sides, ranks 1–5 along
// the others. Black's seat walks round the board, so the rim turns with it.
export const ENGRAVE_IN = APERTURE + 0.12;
export const ENGRAVE_OUT = ENGRAVE_IN + 0.52;
const ENGRAVE_AT = (ENGRAVE_IN + ENGRAVE_OUT) / 2;

export const engraving = (orientation: Orientation): CanvasTexture => {
  const W = 4096;
  const H = 64;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  // The angle round the table of a point on the rim, 0 at +z, toward +x
  const angleOf = (x: number, z: number) => Math.atan2(x, z);
  const place: { text: string; angle: number }[] = [];
  const half = (GRID_SIZE - 1) / 2;
  for (let i = 0; i < GRID_SIZE; i++) {
    const flip = orientation === 'white' ? i : GRID_SIZE - 1 - i;
    // Files: world x of file i; the rank-1 side lies toward +z for White
    const x = (flip - half) * FRAME.pitch;
    const zNear = Math.sqrt(ENGRAVE_AT ** 2 - x * x);
    const file = 'abcde'[i];
    place.push({ text: file, angle: angleOf(x, zNear) });
    place.push({ text: file, angle: angleOf(x, -zNear) });
    // Ranks: world z of rank i
    const z = (half - flip) * FRAME.pitch;
    const xSide = Math.sqrt(ENGRAVE_AT ** 2 - z * z);
    place.push({ text: String(i + 1), angle: angleOf(xSide, z) });
    place.push({ text: String(i + 1), angle: angleOf(-xSide, z) });
  }
  const draw = () => {
    ctx.clearRect(0, 0, W, H);
    // Two fine engraved lines, and the letters between them (up toward the
    // table's centre, so they face whoever sits at that side)
    ctx.fillStyle = 'rgba(210, 222, 245, 0.5)';
    ctx.fillRect(0, 3, W, 2);
    ctx.fillRect(0, H - 5, W, 2);
    ctx.font = '500 36px "Space Grotesk", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const { text, angle } of place) {
      // The rank numbers at half strength: from the opening view they sit
      // near the board's own rank labels, which lead
      ctx.fillStyle = /\d/.test(text) ? 'rgba(220, 230, 250, 0.45)' : 'rgba(220, 230, 250, 1)';
      const u = (((angle / (Math.PI * 2)) % 1) + 1) % 1;
      for (const dx of [0, -W, W]) ctx.fillText(text, u * W + dx, H / 2 + 2);
    }
    // Small ticks between the coordinates round the rest of the rim
    ctx.fillStyle = 'rgba(220, 230, 250, 0.8)';
    for (let k = 0; k < 120; k++) {
      const u = k / 120;
      const clear = place.every(({ angle }) => {
        const d = Math.abs(((((angle / (Math.PI * 2) - u) % 1) + 1.5) % 1) - 0.5);
        return d > 0.012;
      });
      if (clear) ctx.fillRect(u * W - 1, H / 2 - 5, 2, 10);
    }
  };
  draw();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 8;
  if (typeof document !== 'undefined' && document.fonts?.load) {
    const redraw = () => {
      draw();
      t.needsUpdate = true;
    };
    document.fonts.load('500 36px "Space Grotesk"').then(redraw, redraw);
  }
  return t;
};
