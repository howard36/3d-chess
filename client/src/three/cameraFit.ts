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
// The camera stands and turns about the tower's centre (the orbit target, a
// fixed point of the tower: BoardLayout), and a lens shift (a view offset:
// nothing pans) sets where that centre stands on screen. It is the one point
// on screen that never moves, whichever way the view turns, and it is set from
// the window alone: a little (CENTRE_LIFT) above the middle of the room
// between what the HUD shows at the top (its pill: FitWindow.balanceInset)
// and the window's bottom. The band under the pill kept for the pieces taken,
// mostly empty, is only kept clear.
//
// No one point frames every view in the middle. Under perspective, from low
// down the bottom platform's near edge, close to the camera, reaches further
// below the centre than the top reaches above it, so the tower sits low; from
// high up, or looking up from under it, it sits high. Most of a game is
// played from low down (10-35° up), and a shape in the exact middle reads as
// low, so the lift leans the balance their way: from them the tower stands a
// little below the middle (2-3% of the room), from overhead and from
// under it somewhat more above it (at most about 6%). (Centring the rings as
// seen from the opening put the centre 50 px higher in a 720 px window, and
// climbing the view ran the top level under the pill; the middle of the room
// below the band left the views the game is played from 40-60 px low in a
// 900 px window.)
//
// What the fit keeps in frame is the same from every side: circles about the
// tower's vertical axis (FrameRing), wide enough for the tower and its labels
// at any azimuth. A circle about the axis looks the same however far the
// camera has turned round it, so the fit depends on the camera's elevation
// alone, and the shift is only ever vertical: the tower's axis stays in the
// middle of the window across while the view turns. (Centring the outline as
// seen, a diamond one moment and a square the next, with its labels wherever
// they stood, slid the view sideways as it turned, with kinks where the
// outline's extreme corner changed and jumps where a label changed side.) The
// distance fits the rings in the room about the centre from every elevation
// the view can reach (FitWindow.sweep), so the tower and its labels never
// cross the HUD's band or the window's edge however far the view climbs or
// dips, with FRAME_MARGIN to spare at the opening.
//
// The landing page's preview, which only ever turns about the axis at one
// elevation, centres the rings as seen from there instead (centre: 'rings').

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
 * Breathing room for the fit at the opening elevation, as a factor on the
 * room the board takes there (from every other elevation it only has to fit).
 */
const FRAME_MARGIN = 1.05;

/**
 * How far above the middle of the room under the HUD the tower's centre
 * stands, as a share of the rings' height as seen from the opening: the
 * balance over the whole orbit (see The centred fit).
 */
export const CENTRE_LIFT = 0.03;

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
export interface FitWindow {
  width: number;
  height: number;
  fov: number;
  /** CSS px kept clear at the top (HUD_TOP_PX by default). */
  topInset?: number;
  /** CSS px kept clear at the bottom (none by default). */
  bottomInset?: number;
  /**
   * CSS px from the top that the tower's centre is balanced below, with the
   * target centred: the bottom of what the HUD shows there (its pill), where
   * the top band also keeps room for what it may show later (the pieces
   * taken). Within the top band; the top band by default.
   */
  balanceInset?: number;
  /**
   * What the lens shift puts in the middle of the room between the bands:
   * the orbit target, the tower's centre ('target', the default: the game,
   * whose view climbs and dips), or the rings' top and bottom as seen from
   * the fitted elevation ('rings': a view that only turns about the axis).
   */
  centre?: 'target' | 'rings';
  /**
   * The lowest and highest elevations (radians) the view can turn to: with
   * the target centred, the rings stay in the room from all of them. Only
   * the fitted elevation when unset.
   */
  sweep?: readonly [number, number];
}

/** The elevations (radians) an orbit's polar-angle limits let the camera reach, lowest first. */
export const orbitSweep = (orbit: {
  minPolarAngle: number;
  maxPolarAngle: number;
}): [number, number] => [Math.PI / 2 - orbit.maxPolarAngle, Math.PI / 2 - orbit.minPolarAngle];

/** Elevations from `lo` to `hi` (radians), both included, at most a degree apart. */
const elevationsBetween = (lo: number, hi: number): number[] => {
  const steps = Math.max(1, Math.ceil((hi - lo) / MathUtils.degToRad(1)));
  return Array.from({ length: steps + 1 }, (_, i) => lo + ((hi - lo) * i) / steps);
};

/** The top band as a share of the window's height, at most half of it. */
const bandShare = (w: FitWindow): number => Math.min((w.topInset ?? HUD_TOP_PX) / w.height, 0.5);

/** The bottom band as a share of the window's height, at most what the top band leaves of half of it. */
const bottomShare = (w: FitWindow): number =>
  Math.min((w.bottomInset ?? 0) / w.height, Math.max(0, 0.5 - bandShare(w)));

/**
 * Where the target stands with the target centred, as a share of the
 * window's height from its top: CENTRE_LIFT of the rings' height (`tall`, in
 * tangents) above the middle of the room between the balance line and the
 * bottom band.
 */
const targetRow = (w: FitWindow, tall: number): number => {
  const tanV = Math.tan(MathUtils.degToRad(w.fov) / 2);
  const top = Math.min((w.balanceInset ?? Infinity) / w.height, bandShare(w));
  return (top + 1 - bottomShare(w)) / 2 - (CENTRE_LIFT * tall) / (2 * tanV);
};

