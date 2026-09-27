import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/ibm-plex-mono/500.css';
import type { DesignHud } from '../types';
import { INK, SIGNAL, WATER } from './palette';

// The HUD as the station's research terminal: dark pressure-glass panels
// with a thin instrument-green keyline and a faint inner light at the top
// edge, Space Grotesk for words and IBM Plex Mono for coordinates. The turn
// chip carries a short glowing underline, like a lit gauge. A deep vignette
// sinks the screen's edges into the water.

const PANEL = 'rgba(5, 22, 27, 0.72)';
const KEYLINE = 'rgba(111, 242, 196, 0.22)';
const FONT = '"Space Grotesk", "Manrope", system-ui, sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, monospace';

const glowLine = `linear-gradient(90deg, transparent, ${SIGNAL} 20%, ${SIGNAL} 80%, transparent) no-repeat center bottom 6px / calc(100% - 36px) 1.5px`;

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
      'inset 0 1px 0 rgba(160, 255, 230, 0.08), 0 10px 30px rgba(0, 0, 0, 0.45), 0 0 24px rgba(111, 242, 196, 0.05)',
    '--hud-blur': 'blur(8px)',
    '--hud-tracking': '0.02em',
    '--turn-bg': `${glowLine}, ${PANEL}`,
    '--turn-fg': INK,
    '--turn-size': '19px',
    '--turn-border': `1px solid ${KEYLINE}`,
    '--turn-shadow': '0 10px 30px rgba(0, 0, 0, 0.45), 0 0 28px rgba(111, 242, 196, 0.08)',
    '--modal-bg': `radial-gradient(ellipse at 50% 0%, rgba(111, 242, 196, 0.12) 0%, transparent 60%), linear-gradient(180deg, #0a2a31 0%, #041419 100%)`,
    '--modal-fg': INK,
    '--modal-radius': '10px',
    '--modal-shadow': `0 0 0 1px ${KEYLINE}, 0 30px 80px rgba(0, 0, 0, 0.6), 0 0 60px rgba(111, 242, 196, 0.08)`,
    '--modal-backdrop': 'rgba(1, 8, 10, 0.5)',
    '--button-bg': SIGNAL,
    '--button-fg': '#03161a',
    '--button-border': `1px solid ${SIGNAL}`,
    '--button-radius': '6px',
    '--page-bg': `radial-gradient(ellipse at 50% 30%, ${WATER.horizon} 0%, ${WATER.deep} 100%)`,
    '--page-fg': INK,
  },
  overlay: {
    background: 'radial-gradient(ellipse at 50% 48%, transparent 55%, rgba(1, 8, 11, 0.55) 100%)',
  },
};
