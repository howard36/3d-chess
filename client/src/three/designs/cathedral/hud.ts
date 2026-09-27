import '@fontsource/cinzel/700.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/700.css';
import figuresBold from '@fontsource/shippori-mincho/files/shippori-mincho-latin-800-normal.woff2';
import figuresRegular from '@fontsource/shippori-mincho/files/shippori-mincho-latin-600-normal.woff2';
import type { DesignHud } from '../types';
import './hud.css';
import { GILT, HUD_GOLD, LEVEL, PARCHMENT } from './palette';

// The HUD as the margins of an illuminated manuscript read by candlelight:
// panels of dark vellum ruled in thin gold and a band of the five glass
// colours, set in Cormorant (a true lower case, so a file's letter never
// reads as a level's), with a small gilt quatrefoil at each end of the turn
// like a rubricated flourish. Restrained: the board is the page.
//
// Cormorant's figures are old-style: its "1" is a small capital I, so
// "Ba1" read "BaI". Vitrail registers Shippori Mincho's lining figures as a
// digits-only face and sets it first in every stack, so the numbers (and
// only the numbers) come from it: its "1" has a clear flag and foot, where
// Cinzel's, at HUD size, still reads as an l. A small stylesheet (hud.css, scoped to
// this design's canvas) gives the move box a gilt focus ring and the result
// card a proper title.

/** The digits-only face: Shippori Mincho's lining figures. */
export const FIGURES = 'Vitrail Figures';
let figures: Promise<unknown> = Promise.resolve();
if (typeof document !== 'undefined' && document.fonts && typeof FontFace !== 'undefined') {
  // Regular figures beside the HUD's text, bold ones for the board's labels
  const faces = [
    [figuresRegular, '100 599'],
    [figuresBold, '600 900'],
  ].map(([url, weight]) => {
    const face = new FontFace(FIGURES, `url(${url}) format('woff2')`, {
      unicodeRange: 'U+0030-0039',
      weight,
    });
    document.fonts.add(face);
    return face.load().catch(() => undefined);
  });
  figures = Promise.all(faces);
}
/** Resolves once the figures can be drawn (canvas labels must wait for it). */
export const figuresReady = () => figures;

/** Every text in the HUD and on the board: Shippori's figures, Cormorant's letters. */
export const SERIF = `"${FIGURES}", "Cormorant Garamond", Georgia, serif`;

const svg = (body: string, viewBox: string, extra = '') =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${viewBox}' ${extra}>${body}</svg>`,
  )}")`;

/** A gilt quatrefoil in a lozenge, set at each end of the turn chip. */
const quatrefoil = svg(
  `<g fill='none' stroke='${GILT}' stroke-width='1.6'>` +
    `<path d='M12 1.5 L22.5 12 L12 22.5 L1.5 12 Z' opacity='0.55'/>` +
    `<path d='M12 5.6a3.2 3.2 0 0 1 3.1 3.3 3.2 3.2 0 0 1 3.3 3.1 3.2 3.2 0 0 1-3.3 3.1 3.2 3.2 0 0 1-3.1 3.3 3.2 3.2 0 0 1-3.1-3.3 3.2 3.2 0 0 1-3.3-3.1 3.2 3.2 0 0 1 3.3-3.1A3.2 3.2 0 0 1 12 5.6Z'/>` +
    `</g><circle cx='12' cy='12' r='1.3' fill='${GILT}'/>`,
  '0 0 24 24',
);

/** A thin rule of the five level colours, like a band of glass at the top of a page. */
const glassRule = svg(
  LEVEL.map((c, i) => `<rect x='${i * 20}' y='0' width='20' height='2' fill='${c}'/>`).join(''),
  '0 0 100 2',
  "preserveAspectRatio='none'",
);

/** A rose window drawn in gold hairlines, a watermark for the result card. */
const roseMark = svg(
  `<g fill='none' stroke='${HUD_GOLD}' stroke-width='0.6' opacity='0.22'>` +
    `<circle cx='50' cy='50' r='46'/><circle cx='50' cy='50' r='40'/><circle cx='50' cy='50' r='12'/>` +
    Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      const x = 50 + Math.cos(a) * 40;
      const y = 50 + Math.sin(a) * 40;
      const cx = 50 + Math.cos(a) * 43;
      const cy = 50 + Math.sin(a) * 43;
      return (
        `<line x1='${50 + Math.cos(a) * 12}' y1='${50 + Math.sin(a) * 12}' x2='${x}' y2='${y}'/>` +
        `<circle cx='${cx}' cy='${cy}' r='2.6'/>`
      );
    }).join('') +
    `</g>`,
  '0 0 100 100',
);

const PANEL = 'rgba(16, 12, 20, 0.84)';
const RULE = 'rgba(216, 176, 99, 0.34)';

export const hud: DesignHud = {
  readout: true,
  vars: {
    '--hud-font': SERIF,
    '--hud-mono': SERIF,
    '--hud-bg': PANEL,
    '--hud-fg': PARCHMENT,
    '--hud-muted': 'rgba(239, 227, 200, 0.58)',
    '--hud-accent': 'linear-gradient(180deg, #f6dc98 0%, #e2bd6a 55%, #c39a4c 100%)',
    '--hud-accent-fg': '#1a1208',
    '--hud-border': `1px solid ${RULE}`,
    '--hud-radius': '3px',
    '--hud-shadow':
      'inset 0 0 0 3px rgba(16, 12, 20, 0.84), inset 0 0 0 4px rgba(216, 176, 99, 0.16), 0 10px 30px rgba(0, 0, 0, 0.45)',
    '--hud-blur': 'blur(6px)',
    '--hud-tracking': '0.04em',
    '--turn-bg': `${quatrefoil} no-repeat left 3px center / 15px 15px, ${quatrefoil} no-repeat right 3px center / 15px 15px, ${glassRule} no-repeat center bottom 3px / calc(100% - 16px) 3px, ${PANEL}`,
    '--turn-fg': PARCHMENT,
    '--turn-size': '20px',
    '--turn-border': `1px solid ${RULE}`,
    '--turn-shadow':
      'inset 0 0 0 3px rgba(16, 12, 20, 0.84), inset 0 0 0 4px rgba(216, 176, 99, 0.2), 0 10px 30px rgba(0, 0, 0, 0.5)',
    '--modal-bg': `${roseMark} no-repeat center 14px / 180px 180px, radial-gradient(ellipse at 50% 0%, #241b2c 0%, #120e17 70%)`,
    '--modal-fg': PARCHMENT,
    '--modal-radius': '4px',
    '--modal-shadow': `0 0 0 1px ${RULE}, 0 0 0 5px rgba(18, 14, 23, 0.9), 0 0 0 6px rgba(216, 176, 99, 0.22), 0 30px 80px rgba(0, 0, 0, 0.6)`,
    '--modal-backdrop': 'rgba(6, 4, 10, 0.45)',
    '--button-bg': 'linear-gradient(180deg, #f6dc98 0%, #e2bd6a 55%, #c39a4c 100%)',
    '--button-fg': '#1a1208',
    '--button-border': '1px solid rgba(255, 230, 170, 0.5)',
    '--button-radius': '3px',
    '--page-bg': 'radial-gradient(ellipse at 50% 30%, #17121d 0%, #07060a 100%)',
    '--page-fg': PARCHMENT,
  },
  // Candlelight gathering toward the middle of the view, the corners in shadow
  overlay: {
    background: `radial-gradient(ellipse at 50% 48%, transparent 55%, rgba(4, 2, 8, 0.5) 100%)`,
  },
};
