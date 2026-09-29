import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import {
  CAPTURES_BAND_PX,
  HUD_TOP_PX,
  hudTop,
  ZOOM_IN,
  ZOOM_OUT,
  boxRings,
  centringShift,
  elevationOf,
  FIT_SOFTNESS,
  fitDistance,
  fitView,
  ringBounds,
  zoomRange,
} from './cameraFit';
import type { FrameRing } from './cameraFit';
import { towerLayout } from './layout';
import { towerFrameRings } from './scene/labelAnchors';
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

const DEG = Math.PI / 180;

/** A camera `distance` out at this elevation and azimuth (degrees), looking at the origin. */
const cameraAt = (elevation: number, azimuth: number, distance: number, aspect = 1) => {
  const camera = new PerspectiveCamera(36, aspect, 0.1, 1000);
  const [e, a] = [elevation * DEG, azimuth * DEG];
  camera.position.set(
    Math.sin(a) * Math.cos(e) * distance,
    Math.sin(e) * distance,
    Math.cos(a) * Math.cos(e) * distance,
  );
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
};

/** Where a world point falls in a camera's view, as tangents off its axis (x right, y up). */
const tangents = (camera: PerspectiveCamera, p: Vector3) => {
  const v = p.clone().applyMatrix4(camera.matrixWorldInverse);
  return { x: v.x / -v.z, y: v.y / -v.z };
};

/** Points round a ring (or its arc behind the axis), every tenth of a degree. */
const ringPoints = ({ y, radius, behind }: FrameRing) =>
  Array.from({ length: 3600 }, (_, i) => (i / 10) * DEG)
    .filter((t) => behind === undefined || Math.abs(t - Math.PI) <= behind)
    .map((t) => new Vector3(radius * Math.sin(t), y, radius * Math.cos(t)));

// A tower's rings: platforms, pieces, and letters behind it
const RINGS: FrameRing[] = [
  { y: -3.1, radius: 3.6 },
  { y: 2.4, radius: 3.6 },
  { y: 3.2, radius: 3.25 },
  { y: -2.9, radius: 4.1, behind: 55 * DEG },
  { y: 2.6, radius: 4.1, behind: 55 * DEG },
];

