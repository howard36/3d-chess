import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/700.css';
import '@fontsource/cormorant-garamond/600-italic.css';
import '@fontsource/shippori-mincho/latin-500.css';
import '@fontsource/shippori-mincho/latin-700.css';
import '@fontsource/shippori-mincho/latin-800.css';
import cormorant600 from '@fontsource/cormorant-garamond/files/cormorant-garamond-latin-600-normal.woff2';
import cormorant700 from '@fontsource/cormorant-garamond/files/cormorant-garamond-latin-700-normal.woff2';
import shippori600 from '@fontsource/shippori-mincho/files/shippori-mincho-latin-600-normal.woff2';
import shippori700 from '@fontsource/shippori-mincho/files/shippori-mincho-latin-700-normal.woff2';
import type { DesignHud } from '../types';
import { MOVE, PANEL, RULE, SEAL, TEXT, TEXT_MUTED } from './palette';

// The HUD as slips of night paper: dark indigo panels ruled twice in silver,
// Cormorant and Shippori Mincho in silver ink, a single silver brush stroke
// under the turn with a small crescent moon at its start, and a vermilion
// hanko pressed on the result card.

// Cormorant is drawn small for its size; the HUD's small print is 12-13 px.
// Nocturne registers its own face, 15% larger and never lighter than
// semibold, so that print holds up in light type on a dark ground. Its
// figures are old-style (a "1" reads as a capital I), so the face takes its
// digits from Shippori Mincho's lining figures instead.
const FAMILY = 'Nocturne Cormorant';
const DIGITS = 'U+0030-0039';
const NOT_DIGITS = 'U+0000-002F, U+003A-FFFF';
if (typeof document !== 'undefined' && document.fonts && typeof FontFace !== 'undefined') {
  const faces: [string, string, string, string][] = [
    ['600', cormorant600, '115%', NOT_DIGITS],
    ['700', cormorant700, '115%', NOT_DIGITS],
    ['600', shippori600, '96%', DIGITS],
    ['700', shippori700, '96%', DIGITS],
  ];
  for (const [weight, url, sizeAdjust, unicodeRange] of faces) {
    const face = new FontFace(FAMILY, `url(${url}) format('woff2')`, {
      weight,
      sizeAdjust,
      unicodeRange,
    } as FontFaceDescriptors);
    document.fonts.add(face);
    face.load().catch(() => undefined);
  }
}

const svg = (body: string, viewBox: string, extra = '') =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${viewBox}' ${extra}>${body}</svg>`,
  )}")`;

/** A single tapered brush stroke in silver, loaded at the left and lifting off to the right. */
const brushStroke = (color: string) =>
  svg(
    `<path d='M3 5.2 C 30 2.6, 90 2.2, 150 3.4 S 190 4.6, 198 5.4 C 186 6.4, 150 6.6, 100 7.2 S 22 9.4, 4 8.4 C 1.6 7.8, 1.4 6, 3 5.2 Z' fill='${color}'/>`,
    '0 0 200 11',
    "preserveAspectRatio='none'",
  );

/** A large open ensō, brushed in one stroke with a dry tail. */
const enso = (color: string) =>
  svg(
    `<path d='M28 34 C 44 12, 82 8, 104 26 C 126 44, 124 84, 100 104 C 76 122, 36 118, 20 94 C 10 78, 12 58, 18 46' fill='none' stroke='${color}' stroke-width='9' stroke-linecap='round'/>`,
    '0 0 130 130',
  );

/** A small crescent moon. */
const crescent = (color: string) =>
  svg(`<path d='M13 2 A 10 10 0 1 0 22 16 A 8 8 0 1 1 13 2 Z' fill='${color}'/>`, '0 0 24 24');

/**
 * A hanko: a vermilion square seal with 月 ("moon") cut in it, its ink thin
 * where the stamp did not bite, pressed a few degrees askew.
 */
