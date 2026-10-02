import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import {
  CAPTURES_BAND_PX,
  HUD_TOP_PX,
  hudTop,
  ZOOM_IN,
  ZOOM_OUT,
  centringShift,
  CENTRE_LIFT,
  elevationOf,
  FIT_SOFTNESS,
  fitView,
  ringBounds,
  zoomRange,
} from './cameraFit';
import type { FrameRing } from './cameraFit';
import { lensShiftOf, setLensShift } from './viewOffset';

describe('zoomRange', () => {
  it('lets the player zoom a fixed fraction in and out of the fitted view', () => {
    expect(zoomRange(20)).toEqual({ min: 20 * ZOOM_IN, max: 20 * ZOOM_OUT });
    // Proportionally the same from farther away (an upright phone)
    const { min, max } = zoomRange(31);
    expect(min / 31).toBeCloseTo(ZOOM_IN);
    expect(max / 31).toBeCloseTo(ZOOM_OUT);
  });

  it("only narrows the range by the layout's nearest distance", () => {
    expect(zoomRange(20, 5)).toEqual({ min: 14, max: 30 });
    expect(zoomRange(20, 16)).toEqual({ min: 16, max: 30 });
    // Never past the farthest
    expect(zoomRange(20, 40)).toEqual({ min: 30, max: 30 });
  });
});

const DEG = Math.PI / 180;
// The half-height of the 36 degree view at one unit out
const tanV = Math.tan(18 * DEG);

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

  it('reads the elevation off the camera', () => {
    const camera = cameraAt(35, 120, 18);
    expect(elevationOf(camera.position, new Vector3()) / DEG).toBeCloseTo(35, 9);
    expect(elevationOf(new Vector3(), new Vector3())).toBe(0);
  });
});

interface FitOptions {
  rings?: FrameRing[];
  topInset?: number;
  bottomInset?: number;
  centre?: 'target' | 'rings';
  sweep?: [number, number];
  balanceInset?: number;
}

/**
 * The rings fitted by fitView, the lens shift applied, and their outline's
 * margins on screen in CSS px; and where the orbit target lands.
 */
function fitted(
  elevation: number,
  azimuth: number,
  width: number,
  height: number,
  { rings = RINGS, ...options }: FitOptions = {},
) {
  const view = { width, height, fov: 36, ...options };
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
  // The bounds the fit frames: the rings' top and bottom eased from ring to
  // ring (FIT_SOFTNESS), never inside the rings themselves
  const soft = ringBounds(rings, elevation * DEG, distance, FIT_SOFTNESS);
  const k = height / (2 * tanV);
  const framed = {
    ...rect,
    top: height / 2 - (soft.top - shift[1]) * k,
    bottom: height / 2 + (soft.bottom - shift[1]) * k,
  };
  const t = new Vector3().project(camera);
  const target = { x: ((t.x + 1) / 2) * width, y: ((1 - t.y) / 2) * height };
  // How far the target stands above the middle of the room: CENTRE_LIFT of
  // the rings' height as fitted
  const lift = CENTRE_LIFT * (soft.top - soft.bottom) * k;
  return { distance, shift, camera, rect, framed, target, lift };
}

const WINDOWS = [
  ['a 16:9 desktop', 1280, 720],
  ['an ultrawide', 3440, 1440],
  ['an upright phone', 390, 844],
  ['a phone on its side', 844, 390],
  ['a narrow window', 500, 1000],
] as const;

