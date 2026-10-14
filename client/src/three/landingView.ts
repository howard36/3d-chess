import { MathUtils } from 'three';
import { towerBodyRings } from './scene/labelAnchors';
import { layout } from './scene/palette';

// The landing page's preview of the tower: a slow turn round it at a fixed
// elevation, framed beside the page's menu (the bands: screens/landingLayout.ts).

/** The preview's camera: a little above the game's opening view, so each level's squares open up. */
export const LANDING_VIEW = {
  /** Elevation above the horizon, in degrees. */
  elevation: 22,
  /**
   * Where the turn starts, in degrees round from White's side: clear of the
   * garden's sculptures (the start page's pictures are taken from here).
   */
  azimuth: 28,
  /**
   * Seconds for a full turn round the tower: slow enough (2.4° a second)
   * that the eye stays on the game's moves, never a match for the games'
   * lengths (the page opens on a random one).
   */
  period: 150,
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
