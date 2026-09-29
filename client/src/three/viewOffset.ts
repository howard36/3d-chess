import { MathUtils } from 'three';
import type { PerspectiveCamera } from 'three';

// FitCameraToBoard keeps the board centred on screen with a lens shift: a
// view offset on the camera's projection, so the camera itself still stands
// and turns about the board's centre (nothing pans).

/** A lens shift: where the view's centre points, as tangents of the angle off the camera's axis (x right, y up). */
type LensShift = [number, number];

/** The camera's lens shift ([0, 0] until one is set). */
export const lensShiftOf = (camera: PerspectiveCamera): LensShift =>
  (camera.userData.lensShift as LensShift | undefined) ?? [0, 0];

/** Sets the camera's lens shift for a `width` x `height` view (CSS px), clearing the offset for none. */
export function setLensShift(
  camera: PerspectiveCamera,
  shift: LensShift,
  width: number,
  height: number,
): void {
  camera.userData.lensShift = shift;
  // Pixels per unit of tangent, vertically and (square pixels) across
  const k = (height * camera.zoom) / (2 * Math.tan(MathUtils.degToRad(camera.fov) / 2));
  const [x, y] = [shift[0] * k, -shift[1] * k];
  if (x === 0 && y === 0) {
    if (camera.view?.enabled) camera.clearViewOffset();
    return;
  }
  camera.setViewOffset(width, height, x, y, width, height);
}
