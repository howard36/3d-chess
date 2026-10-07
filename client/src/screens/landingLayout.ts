// The home page's layouts and the bands each keeps clear of the tower, in
// CSS px from the window alone. Plain arithmetic, nothing from three.js: the
// start page reads the layouts from its first render, and three.js stays out
// of the entry (the preview, LandingPreview, hands the bands to its fit).

/**
 * The home page's layouts, side by side for choosing one (`?design=` in the
 * address picks another; the first is the default). Each keeps its own bands
 * clear of the tower, in CSS px from the window's size alone, matching
 * index.css's `.landing[data-design]` rules: the left band is where the menu
 * stands beside the tower, which the camera centres in the room to its right.
 */
export const LANDING_DESIGNS = [
  'column',
  'menu',
  'menu-buttons',
  'menu-tiles',
  'menu-cards',
  'menu-pair',
  'menu-type',
  'panel',
] as const;
export type LandingDesign = (typeof LANDING_DESIGNS)[number];

export interface LandingBands {
  top: (height: number, width: number) => number;
  bottom: (height: number, width: number) => number;
  left: (width: number, height: number) => number;
}

const clamp = (lo: number, v: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** A window at least as tall as it is wide stands the menu under the tower (index.css: orientation: portrait). */
const upright = (width: number, height: number) => height >= width;
/** The page's side margin (index.css: --landing-gutter). */
const gutter = (width: number): number => clamp(24, 0.06 * width, 112);
/** The room under an upright window's menu (index.css: --landing-under). */
const under = (width: number): number => Math.max(24, gutter(width));
/** The band an edge keeps clear where the menu is not there. */
const EDGE = 24;
/** The fit's room between the menu and the tower. */
const GAP = 16;
/** Under the tower: the band an upright window's menu takes, and the edge's in any other. */
const below =
  (menu: number) =>
  (height: number, width: number): number =>
    upright(width, height) ? menu + under(width) + GAP : EDGE;
const beside =
  (column: (width: number) => number) =>
  (width: number, height: number): number =>
    upright(width, height) ? 0 : gutter(width) + column(width) + GAP;

/** Heights in an upright window (index.css, the portrait rules): the title, a way to play, the tutorial's button. */
const TITLE = 46;
const MODE = 60;
const LEARN = 44;

/**
 * The menu's title above the tower in an upright window (two lines of 64 px
 * at 0.92), the ways in, `choices` tall, under it; beside it, a column.
 */
const menuBands = (
  choices: number,
  column = (w: number) => clamp(240, 0.26 * w, 400),
): LandingBands => ({
  top: (h, w) => (upright(w, h) ? under(w) + 2 * 0.92 * 64 + GAP : EDGE),
  bottom: below(choices),
  left: beside(column),
});

export const LANDING_BANDS: Record<LandingDesign, LandingBands> = {
  // The title over the menu in a column at the left, the tower right of it
  column: {
    top: () => EDGE,
    bottom: below(TITLE + 20 + MODE + 10 + MODE + 14 + LEARN),
    left: beside((w) => clamp(240, 0.24 * w, 360)),
  },
  // A large set title over the ways in, each menu-* another way of setting
  // them out (rows, buttons, tiles, cards, a pair of pills, large type)
  menu: menuBands(3 * 60),
  'menu-buttons': menuBands(MODE + 10 + MODE + 14 + LEARN),
  'menu-tiles': menuBands(116 + 14 + LEARN),
  'menu-cards': menuBands(150 + 14 + LEARN),
  'menu-pair': menuBands(56 + 12 + 40, (w) => clamp(300, 0.3 * w, 440)),
  'menu-type': menuBands(2 * 57 + 6 + 22 + LEARN),
  // A glass card at the left holding the title and the menu; upright, docked
  // along the bottom, 16 px from the window's edges
  panel: {
    top: () => EDGE,
    bottom: (h, w) => (upright(w, h) ? 24 + 40 + 20 + 116 + 20 + LEARN + 20 + 16 + GAP : EDGE),
    left: beside((w) => clamp(300, 0.26 * w, 380) + 8),
  },
};
