import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { fitDistance } from '../cameraFit';
import { layout } from './palette';
import { GARDEN, gardenView, SQUARE, squareCentre } from './stage';
import { placeStar, SKY_PLAN } from './heavens';

// The garden's promises: every sculpture stands on the centre of a square of
// the colossal board, all about as far out; from every side at least one
// stands clear of the tower and in frame; the constellations sit above the
// frame in every ordinary view.

const ASPECT = 16 / 9;
const FOV = 36;

const cameraAt = (azimuthDeg: number, elevationDeg: number, zoom = 1) => {
  const dir = new Vector3(...layout.viewDirection);
  const d = fitDistance(dir, ASPECT, FOV, layout.halfExtents) * zoom;
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const cam = new PerspectiveCamera(FOV, ASPECT, 0.1, 1000);
  cam.position.set(
    d * Math.cos(el) * Math.sin(az),
    d * Math.sin(el),
    d * Math.cos(el) * Math.cos(az),
  );
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return cam;
};

describe('the garden', () => {
  it('stands each sculpture on the centre of its own square, all about as far out', () => {
    const squares = new Set(GARDEN.map((g) => g.square));
    expect(squares.size).toBe(GARDEN.length);
    const radii = GARDEN.map(({ square, at }) => {
      const [x, z] = squareCentre(square);
      expect(at[0]).toBeCloseTo(x);
      expect(at[2]).toBeCloseTo(z);
      // The centre of a square: half a square off every line
      expect(Math.abs((x / SQUARE) % 1)).toBeCloseTo(0.5);
      expect(Math.abs((z / SQUARE) % 1)).toBeCloseTo(0.5);
      return Math.hypot(x, z);
    });
    expect(Math.max(...radii) / Math.min(...radii)).toBeLessThan(1.1);
  });

  it('keeps a sculpture clear of the tower and in frame from every side', () => {
    for (const turn of [1, -1]) {
      for (const el of [-14, 0, 18, 30]) {
        for (let az = 0; az < 360; az += 5) {
          const view = gardenView(cameraAt(az, el), ASPECT, 1, turn);
          const clear = view.filter((v) => v.inFrame >= 0.5 && v.cover < 0.5);
          expect(clear.length, `el ${el}°, az ${az}°, turn ${turn}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('keeps a whole sculpture in frame at the lowest view, looking up', () => {
    for (let az = 0; az < 360; az += 5) {
      const view = gardenView(cameraAt(az, -14), ASPECT);
      const whole = view.filter((v) => v.inFrame >= 0.9 && v.cover < 0.5);
      expect(whole.length, `az ${az}°`).toBeGreaterThan(0);
    }
  });

  it('fades a sculpture right behind the tower out', () => {
    // From straight down the z axis, the kings on e1 and e8 and the queens
    // on d1 and d8 stand nearly in line with the tower
    const view = gardenView(cameraAt(0, 18), ASPECT);
    const behind = GARDEN.findIndex((g) => g.square === 'e8');
    expect(view[behind].cover).toBeGreaterThan(0.95);
    // Turned about for Black, the one there is the queen from d1
    const turned = gardenView(cameraAt(0, 18), ASPECT, 1, -1);
    expect(turned[GARDEN.findIndex((g) => g.square === 'd1')].cover).toBeGreaterThan(0.95);
  });

  it('keeps the constellations above the frame in the ordinary views', () => {
    for (const plan of SKY_PLAN) {
      for (const star of plan.c.stars) {
        const [x, y, z] = placeStar(star, plan);
        const elevation = (Math.atan2(y, Math.hypot(x, z)) * 180) / Math.PI;
        // The opening view's top edge is the horizon; at 6° it is 12° up.
        // At the lowest view, 14° below level, the top edge is about 28° up
        // beside the tower
        expect(elevation).toBeGreaterThan(13);
        expect(elevation).toBeLessThan(28);
      }
    }
  });
});