const hanko = svg(
  `<defs><filter id='b' x='0' y='0' width='100%' height='100%'>` +
    `<feTurbulence type='fractalNoise' baseFrequency='0.08' numOctaves='2' seed='4'/>` +
    `<feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -14 10.2'/>` +
    `<feComposite in='SourceGraphic' operator='in'/></filter></defs>` +
    `<g transform='rotate(-4 50 50)'><g filter='url(#b)'>` +
    `<rect x='5' y='5' width='90' height='90' rx='9' fill='${SEAL}'/>` +
    `<g fill='#10131f'>` +
    `<path d='M30 20 H 70 V 80 Q 70 86 62 86 H 55 V 77 H 60 V 30 H 40 V 60 Q 40 78 28 86 L 22 79 Q 30 72 30 58 Z'/>` +
    `<rect x='40' y='42' width='20' height='8'/>` +
    `<rect x='40' y='58' width='20' height='8'/>` +
    `</g></g></g>`,
  '0 0 100 100',
);

/** A fine silver tooth over the whole screen: the scene reads as painted on night paper. */
const grain = svg(
  `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/>` +
    `<feColorMatrix values='0 0 0 0 0.78  0 0 0 0 0.82  0 0 0 0 0.92  0 0 0 0.4 -0.2'/></filter>` +
    `<rect width='100%' height='100%' filter='url(#n)'/>`,
  '0 0 240 240',
);

const FONT = `"${FAMILY}", "Cormorant Garamond", "Shippori Mincho", Georgia, serif`;
const MONO = '"Shippori Mincho", "Cormorant Garamond", Georgia, serif';
const DOUBLE_RULE = `0 0 0 1px ${RULE} inset, 0 0 0 4px rgba(13, 16, 30, 0.6) inset, 0 0 0 5px rgba(190, 201, 224, 0.1) inset`;

export const hud: DesignHud = {
  // "Cc4 · White Bishop" under the turn chip, for the square under the pointer
  readout: true,
  vars: {
    '--hud-font': FONT,
    '--hud-mono': MONO,
    '--hud-bg': PANEL,
    '--hud-fg': TEXT,
    '--hud-muted': TEXT_MUTED,
    '--hud-accent': MOVE,
    '--hud-accent-fg': '#0b0e1a',
    '--hud-border': '1px solid transparent',
    '--hud-radius': '2px',
    '--hud-shadow': `${DOUBLE_RULE}, 0 10px 28px rgba(0, 0, 0, 0.45)`,
    '--hud-blur': 'blur(4px)',
    '--hud-tracking': '0.03em',
    '--turn-bg': `${crescent('#e8b75a')} no-repeat left 5px center / 10px 10px, ${brushStroke('rgba(214, 222, 238, 0.85)')} no-repeat center bottom 5px / calc(100% - 34px) 6px, ${PANEL}`,
    '--turn-fg': TEXT,
    '--turn-size': '21px',
    '--turn-border': '1px solid transparent',
    '--turn-shadow': `${DOUBLE_RULE}, 0 10px 28px rgba(0, 0, 0, 0.45)`,
    // Dialogs (promotion, result) on night paper
    '--modal-bg': `radial-gradient(ellipse at 28% 10%, #1d2442 0%, #0d1020 100%)`,
    // The result card: a large title in silver, under a faint brushed ensō
    // (a full moon) and sealed in its top-right corner like a letter
    '--result-bg': `${hanko} no-repeat right 8px top 8px / 48px 48px, ${enso('rgba(214, 222, 238, 0.13)')} no-repeat center 30% / 190px 190px, radial-gradient(ellipse at 28% 10%, #1d2442 0%, #0d1020 100%)`,
    '--result-title-size': '30px',
    '--modal-fg': TEXT,
    '--modal-radius': '2px',
    '--modal-shadow': `${DOUBLE_RULE}, 0 24px 60px rgba(0, 0, 0, 0.6)`,
    '--modal-backdrop': 'rgba(3, 4, 10, 0.5)',
    '--button-bg': '#d3dbea',
    '--button-fg': '#0b0e1a',
    '--button-border': '1px solid #d3dbea',
    '--button-radius': '2px',
    '--page-bg': 'radial-gradient(ellipse at 50% 30%, #1a2140 0%, #0b0f1f 60%, #05070e 100%)',
    '--page-fg': TEXT,
  },
  overlay: {
    background: `radial-gradient(ellipse at 50% 48%, transparent 58%, rgba(2, 3, 9, 0.42) 100%), ${grain} repeat 0 0 / 240px 240px`,
    opacity: 0.6,
  },
};
