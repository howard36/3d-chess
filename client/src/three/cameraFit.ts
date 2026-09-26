import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { GRID_SIZE, SPACING } from './layout';

/** Half the side of the lattice's bounding box: outermost cell centre plus half a cell. */
export const BOARD_HALF_EXTENT = ((GRID_SIZE - 1) / 2) * SPACING + 0.5;

/** The side from which a new game first sees the board (camera direction from the centre). */
export const DEFAULT_VIEW_DIRECTION = new Vector3(6.5, 5, 8.5).normalize();

/** Breathing room around the board, as a fraction of the fitted distance. */
const MARGIN = 1.08;

const cornersOf = ([hx, hy, hz]: readonly [number, number, number]) =>
  [-1, 1].flatMap((x) =>
    [-1, 1].flatMap((y) => [-1, 1].map((z) => new Vector3(x * hx, y * hy, z * hz))),
  );

const CUBE: [number, number, number] = [BOARD_HALF_EXTENT, BOARD_HALF_EXTENT, BOARD_HALF_EXTENT];

/**
 * How far from the board's centre a camera looking at it from `direction`
 * must stand for the whole board to fit in a viewport of this aspect ratio
 * (width / height) with this vertical field of view. The fixed distance the
 * view used to open at fitted the height only, so a window narrower than it
 * was tall (a phone held upright) cut off both sides of the board. The board
 * is a box of the given half extents: the classic cube unless a design lays
 * the cells out otherwise.
 */
export function fitDistance(
  direction: Vector3,
  aspect: number,
  fovDeg: number,
  halfExtents: readonly [number, number, number] = CUBE,
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
