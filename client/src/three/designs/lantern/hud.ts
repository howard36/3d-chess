import '@fontsource/shippori-mincho/latin-500.css';
import '@fontsource/shippori-mincho/latin-700.css';
import '@fontsource/shippori-mincho/latin-800.css';
import type { DesignHud } from '../types';
import { INK, LACQUER, SKY, WASHI } from './palette';

// The HUD belongs to the garden at dusk: panels of dark lacquer, edged in a
// hairline of lantern light, set in a Mincho serif the colour of washi; and
// the turn shown as a small lit paper lantern, ribbed, capped top and
// bottom in lacquer, glowing into the dark round it. The result card is a
// larger lit lantern with a red lacquer seal.

export const FONT = '"Shippori Mincho", "Cormorant Garamond", Georgia, serif';

const svg = (body: string, viewBox: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${viewBox}'>${body}</svg>`,
  )}")`;

/** A red lacquer seal: a round mon of a lantern's ribs. */
const seal = svg(
  `<circle cx='50' cy='50' r='44' fill='${LACQUER}'/>` +
    `<circle cx='50' cy='50' r='36' fill='none' stroke='#fff4e2' stroke-width='3'/>` +
    `<g fill='none' stroke='#fff4e2' stroke-width='3.2' stroke-linecap='round'>` +
    `<path d='M34 36 Q50 30 66 36'/><path d='M30 46 Q50 40 70 46'/>` +
    `<path d='M30 56 Q50 50 70 56'/><path d='M34 66 Q50 60 66 66'/></g>` +
    `<rect x='42' y='24' width='16' height='6' rx='2' fill='#fff4e2'/>` +
    `<rect x='42' y='70' width='16' height='6' rx='2' fill='#fff4e2'/>`,
  '0 0 100 100',
);

/** Lit washi with the ribs of a paper lantern across it. */
const litPaper = (glow: string) =>
  `repeating-linear-gradient(180deg, transparent 0 9px, rgba(122, 74, 34, 0.13) 9px 10px), ` +
  `radial-gradient(ellipse at 50% 55%, ${glow} 0%, #f6e4c0 55%, #e9d2a8 100%)`;

const PANEL = 'linear-gradient(180deg, rgba(34, 27, 36, 0.86) 0%, rgba(16, 17, 32, 0.86) 100%)';
const EDGE = '1px solid rgba(255, 201, 120, 0.26)';

export const hud: DesignHud = {
  readout: true,
  vars: {
    '--hud-font': FONT,
    '--hud-mono': FONT,
    '--hud-bg': PANEL,
    '--hud-fg': WASHI,
    '--hud-muted': 'rgba(243, 228, 198, 0.56)',
    '--hud-accent': '#ffc978',
    '--hud-accent-fg': INK,
    '--hud-border': EDGE,
    '--hud-radius': '3px',
    '--hud-shadow':
      'inset 0 1px 0 rgba(255, 214, 150, 0.1), 0 0 0 1px rgba(0, 0, 0, 0.35), 0 12px 30px rgba(2, 4, 14, 0.45)',
    '--hud-blur': 'blur(6px)',
    '--hud-tracking': '0.03em',
    '--turn-bg': litPaper('#ffe2a4'),
    '--turn-fg': INK,
    '--turn-size': '20px',
    '--turn-border': '1px solid rgba(58, 30, 18, 0.55)',
    // Lacquer caps top and bottom, and the lantern's glow in the dark
    '--turn-shadow':
      'inset 0 4px 0 #2b1911, inset 0 -4px 0 #2b1911, 0 0 26px rgba(255, 184, 96, 0.38), 0 6px 18px rgba(0, 0, 0, 0.4)',
    '--modal-bg': `${seal} no-repeat center top 12px / 30px 30px, ${litPaper('#ffe6b0')}`,
    '--modal-fg': INK,
    '--modal-radius': '4px',
    '--modal-shadow':
      'inset 0 6px 0 #2b1911, inset 0 -6px 0 #2b1911, 0 0 60px rgba(255, 184, 96, 0.3), 0 24px 60px rgba(0, 0, 0, 0.5)',
    '--modal-backdrop': 'rgba(4, 6, 16, 0.45)',
    '--button-bg': '#2b1911',
    '--button-fg': WASHI,
    '--button-border': '1px solid rgba(255, 201, 120, 0.4)',
    '--button-radius': '3px',
    '--page-bg': `radial-gradient(ellipse at 50% 30%, ${SKY.low} 0%, ${SKY.high} 55%, ${SKY.zenith} 100%)`,
    '--page-fg': WASHI,
  },
  // A soft vignette: the garden falls away into the dusk at the edges
  overlay: {
    background: 'radial-gradient(ellipse at 50% 48%, transparent 62%, rgba(3, 5, 14, 0.42) 100%)',
  },
};
