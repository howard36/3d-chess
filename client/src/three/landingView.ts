import { MathUtils } from 'three';
import { towerBodyRings } from './scene/labelAnchors';
import { layout } from './scene/palette';
import { DEMO_LOOP_SECONDS } from '../game/demo';

// The landing page's preview of the tower: a slow turn round it at a fixed
// elevation, framed between the page's title above and its button below.

/** The preview's camera: a little above the game's opening view, so each level's squares open up. */
export const LANDING_VIEW = {
  /** Elevation above the horizon, in degrees. */
  elevation: 22,
  /**
   * Where the turn starts, in degrees round from White's side: clear of the
   * garden's sculptures, and turned so the first game's mate lands seen from
   * Black's side, where the mated king stands nearest.
   */
  azimuth: 28,
  /**
   * Seconds for a full turn round the tower: two passes of the demo (about
   * 90 s), so every pass opens, and its mate lands, at one of the same two
   * angles.
   */
  period: 2 * DEMO_LOOP_SECONDS,
} as const;

const [e, a] = [
  MathUtils.degToRad(LANDING_VIEW.elevation),
  MathUtils.degToRad(LANDING_VIEW.azimuth),
];

/** Where the camera opens, as a direction from the tower's centre. */
export const landingViewDirection: [number, number, number] = [
  Math.sin(a) * Math.cos(e),
  Math.sin(e),
  Math.cos(a) * Math.cos(e),
];

/** The preview draws no labels, so it frames the tower alone. */
export const landingFrameRings = towerBodyRings(layout);

/**
 * The home page's layouts, side by side for choosing one (`?design=` in the
 * address picks another; the first is the default). Each keeps its own bands
 * clear of the tower, in CSS px from the window's size alone, matching
 * index.css's `.landing[data-design]` rules: the left band is where the menu
 * stands beside the tower, which the camera centres in the room to its right.
 */
export const LANDING_DESIGNS = ['column', 'menu', 'panel'] as const;
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

export const LANDING_BANDS: Record<LandingDesign, LandingBands> = {
  // The title over the menu in a column at the left, the tower right of it
  column: {
    top: () => EDGE,
    bottom: below(TITLE + 20 + MODE + 10 + MODE + 14 + LEARN),
    left: beside((w) => clamp(240, 0.24 * w, 360)),
  },
  // A large set title over a list of the ways in, the tower right of them;
  // upright, the title above the tower and the list under it
  menu: {
    top: (h, w) => (upright(w, h) ? Math.max(24, gutter(w)) + 2 * 0.92 * 64 + GAP : EDGE),
    bottom: below(3 * 60),
    left: beside((w) => clamp(240, 0.26 * w, 400)),
  },
  // A glass card at the left holding the title and the menu; upright, docked
  // along the bottom, 16 px from the window's edges
  panel: {
    top: () => EDGE,
    bottom: (h, w) => (upright(w, h) ? 24 + 40 + 20 + 116 + 20 + LEARN + 20 + 16 + GAP : EDGE),
    left: beside((w) => clamp(300, 0.26 * w, 380) + 8),
  },
};
