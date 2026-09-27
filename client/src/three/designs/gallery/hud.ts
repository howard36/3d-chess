import '@fontsource/cormorant-garamond/latin-500.css';
import '@fontsource/cormorant-garamond/latin-600.css';
import '@fontsource/cormorant-garamond/latin-700.css';
import '@fontsource/jost/latin-400.css';
import '@fontsource/jost/latin-500.css';
import type { DesignHud } from '../types';
import { BRASS } from './palette';

// The HUD as museum wall labels: dark placards with a hairline brass rule,
// set in a fine Garamond with the details in a quiet geometric sans, the way
// a gallery sets a title over its caption. The result is a framed title
// card, double-ruled in brass.

export const SERIF = '"Cormorant Garamond", Garamond, Georgia, serif';
const SANS = 'Jost, "Helvetica Neue", Arial, sans-serif';
const IVORY = '#ece5d6';
const PLACARD = 'rgba(15, 16, 19, 0.88)';
const RULE = 'rgba(230, 189, 106, 0.3)';

export const hud: DesignHud = {
  readout: true,
  vars: {
    '--hud-font': SERIF,
    '--hud-mono': SANS,
    '--hud-bg': PLACARD,
    '--hud-fg': IVORY,
    '--hud-muted': 'rgba(236, 229, 214, 0.55)',
    '--hud-accent': BRASS,
    '--hud-accent-fg': '#17130c',
    '--hud-border': `1px solid ${RULE}`,
    '--hud-radius': '1px',
    '--hud-shadow': '0 12px 32px rgba(0, 0, 0, 0.45)',
    '--hud-blur': 'blur(4px)',
    '--hud-tracking': '0.03em',
    // A short brass rule under the turn, as under a label's title
    '--turn-bg': `linear-gradient(${BRASS}, ${BRASS}) no-repeat center bottom 7px / 44px 1px, ${PLACARD}`,
    '--turn-fg': IVORY,
    '--turn-size': '23px',
    '--turn-border': `1px solid ${RULE}`,
    '--turn-shadow': '0 12px 32px rgba(0, 0, 0, 0.5)',
    '--modal-bg': 'radial-gradient(ellipse at 50% 0%, #25231f 0%, #131315 72%)',
    '--modal-fg': IVORY,
    '--modal-radius': '1px',
    // A title card in a double brass frame
    '--modal-shadow':
      'inset 0 0 0 1px rgba(230, 189, 106, 0.55), inset 0 0 0 7px #151517, inset 0 0 0 8px rgba(230, 189, 106, 0.25), 0 30px 80px rgba(0, 0, 0, 0.65)',
    '--modal-backdrop': 'rgba(3, 4, 6, 0.55)',
    '--button-bg': BRASS,
    '--button-fg': '#17130c',
    '--button-border': '1px solid #f4d596',
    '--button-radius': '1px',
    '--page-bg': 'radial-gradient(ellipse at 50% 40%, #16171b 0%, #07080a 100%)',
    '--page-fg': IVORY,
  },
  // The edges of the view fall into the gallery's gloom
  overlay: {
    background: 'radial-gradient(ellipse at 50% 46%, transparent 58%, rgba(0, 0, 0, 0.42) 100%)',
  },
};