describe('fitView', () => {
  it.each(WINDOWS)(
    "stands the tower's centre a little above the middle of the room below the HUD band in %s, and fits the rings round it",
    (_, w, h) => {
      for (const elevation of [-14, 18, 55, 89.9]) {
        for (const azimuth of [0, 16, 45, 200]) {
          const { rect, framed, shift, target, lift } = fitted(elevation, azimuth, w, h);
          // The target: in the middle across, and lifted a little above the
          // middle of the room between the band and the window's bottom
          expect(Math.abs(target.x - w / 2)).toBeLessThan(0.5);
          expect(lift).toBeGreaterThan(0);
          expect(Math.abs(target.y - ((HUD_TOP_PX + h) / 2 - lift))).toBeLessThan(0.5);
          // The rings: centred across, inside the room
          expect(Math.abs(rect.left - rect.right)).toBeLessThan(0.5);
          expect(rect.top).toBeGreaterThanOrEqual(framed.top - 0.5);
          expect(rect.bottom).toBeGreaterThanOrEqual(framed.bottom - 0.5);
          expect(framed.top).toBeGreaterThan(HUD_TOP_PX);
          expect(framed.bottom).toBeGreaterThan(0);
          // Filling it on the tighter side, with a little room to spare: their
          // reach above the target in the room above it, or below in the room
          // below
          const across = (w - rect.left - rect.right) / w;
          const up = (target.y - framed.top) / (target.y - HUD_TOP_PX);
          const down = (h - framed.bottom - target.y) / (h - target.y);
          expect(Math.max(across, up, down)).toBeGreaterThan(0.94);
          expect(Math.max(across, up, down)).toBeLessThan(0.96);
          // The lens only ever shifts up or down
          expect(shift[0]).toBe(0);
        }
      }
    },
  );

  it('balances the target below a line under the top band, keeping the band itself clear', () => {
    for (const [, w, h] of WINDOWS) {
      const { framed, target, lift } = fitted(18, 16, w, h, { topInset: 82, balanceInset: 56 });
      // Above the middle of the room between the line and the bottom
      expect(Math.abs(target.y - ((56 + h) / 2 - lift))).toBeLessThan(0.5);
      // The rings below the band, filling the room above or below the target
      expect(framed.top).toBeGreaterThan(82);
      const up = (target.y - framed.top) / (target.y - 82);
      const down = (h - framed.bottom - target.y) / (h - target.y);
      const across = (w - framed.left - framed.right) / w;
      expect(Math.max(up, down, across)).toBeGreaterThan(0.94);
      expect(Math.max(up, down, across)).toBeLessThan(0.96);
    }
    // A line lower than the band counts as the band
    const view = { width: 1280, height: 720, fov: 36, topInset: 82 };
    expect(fitView(18 * DEG, RINGS, { ...view, balanceInset: 200 })).toEqual(
      fitView(18 * DEG, RINGS, view),
    );
  });

  it('lifts the target by a share of the rings’ height, whatever the window', () => {
    for (const [, w, h] of WINDOWS) {
      const { framed, target, lift } = fitted(18, 16, w, h);
      const height = h - framed.bottom - framed.top;
      expect(lift / height).toBeCloseTo(CENTRE_LIFT, 2);
      expect(target.y).toBeLessThan((HUD_TOP_PX + h) / 2);
    }
  });

  it.each(WINDOWS)(
    'keeps the rings in the room from every elevation of the sweep in %s, one of them filling it',
    (_, w, h) => {
      const sweep: [number, number] = [-14 * DEG, 89.9 * DEG];
      const view = { width: w, height: h, fov: 36, topInset: 82, sweep };
      const { distance, shift } = fitView(18 * DEG, RINGS, view);
      const k = h / (2 * tanV);
      const tanH = tanV * (w / h);
      let tightest = Infinity;
      for (let e = -14; e <= 89.9; e += 0.25) {
        const b = ringBounds(RINGS, e * DEG, distance, FIT_SOFTNESS);
        const top = h / 2 - (b.top - shift[1]) * k;
        const bottom = h / 2 - (b.bottom - shift[1]) * k;
        const side = (tanH - b.right) * k;
        // (sampled a degree apart: between samples a ring may reach a hair further)
        tightest = Math.min(tightest, top - 82, h - bottom, side);
      }
      expect(tightest).toBeGreaterThan(-0.5);
      // As far in as that allows: some elevation binds, or the opening's margin
      const opening = fitted(18, 0, w, h, { topInset: 82 });
      expect(tightest < 1 || distance === opening.distance).toBe(true);
      // Never nearer than the opening alone would stand, which is the fit without a sweep
      expect(distance).toBeGreaterThanOrEqual(opening.distance);
      expect(fitView(18 * DEG, RINGS, { ...view, sweep: undefined }).distance).toBe(
        opening.distance,
      );
    },
  );

  it.each([
    ['a desktop', 1280, 720, 120, 116],
    ['a tall window', 1440, 900, 140, 132],
    ['an upright phone', 390, 844, 120, 116],
  ])(
    "stands the tower's centre in %s a little above midway between a top and a bottom band",
    (_, w, h, top, bottom) => {
      for (const elevation of [18, 22, 45]) {
        const { framed, target, lift } = fitted(elevation, 28, w, h, {
          topInset: top,
          bottomInset: bottom,
        });
        expect(Math.abs(target.y - ((top + h - bottom) / 2 - lift))).toBeLessThan(0.5);
        expect(framed.top).toBeGreaterThan(top);
        expect(framed.bottom).toBeGreaterThan(bottom);
      }
    },
  );

  describe("centring the rings (centre: 'rings', the landing page's preview)", () => {
    it.each(WINDOWS)(
      'centres the rings in %s, below the HUD band, and fills it on one axis',
      (_, w, h) => {
        for (const elevation of [-14, 18, 55, 89.9]) {
          for (const azimuth of [0, 16, 45, 200]) {
            const { rect, framed, shift } = fitted(elevation, azimuth, w, h, { centre: 'rings' });
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
      },
    );

    it('centres in the whole window without a HUD band', () => {
      const { rect, framed } = fitted(18, 16, 1280, 720, { topInset: 0, centre: 'rings' });
      expect(Math.abs(framed.top - framed.bottom)).toBeLessThan(0.5);
      expect(Math.abs(rect.left - rect.right)).toBeLessThan(0.5);
    });

    it.each([
      ['a desktop', 1280, 720, 120, 116],
      ['a tall window', 1440, 900, 140, 132],
      ['an upright phone', 390, 844, 120, 116],
    ])('centres the rings in %s between a top and a bottom band', (_, w, h, top, bottom) => {
      for (const elevation of [18, 22, 45]) {
        for (const azimuth of [0, 28, 200]) {
          const { rect, framed, shift } = fitted(elevation, azimuth, w, h, {
            topInset: top,
            bottomInset: bottom,
            centre: 'rings',
          });
          expect(Math.abs(rect.left - rect.right)).toBeLessThan(0.5);
          expect(Math.abs(framed.top - top - (framed.bottom - bottom))).toBeLessThan(0.5);
          expect(framed.top).toBeGreaterThan(top);
          expect(framed.bottom).toBeGreaterThan(bottom);
          // Fills what the bands leave on its tighter axis
          const across = (w - rect.left - rect.right) / w;
          const down = (h - framed.top - framed.bottom) / (h - top - bottom);
          expect(Math.max(across, down)).toBeGreaterThan(0.94);
          expect(Math.max(across, down)).toBeLessThan(0.96);
          expect(shift[0]).toBe(0);
        }
      }
    });

    it('stands nearer than centring the target would, the rings being off centre', () => {
      // (from low down the near edge of the bottom ring reaches further below
      // the target than the top reaches above it)
      expect(fitted(18, 0, 1280, 720, { centre: 'rings' }).distance).toBeLessThan(
        fitted(18, 0, 1280, 720).distance,
      );
    });
  });

  it('fits exactly as before without a bottom band', () => {
    const view = { width: 1280, height: 720, fov: 36, topInset: 82 };
    for (const centre of ['target', 'rings'] as const) {
      expect(fitView(18 * DEG, RINGS, { ...view, centre, bottomInset: 0 })).toEqual(
        fitView(18 * DEG, RINGS, { ...view, centre }),
      );
    }
  });

  it('never lets the two bands together take more than half the window', () => {
    const view = { width: 800, height: 800, fov: 36 };
    const [, y] = centringShift(
      { left: 0, right: 0, bottom: 0, top: 0 },
      {
        ...view,
        topInset: 300,
        bottomInset: 300,
      },
    );
    // The top band takes 300 of 800 rows; the bottom only the 100 left of half
    expect(y).toBeCloseTo(((300 - 100) / 800) * tanV);
  });

  it('stands further back for wider rings', () => {
    const wider = RINGS.map((r) => ({ ...r, radius: r.radius * 1.2 }));
    expect(fitted(18, 0, 390, 844, { rings: wider }).distance).toBeGreaterThan(
      fitted(18, 0, 390, 844).distance,
    );
  });

  it('turns the camera about the board centre: the lens shift moves the picture, never the camera', () => {
    const { camera, shift } = fitted(18, 16, 1280, 720);
    // The camera still looks straight at the origin
    const ahead = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    expect(ahead.dot(camera.position.clone().normalize().negate())).toBeCloseTo(1, 6);
    // The HUD band at the top: the shift raises the view, lowering the tower under it
    expect(shift[1]).toBeGreaterThan(0);
  });
});

describe('centringShift', () => {
  it('aims the view at the middle of the bounds, lowered by half the HUD band', () => {
    const bounds = { left: -0.1, right: 0.3, bottom: -0.2, top: 0.2 };
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
