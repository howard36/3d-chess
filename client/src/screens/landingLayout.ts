// The bands the home page's menu keeps clear of the tower, in CSS px from the
// window alone, mirroring index.css's landing rules. Plain arithmetic,
// nothing from three.js: three.js stays out of the entry, and the preview
// (LandingPreview, a lazy chunk) hands these to its fit.

export interface LandingBands {
  top: (height: number, width: number) => number;
  bottom: (height: number, width: number) => number;
  left: (width: number, height: number) => number;
}

const clamp = (lo: number, v: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** A window at least as tall as it is wide stands the menu above and under the tower (index.css: orientation: portrait). */
const upright = (width: number, height: number) => height >= width;
/** An upright window this wide or wider is a tablet: the menu in a band along the bottom (index.css: min-width: 600px). */
const tablet = (width: number, height: number) => upright(width, height) && width >= 600;
/** A window this short (a phone on its side) sets the menu a size down (index.css: max-height: 480px). */
const short = (height: number) => height <= 480;
/** The page's side margin (index.css: --landing-gutter). */
const gutter = (width: number): number => clamp(24, 0.06 * width, 112);
/** The room under an upright window's menu (index.css: --landing-under). */
const under = (width: number): number => Math.max(24, gutter(width));
/** The menu's column beside the tower (index.css: --landing-column). */
const column = (width: number, height: number): number =>
  short(height) ? clamp(300, 0.38 * width, 340) : clamp(340, 0.3 * width, 440);
/** The band an edge keeps clear where the menu is not there. */
const EDGE = 24;
/** The fit's room between the menu and the tower. */
const GAP = 16;
/** The two-line title `size` px tall a line (lines of 0.92). */
const title = (size: number) => 2 * 0.92 * size;
/** The rule under the title in a tablet (index.css: .landing-head::after, 20 px under it). */
const RULE = 22;
/** Under an upright phone's tower: the tiles (116 px) and the tutorial's button under them. */
const PHONE_MENU = 116 + 14 + 44;
/** A tablet's tiles (132 px) and the tutorial's button under them. */
const TABLET_MENU = 132 + 14 + 44;

export const LANDING_BANDS: LandingBands = {
  // An upright phone's title above the tower (64 px)
  top: (h, w) => (upright(w, h) && !tablet(w, h) ? under(w) + title(64) + GAP : EDGE),
  // An upright window's tiles under the tower; in a tablet, beside the title
  bottom: (h, w) =>
    !upright(w, h)
      ? EDGE
      : under(w) +
        GAP +
        (tablet(w, h) ? Math.max(title(clamp(64, 0.11 * w, 112)) + RULE, TABLET_MENU) : PHONE_MENU),
  // Beside the tower, the menu's column
  left: (w, h) => (upright(w, h) ? 0 : gutter(w) + column(w, h) + GAP),
};
