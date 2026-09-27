import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/700.css';
import '@fontsource/shippori-mincho/latin-500.css';
import '@fontsource/shippori-mincho/latin-700.css';
import '@fontsource/shippori-mincho/latin-800.css';
import cormorant600 from '@fontsource/cormorant-garamond/files/cormorant-garamond-latin-600-normal.woff2';
import cormorant700 from '@fontsource/cormorant-garamond/files/cormorant-garamond-latin-700-normal.woff2';
import type { DesignHud } from '../types';
import { INK, SEAL } from './palette';

// The HUD as a set of paper slips: warm washi panels ruled in ink, a serif
// set like a printed scroll, one vermilion brush stroke under the turn, and
// a hanko seal stamped over the result when the game ends.

// Cormorant is drawn small for its size (a low x-height), and the HUD sets
// its small print at 12–13 px. Sumi registers its own Cormorant face, scaled
// up 15% and never lighter than semibold, so that small print reads at about
// 15 px while the turn chip keeps its elegance.
const FAMILY = 'Sumi Cormorant';
if (typeof document !== 'undefined' && document.fonts && typeof FontFace !== 'undefined') {
  for (const [weight, url] of [
    ['600', cormorant600],
    ['700', cormorant700],
  ]) {
    const face = new FontFace(FAMILY, `url(${url}) format('woff2')`, {
      weight,
      sizeAdjust: '115%',
    } as FontFaceDescriptors);
    document.fonts.add(face);
    face.load().catch(() => undefined);
  }
}

const svg = (body: string, viewBox: string, extra = '') =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${viewBox}' ${extra}>${body}</svg>`,
  )}")`;

/** A single tapered brush stroke, loaded at the left and lifting off to the right. */
const brushStroke = (color: string) =>
  svg(
    `<path d='M3 5.2 C 30 2.6, 90 2.2, 150 3.4 S 190 4.6, 198 5.4 C 186 6.4, 150 6.6, 100 7.2 S 22 9.4, 4 8.4 C 1.6 7.8, 1.4 6, 3 5.2 Z' fill='${color}'/>`,
    '0 0 200 11',
    "preserveAspectRatio='none'",
  );

/**
 * A hanko: a vermilion square seal with 王 ("king") cut in white, its ink
 * thin in places where the stamp did not bite, pressed a few degrees askew
 * as a hand would.
 */
const hanko = svg(
  `<defs><filter id='b' x='0' y='0' width='100%' height='100%'>` +
    `<feTurbulence type='fractalNoise' baseFrequency='0.08' numOctaves='2' seed='11'/>` +
    `<feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -14 10.2'/>` +
    `<feComposite in='SourceGraphic' operator='in'/></filter></defs>` +
    `<g transform='rotate(5 50 50)'><g filter='url(#b)'>` +
    `<rect x='5' y='5' width='90' height='90' rx='9' fill='${SEAL}'/>` +
    `<g fill='#f6efe2'>` +
    `<rect x='24' y='22' width='52' height='9' rx='3'/>` +
    `<rect x='28' y='45' width='44' height='9' rx='3'/>` +
    `<rect x='19' y='69' width='62' height='10' rx='3'/>` +
    `<rect x='45.5' y='22' width='9' height='55' rx='2.5'/>` +
    `</g></g></g>`,
  '0 0 100 100',
);

/** Paper tooth for the whole screen: the scene reads as printed on washi. */
const grain = svg(
  `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/>` +
    `<feColorMatrix values='0 0 0 0 0.3  0 0 0 0 0.24  0 0 0 0 0.16  0 0 0 0.5 -0.19'/></filter>` +
    `<rect width='100%' height='100%' filter='url(#n)'/>`,
  '0 0 240 240',
);

const PANEL = 'rgba(250, 246, 237, 0.9)';
const RULE = 'rgba(33, 28, 25, 0.22)';
const FONT = `"${FAMILY}", "Cormorant Garamond", "Shippori Mincho", Georgia, serif`;
const MONO = '"Shippori Mincho", "Cormorant Garamond", Georgia, serif';

export const hud: DesignHud = {
  // "Cc4 · White Bishop" under the turn chip, for the square under the pointer
  readout: true,
  vars: {
    '--hud-font': FONT,
    '--hud-mono': MONO,
    '--hud-bg': PANEL,
    '--hud-fg': INK,
    '--hud-muted': 'rgba(33, 28, 25, 0.45)',
    '--hud-accent': INK,
    '--hud-accent-fg': '#fbf6ec',
    '--hud-border': `1px solid ${RULE}`,
    '--hud-radius': '2px',
    '--hud-shadow': '0 1px 0 rgba(255, 255, 255, 0.6) inset, 0 8px 22px rgba(74, 56, 36, 0.14)',
    '--hud-blur': 'blur(3px)',
    '--hud-tracking': '0.02em',
    '--turn-bg': `${brushStroke(SEAL)} no-repeat center bottom 5px / calc(100% - 30px) 7px, ${PANEL}`,
    '--turn-fg': INK,
    '--turn-size': '21px',
    '--turn-border': `1px solid ${RULE}`,
    '--turn-shadow': '0 8px 22px rgba(74, 56, 36, 0.16)',
    // The result card, sealed in its top-right corner like a letter (inside
    // the card's 48 px side padding, clear of the title)
    '--modal-bg': `${hanko} no-repeat right 5px top 6px / 40px 40px, radial-gradient(ellipse at 30% 12%, #fffcf5 0%, #f3ecdf 100%)`,
    '--modal-fg': INK,
    '--modal-radius': '2px',
    '--modal-shadow': '0 24px 60px rgba(60, 44, 28, 0.28)',
    '--modal-backdrop': 'rgba(60, 46, 32, 0.22)',
    '--button-bg': INK,
    '--button-fg': '#f7f1e6',
    '--button-border': `1px solid ${INK}`,
    '--button-radius': '2px',
    '--page-bg': 'radial-gradient(ellipse at 50% 35%, #f6f1e7 0%, #e4dccb 100%)',
    '--page-fg': INK,
  },
  overlay: {
    background: `radial-gradient(ellipse at 50% 46%, transparent 58%, rgba(92, 70, 44, 0.16) 100%), ${grain} repeat 0 0 / 240px 240px`,
    opacity: 0.9,
  },
};
