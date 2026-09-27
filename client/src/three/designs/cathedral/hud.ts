import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/700.css';
import type { DesignHud } from '../types';
import { GILT, HUD_GOLD, LEVEL, PARCHMENT } from './palette';

// The HUD as the margins of an illuminated manuscript read by candlelight:
// panels of dark vellum ruled in thin gold and a band of the five glass
// colours, set in Cormorant (a true lower case, so a file's letter never
// reads as a level's), with a small gilt quatrefoil at each end of the turn
// like a rubricated flourish. Restrained: the board is the page.

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
const SERIF = '"Cormorant Garamond", Georgia, serif';

export const hud: DesignHud = {
  readout: true,
  vars: {
    '--hud-font': SERIF,
    '--hud-mono': SERIF,
    '--hud-bg': PANEL,
    '--hud-fg': PARCHMENT,
    '--hud-muted': 'rgba(239, 227, 200, 0.58)',
    '--hud-accent': HUD_GOLD,
    '--hud-accent-fg': '#1a1208',
    '--hud-border': `1px solid ${RULE}`,
    '--hud-radius': '3px',
    '--hud-shadow':
      'inset 0 0 0 3px rgba(16, 12, 20, 0.84), inset 0 0 0 4px rgba(216, 176, 99, 0.16), 0 10px 30px rgba(0, 0, 0, 0.45)',
    '--hud-blur': 'blur(6px)',
    '--hud-tracking': '0.04em',
    '--turn-bg': `${quatrefoil} no-repeat left 4px center / 12px 12px, ${quatrefoil} no-repeat right 4px center / 12px 12px, ${glassRule} no-repeat center bottom / calc(100% - 24px) 2px, ${PANEL}`,
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
    '--button-bg': `linear-gradient(180deg, #e3c071 0%, ${HUD_GOLD} 55%, #b58d44 100%)`,
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
