import { MathUtils, Vector3 } from 'three';

/**
 * How far the player may zoom, as fractions of the fitted distance: in until
 * the nearest levels fill the window, out until the board sits small in the
 * middle of it. Relative to the fit, so a phone held upright (which fits from
 * farther away) zooms as far, proportionally, as a desktop window.
 */
export const ZOOM_IN = 0.7;
export const ZOOM_OUT = 1.5;

/**
 * The distances from the board's centre the camera may stand at, given the
 * distance that fits the board in the window. The layout's own nearest
 * distance only narrows the range.
 */
export function zoomRange(fit: number, minDistance = 0): { min: number; max: number } {
  const max = fit * ZOOM_OUT;
  const min = Math.min(Math.max(fit * ZOOM_IN, minDistance), max);
  return { min, max };
}

// --- The centred fit -------------------------------------------------------------
//
// Under perspective a box's near corners project further from the middle than
// its far ones, so a board fitted symmetrically about the orbit target sat low
// in a landscape window. The fit shifts the lens (a view offset: the camera
// still stands and turns about the board's centre, nothing pans) so the board
// sits in the middle of the window between the HUD's bands, and fits the
// distance to it.
//
// What it frames is the same from every side: circles about the tower's
// vertical axis (FrameRing), wide enough for the tower and its labels at any
// azimuth. A circle about the axis looks the same however far the camera has
// turned round it, so the fit and the shift depend on the camera's elevation
// alone, and the shift is only ever vertical: the tower's axis stays in the
// middle of the window across while the view turns. (Centring the outline as
// seen, a diamond one moment and a square the next, with its labels wherever
// they stood, slid the view sideways as it turned, with kinks where the
// outline's extreme corner changed and jumps where a label changed side.)

/** Rows of CSS pixels at the top of the window kept for the HUD (its pill), which the fitted board stays below. */
export const HUD_TOP_PX = 56;

/**
 * Rows kept under the pill for the pieces each side has taken (index.css,
 * .hud-captures: 18 px tall, 4 px under the pill), in every window but a
 * short one, where they stand at the top left beside the tower instead. Kept
 * from the first move, so the first capture never moves the board.
 */
export const CAPTURES_BAND_PX = 26;

/**
 * The band at the top of the window, in CSS px, that the fitted board keeps
 * clear of: the pill and the pieces taken under it. In a short window (a phone
 * on its side) the pieces taken stand at the top left beside the tower, so
 * only the pill's band remains.
 */
export const hudTop = (height: number): number =>
  HUD_TOP_PX + (height <= 480 ? 0 : CAPTURES_BAND_PX);

/**
 * Breathing room for the fit, as a factor on the room the board takes.
 */
const FRAME_MARGIN = 1.05;

/**
 * A horizontal circle about the vertical axis through the orbit target (the
 * origin), or the arc of it on the far side of the axis from the camera: part
 * of what the fitted view keeps in frame from every side.
 */
export interface FrameRing {
  /** Height of the circle's plane. */
  y: number;
  radius: number;
  /**
   * Only the arc within this angle (radians) either side of the point
   * straight behind the axis, for something that always stands on the far
   * side of the tower from the camera; the whole circle when unset.
   */
  behind?: number;
}

/**
 * Where things fall in a camera's view, as tangents of the angle off its axis
 * (x right, y up): the frustum spans ±tan(fov / 2) vertically.
 */
