import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import {
  HUD_TOP_PX,
  hudBands,
  MOVE_CARD_BAND_PX,
  ZOOM_IN,
  ZOOM_OUT,
  boxCorners,
  centringShift,
  fitDistance,
  fitView,
  viewBounds,
  zoomRange,
} from './cameraFit';
import { towerLayout } from './layout';
import { lensShiftOf, setLensShift } from './viewOffset';

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

// The tall tower box of the kit's layouts, seen from its opening view (18° up, 16° round)
const TOWER: [number, number, number] = [2.8, 3.15, 2.8];
const TOWER_VIEW = new Vector3(
  Math.sin(0.28) * Math.cos(0.314),
  Math.sin(0.314),
  Math.cos(0.28) * Math.cos(0.314),
);

/** A camera fitted by fitView, with its lens shift applied; and the points' rectangle on screen in CSS px. */
function fitted(
  direction: Vector3,
  width: number,
  height: number,
  points = boxCorners(TOWER),
  topInset?: number,
  bottomInset?: number,
) {
  const fov = 36;
  const view = {
    width,
    height,
    fov,
    ...(topInset !== undefined ? { topInset } : {}),
    ...(bottomInset !== undefined ? { bottomInset } : {}),
  };
  const { distance, shift } = fitView(direction, points, view);
  const camera = new PerspectiveCamera(fov, width / height, 0.1, 1000);
  camera.position.copy(direction).normalize().multiplyScalar(distance);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  setLensShift(camera, shift, width, height);
  const px = points.map((p) => {
    const n = p.clone().project(camera);
    return [((n.x + 1) / 2) * width, ((1 - n.y) / 2) * height];
  });
  const xs = px.map(([x]) => x);
  const ys = px.map(([, y]) => y);
  const rect = {
    left: Math.min(...xs),
    right: width - Math.max(...xs),
    top: Math.min(...ys),
    bottom: height - Math.max(...ys),
  };
  return { distance, shift, camera, rect };
}

describe('fitView', () => {
  it.each([
    ['a 16:9 desktop', 1280, 720],
    ['an ultrawide', 3440, 1440],
    ['an upright phone', 390, 844],
    ['a phone on its side', 844, 390],
    ['a narrow window', 500, 1000],
  ])('centres the tower in %s, below the HUD band, and fills it on one axis', (_, w, h) => {
    for (const direction of [TOWER_VIEW, new Vector3(6.5, 5, 8.5), new Vector3(0.1, 1, 0.3)]) {
      const { rect } = fitted(direction, w, h);
      // Centred across, and in the band below the HUD's top rows
      expect(Math.abs(rect.left - rect.right)).toBeLessThan(0.5);
      expect(Math.abs(rect.top - HUD_TOP_PX - rect.bottom)).toBeLessThan(0.5);
      expect(rect.top).toBeGreaterThan(HUD_TOP_PX);
      // Fills the window on its tighter axis, with a little room to spare
      const across = (w - rect.left - rect.right) / w;
      const down = (h - rect.top - rect.bottom) / (h - HUD_TOP_PX);
      expect(Math.max(across, down)).toBeGreaterThan(0.94);
      expect(Math.max(across, down)).toBeLessThan(0.96);
    }
  });

  it('centres in the whole window without a HUD band', () => {
    const { rect } = fitted(TOWER_VIEW, 1280, 720, boxCorners(TOWER), 0);
    expect(Math.abs(rect.top - rect.bottom)).toBeLessThan(0.5);
    expect(Math.abs(rect.left - rect.right)).toBeLessThan(0.5);
  });

  it('keeps a bottom band clear too, centring between the bands', () => {
    for (const [w, h] of [
      [700, 900],
      [390, 844],
      [768, 1024],
    ]) {
      const { rect } = fitted(TOWER_VIEW, w, h, boxCorners(TOWER), HUD_TOP_PX, MOVE_CARD_BAND_PX);
      expect(rect.bottom).toBeGreaterThan(MOVE_CARD_BAND_PX);
      expect(rect.top).toBeGreaterThan(HUD_TOP_PX);
      expect(Math.abs(rect.top - HUD_TOP_PX - (rect.bottom - MOVE_CARD_BAND_PX))).toBeLessThan(0.5);
    }
  });

  it('frames the tower larger than the symmetric fit, which it used to sit low or aside in', () => {
    for (const [w, h] of [
      [1280, 720],
      [390, 844],
    ]) {
      const old = fitDistance(TOWER_VIEW, w / h, 36, TOWER);
      expect(fitted(TOWER_VIEW, w, h).distance).toBeLessThan(old * 0.97);
    }
  });

  it('frames extra points, such as labels standing outside the box', () => {
    const labels = [new Vector3(-3.6, -2, 2.4), new Vector3(-3.6, 2, -2.4)];
    const plain = fitted(TOWER_VIEW, 390, 844);
    const framed = fitted(TOWER_VIEW, 390, 844, [...boxCorners(TOWER), ...labels]);
    expect(framed.distance).toBeGreaterThan(plain.distance);
    expect(Math.abs(framed.rect.left - framed.rect.right)).toBeLessThan(0.5);
  });

  it('turns the camera about the board centre: the lens shift moves the picture, never the camera', () => {
    const { camera, shift } = fitted(TOWER_VIEW, 1280, 720);
    // The camera still looks straight at the origin
    const ahead = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    expect(ahead.dot(camera.position.clone().normalize().negate())).toBeCloseTo(1, 6);
    // The board sat low: the shift moves the view down onto it
    expect(shift[1]).toBeLessThan(0);
  });
});

