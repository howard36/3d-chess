import '@fontsource/cormorant-garamond/latin-600.css';
import '@fontsource/cormorant-garamond/latin-700.css';
import figuresBold from '@fontsource/shippori-mincho/files/shippori-mincho-latin-800-normal.woff2';

// The notation on the board and on the meridian ring is set like an
// engraver's: Cormorant Garamond's letters (a true double-storey "a", a round
// "D") with lining figures. Cormorant's own figures are old-style, its "1" a
// small capital I that reads as "I" or "l", so, as Vitrail does, a digits-only
// face of Shippori Mincho's lining figures (a "1" with a clear flag and foot)
// is registered and set first in the stack: the numbers, and only the
// numbers, come from it.

/** The digits-only face. */
const FIGURES = 'Meridian Figures';

let figures: Promise<unknown> = Promise.resolve();
if (typeof document !== 'undefined' && document.fonts && typeof FontFace !== 'undefined') {
  const face = new FontFace(FIGURES, `url(${figuresBold}) format('woff2')`, {
    unicodeRange: 'U+0030-0039',
    weight: '100 900',
    // Shippori's figures run a little large beside Cormorant's letters
    // (size-adjust is not yet in TypeScript's FontFaceDescriptors)
    sizeAdjust: '90%',
  } as FontFaceDescriptors);
  document.fonts.add(face);
  figures = face.load().catch(() => undefined);
}

/** Resolves once the figures can be drawn: canvas text drawn earlier keeps a fallback face. */
export const figuresReady = () => figures;

/** The notation's font stack: Shippori's figures, Cormorant's letters. */
export const NOTATION_FONT = `"${FIGURES}", "Cormorant Garamond", Georgia, serif`;
