import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { ZOOM_IN, ZOOM_OUT, fitDistance, zoomRange } from './cameraFit';
import { towerLayout } from './layout';

// The board's box and opening view: the tower's
const { halfExtents: BOX, viewDirection } = towerLayout();
const VIEW = new Vector3(...viewDirection);
const [hx, hy, hz] = BOX;
const corners = [-1, 1].flatMap((x) =>
  [-1, 1].flatMap((y) => [-1, 1].map((z) => new Vector3(x * hx, y * hy, z * hz))),
);

// Where each board corner lands on screen, in normalized device coordinates
// (the visible window is -1..1 on both axes).
function projectCorners(direction: Vector3, aspect: number, fov = 40) {
  const camera = new PerspectiveCamera(fov, aspect, 0.1, 100);
  camera.position
    .copy(direction)
    .normalize()
    .multiplyScalar(fitDistance(direction, aspect, fov, BOX));
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
    for (const direction of [VIEW, new Vector3(0, 1, 0.01), new Vector3(-1, -0.4, 0.2)]) {
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
    const wide = fitDistance(VIEW, 16 / 9, 40, BOX);
    const phone = fitDistance(VIEW, 375 / 667, 40, BOX);
    expect(phone).toBeGreaterThan(wide * 1.3);
  });

  it('stands further back for a taller box', () => {
    const taller = fitDistance(VIEW, 16 / 9, 40, [hx, hy * 2, hz]);
    expect(taller).toBeGreaterThan(fitDistance(VIEW, 16 / 9, 40, BOX));
  });
});

describe('zoomRange', () => {
  it('lets the player zoom a fixed fraction in and out of the fitted view', () => {
    expect(zoomRange(20)).toEqual({ min: 20 * ZOOM_IN, max: 20 * ZOOM_OUT });
    // Proportionally the same on an upright phone, which fits from farther away
    const phone = fitDistance(VIEW, 375 / 667, 40, BOX);
    const { min, max } = zoomRange(phone);
    expect(min / phone).toBeCloseTo(ZOOM_IN);
    expect(max / phone).toBeCloseTo(ZOOM_OUT);
  });

  it("only narrows the range by the layout's nearest distance", () => {
    expect(zoomRange(20, 5)).toEqual({ min: 14, max: 30 });
    expect(zoomRange(20, 16)).toEqual({ min: 16, max: 30 });
    // Never past the farthest
    expect(zoomRange(20, 40)).toEqual({ min: 30, max: 30 });
  });
});