describe('centringShift and viewBounds', () => {
  it('measures points as tangents off the camera axis', () => {
    const camera = new PerspectiveCamera(36, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const b = viewBounds(
      [new Vector3(-1, 0, 0), new Vector3(2, 3, 0), new Vector3(0, -1, 5)],
      camera,
    );
    expect(b.left).toBeCloseTo(-0.1);
    expect(b.right).toBeCloseTo(0.2);
    expect(b.top).toBeCloseTo(0.3);
    expect(b.bottom).toBeCloseTo(-0.2);
  });

  it('aims the view at the middle of the bounds, lowered by half the HUD band', () => {
    const bounds = { left: -0.1, right: 0.3, bottom: -0.2, top: 0.2 };
    const tanV = Math.tan((36 * Math.PI) / 360);
    const [x, y] = centringShift(bounds, { width: 800, height: 800, fov: 36, topInset: 80 });
    expect(x).toBeCloseTo(0.1);
    // A band of 80 of 800 rows: the middle of the rest is 40 rows (0.1 tanV) below the middle
    expect(y).toBeCloseTo(0.1 * tanV);
    expect(centringShift(bounds, { width: 800, height: 800, fov: 36, topInset: 0 })[1]).toBeCloseTo(
      0,
    );
  });
});

describe('hudBands', () => {
  it('keeps the pill band always, and the move card band only while the card spans the bottom', () => {
    expect(hudBands(1280, 720, false)).toEqual({ top: HUD_TOP_PX, bottom: 0 });
    // A wide window keeps the card in a corner beside the board
    expect(hudBands(1280, 720, true)).toEqual({ top: HUD_TOP_PX, bottom: 0 });
    // Upright and squarish windows put it across the bottom
    for (const [w, h] of [
      [390, 844],
      [700, 900],
      [768, 1024],
      [1024, 768],
    ]) {
      expect(hudBands(w, h, true).bottom).toBe(MOVE_CARD_BAND_PX);
      expect(hudBands(w, h, false).bottom).toBe(0);
    }
    // A phone on its side docks it beside the board
    expect(hudBands(844, 390, true).bottom).toBe(0);
  });

  it('never lets the bands take more than half the window', () => {
    const bounds = { left: -0.1, right: 0.1, bottom: -0.2, top: 0.2 };
    const tanV = Math.tan((36 * Math.PI) / 360);
    // 300 + 300 of 800 rows, scaled to 200 + 200: the middle of the rest is the middle
    const [, y] = centringShift(bounds, {
      width: 800,
      height: 800,
      fov: 36,
      topInset: 300,
      bottomInset: 300,
    });
    expect(y).toBeCloseTo(0);
    const [, lower] = centringShift(bounds, {
      width: 800,
      height: 800,
      fov: 36,
      topInset: 0,
      bottomInset: 80,
    });
    // A bottom band of 80 rows raises the middle of the rest by 40 rows
    expect(lower).toBeCloseTo(-0.1 * tanV);
  });
});

describe('the lens shift', () => {
  const camera = () => {
    const c = new PerspectiveCamera(36, 2, 0.1, 100);
    c.position.set(0, 0, 10);
    c.lookAt(0, 0, 0);
    c.updateMatrixWorld();
    return c;
  };
  const tanV = Math.tan((36 * Math.PI) / 360);

  it('puts the view centre where the shift points', () => {
    const c = camera();
    setLensShift(c, [0.1, -0.05], 1000, 500);
    expect(lensShiftOf(c)).toEqual([0.1, -0.05]);
    // A point on the shifted axis lands in the middle of the window
    const p = new Vector3(0.1 * 10, -0.05 * 10, 0).project(c);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(0);
    expect(c.view?.offsetY).toBeCloseTo((0.05 * 500) / (2 * tanV));
  });

  it('clears the offset when the shift is nil', () => {
    const c = camera();
    setLensShift(c, [0.1, 0.1], 1000, 500);
    expect(c.view?.enabled).toBe(true);
    setLensShift(c, [0, 0], 1000, 500);
    expect(c.view?.enabled).toBe(false);
    expect(lensShiftOf(c)).toEqual([0, 0]);
  });
});
