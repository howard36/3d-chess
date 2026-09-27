import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import type { DesignHud } from '../types';
import { INK, SIGNAL, WATER } from './palette';

// The HUD as the station's research terminal: dark pressure-glass panels
// with a thin pale-aqua keyline and a faint inner light at the top edge,
// Space Grotesk for words and IBM Plex Mono for coordinates. The accent is a
// pale aqua-white, clear of every level colour. The turn chip carries a
// short glowing underline, like a lit gauge; the result card is an
// instrument face, a faint sonar ring behind its text and an outlined
// button. A deep vignette sinks the screen's edges into the water.

const PANEL = 'rgba(5, 22, 27, 0.74)';
const KEYLINE = 'rgba(191, 239, 242, 0.2)';
const FONT = '"Space Grotesk", "Manrope", system-ui, sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, monospace';

const glowLine = `linear-gradient(90deg, transparent, ${SIGNAL} 20%, ${SIGNAL} 80%, transparent) no-repeat center bottom 6px / calc(100% - 36px) 1.5px`;

const svg = (body: string, viewBox: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${viewBox}'>${body}</svg>`,
  )}")`;

/** Two faint concentric rings and a short tick scale: an instrument's face behind the result. */
const instrumentFace = svg(
  `<g fill='none' stroke='${SIGNAL}'>` +
    `<circle cx='100' cy='100' r='92' stroke-opacity='0.14' stroke-width='1'/>` +
    `<circle cx='100' cy='100' r='70' stroke-opacity='0.08' stroke-width='1'/>` +
    Array.from({ length: 24 }, (_, i) => {
      const a = (i / 24) * Math.PI * 2;
      const [r0, r1] = i % 6 === 0 ? [84, 92] : [88, 92];
      return `<line x1='${100 + Math.cos(a) * r0}' y1='${100 + Math.sin(a) * r0}' x2='${100 + Math.cos(a) * r1}' y2='${100 + Math.sin(a) * r1}' stroke-opacity='0.2' stroke-width='1'/>`;
    }).join('') +
    `</g>`,
  '0 0 200 200',
);

export const hud: DesignHud = {
  readout: true,
  vars: {
    '--hud-font': FONT,
    '--hud-mono': MONO,
    '--hud-bg': PANEL,
    '--hud-fg': INK,
    '--hud-muted': 'rgba(216, 243, 241, 0.55)',
    '--hud-accent': SIGNAL,
    '--hud-accent-fg': '#03161a',
    '--hud-border': `1px solid ${KEYLINE}`,
    '--hud-radius': '6px',
    '--hud-shadow':
      'inset 0 1px 0 rgba(200, 245, 248, 0.07), 0 10px 30px rgba(0, 0, 0, 0.45), 0 0 24px rgba(191, 239, 242, 0.04)',
    '--hud-blur': 'blur(8px)',
    '--hud-tracking': '0.02em',
    '--turn-bg': `${glowLine}, ${PANEL}`,
    '--turn-fg': INK,
    '--turn-size': '19px',
    '--turn-border': `1px solid ${KEYLINE}`,
    '--turn-shadow': '0 10px 30px rgba(0, 0, 0, 0.45), 0 0 28px rgba(191, 239, 242, 0.06)',
    // The promotion dialog and the result card share this glass...
    '--modal-bg': `radial-gradient(ellipse at 50% 0%, rgba(191, 239, 242, 0.1) 0%, transparent 60%), linear-gradient(180deg, #0a2a31 0%, #041419 100%)`,
    // ...and only the result card carries the instrument face
    '--result-bg': `${instrumentFace} no-repeat center / 240px 240px, radial-gradient(ellipse at 50% 0%, rgba(191, 239, 242, 0.1) 0%, transparent 60%), linear-gradient(180deg, #0a2a31 0%, #041419 100%)`,
    '--result-title-size': '19px',
    '--modal-fg': INK,
    '--modal-radius': '10px',
    '--modal-shadow': `0 0 0 1px ${KEYLINE}, inset 0 -1px 0 rgba(191, 239, 242, 0.25), 0 30px 80px rgba(0, 0, 0, 0.6)`,
    '--modal-backdrop': 'rgba(1, 8, 10, 0.5)',
    // Outlined, quiet: the card's text leads, not a slab of colour
    '--button-bg': 'rgba(191, 239, 242, 0.08)',
    '--button-fg': SIGNAL,
    '--button-border': `1px solid rgba(191, 239, 242, 0.55)`,
    '--button-radius': '6px',
    '--page-bg': `radial-gradient(ellipse at 50% 30%, ${WATER.horizon} 0%, ${WATER.deep} 100%)`,
    '--page-fg': INK,
  },
  overlay: {
    background: 'radial-gradient(ellipse at 50% 48%, transparent 55%, rgba(1, 8, 11, 0.55) 100%)',
  },
};
