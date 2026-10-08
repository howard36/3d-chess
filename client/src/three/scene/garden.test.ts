import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { PieceType } from '../../engine/pieces';
import { GARDEN, gardenView, SQUARE, squareCentre, WHOLE_FADE, wholeOf } from './stage';
import { placeStar, SKY_PLAN } from './heavens';
import { sculptureOf } from './sculptures';
import { eyeAt } from './testKit';

// The garden's promises: every sculpture stands on the centre of a square of
// the colossal board, all about as far out; from every side at least one
// stands clear of the tower and in frame; the constellations sit above the
// frame in every ordinary view; and each is a line drawing of its piece.

const ASPECT = 16 / 9;
const FOV = 36;
// The tower's shade is wide, so a sculpture beside it still averages a little dark
const CLEAR = 0.6;

// About how far out the game opens in a 16:9 window
const DISTANCE = 16;

const cameraAt = (azimuthDeg: number, elevationDeg: number, zoom = 1) => {
  const d = DISTANCE * zoom;
  const cam = new PerspectiveCamera(FOV, ASPECT, 0.1, 1000);
  cam.position.set(...eyeAt(azimuthDeg, elevationDeg, d));
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
          const view = gardenView(cameraAt(az, el), ASPECT, turn);
          const clear = view.filter((v) => v.inFrame >= 0.5 && v.cover < CLEAR);
          expect(clear.length, `el ${el}°, az ${az}°, turn ${turn}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('keeps a whole sculpture in frame at the lowest view, looking up', () => {
    for (let az = 0; az < 360; az += 5) {
      const view = gardenView(cameraAt(az, -14), ASPECT);
      const whole = view.filter((v) => v.inFrame >= 0.9 && v.cover < CLEAR);
      expect(whole.length, `az ${az}°`).toBeGreaterThan(0);
    }
  });

  it('turns the knights to face each other from every side', () => {
    const knights = GARDEN.filter((g) => g.type === PieceType.Knight);
    expect(knights).toHaveLength(2);
    expect(knights[0].toward).toEqual([knights[1].at[0], knights[1].at[2]]);
    expect(knights[1].toward).toEqual([knights[0].at[0], knights[0].at[2]]);
    const onScreen = (cam: PerspectiveCamera, x: number, z: number) =>
      new Vector3(x, knights[0].at[1], z).project(cam);
    for (const turn of [1, -1]) {
      for (const el of [-14, 18, 60]) {
        for (const zoom of [0.5, 1, 1.6]) {
          for (let az = 0; az < 360; az += 5) {
            const cam = cameraAt(az, el, zoom);
            knights.forEach(({ at, toward }, i) => {
              const twin = knights[1 - i].at;
              const [ax, az2] = [at[0] * turn, at[2] * turn];
              // The vertex shader's turn: the drawing faces the camera, its
              // front (+x) toward the point the sculpture looks at
              const h = [cam.position.x - ax, cam.position.z - az2];
              const right = [h[1], -h[0]];
              const look = [toward[0] * turn - ax, toward[1] * turn - az2];
              const face = right[0] * look[0] + right[1] * look[1] >= 0 ? 1 : -1;
              const from = onScreen(cam, ax, az2);
              const front = onScreen(
                cam,
                ax + right[0] * face * 1e-3,
                az2 + right[1] * face * 1e-3,
              );
              const other = onScreen(cam, twin[0] * turn, twin[2] * turn);
              // Behind the camera, out of sight
              const behind = (x: number, z: number) =>
                new Vector3(x, at[1], z).applyMatrix4(cam.matrixWorldInverse).z > 0;
              if (behind(ax, az2) || behind(twin[0] * turn, twin[2] * turn)) return;
              if (Math.abs(from.x) > 1 || Math.abs(other.x) > 1) return;
              expect(
                Math.sign(front.x - from.x),
                `knight ${i}, el ${el}°, az ${az}°, zoom ${zoom}, turn ${turn}`,
              ).toBe(Math.sign(other.x - from.x));
            });
          }
        }
      }
    }
  });

  it('fades a sculpture right behind the tower out', () => {
    // From straight down the z axis, the kings on e1 and e8 and the queens
    // on d1 and d8 stand nearly in line with the tower
    const view = gardenView(cameraAt(0, 18), ASPECT);
    const behind = GARDEN.findIndex((g) => g.square === 'e8');
    expect(view[behind].cover).toBeGreaterThan(0.95);
    // Turned about for Black, the one there is the queen from d1
    const turned = gardenView(cameraAt(0, 18), ASPECT, -1);
    expect(turned[GARDEN.findIndex((g) => g.square === 'd1')].cover).toBeGreaterThan(0.95);
  });

  it('takes the sculpture right behind the tower away whole, crown and all, at either seat', () => {
    // The opening view (16° round, 18° up), on a wide window and a phone
    // upright: the queen from d8 stands behind the tower at White's, the
    // king from e1 at Black's (the garden turned half about); its crown
    // would stand over level E among the far rank's pieces
    for (const [aspect, zoom] of [
      [ASPECT, 1],
      [390 / 844, 29.1 / 19],
    ]) {
      for (const [turn, square] of [
        [1, 'd8'],
        [-1, 'e1'],
      ] as const) {
        const cam = cameraAt(16, 18, zoom);
        cam.aspect = aspect;
        cam.updateProjectionMatrix();
        const view = gardenView(cam, aspect, turn);
        const behind = GARDEN.findIndex((g) => g.square === square);
        expect(wholeOf(view[behind].cover), `${square} at ${aspect.toFixed(2)}`).toBeLessThan(0.05);
        // ...while the two beside the tower keep all their light
        const beside = view.filter((v) => v.inFrame > 0.5 && v.cover < WHOLE_FADE[0]);
        if (aspect > 1) expect(beside.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('fades a sculpture as a whole smoothly, and only once the shade mostly covers it', () => {
    expect(wholeOf(0)).toBe(1);
    expect(wholeOf(WHOLE_FADE[0])).toBe(1);
    expect(wholeOf(WHOLE_FADE[1])).toBe(0);
    let last = 1;
    for (let c = 0; c <= 1; c += 0.01) {
      const w = wholeOf(c);
      expect(w).toBeLessThanOrEqual(last);
      expect(last - w).toBeLessThan(0.07);
      last = w;
    }
    // The sculptures counted clear of the tower (above) keep all their light
    expect(CLEAR).toBeLessThan(WHOLE_FADE[0]);
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

it('draws every piece as finite outlines standing on its base', () => {
  for (const type of Object.values(PieceType)) {
    const d = sculptureOf(type);
    expect(d.outlines.length).toBeGreaterThan(0);
    for (const o of d.outlines) {
      expect(o.points.length).toBeGreaterThan(1);
      for (const [x, y] of o.points) {
        expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
        expect(y).toBeGreaterThanOrEqual(-1e-6);
        expect(y).toBeLessThanOrEqual(0.9);
      }
    }
    // A base ring and a collar ring
    expect(d.rings).toHaveLength(2);
    expect(d.rings[0].y).toBeLessThan(0.01);
  }
});
