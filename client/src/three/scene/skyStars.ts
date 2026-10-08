import { Color } from 'three';
import { rng } from './textures';
import { PALETTE, SKY_DETAIL } from './palette';
import { starBuffers } from './skyChart';
import { DEG, DOME, skyDirection } from './skyPlace';

// The richer field of stars (envPreview `stars: rich`). Nothing above about
// 33° is ever on screen, so every star is spent between 1° and 36°, even
// over the sky there; they come in a real spread of brightness: mostly a
// dust of faint points, a few hundred plain stars and about a dozen bright
// ones with a soft glow, each a pale colour (blue-white, white, pale gold, a
// rare pale orange), and a handful of doubles, a gold star with a blue
// companion among them. Low down they sink into the horizon's haze, and none
// of the bright ones stands near a constellation's stars, so the figures
// still read first.

export const RICH_FIELD = 3000;
/** Up to where the field reaches (degrees): a little past the highest sky on screen. */
const TOP = 36;
const BOTTOM = 1;

/** A brightness for a magnitude: 0 the brightest, 6.5 the faintest dust. */
const brightness = (m: number) => 0.8 * 10 ** (-0.18 * m);
/** A size (CSS px): the brightest about 3.6, everything past the third magnitude a dot. */
const sizeOf = (m: number) => 1.15 + 2.5 * Math.max(0, (2.8 - m) / 2.8) ** 1.4;

export interface FieldBuffers {
  pos: number[];
  size: number[];
  bright: number[];
  color: number[];
}

/**
 * The field, as buffers. `avoid` are directions (the constellations' stars)
 * no bright field star may stand near.
 */
export const richField = (avoid: readonly (readonly number[])[]): FieldBuffers => {
  const random = rng(97);
  const out: FieldBuffers = { pos: [], size: [], bright: [], color: [] };
  const tints = [
    { c: new Color(SKY_DETAIL.starWhite), p: 0.6 },
    { c: new Color(SKY_DETAIL.starBlue), p: 0.2 },
    { c: new Color(SKY_DETAIL.starGold), p: 0.16 },
    { c: new Color(SKY_DETAIL.starOrange), p: 0.04 },
  ];
  const tint = () => {
    let u = random();
    for (const t of tints) if ((u -= t.p) <= 0) return t.c;
    return tints[0].c;
  };
  // Magnitudes from a rising count, as a real sky's: e^(k m) on [0, 6.5]
  const k = 0.8;
  const span = Math.exp(k * 6.5) - 1;
  const lo = Math.sin(BOTTOM * DEG);
  const hi = Math.sin(TOP * DEG);
  // The figures' stars and their lengths, once (angleBetween's, so the
  // angles come out the same to the last bit)
  const flat = Float64Array.from(avoid.flatMap((a) => [a[0], a[1], a[2]]));
  const avoidLength = Float64Array.from(avoid, (a) => Math.hypot(a[0], a[1], a[2]));
  /**
   * The angle to the nearest figure's star (degrees): angleBetween's, but
   * the arc cosine taken once, of the nearest's cosine (it falls as the
   * cosine rises, so the least angle is the greatest cosine's), as a page
   * load waits on this for every star.
   */
  const nearest = (dir: readonly number[]) => {
    const la = Math.hypot(dir[0], dir[1], dir[2]);
    let most = -Infinity;
    for (let i = 0; i < avoidLength.length; i++) {
      const j = i * 3;
      const d =
        (dir[0] * flat[j] + dir[1] * flat[j + 1] + dir[2] * flat[j + 2]) / (la * avoidLength[i]);
      if (d > most) most = d;
    }
    return avoid.length ? Math.min(180, Math.acos(Math.min(1, Math.max(-1, most))) / DEG) : 180;
  };
  const push = (dir: number[], m: number, c: Color) => {
    const el = Math.asin(dir[1]) / DEG;
    // Into the haze low down: the faint first
    const haze = Math.min(Math.max((el - BOTTOM) / 9, 0), 1);
    let b = brightness(m) * (0.22 + 0.78 * haze ** (m > 3 ? 1.4 : 0.8));
    // Clear of the figures: within 2° of a constellation's star, only dust
    const near = nearest(dir);
    if (near < 2.2) b = Math.min(b, 0.07 + 0.03 * (near / 2.2));
    out.pos.push(dir[0] * DOME, dir[1] * DOME, dir[2] * DOME);
    out.size.push(near < 2.2 ? Math.min(sizeOf(m), 1.4) : sizeOf(m));
    out.bright.push(b);
    out.color.push(c.r, c.g, c.b);
  };
  const doubles: number[][] = [];
  for (let i = 0; i < RICH_FIELD; i++) {
    // Even over the sky between BOTTOM and TOP
    const y = lo + random() * (hi - lo);
    const az = random() * Math.PI * 2;
    const dir = skyDirection(az, Math.asin(y)).toArray();
    const m = Math.log(1 + random() * span) / k;
    // Bright ones carry their colour; dust is near white
    const c = m < 4 ? tint() : random() < 0.75 ? tints[0].c : tints[1].c;
    push(dir, m, c);
    if (m > 1.6 && m < 3.2 && doubles.length < 7 && random() < 0.08) doubles.push([...dir, m, i]);
  }
  // Doubles: a companion a few tenths of a degree off, fainter. The first
  // pair is gold and blue
  doubles.forEach(([x, y, z, m, at], i) => {
    const el = Math.asin(y);
    const az = Math.atan2(x, z);
    const off = (0.18 + random() * 0.16) * DEG;
    const turn = random() * Math.PI * 2;
    const dir = skyDirection(az + (Math.cos(turn) * off) / Math.cos(el), el + Math.sin(turn) * off);
    if (i === 0) out.color.splice(at * 3, 3, tints[2].c.r, tints[2].c.g, tints[2].c.b);
    push(dir.toArray(), m + 0.9 + random() * 0.8, i === 0 ? tints[1].c : tint());
  });
  return out;
};

