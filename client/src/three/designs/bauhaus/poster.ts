import { CanvasTexture, SRGBColorSpace } from 'three';
import type { Texture } from 'three';
import { rng } from '../kit/textures';
import { BLUE, INK, PAPER, RED, YELLOW } from './pieces';

// The backdrop is a printed poster, drawn in screen space so it holds still
// while the board turns in front of it. Shapes are laid out from the edges
// (in units of the poster's height), leaving the middle clear for the board,
// and overprint one another the way riso inks do.

export const FONT = '"Josefin Sans", "Futura", sans-serif';

let grain: HTMLCanvasElement | null = null;
const grainTile = () => {
  if (grain) return grain;
  const size = 160;
  grain = document.createElement('canvas');
  grain.width = grain.height = size;
  const ctx = grain.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const random = rng(19);
  for (let i = 0; i < size * size; i++) {
    const v = random();
    const dark = v < 0.5;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = dark ? 40 : 255;
    img.data[i * 4 + 3] = Math.floor(Math.abs(v - 0.5) * 2 * 70);
  }
  ctx.putImageData(img, 0, 0);
  return grain;
};

export const drawPoster = (w: number, h: number, withType: boolean): Texture => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const u = h / 100;

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);

  ctx.globalCompositeOperation = 'multiply';
  // Red sun, top right, cropped by the edge
  ctx.fillStyle = RED;
  ctx.beginPath();
  ctx.arc(w - 13 * u, 30 * u, 27 * u, 0, Math.PI * 2);
  ctx.fill();
  // Blue quarter disc in the bottom-left corner
  ctx.fillStyle = BLUE;
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.arc(0, h, 44 * u, -Math.PI / 2, 0);
  ctx.closePath();
  ctx.fill();
  // Yellow column, overprinting the blue
  ctx.fillStyle = YELLOW;
  ctx.fillRect(17 * u, 10 * u, 8 * u, 90 * u);
  // Yellow half disc, bottom right
  ctx.beginPath();
  ctx.arc(w - 30 * u, h, 13 * u, Math.PI, 0);
  ctx.fill();

  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = INK;
  // A heavy rule through the red sun and a thin one crossing it
  ctx.fillRect(w - 44 * u, 58 * u, 44 * u, 2.2 * u);
  ctx.fillRect(w - 38 * u, 6 * u, 0.35 * u, 80 * u);
  // A black triangle perched on the rule
  ctx.beginPath();
  ctx.moveTo(w - 22 * u, 58 * u);
  ctx.lineTo(w - 12 * u, 58 * u);
  ctx.lineTo(w - 17 * u, 49.5 * u);
  ctx.closePath();
  ctx.fill();
  // A thin rule across the left band, a black disc riding it
  ctx.fillRect(0, 31 * u, 40 * u, 0.35 * u);
  ctx.beginPath();
  ctx.arc(34 * u, 26.5 * u, 4.4 * u, 0, Math.PI * 2);
  ctx.fill();

  if (withType) {
    // Vertical title up the left edge
    ctx.save();
    ctx.translate(12.2 * u, 88 * u);
    ctx.rotate(-Math.PI / 2);
    ctx.font = `700 ${7.2 * u}px ${FONT}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = INK;
    ctx.fillText('RAUMSCHACH', 0, 0);
    ctx.restore();
    // Caption block under the heavy rule
    ctx.font = `700 ${2.6 * u}px ${FONT}`;
    ctx.fillStyle = INK;
    ctx.textAlign = 'right';
    ctx.fillText('SPIEL IM RAUM', w - 3 * u, 65 * u);
    ctx.font = `400 ${2.2 * u}px ${FONT}`;
    ctx.fillText('5 × 5 × 5 — 125 FELDER', w - 3 * u, 68.8 * u);
    ctx.fillText('NACH F. MAACK, 1907', w - 3 * u, 72.2 * u);
  }

  // Paper grain over everything
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = ctx.createPattern(grainTile(), 'repeat')!;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;

  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
};
