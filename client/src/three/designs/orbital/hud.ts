import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/space-grotesk/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import type { DesignHud } from '../types';
import { DOCK, INK, INK_MUTED } from './palette';

// The station's interface: calm flight-deck panels of dark smoked glass
// with a hairline edge, a clean grotesque for words and a mono for
// coordinates, and one ice-blue accent, the colour of the docking lights.
// The view is framed like a window: a rounded viewport, its corners dark.

export const FONT = '"Space Grotesk", "Manrope", system-ui, sans-serif';
export const MONO = '"IBM Plex Mono", ui-monospace, monospace';

const PANEL = 'rgba(9, 14, 24, 0.74)';
const EDGE = '1px solid rgba(170, 205, 245, 0.16)';

export const hud: DesignHud = {
  readout: true,
  // The view out of a rounded viewport: a faint hairline bezel just inside
  // the screen's edge, the corners beyond it darkened, and a soft falloff
  overlay: {
    inset: '7px',
    borderRadius: '26px',
    boxShadow:
      '0 0 0 48px rgba(2, 4, 10, 0.5), inset 0 0 0 1px rgba(170, 205, 245, 0.08), inset 0 0 80px rgba(1, 3, 9, 0.35)',
    background:
      'radial-gradient(ellipse 80% 75% at 50% 46%, rgba(0, 0, 0, 0) 62%, rgba(1, 3, 9, 0.35) 100%)',
  },
  vars: {
    '--hud-font': FONT,
    '--hud-mono': MONO,
    '--hud-bg': PANEL,
    '--hud-fg': INK,
    '--hud-muted': INK_MUTED,
    '--hud-accent': DOCK,
    '--hud-accent-fg': '#07111d',
    '--hud-border': EDGE,
    '--hud-radius': '6px',
    '--hud-shadow': '0 10px 30px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.04)',
    '--hud-blur': 'blur(10px)',
    '--hud-tracking': '0.03em',
    '--turn-bg': 'rgba(9, 14, 24, 0.8)',
    '--turn-fg': INK,
    '--turn-size': '19px',
    '--turn-border': '1px solid rgba(220, 244, 255, 0.36)',
    '--turn-shadow':
      '0 0 0 1px rgba(0, 0, 0, 0.3), 0 8px 26px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(220, 244, 255, 0.18)',
    '--modal-bg': 'rgba(10, 16, 28, 0.94)',
    '--modal-fg': INK,
    '--modal-radius': '8px',
    '--modal-shadow':
      '0 24px 60px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(220, 244, 255, 0.35), 0 0 0 1px rgba(170, 205, 245, 0.14)',
    '--modal-backdrop': 'rgba(2, 4, 10, 0.55)',
    '--button-bg': DOCK,
    '--button-fg': '#07111d',
    '--button-border': '1px solid rgba(255, 255, 255, 0.4)',
    '--button-radius': '5px',
    '--page-bg': '#04070e',
    '--page-fg': INK,
  },
};
