import { CanvasTexture, LinearMipmapLinearFilter, NoColorSpace } from 'three';
import type { Texture } from 'three';
import { fbm, rng } from '../kit/textures';

// The planet below the station, as seen from it: a map of every direction
// from the nadir out to the limb (an azimuthal map, even in angle, so a
// degree of view gets the same texels whether it looks straight down or
// skims the horizon), holding the night side in three channels:
//
//   red    city lights: clustered along coasts, strung together by roads
//   green  cloud, faintly moonlit
//   blue   land (the rest is ocean)
//
// The land and cloud are computed on the planet's surface and projected
// into the map, so near the limb they flatten as a sphere's would. Built
// once, on a 2D canvas: the sky shader only samples it.

const DEG = Math.PI / 180;

/** How far the planet's limb sits below the horizontal, seen from the station. */
export const LIMB_DIP = 21 * DEG;
/** The station's distance from the planet's centre, in planet radii. */
export const PLANET_DISTANCE = 1 / Math.cos(LIMB_DIP);
/** Angle from straight down to the limb: the map's radius. */
export const MAP_REACH = Math.PI / 2 - LIMB_DIP;

const SIZE = 2048;
const FIELD = 512;

/** The surface point (planet centre at the origin, unit radius) a view direction lands on, or null. */
const surfaceHit = (dx: number, dy: number, dz: number): [number, number, number] | null => {
  const b = PLANET_DISTANCE * dy;
  const disc = b * b - (PLANET_DISTANCE * PLANET_DISTANCE - 1);
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t <= 0) return null;
  return [dx * t, PLANET_DISTANCE + dy * t, dz * t];
};

/** The view direction through map texel (u, v) in 0–1, or null past the limb. */
const directionAt = (u: number, v: number): [number, number, number] | null => {
  const x = u * 2 - 1;
  const y = v * 2 - 1;
  const r = Math.hypot(x, y);
  if (r >= 1) return null;
  const beta = r * MAP_REACH;
  const az = Math.atan2(y, x);
  const s = Math.sin(beta);
  return [s * Math.cos(az), -Math.cos(beta), s * Math.sin(az)];
};

/** Half the width of the visible cap of the surface (the limb is LIMB_DIP round from the nadir). */
const SURFACE_SPAN = Math.sin(LIMB_DIP);

/**
 * 2D gradient noise (Perlin's), about -0.7 to 0.7: smooth and free of the
 * square cells value noise shows at coarse scales.
 */
const gradientNoise = (seed: number) => {
  const random = rng(seed);
  const perm = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  const p = [...perm, ...perm];
  const gx = Array.from({ length: 16 }, (_, k) => Math.cos((k * Math.PI) / 8));
  const gy = Array.from({ length: 16 }, (_, k) => Math.sin((k * Math.PI) / 8));
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;
    const dot = (h: number, dx: number, dy: number) => gx[h & 15] * dx + gy[h & 15] * dy;
    const aa = dot(p[p[X] + Y], xf, yf);
    const ba = dot(p[p[X + 1] + Y], xf - 1, yf);
    const ab = dot(p[p[X] + Y + 1], xf, yf - 1);
    const bb = dot(p[p[X + 1] + Y + 1], xf - 1, yf - 1);
    const u = fade(xf);
    const v = fade(yf);
    const top = aa + (ba - aa) * u;
    const bottom = ab + (bb - ab) * u;
    return top + (bottom - top) * v;
  };
};

