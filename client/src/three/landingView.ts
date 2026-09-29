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
