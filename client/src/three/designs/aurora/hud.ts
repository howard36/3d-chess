import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-500.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import type { DesignHud } from '../types';
import { INK, LEVELS, NIGHT } from './palette';

// The HUD as frosted glass on a cold night: panels of dark ice, blurred,
// with a hairline of frost round them; a light, open sans (Manrope, with a
// two-storey a and a flagged 1, so labels never read a/o or 1/l), tracked
// a little wide; the turn chip underlined by a thin strip of aurora.

export const FONT = "'Manrope', system-ui, sans-serif";

const aurora = `linear-gradient(90deg, ${LEVELS.join(', ')})`;

export const hud: DesignHud = {
  readout: true,
  vars: {
    '--hud-font': FONT,
    '--hud-bg': 'rgba(12, 22, 36, 0.62)',
    '--hud-fg': INK,
    '--hud-muted': 'rgba(214, 230, 246, 0.58)',
    // Calls to action are frosted ice: the level colours stay a board language
    '--hud-accent': 'linear-gradient(180deg, #eef5fc, #cfdeee)',
    '--hud-accent-fg': '#0b1726',
    '--hud-border': '1px solid rgba(190, 225, 255, 0.16)',
    '--hud-radius': '10px',
    '--hud-shadow': '0 10px 30px rgba(0, 4, 12, 0.45), inset 0 1px 0 rgba(220, 240, 255, 0.08)',
    '--hud-blur': 'blur(12px) saturate(1.2)',
    '--hud-tracking': '0.04em',
    '--turn-bg': `${aurora} bottom / 100% 2px no-repeat, rgba(12, 22, 36, 0.7)`,
    '--turn-fg': '#f2f8ff',
    '--turn-size': '18px',
    '--turn-border': '1px solid rgba(190, 225, 255, 0.2)',
    '--turn-shadow': '0 10px 30px rgba(0, 4, 12, 0.5)',
    '--modal-bg': `${aurora} top / 100% 3px no-repeat, rgba(10, 19, 32, 0.92)`,
    // The result card: the aurora's arc rising behind the verdict
    '--result-bg': `${aurora} top / 100% 3px no-repeat, radial-gradient(120% 90% at 50% -10%, rgba(70, 255, 166, 0.22), rgba(57, 228, 255, 0.1) 40%, rgba(176, 133, 255, 0.06) 60%, rgba(0, 0, 0, 0) 75%), rgba(8, 16, 28, 0.94)`,
    '--result-title-size': '22px',
    '--modal-fg': INK,
    '--modal-radius': '14px',
    '--modal-shadow': '0 24px 60px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(190, 225, 255, 0.14)',
    '--modal-backdrop': 'rgba(2, 6, 14, 0.45)',
    '--button-bg': `${aurora} bottom / 100% 2px no-repeat, linear-gradient(180deg, #eef5fc, #cfdeee)`,
    '--button-fg': '#0b1726',
    '--button-border': 'none',
    '--button-radius': '8px',
    '--page-bg': NIGHT.horizon,
    '--page-fg': INK,
  },
  // A faint cold vignette: the edges of the view fall into the night
  overlay: {
    background:
      'radial-gradient(ellipse 120% 90% at 50% 45%, rgba(0,0,0,0) 60%, rgba(1, 4, 10, 0.4) 100%)',
  },
};
