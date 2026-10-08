// Colour helpers for colour-coding the five levels, in OKLCH (a perceptual
// space where equal steps of hue look like equal steps) and Okhsv, its
// hue-saturation-value form. One OKLCH chroma does not look equally vivid
// in every hue: a screen's cyan peaks near chroma 0.15, its blue near 0.31,
// so the same chroma is a cyan at full strength and a pastel blue. Okhsv's
// saturation measures a colour against the strongest its hue can be, so one
// saturation looks equally vivid in every hue. Pure, so the ramps can be
// tested (and picked) without WebGL.

interface Oklch {
  /** Lightness, 0 (black) to 1 (white). */
  l: number;
  /** Chroma: 0 is grey; sRGB reaches about 0.37 at most. */
  c: number;
  /** Hue, degrees. */
  h: number;
}

const DEG = Math.PI / 180;

/** Linear sRGB of an OKLCH colour (out-of-gamut channels are left outside 0–1). */
const oklchToLinear = ({ l, c, h }: Oklch): [number, number, number] => {
  const a = c * Math.cos(h * DEG);
  const b = c * Math.sin(h * DEG);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
};

const inGamut = (rgb: number[]) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

const encode = (v: number) => {
  const x = Math.min(Math.max(v, 0), 1);
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
};
const decode = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/**
 * The sRGB hex of an OKLCH colour. A colour sRGB cannot show keeps its
 * lightness and hue and loses only as much chroma as it must.
 */
export const oklchToHex = (color: Oklch): string => {
  let rgb = oklchToLinear(color);
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = color.c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ ...color, c: mid }))) lo = mid;
      else hi = mid;
    }
    rgb = oklchToLinear({ ...color, c: lo });
  }
  return `#${rgb
    .map((v) =>
      Math.round(encode(v) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
};

/** The OKLCH coordinates of an sRGB hex colour ('#rrggbb'). */
export const hexToOklch = (hex: string): Oklch => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => decode(v / 255));
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const l = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const h = (Math.atan2(bb, a) / DEG + 360) % 360;
  return { l, c: Math.hypot(a, bb), h };
};

// Okhsv (Björn Ottosson's), on a cusp found by search: for a hue, the
// lightness and chroma of its strongest colour sRGB can show.

const inside = (c: number[]) => c.every((v) => v >= -1e-6 && v <= 1 + 1e-6);

/** The most chroma sRGB can show at a lightness and hue. */
const maxChroma = (l: number, h: number) => {
  let lo = 0;
  let hi = 0.5;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (inside(oklchToLinear({ l, c: mid, h }))) lo = mid;
    else hi = mid;
  }
  return lo;
};

/** A hue's cusp: the lightness at which it reaches its most chroma, and that chroma. */
const cusp = (h: number) => {
  let a = 0.2;
  let b = 0.999;
  for (let i = 0; i < 40; i++) {
    const m1 = a + (b - a) / 3;
    const m2 = b - (b - a) / 3;
    if (maxChroma(m1, h) < maxChroma(m2, h)) a = m1;
    else b = m2;
  }
  const l = (a + b) / 2;
  return { l, c: maxChroma(l, h) };
};

const K1 = 0.206;
const K2 = 0.03;
const K3 = (1 + K1) / (1 + K2);
const toe = (x: number) => 0.5 * (K3 * x - K1 + Math.sqrt((K3 * x - K1) ** 2 + 4 * K2 * K3 * x));
const toeInv = (x: number) => (x * x + K1 * x) / (K3 * (x + K2));

/** The triangle under a hue's cusp, and the scale Okhsv's value takes from it. */
const okhsvFrame = (h: number) => {
  const { l, c } = cusp(h);
  const sMax = c / l;
  const tMax = c / (1 - l);
  return { tMax, k: 1 - 0.5 / sMax };
};
const valueScale = (h: number, lv: number, cv: number) => {
  const lvt = toeInv(lv);
  const cvt = (cv * lvt) / lv;
  const rgb = oklchToLinear({ l: lvt, c: cvt, h });
  return Math.cbrt(1 / Math.max(rgb[0], rgb[1], rgb[2], 0));
};

/** OKLCH of an Okhsv colour: hue in degrees, saturation and value 0 to 1. */
export const okhsvToOklch = (hue: number, s: number, v: number): Oklch => {
  const h = ((hue % 360) + 360) % 360;
  const { tMax, k } = okhsvFrame(h);
  const lv = 1 - (s * 0.5) / (0.5 + tMax - tMax * k * s);
  const cv = (s * tMax * 0.5) / (0.5 + tMax - tMax * k * s);
  const l = toeInv(v * lv);
  const c = (v * cv * l) / (v * lv);
  const scale = valueScale(h, lv, cv);
  return { l: l * scale, c: c * scale, h };
};

/** The Okhsv saturation and value of an OKLCH colour. */
export const oklchToOkhsv = ({ l, c, h }: Oklch) => {
  const { tMax, k } = okhsvFrame(h);
  const t = tMax / (c + l * tMax);
  const lv = t * l;
  const cv = t * c;
  const scale = valueScale(h, lv, cv);
  const ls = l / scale;
  return { s: ((0.5 + tMax) * cv) / (tMax * 0.5 + tMax * k * cv), v: toe(ls) / lv };
};

/**
 * The five level colours, A to E: hues stepping evenly from `from` to `to`
 * (OKLCH degrees, the way given: 355 → 230 passes through violet, 20 → 260
 * through yellow and green), all of one Okhsv saturation and value, so they
 * look equally vivid. A hue whose colour would fall below `minLightness`
 * (a blue or violet, strong only when dark) keeps that lightness and as much
 * of the saturation as sRGB allows there.
 */
export const levelRamp = ({
  from,
  to,
  saturation,
  value,
  minLightness,
}: {
  from: number;
  to: number;
  saturation: number;
  value: number;
  minLightness: number;
}): string[] =>
  Array.from({ length: 5 }, (_, i) => {
    const color = okhsvToOklch(from + ((to - from) * i) / 4, saturation, value);
    if (color.l >= minLightness) return oklchToHex(color);
    // At the floor: the chroma that reaches the saturation, or sRGB's most
    const l = minLightness;
    let lo = 0;
    let hi = maxChroma(l, color.h) * 0.999;
    if (oklchToOkhsv({ l, c: hi, h: color.h }).s >= saturation) {
      for (let k = 0; k < 32; k++) {
        const mid = (lo + hi) / 2;
        if (oklchToOkhsv({ l, c: mid, h: color.h }).s < saturation) lo = mid;
        else hi = mid;
      }
    }
    return oklchToHex({ l, c: hi, h: color.h });
  });
