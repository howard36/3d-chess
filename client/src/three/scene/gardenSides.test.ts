import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { GardenSides, offFrame, seenFromFront, SIDE_MARGIN } from './gardenSides';
import type { GardenFigure } from './gardenSides';
import { GARDEN_FIGURES } from './stage';
import { GROUND_Y } from './palette';

/** A camera at a distance, elevation and azimuth (degrees) round the tower's centre. */
const cameraAt = (distance: number, elevation: number, azimuth: number, aspect = 1.6) => {
  const c = new PerspectiveCamera(36, aspect, 0.1, 1000);
  const e = (elevation * Math.PI) / 180;
  const a = (azimuth * Math.PI) / 180;
  c.position.set(
    distance * Math.cos(e) * Math.sin(a),
    distance * Math.sin(e),
    distance * Math.cos(e) * Math.cos(a),
  );
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  return c;
};

/** A figure's azimuth from the tower (degrees, as cameraAt's). */
const azimuthOf = (f: GardenFigure, turn = 1) =>
  (Math.atan2(f.at[0] * turn, f.at[1] * turn) * 180) / Math.PI;

const figure: GardenFigure = {
  at: [0, 28],
  boxes: [[-2, GROUND_Y - 6, 26, 2, GROUND_Y + 6, 30]],
};

describe('which side of a figure the camera stands', () => {
  it('is the front from the tower, behind past the plane through it', () => {
    expect(seenFromFront([0, 10], figure.at, 1, 0)).toBe(true);
    expect(seenFromFront([20, 25], figure.at, 1, 0)).toBe(true);
    expect(seenFromFront([0, 30], figure.at, 1, 0)).toBe(false);
    expect(seenFromFront([8, 29], figure.at, 1, 0)).toBe(false);
    // From the other side of the tower, always the front
    expect(seenFromFront([0, -40], figure.at, 1, 0)).toBe(true);
  });

  it('turns with the garden for Black', () => {
    expect(seenFromFront([0, 30], figure.at, -1, 0)).toBe(true);
    expect(seenFromFront([0, -30], figure.at, -1, 0)).toBe(false);
  });

  it('counts a margin before the plane as behind', () => {
    expect(SIDE_MARGIN).toBeLessThan(0);
    expect(seenFromFront([0, 27], figure.at, 1, 0)).toBe(true);
    expect(seenFromFront([0, 27], figure.at, 1, -2)).toBe(false);
  });
});

describe('a figure out of frame', () => {
  it('is in frame looked at, out of frame behind the camera or to one side', () => {
    expect(offFrame(cameraAt(20, 10, 180), figure)).toBe(false);
    expect(offFrame(cameraAt(20, 10, 0), figure)).toBe(true);
    expect(offFrame(cameraAt(20, 10, 90), figure)).toBe(true);
    // Turned for Black, the figure stands where White's camera looks
    expect(offFrame(cameraAt(20, 10, 0), figure, -1)).toBe(false);
  });
});

describe('a figure shown or hidden', () => {
  it('starts as the rule has it, even in frame', () => {
    const sides = new GardenSides([figure]);
    // Behind it, looking past it at the tower, with it in frame
    const behind = cameraAt(40, 8, 0);
    expect(offFrame(behind, figure)).toBe(false);
    sides.update(behind);
    expect(sides.shown[0]).toBe(0);
    const front = new GardenSides([figure]);
    front.update(cameraAt(20, 10, 180));
    expect(front.shown[0]).toBe(1);
  });

  it('never changes while any of it is in frame, and changes once it is out', () => {
    const sides = new GardenSides([figure]);
    sides.update(cameraAt(60, 10, 160));
    expect(sides.shown[0]).toBe(1);
    // Straight behind it, in frame: still shown, however long
    for (let i = 0; i < 5; i++) {
      expect(sides.update(cameraAt(40, 8, 0))).toBe(false);
      expect(sides.shown[0]).toBe(1);
    }
    // Turned round, still behind it, until it is out of frame (two frames: the one drawn and
    // the next one's test), then back: it has gone
    const away = cameraAt(40, 8, 30);
    expect(offFrame(away, figure)).toBe(true);
    sides.update(away);
    sides.update(away);
    expect(sides.shown[0]).toBe(0);
    sides.update(cameraAt(40, 8, 0));
    expect(sides.shown[0]).toBe(0);
    // And it comes back out of frame once the camera is in front again
    sides.update(cameraAt(20, 10, 0));
    sides.update(cameraAt(20, 10, 0));
    expect(sides.shown[0]).toBe(1);
  });

  it('waits a frame out of frame before changing', () => {
    const sides = new GardenSides([figure]);
    sides.update(cameraAt(40, 8, 0));
    expect(sides.shown[0]).toBe(0);
    // In front, and out of frame for the first time: not yet
    sides.update(cameraAt(20, 10, 0));
    expect(sides.shown[0]).toBe(0);
    sides.update(cameraAt(20, 10, 0));
    expect(sides.shown[0]).toBe(1);
  });
});

