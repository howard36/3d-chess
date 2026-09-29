import { CanvasTexture, SRGBColorSpace } from 'three';
import type { Texture } from 'three';

// A procedural sprite drawn on a 2D canvas (no image assets to ship or
// fetch), and the seeded random numbers procedural scenery is built from.

/** A soft round dot, white on transparent: the sprite for glowing particles. */
export const dotTexture = (softness = 0.5, size = 64): Texture => {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(Math.max(0.01, 1 - softness), 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
};

// A small deterministic PRNG, so procedural scenery looks the same on every
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
