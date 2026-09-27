// Colour helpers for colour-coding the five levels, in OKLCH: a perceptual
// space where equal steps of hue look like equal steps, and a lightness and
// chroma held constant keep every colour equally bright and equally vivid.
// Pure, so the ramps can be tested (and picked) without WebGL.

export interface Oklch {
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

export interface LevelRampOptions {
  /**
   * Hue of level A and of level E (OKLCH degrees). The ramp runs from one to
   * the other the way given: 20 → 260 passes through yellow and green, 20 →
   * -100 through magenta.
   */
  from: number;
  to: number;
  /** OKLCH lightness of every level, or of A and E with the rest in between (default 0.72). */
  lightness?: number | [number, number];
  /** OKLCH chroma (default 0.13); a colour sRGB cannot show loses only what it must. */
  chroma?: number;
  /** How many colours (default 5, one per level). */
  count?: number;
}

/**
 * Evenly spaced colours for the levels, A to E: real colours of one
 * lightness and vividness, stepping in equal perceptual steps of hue, with
 * no white or grey among them. Hand them to LevelPlates (tints, edgeColors),
 * LevelGrid (colors), SmartLabels (levelColors), LevelFootprint or LevelBand,
 * so every part says a level in the same colour.
 */
export const levelRamp = ({
  from,
  to,
  lightness = 0.72,
  chroma = 0.13,
  count = 5,
}: LevelRampOptions): string[] => {
  const [l0, l1] = typeof lightness === 'number' ? [lightness, lightness] : lightness;
  return Array.from({ length: count }, (_, i) => {
    const k = count === 1 ? 0 : i / (count - 1);
    return oklchToHex({ l: l0 + (l1 - l0) * k, c: chroma, h: from + (to - from) * k });
  });
};