describe('ringBounds', () => {
  it('bounds the rings exactly as the camera sees them, from any azimuth', () => {
    for (const elevation of [-14, 0, 18, 45, 75, 89.9]) {
      for (const distance of [12, 20, 40]) {
        const bounds = ringBounds(RINGS, elevation * DEG, distance);
        for (const azimuth of [0, 16, 45, 133, 250]) {
          const camera = cameraAt(elevation, azimuth, distance);
          const seen = RINGS.flatMap((r) =>
            ringPoints({ ...r, behind: undefined })
              .map((p) => {
                // An arc behind the axis turns with the camera: rotate it round
                if (r.behind === undefined) return p;
                const t = Math.atan2(p.x, p.z);
                if (Math.abs(Math.abs(t) - Math.PI) > r.behind) return null;
                return p.clone().applyAxisAngle(new Vector3(0, 1, 0), azimuth * DEG);
              })
              .filter((p): p is Vector3 => p !== null)
              .map((p) => tangents(camera, p)),
          );
          const xs = seen.map((p) => p.x);
          const ys = seen.map((p) => p.y);
          const where = `elevation ${elevation}, distance ${distance}, azimuth ${azimuth}`;
          expect(bounds.left, where).toBeCloseTo(Math.min(...xs), 5);
          expect(bounds.right, where).toBeCloseTo(Math.max(...xs), 5);
          expect(bounds.bottom, where).toBeCloseTo(Math.min(...ys), 5);
          expect(bounds.top, where).toBeCloseTo(Math.max(...ys), 5);
          expect(bounds.left).toBe(-bounds.right);
        }
      }
    }
  });

  it('eases the top and bottom from ring to ring and side to side, never inside the rings', () => {
    for (const elevation of [-14, -12, 0, 18, 89.9]) {
      const hard = ringBounds(RINGS, elevation * DEG, 15);
      const soft = ringBounds(RINGS, elevation * DEG, 15, FIT_SOFTNESS);
      expect(soft.top).toBeGreaterThanOrEqual(hard.top);
      expect(soft.bottom).toBeLessThanOrEqual(hard.bottom);
      // By at most the softness for each of the rings' sides that could tie
      const most = FIT_SOFTNESS * Math.log(2 * RINGS.length);
      expect(soft.top - hard.top).toBeLessThan(most);
      expect(hard.bottom - soft.bottom).toBeLessThan(most);
      expect(soft.right).toBe(hard.right);
    }
  });

  it('frames a box by the circles round its top and bottom', () => {
    const [hx, hy, hz] = BOX;
    const bounds = ringBounds(boxRings(BOX), 18 * DEG, 20);
    for (const azimuth of [0, 16, 45, 90]) {
      const camera = cameraAt(18, azimuth, 20);
      for (const c of corners) {
        const { x, y } = tangents(camera, c);
        expect(x).toBeLessThanOrEqual(bounds.right + 1e-12);
        expect(x).toBeGreaterThanOrEqual(bounds.left - 1e-12);
        expect(y).toBeLessThanOrEqual(bounds.top + 1e-12);
        expect(y).toBeGreaterThanOrEqual(bounds.bottom - 1e-12);
      }
    }
    expect(boxRings(BOX)[0]).toEqual({ y: -hy, radius: Math.hypot(hx, hz) });
  });

  it('reads the elevation off the camera', () => {
    const camera = cameraAt(35, 120, 18);
    expect(elevationOf(camera.position, new Vector3()) / DEG).toBeCloseTo(35, 9);
    expect(elevationOf(new Vector3(), new Vector3())).toBe(0);
  });
});