/** The field's geometry. */
export const richFieldGeometry = (avoid: readonly (readonly number[])[]) => {
  const f = richField(avoid);
  return starBuffers(f.pos, f.size, f.bright, f.color);
};

/** The brightest stars of a field (for the stone's reflection), as geometry. */
export const brightestOf = (f: FieldBuffers, count: number) => {
  const order = f.bright.map((b, i) => [b, i]).sort((a, b) => b[0] - a[0]);
  const keep = order.slice(0, count).map(([, i]) => i);
  const pick = (list: number[], n: number) => keep.flatMap((i) => list.slice(i * n, i * n + n));
  return starBuffers(pick(f.pos, 3), pick(f.size, 1), pick(f.bright, 1), pick(f.color, 3));
};

/** Today's field (envPreview `stars: off`), as buffers: 900 stars even over the dome above 3°. */
export const todayField = (): FieldBuffers => {
  const random = rng(53);
  const out: FieldBuffers = { pos: [], size: [], bright: [], color: [] };
  const cool = new Color(PALETTE.neon);
  const warm = new Color(SKY_DETAIL.starWarm);
  for (let i = 0; i < 900; i++) {
    // Even over the dome above 3°
    const y = 0.05 + random() * 0.95;
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(1 - y * y);
    const low = Math.min((y - 0.05) / 0.2, 1);
    out.pos.push(Math.sin(a) * r * DOME, y * DOME, Math.cos(a) * r * DOME);
    out.size.push(1.2 + random() ** 3 * 1.4);
    out.bright.push((0.1 + random() ** 2.6 * 0.42) * (0.3 + 0.7 * low));
    const c = random() < 0.2 ? warm : cool;
    out.color.push(c.r, c.g, c.b);
  }
  return out;
};
