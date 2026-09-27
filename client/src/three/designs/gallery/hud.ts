import '@fontsource/cormorant-garamond/latin-500.css';
import '@fontsource/cormorant-garamond/latin-600.css';
import '@fontsource/cormorant-garamond/latin-700.css';
import '@fontsource/jost/latin-400.css';
import '@fontsource/jost/latin-500.css';
import jost500 from '@fontsource/jost/files/jost-latin-500-normal.woff2';
import jost600 from '@fontsource/jost/files/jost-latin-600-normal.woff2';
import type { DesignHud } from '../types';
import { BRASS } from './palette';

// The HUD as museum wall labels: dark placards with a hairline brass rule,
// set in a fine Garamond with the details in a quiet geometric sans, the way
// a gallery sets a title over its caption. The result is a framed title
// card, double-ruled in brass.

// Cormorant's default figures are old-style, and its 1 reads as a capital
// I. Canvas labels cannot ask for lining figures, so Gallery registers Jost's
// lining digits under their own family names, used ahead of Cormorant: the
// board's rank numbers and every number in the HUD are set in Jost. (The
// labels' family also covers the space, so the kit's font check, which
// loads a font by a space, waits for it.)
const LABEL_DIGITS = 'Gallery Label Digits';
const FIGURES = 'Gallery Figures';
if (typeof document !== 'undefined' && document.fonts && typeof FontFace !== 'undefined') {
  for (const [family, url, range] of [
    [LABEL_DIGITS, jost600, 'U+20, U+30-39'],
    [FIGURES, jost500, 'U+30-39'],
  ]) {
    const face = new FontFace(family, `url(${url}) format('woff2')`, {
      weight: '100 900',
      unicodeRange: range,
    });
    document.fonts.add(face);
    face.load().catch(() => undefined);
  }
  // The labels' letters: start loading them now, well before the board mounts
  document.fonts.load('700 64px "Cormorant Garamond"').catch(() => undefined);
}

export const SERIF = `"${FIGURES}", "Cormorant Garamond", Garamond, Georgia, serif`;
/** The board's labels: Jost's lining digits, Cormorant's letters. */
export const LABEL_FONT = `"${LABEL_DIGITS}", "Cormorant Garamond", Garamond, Georgia, serif`;
const SANS = 'Jost, "Helvetica Neue", Arial, sans-serif';
const IVORY = '#ece5d6';
const PLACARD = 'rgba(15, 16, 19, 0.88)';
const RULE = 'rgba(230, 189, 106, 0.3)';

const CARD = 'radial-gradient(ellipse at 50% 0%, #25231f 0%, #131315 72%)';

/**
 * The result card as a museum wall label: over the result (the card's own
 * title), a small italic "Final position"; under the button, the medium line
 * in tracked Jost capitals. The card's text is shared code, so the two lines
 * are drawn into images with the page's own fonts, once they have loaded.
 */
let label: string | null = null;
const wallLabel = (): string => {
  if (label) return label;
  if (
    typeof document === 'undefined' ||
    !document.fonts?.check('italic 500 28px "Cormorant Garamond"') ||
    !document.fonts.check('500 18px Jost')
  ) {
    return CARD;
  }
  const line = (text: string, font: string, color: string, tracking: number) => {
    const c = document.createElement('canvas');
    c.width = 720;
    c.height = 44;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${tracking}px`;
    ctx.fillText(text, c.width / 2, c.height / 2);
    return c.toDataURL();
  };
  const title = line('Final position', 'italic 500 28px "Cormorant Garamond"', '#bfb5a2', 1);
  const medium = line(
    'RAUMSCHACH \u00b7 MARBLE AND BASALT ON GLASS',
    '500 17px Jost',
    'rgba(236, 229, 214, 0.5)',
    3,
  );
  if (!title || !medium) return CARD;
  label =
    `url("${title}") no-repeat center top 12px / 360px 22px, ` +
    `url("${medium}") no-repeat center bottom 11px / 360px 22px, ` +
    CARD;
  return label;
};

const vars: DesignHud['vars'] = {
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
  '--turn-bg': `linear-gradient(${BRASS}, ${BRASS}) no-repeat center bottom 3px / 44px 1px, ${PLACARD}`,
  '--turn-fg': IVORY,
  '--turn-size': '23px',
  '--turn-border': `1px solid ${RULE}`,
  '--turn-shadow': '0 12px 32px rgba(0, 0, 0, 0.5)',
  '--modal-bg': CARD,
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
};
// Read each time the game screen renders: the wall label once fonts are in
Object.defineProperty(vars, '--modal-bg', { get: wallLabel, enumerable: true });

export const hud: DesignHud = {
  readout: true,
  vars,
  // The edges of the view fall into the gallery's gloom
  overlay: {
    background: 'radial-gradient(ellipse at 50% 46%, transparent 58%, rgba(0, 0, 0, 0.42) 100%)',
  },
};