interface ViewBounds {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

/** The distance inside which a camera at `elevation` would stand among the rings (or level with a point of them). */
const nearestOutside = (rings: readonly FrameRing[], elevation: number): number => {
  const [s, c] = [Math.sin(elevation), Math.cos(elevation)];
  return Math.max(0, ...rings.map(({ y, radius }) => y * s + radius * Math.abs(c)));
};

/**
 * How softly (in tangents of the view angle) the fit's top and bottom pass
 * from one ring to another, and from a ring's near side to its far side as
 * the camera climbs through its plane (a platform seen edge-on): a hard
 * maximum turns the view's drift abruptly where one takes over; this eases it
 * over a few degrees, framing never less than the rings and at most this much
 * (times ln 2) more where two tie.
 */
export const FIT_SOFTNESS = 0.008;

/** The greatest of `values`, or with `softness` a smooth maximum never below it. */
const greatest = (values: number[], softness: number) => {
  const most = Math.max(...values);
  if (softness <= 0) return most;
  return (
    most + softness * Math.log(values.reduce((sum, v) => sum + Math.exp((v - most) / softness), 0))
  );
};

/**
 * Where `rings` fall in the view of a camera `distance` from the origin at
 * `elevation` (radians above the horizon) looking at it, level (as
 * OrbitControls holds it), as tangents of the angle off its axis. The same at
 * every azimuth, and symmetric across: left is -right. With `softness`, the
 * top and bottom are smooth maxima over the rings' sides (FIT_SOFTNESS).
 */
export function ringBounds(
  rings: readonly FrameRing[],
  elevation: number,
  distance: number,
  softness = 0,
): ViewBounds {
  const [s, c] = [Math.sin(elevation), Math.cos(elevation)];
  let right = 0;
  const ups: number[] = [];
  const downs: number[] = [];
  for (const { y, radius: r, behind } of rings) {
    // The circle's point at angle t round from the one nearest the camera
    // stands r sin t across, y cos e - r cos t sin e up and
    // D - y sin e - r cos t cos e deep. Up and deep follow cos t alone, so the
    // top and bottom are where cos t is least or greatest; across, the edge
    // is where the camera's line grazes the circle, cos t = r cos e / (D - y
    // sin e), or the arc's end if it stops short of that.
    const deep = distance - y * s;
    const most = behind === undefined ? 1 : -Math.cos(behind);
    for (const u of [-1, most]) {
      const v = (y * c - r * u * s) / Math.max(deep - r * u * c, 1e-9);
      ups.push(v);
      downs.push(-v);
    }
    const graze = (r * c) / deep;
    const across =
      graze <= most
        ? r / Math.sqrt(Math.max(deep * deep - r * r * c * c, 1e-18))
        : (r * Math.sqrt(1 - most * most)) / Math.max(deep - r * most * c, 1e-9);
    right = Math.max(right, across);
  }
  return { left: -right, right, bottom: -greatest(downs, softness), top: greatest(ups, softness) };
}

/** The window a fit is for: its size in CSS px, vertical field of view and HUD band. */
interface FitWindow {
  width: number;
  height: number;
  fov: number;
  /** CSS px kept clear at the top (HUD_TOP_PX by default). */
  topInset?: number;
}

/** The band as a share of the window's height, at most half of it. */
const bandShare = (w: FitWindow): number => Math.min((w.topInset ?? HUD_TOP_PX) / w.height, 0.5);

/**
 * The lens shift that centres `bounds` in the window below its top band, in
 * the same tangent units (x right, y up): the view's centre
 * moves there. For ringBounds, whose left is -right, it is vertical only.
 */
export function centringShift(bounds: ViewBounds, w: FitWindow): [number, number] {
  const tanV = Math.tan(MathUtils.degToRad(w.fov) / 2);
  return [(bounds.left + bounds.right) / 2, (bounds.bottom + bounds.top) / 2 + tanV * bandShare(w)];
}

/**
 * The distance from the orbit target at which `rings`, seen from `elevation`
 * (radians) and centred by a lens shift, fill the window below its band
 * with FRAME_MARGIN to spare on the tighter axis; and that shift (both with
 * the top and bottom eased from ring to ring, FIT_SOFTNESS). Neither depends
 * on the camera's azimuth. Zooming is relative to this distance
 * (zoomRange).
 */
export function fitView(
  elevation: number,
  rings: readonly FrameRing[],
  w: FitWindow,
): { distance: number; shift: [number, number] } {
  const tanV = Math.tan(MathUtils.degToRad(w.fov) / 2);
  const tanH = tanV * (w.width / w.height);
  const band = bandShare(w);
  // How much of the room the rings take at distance D (1: exactly the room)
  const fill = (distance: number) => {
    const b = ringBounds(rings, elevation, distance, FIT_SOFTNESS);
    return Math.max(
      ((b.right - b.left) * FRAME_MARGIN) / (2 * tanH),
      ((b.top - b.bottom) * FRAME_MARGIN) / (2 * tanV * (1 - band)),
    );
  };
  let near = nearestOutside(rings, elevation) + 1e-3;
  let far = Math.max(near * 2, 1);
  while (fill(far) > 1 && far < 1e6) far *= 2;
  for (let i = 0; i < 60; i++) {
    const mid = (near + far) / 2;
    if (fill(mid) > 1) near = mid;
    else far = mid;
  }
  return {
    distance: far,
    shift: centringShift(ringBounds(rings, elevation, far, FIT_SOFTNESS), w),
  };
}

/** A camera's elevation above the horizon about `target` (radians), from its position. */
export const elevationOf = (camera: Vector3, target: Vector3): number => {
  const d = camera.clone().sub(target);
  const length = d.length();
  return length > 0 ? Math.asin(MathUtils.clamp(d.y / length, -1, 1)) : 0;
};
