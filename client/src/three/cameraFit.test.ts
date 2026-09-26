import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { BOARD_HALF_EXTENT, DEFAULT_VIEW_DIRECTION, fitDistance } from './cameraFit';

const corners = [-1, 1].flatMap((x) =>
  [-1, 1].flatMap((y) =>
    [-1, 1].map((z) => new Vector3(x, y, z).multiplyScalar(BOARD_HALF_EXTENT)),
  ),
);

// Where each board corner lands on screen, in normalized device coordinates
// (the visible window is -1..1 on both axes).
function projectCorners(direction: Vector3, aspect: number, fov = 40) {
  const camera = new PerspectiveCamera(fov, aspect, 0.1, 100);
  camera.position
    .copy(direction)
    .normalize()
    .multiplyScalar(fitDistance(direction, aspect, fov));
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return corners.map((c) => c.clone().project(camera));
}

describe('fitDistance', () => {
  it.each([
    ['a wide desktop window', 1280 / 720],
    ['a square window', 1],
    ['an upright phone', 375 / 667],
    ['a very tall, narrow window', 0.3],
  ])('keeps the whole board in frame in %s', (_, aspect) => {
    for (const direction of [
      DEFAULT_VIEW_DIRECTION,
      new Vector3(0, 1, 0.01),
      new Vector3(-1, -0.4, 0.2),
    ]) {
      const ndc = projectCorners(direction, aspect);
      for (const p of ndc) {
        expect(Math.abs(p.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
      }
      // ...and fills it: the fit is tight on at least one axis
      const extent = Math.max(...ndc.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))));
      expect(extent).toBeGreaterThan(0.85);
    }
  });

  it('stands further back the narrower the window', () => {
    const wide = fitDistance(DEFAULT_VIEW_DIRECTION, 16 / 9, 40);
    const phone = fitDistance(DEFAULT_VIEW_DIRECTION, 375 / 667, 40);
    expect(phone).toBeGreaterThan(wide * 1.3);
  });
});

describe("fitDistance for a design's board box", () => {
  it('stands further back for a taller box, and matches the cube by default', () => {
    const cube = fitDistance(DEFAULT_VIEW_DIRECTION, 16 / 9, 40);
    const same = fitDistance(DEFAULT_VIEW_DIRECTION, 16 / 9, 40, [
      BOARD_HALF_EXTENT,
      BOARD_HALF_EXTENT,
      BOARD_HALF_EXTENT,
    ]);
    const tower = fitDistance(DEFAULT_VIEW_DIRECTION, 16 / 9, 40, [
      BOARD_HALF_EXTENT,
      BOARD_HALF_EXTENT * 2,
      BOARD_HALF_EXTENT,
    ]);
    expect(same).toBeCloseTo(cube);
    expect(tower).toBeGreaterThan(cube);
  });
});