/** The rings fitted by fitView, the lens shift applied, and their outline's margins on screen in CSS px. */
function fitted(
  elevation: number,
  azimuth: number,
  width: number,
  height: number,
  rings = RINGS,
  topInset?: number,
) {
  const view = {
    width,
    height,
    fov: 36,
    ...(topInset !== undefined ? { topInset } : {}),
  };
  const { distance, shift } = fitView(elevation * DEG, rings, view);
  const camera = cameraAt(elevation, azimuth, distance, width / height);
  setLensShift(camera, shift, width, height);
  const px = rings.flatMap(ringPoints).map((p) => {
    // (arcs as seen from azimuth 0; turned with the camera)
    const q = p.clone().applyAxisAngle(new Vector3(0, 1, 0), azimuth * DEG);
    const n = q.project(camera);
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
  // The bounds the fit centres: the rings' top and bottom eased from ring to
  // ring (FIT_SOFTNESS), never inside the rings themselves
  const soft = ringBounds(rings, elevation * DEG, distance, FIT_SOFTNESS);
  const k = height / (2 * Math.tan(18 * DEG));
  const framed = {
    ...rect,
    top: height / 2 - (soft.top - shift[1]) * k,
    bottom: height / 2 + (soft.bottom - shift[1]) * k,
  };
  return { distance, shift, camera, rect, framed };
}

describe('fitView', () => {
  it.each([
    ['a 16:9 desktop', 1280, 720],
    ['an ultrawide', 3440, 1440],
    ['an upright phone', 390, 844],
    ['a phone on its side', 844, 390],
    ['a narrow window', 500, 1000],
  ])('centres the rings in %s, below the HUD band, and fills it on one axis', (_, w, h) => {
    for (const elevation of [-14, 18, 55, 89.9]) {
      for (const azimuth of [0, 16, 45, 200]) {
        const { rect, framed, shift } = fitted(elevation, azimuth, w, h);
        // Centred across, and in the band below the HUD's top rows
        expect(Math.abs(rect.left - rect.right)).toBeLessThan(0.5);
        expect(Math.abs(framed.top - HUD_TOP_PX - framed.bottom)).toBeLessThan(0.5);
        expect(rect.top).toBeGreaterThanOrEqual(framed.top - 0.5);
        expect(rect.bottom).toBeGreaterThanOrEqual(framed.bottom - 0.5);
        expect(framed.top).toBeGreaterThan(HUD_TOP_PX);
        // Fills the window on its tighter axis, with a little room to spare
        const across = (w - rect.left - rect.right) / w;
        const down = (h - framed.top - framed.bottom) / (h - HUD_TOP_PX);
        expect(Math.max(across, down)).toBeGreaterThan(0.94);
        expect(Math.max(across, down)).toBeLessThan(0.96);
        // The lens only ever shifts up or down
        expect(shift[0]).toBe(0);
      }
    }
  });

  it('centres in the whole window without a HUD band', () => {
    const { rect, framed } = fitted(18, 16, 1280, 720, RINGS, 0);
    expect(Math.abs(framed.top - framed.bottom)).toBeLessThan(0.5);
    expect(Math.abs(rect.left - rect.right)).toBeLessThan(0.5);
  });

  it('frames the tower about as large as the symmetric fit, which it used to sit low or aside in', () => {
    // The tower with its labels, as the game frames it, against the box its
    // layout gives for the labels' room, fitted symmetrically
    const tower = towerLayout({ pieceHeight: 0.87 * 0.8, minElevation: -14 });
    const rings = towerFrameRings(tower, { size: 0.32, levelScale: 1 });
    // (7% and 1% closer in a desktop window and a phone on its side, where
    // the framing of the outline as seen was 10% and 3% closer, before it
    // held still as the view turned; an upright phone, which the tower fills
    // across, stands 3.5% further back for the level letters' column at a
    // side of the tower's outline)
    for (const [w, h, most] of [
      [1280, 720, 0.93],
      [390, 844, 1.04],
      [844, 390, 1],
    ]) {
      const old = fitDistance(VIEW, w / h, 36, tower.halfExtents);
      const elevation = Math.asin(VIEW.y / VIEW.length()) / DEG;
      expect(fitted(elevation, 16, w, h, rings).distance).toBeLessThan(old * most);
    }
  });

  it('stands further back for wider rings', () => {
    const wider = RINGS.map((r) => ({ ...r, radius: r.radius * 1.2 }));
    expect(fitted(18, 0, 390, 844, wider).distance).toBeGreaterThan(
      fitted(18, 0, 390, 844).distance,
    );
  });

  it('turns the camera about the board centre: the lens shift moves the picture, never the camera', () => {
    const { camera, shift } = fitted(18, 16, 1280, 720);
    // The camera still looks straight at the origin
    const ahead = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    expect(ahead.dot(camera.position.clone().normalize().negate())).toBeCloseTo(1, 6);
    // The tower sat low: the shift moves the view down onto it
    expect(shift[1]).toBeLessThan(0);
  });
});

describe('centringShift', () => {
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

describe('hudTop', () => {
  it('keeps the row of pieces taken under the pill, except where it stands beside the tower', () => {
    for (const h of [640, 900, 720, 560, 1440]) {
      expect(hudTop(h)).toBe(HUD_TOP_PX + CAPTURES_BAND_PX);
    }
    // A short window (a phone on its side): at the top left, beside the tower
    for (const h of [360, 390, 430]) {
      expect(hudTop(h)).toBe(HUD_TOP_PX);
    }
  });

  it('never lets the band take more than half the window', () => {
    const bounds = { left: -0.1, right: 0.1, bottom: -0.2, top: 0.2 };
    const tanV = Math.tan((36 * Math.PI) / 360);
    // 600 of 800 rows, scaled to 400: the middle of the rest is 0.5 tanV below the middle
    const [, y] = centringShift(bounds, { width: 800, height: 800, fov: 36, topInset: 600 });
    expect(y).toBeCloseTo(0.5 * tanV);
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