/** Fractal gradient noise, about -1 to 1, each octave turned so no grid lines up. */
const fractal = (seed: number, octaves: number) => {
  const noise = gradientNoise(seed);
  const turns = Array.from({ length: octaves }, (_, o) => [Math.cos(o * 1.7), Math.sin(o * 1.7)]);
  const norm = 1 / (2 - 0.5 ** (octaves - 1));
  return (x: number, y: number) => {
    let sum = 0;
    let amp = 1;
    let f = 1;
    for (let o = 0; o < octaves; o++) {
      const [c, s] = turns[o];
      sum += noise((x * c - y * s) * f + o * 17.3, (x * s + y * c) * f - o * 9.1) * amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return sum * norm * 1.6;
  };
};

let cached: Texture | null = null;

/**
 * Builds the planet map when the browser is next idle (it takes a few
 * hundred milliseconds), so the sky is usually ready before it is drawn.
 */
export const preloadPlanetMap = () => {
  if (typeof window === 'undefined' || typeof window.requestIdleCallback !== 'function') return;
  window.requestIdleCallback(() => planetMap(), { timeout: 3000 });
};

/** The planet map (see above). Shared; never dispose it. */
export const planetMap = (): Texture => {
  if (cached) return cached;
  const land = fractal(11, 7);
  const warpA = fractal(23, 3);
  const warpB = fractal(31, 3);
  const cloud = fractal(29, 6);
  const people = fbm(47, 6, 3);
  // Surface coordinates across the visible cap, spread out round the nadir
  // (so the view straight down finds as much going on as the view toward
  // the limb, where the surface is foreshortened anyway)
  const surf = (s: [number, number, number]) => {
    const x = s[0] / SURFACE_SPAN;
    const z = s[2] / SURFACE_SPAN;
    // Stretched 3.5 times at the nadir, easing to 0.3 at the limb
    const k = 1.4 / (Math.hypot(x, z) + 0.4);
    return [x * k * 3, z * k * 3];
  };
  // Continents: warped fractal noise, cut at a sea level that leaves about a
  // third land, the coast passing close by the nadir
  const landValue = (n: number[]) => {
    const wx = n[0] + 0.45 * warpA(n[0] * 0.8, n[1] * 0.8);
    const wy = n[1] + 0.45 * warpB(n[0] * 0.8, n[1] * 0.8);
    return land(wx * 0.9, wy * 0.9);
  };
  const seaLevel = landValue([0.06, -0.04]);
  const landAt = (n: number[]) => Math.min(Math.max((landValue(n) - seaLevel) / 0.035, 0), 1);

  // --- The field: land and cloud, per texel -----------------------------------
  const field = document.createElement('canvas');
  field.width = field.height = FIELD;
  const fctx = field.getContext('2d')!;
  const img = fctx.createImageData(FIELD, FIELD);
  const landGrid = new Float32Array(FIELD * FIELD);
  for (let j = 0; j < FIELD; j++) {
    for (let i = 0; i < FIELD; i++) {
      const o = j * FIELD + i;
      img.data[o * 4 + 3] = 255;
      const d = directionAt((i + 0.5) / FIELD, (j + 0.5) / FIELD);
      const s = d && surfaceHit(d[0], d[1], d[2]);
      if (!s) continue;
      const n = surf(s);
      const l = landAt(n);
      landGrid[o] = l;
      // Weather: long swirled bands of cloud, broken up
      const c = cloud(n[0] * 1.1 + 0.6 * warpB(n[1], n[0]), n[1] * 2.2 + 0.6 * warpA(n[1], n[0]));
      const cl = Math.min(Math.max((c - 0.05) / 0.5, 0), 1) ** 1.4;
      img.data[o * 4 + 1] = Math.round(cl * 255);
      img.data[o * 4 + 2] = Math.round(l * 255);
    }
  }
  fctx.putImageData(img, 0, 0);

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(field, 0, 0, SIZE, SIZE);

  // --- City lights -----------------------------------------------------------
  // Pin-points, not blobs: each city a small bright core in a scatter of
  // fainter lights, clustered on the coasts and the populous parts of each
  // land, flattened along the line of sight toward the limb.
  ctx.globalCompositeOperation = 'lighter';
  const random = rng(5);
  const landAtTexel = (u: number, v: number) => {
    const i = Math.min(FIELD - 1, Math.max(0, Math.floor(u * FIELD)));
    const j = Math.min(FIELD - 1, Math.max(0, Math.floor(v * FIELD)));
    return landGrid[j * FIELD + i];
  };
  // How much the surface is foreshortened at a texel (1 face-on, 0 at the limb)
  const facing = (u: number, v: number) => {
    const d = directionAt(u, v);
    const s = d && surfaceHit(d[0], d[1], d[2]);
    if (!d || !s) return 0;
    return Math.max(0, -(s[0] * d[0] + s[1] * d[1] + s[2] * d[2]));
  };
  const light = (x: number, y: number, radius: number, alpha: number) => {
    ctx.fillStyle = `rgba(255,0,0,${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  };

  let placed = 0;
  for (let k = 0; k < 40000 && placed < 2000; k++) {
    // Even in view angle: as many lights to a degree of view anywhere
    const r = Math.sqrt(random()) * 0.985;
    const a = random() * Math.PI * 2;
    const u = 0.5 + 0.5 * r * Math.cos(a);
    const v = 0.5 + 0.5 * r * Math.sin(a);
    if (landAtTexel(u, v) <= 0.3) continue;
    const step = 0.005;
    const nearCoast =
      landAtTexel(u + step, v) < 0.5 ||
      landAtTexel(u - step, v) < 0.5 ||
      landAtTexel(u, v + step) < 0.5 ||
      landAtTexel(u, v - step) < 0.5;
    const p = people(u, v);
    const chance = (nearCoast ? 0.85 : 0.1) * Math.min(1, Math.max(0, (p - 0.4) / 0.25));
    if (random() > chance) continue;
    placed++;
    const x = u * SIZE;
    const y = v * SIZE;
    const f = facing(u, v);
    const size = random() ** 4;
    // Along the line of sight (radial in the map) the city is flattened
    const radial = [Math.cos(a), Math.sin(a)];
    const across = [-radial[1], radial[0]];
    light(x, y, 0.7 + size * 1.3, 0.45 + size * 0.5);
    const scatter = 2 + Math.floor(size * 26);
    for (let n = 0; n < scatter; n++) {
      const spread = (1.5 + size * 7) * Math.sqrt(random());
      const t = random() * Math.PI * 2;
      const ox = Math.cos(t) * spread;
      const oy = Math.sin(t) * spread;
      light(
        x + (radial[0] * ox * Math.max(f, 0.15) + across[0] * oy),
        y + (radial[1] * ox * Math.max(f, 0.15) + across[1] * oy),
        0.45 + random() * 0.4,
        0.18 + random() * 0.3,
      );
    }
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = NoColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  cached = texture;
  return texture;
};
