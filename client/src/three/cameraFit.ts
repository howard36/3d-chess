import { MathUtils, PerspectiveCamera, Vector3 } from 'three';

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