/**
 * The lens shift that centres `bounds` in the window between its top and
 * bottom bands, in the same tangent units (x right, y up): the view's centre
 * moves there. For ringBounds, whose left is -right, it is vertical only.
 */
export function centringShift(bounds: ViewBounds, w: FitWindow): [number, number] {
  const tanV = Math.tan(MathUtils.degToRad(w.fov) / 2);
  return [
    (bounds.left + bounds.right) / 2,
    (bounds.bottom + bounds.top) / 2 + tanV * (bandShare(w) - bottomShare(w)),
  ];
}

/**
 * The lens shift of a view fitted to `rings` from `elevation` (radians),
 * `distance` from the orbit target: the target CENTRE_LIFT of the rings'
 * height above the middle of the room between the window's bands, or the
 * rings in the middle (FitWindow.centre). Set with the fit and kept as the
 * view moves (FitCameraToBoard).
 */
export function fitShift(
  rings: readonly FrameRing[],
  elevation: number,
  distance: number,
  w: FitWindow,
): [number, number] {
  const b = ringBounds(rings, elevation, distance, FIT_SOFTNESS);
  if (w.centre === 'rings') return centringShift(b, w);
  // (the view's centre moves up as far as the target is to stand below it)
  const tanV = Math.tan(MathUtils.degToRad(w.fov) / 2);
  return [0, tanV * (2 * targetRow(w, b.top - b.bottom) - 1)];
}

/**
 * The distance from the orbit target at which `rings`, seen from `elevation`
 * (radians) and placed by a lens shift (fitShift), fill the window between
 * its bands with FRAME_MARGIN to spare on the tighter axis; and that shift
 * (both with the top and bottom eased from ring to ring, FIT_SOFTNESS).
 * Neither depends on the camera's azimuth. With the target placed, the rings'
 * reach above and below it each take their side of the room, from
 * `elevation` with the margin and from every elevation of FitWindow.sweep
 * without. Zooming is relative to this distance (zoomRange).
 */
export function fitView(
  elevation: number,
  rings: readonly FrameRing[],
  w: FitWindow,
): { distance: number; shift: [number, number] } {
  const tanV = Math.tan(MathUtils.degToRad(w.fov) / 2);
  const tanH = tanV * (w.width / w.height);
  const band = bandShare(w) + bottomShare(w);
  // Half the room's height
  const half = tanV * (1 - band);
  // How much of the room the rings take at distance D (1: exactly the room),
  // from the fitted elevation (with the margin) and from any other
  const measure = (distance: number) => {
    const b = ringBounds(rings, elevation, distance, FIT_SOFTNESS);
    if (w.centre === 'rings') {
      const fitted = Math.max(
        (b.right * FRAME_MARGIN) / tanH,
        ((b.top - b.bottom) * FRAME_MARGIN) / (2 * half),
      );
      return { fitted, from: () => 0 };
    }
    // The room above the target, to the top band, and below it, to the
    // bottom band, as fitShift places it
    const row = targetRow(w, b.top - b.bottom);
    const above = 2 * tanV * (row - bandShare(w));
    const below = 2 * tanV * (1 - bottomShare(w) - row);
    const take = (v: ViewBounds) => Math.max(v.right / tanH, v.top / above, -v.bottom / below);
    return {
      fitted: take(b) * FRAME_MARGIN,
      from: (e: number) => take(ringBounds(rings, e, distance, FIT_SOFTNESS)),
    };
  };
  const fill = (distance: number, others: readonly number[]) => {
    const m = measure(distance);
    return Math.max(m.fitted, ...others.map(m.from));
  };
  // The nearest distance at which the rings fill no more than the room
  const nearest = (others: readonly number[]) => {
    let near = Math.max(...[elevation, ...others].map((e) => nearestOutside(rings, e))) + 1e-3;
    let far = Math.max(near * 2, 1);
    while (fill(far, others) > 1 && far < 1e6) far *= 2;
    for (let i = 0; i < 60; i++) {
      const mid = (near + far) / 2;
      if (fill(mid, others) > 1) near = mid;
      else far = mid;
    }
    return far;
  };
  // The sweep's elevations, a degree apart, all in the room: fitted to the
  // few that bind (each pass adds the one that most overflows the fit so
  // far), which stands exactly where fitting to them all would, at a sliver
  // of the cost
  const sweep = w.sweep && w.centre !== 'rings' ? elevationsBetween(...w.sweep) : [];
  const binding: number[] = [];
  let far = nearest(binding);
  for (;;) {
    const m = measure(far);
    let worst = 1;
    let over: number | undefined;
    for (const e of sweep) {
      const f = m.from(e);
      if (f > worst && !binding.includes(e)) [worst, over] = [f, e];
    }
    if (over === undefined) break;
    binding.push(over);
    far = nearest(binding);
  }
  return { distance: far, shift: fitShift(rings, elevation, far, w) };
}

/** A camera's elevation above the horizon about `target` (radians), from its position. */
export const elevationOf = (camera: Vector3, target: Vector3): number => {
  const d = camera.clone().sub(target);
  const length = d.length();
  return length > 0 ? Math.asin(MathUtils.clamp(d.y / length, -1, 1)) : 0;
};
