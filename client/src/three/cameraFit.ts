import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import type { Camera } from 'three';

/** Breathing room around the board, as a fraction of the fitted distance. */
const MARGIN = 1.08;

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

const cornersOf = ([hx, hy, hz]: readonly [number, number, number]) =>
  [-1, 1].flatMap((x) =>
    [-1, 1].flatMap((y) => [-1, 1].map((z) => new Vector3(x * hx, y * hy, z * hz))),
  );

/**
 * How far from the board's centre a camera looking at it from `direction`
 * must stand for the whole board to fit in a viewport of this aspect ratio
 * (width / height) with this vertical field of view. The fixed distance the
 * view used to open at fitted the height only, so a window narrower than it
 * was tall (a phone held upright) cut off both sides of the board. The board
 * is a box of the given half extents.
 */
export function fitDistance(
  direction: Vector3,
  aspect: number,
  fovDeg: number,
  halfExtents: readonly [number, number, number],
): number {
  const tanV = Math.tan(MathUtils.degToRad(fovDeg) / 2);
  const tanH = tanV * aspect;
  // A camera one unit out along `direction`: in its frame a corner sits at
  // lateral (x, y) and depth 1 - p·d, and moving the camera out to distance D
  // only changes the depth, to D - p·d. The corner is in frame once
  // |x| / (D - p·d) <= tanH and |y| / (D - p·d) <= tanV.
  const probe = new PerspectiveCamera();
  probe.position.copy(direction).normalize();
  probe.lookAt(0, 0, 0);
  probe.updateMatrixWorld();
  let distance = 0;
  for (const corner of cornersOf(halfExtents)) {
    const c = corner.clone().applyMatrix4(probe.matrixWorldInverse);
    const along = 1 + c.z; // p·d
    distance = Math.max(distance, along + Math.abs(c.x) / tanH, along + Math.abs(c.y) / tanV);
  }
  return distance * MARGIN;
}

// --- The centred fit -------------------------------------------------------------
//
// fitDistance fits the box symmetrically about the orbit target, but under
// perspective the box's near corners project further from the middle than its
// far ones, and a turned view pushes one side out: the board sat low in a
// landscape window and hugged the left edge of an upright phone, with three
// or four times the margin on the other side. The centred fit shifts the lens
// (a view offset: the camera still stands and turns about the board's centre,
// nothing pans) so the board's outline on screen sits in the middle of the
// window below the HUD's top band, and fits the distance to that outline.

/** Rows of CSS pixels at the top of the window kept for the HUD (its pill), which the fitted board stays below. */
export const HUD_TOP_PX = 56;

/**
 * Breathing room for the centred fit, as a factor on the room the board
 * takes. Smaller than fitDistance's MARGIN: that one also had to cover the
 * labels outside the box and the uneven margins, and the centred fit frames
 * the labels and shares the room evenly.
 */
const FRAME_MARGIN = 1.05;

/** The corners of a box of these half extents about the origin. */
export const boxCorners = (halfExtents: readonly [number, number, number]): Vector3[] =>
  cornersOf(halfExtents);

/**
 * Where points fall in a camera's view, as tangents of the angle off its axis
 * (x right, y up): the frustum spans ±tan(fov / 2) vertically.
 */
export interface ViewBounds {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

/** A point in the camera's frame: lateral offsets and distance along its axis from the camera's origin. */
type Lateral = { x: number; y: number; along: number };

const boundsAt = (points: readonly Lateral[], distance: number): ViewBounds => {
  const b = { left: Infinity, right: -Infinity, bottom: Infinity, top: -Infinity };
  for (const { x, y, along } of points) {
    const depth = Math.max(distance - along, 1e-6);
    b.left = Math.min(b.left, x / depth);
    b.right = Math.max(b.right, x / depth);
    b.bottom = Math.min(b.bottom, y / depth);
    b.top = Math.max(b.top, y / depth);
  }
  return b;
};

/** `points` in the frame of `camera` (its world matrices up to date), as ViewBounds. */
export function viewBounds(points: readonly Vector3[], camera: Camera): ViewBounds {
  const v = new Vector3();
  return boundsAt(
    points.map((p) => {
      v.copy(p).applyMatrix4(camera.matrixWorldInverse);
      return { x: v.x, y: v.y, along: v.z };
    }),
    0,
  );
}

/** The window a fit is for: its size in CSS px, vertical field of view and HUD band. */
export interface FitWindow {
  width: number;
  height: number;
  fov: number;
  /** CSS px kept clear at the top (HUD_TOP_PX by default). */
  topInset?: number;
}

/**
 * The lens shift that centres `bounds` in the window below its top band, in
 * the same tangent units (x right, y up): the view's centre moves there.
 */
export function centringShift(bounds: ViewBounds, w: FitWindow): [number, number] {
  const tanV = Math.tan(MathUtils.degToRad(w.fov) / 2);
  const band = Math.min((w.topInset ?? HUD_TOP_PX) / w.height, 0.5);
  return [(bounds.left + bounds.right) / 2, (bounds.bottom + bounds.top) / 2 + tanV * band];
}

/**
 * The distance along `direction` (from the orbit target at the origin) at
 * which `points`, centred by a lens shift, fill the window below its top band
 * with FRAME_MARGIN to spare on the tighter axis; and that shift. Zooming is
 * relative to this distance (zoomRange).
 */
export function fitView(
  direction: Vector3,
  points: readonly Vector3[],
  w: FitWindow,
): { distance: number; shift: [number, number] } {
  const tanV = Math.tan(MathUtils.degToRad(w.fov) / 2);
  const tanH = tanV * (w.width / w.height);
  const band = Math.min((w.topInset ?? HUD_TOP_PX) / w.height, 0.5);
  const probe = new PerspectiveCamera();
  probe.position.copy(direction).normalize();
  probe.lookAt(0, 0, 0);
  probe.updateMatrixWorld();
  // In the probe's frame (one unit out) a point sits at lateral (x, y) and
  // depth 1 - p·d; at distance D the depth is D - p·d
  const v = new Vector3();
  const lateral = points.map((p) => {
    v.copy(p).applyMatrix4(probe.matrixWorldInverse);
    return { x: v.x, y: v.y, along: 1 + v.z };
  });
  const nearest = Math.max(0, ...lateral.map((p) => p.along));
  // How much of the room the points take at distance D (1: exactly the room)
  const fill = (distance: number) => {
    const b = boundsAt(lateral, distance);
    return Math.max(
      ((b.right - b.left) * FRAME_MARGIN) / (2 * tanH),
      ((b.top - b.bottom) * FRAME_MARGIN) / (2 * tanV * (1 - band)),
    );
  };
  let near = nearest + 1e-3;
  let far = Math.max(near * 2, 1);
  while (fill(far) > 1 && far < 1e6) far *= 2;
  for (let i = 0; i < 60; i++) {
    const mid = (near + far) / 2;
    if (fill(mid) > 1) near = mid;
    else far = mid;
  }
  return { distance: far, shift: centringShift(boundsAt(lateral, far), w) };
}
