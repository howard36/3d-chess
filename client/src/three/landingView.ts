import { MathUtils } from 'three';
import { towerBodyRings } from './scene/labelAnchors';
import { layout } from './scene/palette';
import { DEMO_LOOP_SECONDS } from '../game/demo';

// The landing page's preview of the tower: a slow turn round it at a fixed
// elevation, framed beside the page's menu (the bands: screens/landingLayout.ts).

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
