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

/** A window this short (a phone on its side) sets the page's text in a column beside the tower. */
export const LANDING_SHORT_PX = 480;
/** A window this tall sets the page's text a step larger. */
export const LANDING_TALL_PX = 860;

/**
 * The bands above and below the tower kept for the page's title and button,
 * in CSS px: one height for both, so the tower stands midway between the two
 * (index.css, .landing: --landing-band, in which each stands centred). A
 * short window keeps only a sliver: its text stands beside the tower.
 */
export const LANDING_BAND_PX = { normal: 124, tall: 140, short: 12 } as const;
export const landingBand = (height: number): number =>
  height <= LANDING_SHORT_PX
    ? LANDING_BAND_PX.short
    : height >= LANDING_TALL_PX
      ? LANDING_BAND_PX.tall
      : LANDING_BAND_PX.normal;

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
  'cinematic',
  'panel',
  'split',
  'topbar',
  'classic',
] as const;
export type LandingDesign = (typeof LANDING_DESIGNS)[number];

export interface LandingBands {
  top: (height: number, width: number) => number;
  bottom: (height: number, width: number) => number;
  left?: (width: number, height: number) => number;
}

const clamp = (lo: number, v: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** A window at least as tall as it is wide stacks the menu under the tower (index.css: orientation: portrait). */
const upright = (width: number, height: number) => height >= width;
/** The page's side margin (index.css: --landing-gutter). */
export const landingGutter = (width: number): number => clamp(24, 0.06 * width, 112);
/** The menu's column beside the tower (index.css: --landing-column). */
const column = (width: number) => clamp(220, 0.24 * width, 360);
/** The menu's room under an upright window's tower: its height and the gutter under it. */
const stacked =
  (block: (width: number) => number) =>
  (height: number, width: number): number =>
    upright(width, height) ? block(width) + Math.max(24, landingGutter(width)) + 16 : 24;
const beside =
  (room: (width: number) => number) =>
  (width: number, height: number): number =>
    upright(width, height) ? 0 : room(width);
const edge = () => 24;

/** Heights of the menu's parts in an upright window (index.css, the portrait rules). */
const TITLE_UPRIGHT = 46;
const PLAY = 52;
const ALT = 44;
const LEARN = 36;

export const LANDING_BANDS: Record<LandingDesign, LandingBands> = {
  // Title over the buttons in a column at the left, the tower right of it
  column: {
    top: edge,
    bottom: stacked(() => TITLE_UPRIGHT + 20 + PLAY + 10 + ALT + 6 + LEARN),
    left: beside((w) => landingGutter(w) + column(w) + 16),
  },
  // A large set title and a list of ways in, the tower right of them
  menu: {
    top: (h, w) => (upright(w, h) ? Math.max(24, landingGutter(w)) + 2 * 0.92 * 64 + 16 : 24),
    bottom: stacked(() => 3 * 56),
    left: beside((w) => landingGutter(w) + clamp(240, 0.26 * w, 400) + 16),
  },
  // A film's title card: the tower large, the title and buttons along the bottom left
  cinematic: {
    top: () => 0,
    bottom: (h, w) =>
      upright(w, h) ? 56 + 20 + PLAY + 10 + ALT + Math.max(24, landingGutter(w)) + 16 : 0,
    left: beside((w) => 0.22 * w),
  },
  // A glass card at the left holding the title and menu
  panel: {
    top: edge,
    bottom: stacked(() => 2 * 24 + 40 + 20 + PLAY + 10 + ALT + 17 + LEARN + 16),
    left: beside((w) => landingGutter(w) + clamp(260, 0.24 * w, 340) + 24),
  },
  // A dark panel down the left, ruled off by the five level colours
  split: {
    top: edge,
    bottom: (h, w) => (upright(w, h) ? clamp(300, 0.38 * h, 380) + 16 : 24),
    left: beside((w) => clamp(280, 0.36 * w, 560) + 16),
  },
  // A bar across the top with the title and the quieter ways in, the call to action below the tower
  topbar: {
    top: (h) => (h <= LANDING_SHORT_PX ? 52 : 72),
    bottom: (h, w) =>
      h <= LANDING_SHORT_PX
        ? 46 + 16 + 16
        : PLAY + Math.max(24, landingGutter(w)) + 16 + (upright(w, h) ? ALT + 10 : 0),
  },
  // As it was: the title above the tower and the buttons below it
  classic: { top: landingBand, bottom: landingBand },
};
