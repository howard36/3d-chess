import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/space-grotesk/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import { useEffect } from 'react';
import type { DesignHud } from '../types';
import { CHECK, INK, LASER, LEVEL_LED, ROOM } from './palette';

// The HUD as the lab's instrument panels: frosted white panels with a
// hairline border and square-ish corners, a grotesk set in small tracked
// capitals, a monospace readout, a green status LED on the turn chip, and the
// five level colours as a thin LED strip along its foot and across the top of
// the result card.

export const FONT = '"Space Grotesk", "Manrope", system-ui, sans-serif';
export const MONO = '"IBM Plex Mono", ui-monospace, monospace';

const PANEL = 'rgba(250, 251, 253, 0.88)';
const RULE = 'rgba(39, 48, 59, 0.14)';
const STRIP = `linear-gradient(90deg, ${LEVEL_LED.join(', ')})`;

export const hud: DesignHud = {
  readout: true,
  vars: {
    '--hud-font': FONT,
    '--hud-mono': MONO,
    '--hud-bg': PANEL,
    '--hud-fg': INK,
    '--hud-muted': 'rgba(39, 48, 59, 0.55)',
    '--hud-accent': INK,
    '--hud-accent-fg': '#f7f9fb',
    '--hud-border': `1px solid ${RULE}`,
    '--hud-radius': '4px',
    '--hud-shadow': '0 1px 0 rgba(255, 255, 255, 0.9) inset, 0 6px 18px rgba(40, 52, 66, 0.1)',
    '--hud-blur': 'blur(8px)',
    '--hud-tracking': '0.04em',
    '--turn-bg': `${STRIP} no-repeat left bottom / 100% 2px, ${PANEL}`,
    '--turn-fg': INK,
    '--turn-size': '15px',
    '--turn-border': `1px solid ${RULE}`,
    '--turn-shadow': '0 8px 22px rgba(40, 52, 66, 0.12)',
    '--modal-bg': 'linear-gradient(180deg, #ffffff 0%, #f1f4f7 100%)',
    // The result card alone carries the level strip (the promotion dialog shares --modal-bg)
    '--result-bg': `${STRIP} no-repeat left top / 100% 3px, linear-gradient(180deg, #ffffff 0%, #f1f4f7 100%)`,
    '--result-title-size': '22px',
    '--modal-fg': INK,
    '--modal-radius': '6px',
    '--modal-shadow': '0 24px 60px rgba(40, 52, 66, 0.22)',
    '--modal-backdrop': 'rgba(210, 218, 226, 0.45)',
    '--button-bg': INK,
    '--button-fg': '#f7f9fb',
    '--button-border': `1px solid ${INK}`,
    '--button-radius': '4px',
    '--page-bg': ROOM.wall,
    '--page-fg': INK,
  },
  // A faint cool vignette, as if seen through the bay's glass
  overlay: {
    background: 'radial-gradient(ellipse at 50% 48%, transparent 62%, rgba(58, 72, 88, 0.12) 100%)',
  },
};

/**
 * A few rules the variables cannot say: the status LED (green on your move,
 * amber while the opponent thinks, red in check), the typefaces, and the
 * result card's printout line.
 */
export const HUD_CSS = `
[data-testid="turn-indicator"] {
  font-family: ${FONT} !important;
  font-weight: 600 !important;
}
[data-testid="turn-indicator"]::before {
  content: '';
  display: inline-block;
  width: 7px;
  height: 7px;
  margin: 0 10px 1px 0;
  border-radius: 50%;
  vertical-align: middle;
  background: #2fcf78;
  box-shadow: 0 0 0 2px rgba(47, 207, 120, 0.18), 0 0 8px rgba(47, 207, 120, 0.7);
}
[data-testid="turn-indicator"][data-cr-led='wait']::before {
  background: #f2b53c;
  box-shadow: 0 0 0 2px rgba(242, 181, 60, 0.18), 0 0 8px rgba(242, 181, 60, 0.6);
}
[data-testid="turn-indicator"][data-cr-led='check']::before {
  background: ${CHECK};
  box-shadow: 0 0 0 2px rgba(200, 16, 46, 0.18), 0 0 8px rgba(200, 16, 46, 0.7);
}
[data-testid="hover-readout"] {
  font-family: ${MONO} !important;
  letter-spacing: 0.02em;
}
#end-game-title {
  font-family: ${FONT};
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: 0.01em;
}
#end-game-title::before {
  content: 'Result';
  display: block;
  margin-bottom: 10px;
  font-family: ${MONO};
  font-weight: 500;
  font-size: 11px;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: ${LASER};
}
#end-game-title[data-cr-line]::after {
  content: attr(data-cr-line);
  display: block;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid ${RULE};
  font-family: ${MONO};
  font-weight: 500;
  font-size: 12px;
  letter-spacing: 0.08em;
  color: rgba(39, 48, 59, 0.6);
}
`;

const MOVE = /[A-E][a-e][1-5]\u2013([A-E][a-e][1-5])/g;

/**
 * Keeps the HUD's instrument details in step with the game, from what the app
 * already shows: the turn chip's status LED (whose move, check), and the
 * result card's printout ("9 moves · Ec4 · checkmate") from the move list.
 */
export const useHudState = (seat: 'white' | 'black') => {
  useEffect(() => {
    const update = () => {
      const turn = document.querySelector('[data-testid="turn-indicator"]');
      if (turn) {
        const text = (turn.textContent ?? '').toLowerCase();
        const led = text.includes('check') ? 'check' : text.startsWith(seat) ? 'go' : 'wait';
        if (turn.getAttribute('data-cr-led') !== led) turn.setAttribute('data-cr-led', led);
      }
      const title = document.getElementById('end-game-title');
      if (title && !title.hasAttribute('data-cr-line')) {
        const list = document.querySelector('[data-testid="move-list"]')?.textContent ?? '';
        const moves = [...list.matchAll(MOVE)];
        const last = moves.length ? moves[moves.length - 1][1] : null;
        const result = /stalemate/i.test(title.textContent ?? '') ? 'stalemate' : 'checkmate';
        const plies = moves.length;
        const line = [plies ? `${Math.ceil(plies / 2)} moves` : null, last, result];
        title.setAttribute('data-cr-line', line.filter(Boolean).join(' \u00b7 '));
      }
    };
    const observer = new MutationObserver(update);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    update();
    return () => observer.disconnect();
  }, [seat]);
};