/**
 * Orbits a camera all the way round at a distance and elevation, a degree a
 * frame, and reports the longest run of degrees each figure spends in frame
 * on the wrong side of the rule (shown behind it, or hidden in front).
 */
const orbit = (distance: number, elevation: number, aspect: number, turn: number) => {
  const sides = new GardenSides(GARDEN_FIGURES);
  const runs = GARDEN_FIGURES.map(() => ({ run: 0, worst: 0 }));
  // Twice round, so the first lap's start leaves nothing behind
  for (let step = 0; step < 720; step++) {
    const camera = cameraAt(distance, elevation, step, aspect);
    sides.update(camera, turn);
    if (step < 360) continue;
    GARDEN_FIGURES.forEach((f, i) => {
      const want = seenFromFront([camera.position.x, camera.position.z], f.at, turn) ? 1 : 0;
      const r = runs[i];
      r.run = want !== sides.shown[i] && !offFrame(camera, f, turn) ? r.run + 1 : 0;
      r.worst = Math.max(r.worst, r.run);
    });
  }
  return runs.map((r) => r.worst);
};

describe('zoomed out as far as the camera goes, orbiting', () => {
  // The fitted zoom limits (FitCameraToBoard) at 1280x800 and 390x844,
  // and elevations from as low as the camera floor lets it to steep
  const views = [
    { name: 'desktop', distance: 28.63, aspect: 1.6, steep: [] as number[] },
    // Round 48–50° up, one standing under the phone's camera can stay in the
    // foot of its narrow frame a few degrees after the camera crosses its line
    { name: 'phone', distance: 43.69, aspect: 390 / 844, steep: [48, 50] },
  ];
  for (const { name, distance, aspect, steep } of views) {
    const lowest = (Math.asin((GROUND_Y + 1.2) / distance) * 180) / Math.PI;
    for (const elevation of [Math.max(lowest, -14), -5, 0, 3, 6, 9, 12, 20, 30, 40, 45, 55, 60])
      for (const turn of [1, -1])
        it(`${name}, ${elevation.toFixed(1)}°, ${turn > 0 ? 'White' : 'Black'}: every figure goes and comes back out of frame`, () => {
          expect(orbit(distance, elevation, aspect, turn)).toEqual(GARDEN_FIGURES.map(() => 0));
        });
    for (const elevation of steep)
      it(`${name}, ${elevation}°: in frame on the wrong side for at most 8° of the turn`, () => {
        for (const turn of [1, -1])
          expect(Math.max(...orbit(distance, elevation, aspect, turn))).toBeLessThanOrEqual(8);
      });
  }

  it('hides the sculpture the camera passes behind', () => {
    const [i] = GARDEN_FIGURES.map((_, k) => k);
    const az = azimuthOf(GARDEN_FIGURES[i]);
    const sides = new GardenSides(GARDEN_FIGURES);
    for (let step = 60; step >= 0; step--) sides.update(cameraAt(43.69, 6, az + step, 0.46));
    expect(sides.shown[i]).toBe(0);
  });
});
