import { describe, expect, it } from 'vitest';
import React from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { useThree } from '@react-three/fiber';
import { PerspectiveCamera, Vector3 } from 'three';
import { FitCameraToBoard } from './FitCameraToBoard';
import { FIT_SOFTNESS, hudBands, ringBounds } from './cameraFit';
import { towerFrame } from './layout';
import { CORNERS, GLYPH_REACH, labelAnchors } from './scene/labelAnchors';
import type { AnchorState } from './scene/labelAnchors';
import { layout } from './scene/palette';
import { lensShiftOf } from './viewOffset';
import type { Vec3 } from './types';

// The game's camera fit (FitCameraToBoard, as GameScreen mounts it) swept
// through every pose: the camera turned all the way round half a degree at a
// time at seven elevations from 14° below the horizon to overhead, and
// climbed through them a quarter of a degree at a time, in a desktop window
// and a phone either way up. What the player sees:
//
// - turning the view never moves it: the lens shift has no sideways part and
//   its vertical part is the same at every azimuth, so the tower's axis
//   stands still in the middle of the window;
// - climbing or dipping moves the view smoothly, never by a jump;
// - the whole tower and every label, where the grid puts it, stays inside the
//   window clear of the HUD's bands, at the fitted distance and zoomed all the
//   way out; zoomed all the way in (where it cannot fit) it stays centred.

const DEG = Math.PI / 180;
const WINDOWS = [
  [1280, 720],
  [390, 844],
  [844, 390],
] as const;
const ELEVATIONS = [-14, 0, 18, 35, 55, 75, 89.9];
const AZIMUTHS = Array.from({ length: 721 }, (_, i) => i / 2);
const frame = towerFrame(layout);
// As the grid draws the labels (grid.tsx)
const SIZE = 0.32;

const direction = (azimuth: number, elevation: number) =>
  new Vector3(
    Math.sin(azimuth * DEG) * Math.cos(elevation * DEG),
    Math.sin(elevation * DEG),
    Math.cos(azimuth * DEG) * Math.cos(elevation * DEG),
  );

/**
 * FitCameraToBoard in a canvas this size, the camera opening from `from`
 * (azimuth, elevation), with stand-in orbit controls that, like three's
 * OrbitControls, say when they have moved the camera.
 */
async function mount(width: number, height: number, from: [number, number] = [16, 18]) {
  const camera = new PerspectiveCamera(36, width / height, 0.1, 1000);
  camera.position.copy(direction(...from));
  const listeners = new Set<() => void>();
  const controls = {
    target: new Vector3(),
    minDistance: 0,
    maxDistance: Infinity,
    update: () => {},
    addEventListener: (_: 'change', l: () => void) => listeners.add(l),
    removeEventListener: (_: 'change', l: () => void) => listeners.delete(l),
  };
  const Controls = () => {
    const set = useThree((s) => s.set);
    React.useLayoutEffect(() => set({ controls: controls as never }), [set]);
    return null;
  };
  const bands = (w: number, h: number) => hudBands(w, h, false);
  await ReactThreeTestRenderer.create(
    <>
      <Controls />
      <FitCameraToBoard
        halfExtents={layout.halfExtents}
        viewDirection={layout.viewDirection}
        minDistance={layout.orbit.minDistance}
        frameRings={layout.frameRings}
        bands={bands}
      />
    </>,
    { width, height, camera },
  );
  const fitted = camera.position.length();
  // CSS px per unit of tangent
  const px = height / (2 * Math.tan(18 * DEG));
  /** Turns the camera to a pose as OrbitControls does, and returns the lens shift in CSS px. */
  const turn = (azimuth: number, elevation: number, distance = fitted): [number, number] => {
    camera.position.copy(direction(azimuth, elevation)).multiplyScalar(distance);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    listeners.forEach((l) => l());
    const [x, y] = lensShiftOf(camera);
    return [x * px, y * px];
  };
  return { camera, controls, fitted, turn, bands: bands(width, height) };
}

describe('the fitted view', () => {
  for (const [width, height] of WINDOWS) {
    it(`never moves as the view turns, in ${width}x${height}`, async () => {
      const bad: string[] = [];
      for (const elevation of ELEVATIONS) {
        const view = await mount(width, height, [16, elevation]);
        const { min, max } = { min: view.controls.minDistance, max: view.controls.maxDistance };
        for (const distance of [view.fitted, min, max]) {
          const [, first] = view.turn(0, elevation, distance);
          for (const azimuth of AZIMUTHS) {
            const [x, y] = view.turn(azimuth, elevation, distance);
            if (x !== 0 || Math.abs(y - first) > 1e-9) {
              bad.push(`el ${elevation} az ${azimuth} d ${distance.toFixed(1)}: shift ${x}, ${y}`);
            }
          }
        }
      }
      expect(bad.slice(0, 10)).toEqual([]);
    });

    it(`moves smoothly as the view climbs, in ${width}x${height}`, async () => {
      const view = await mount(width, height);
      const { minDistance: min, maxDistance: max } = view.controls;
      let worst = 0;
      let kink = 0;
      for (const distance of [view.fitted, min, max]) {
        for (const azimuth of [0, 16, 45, 200]) {
          const shifts: number[] = [];
          for (let e = -14; e <= 89.9; e += 0.25) shifts.push(view.turn(azimuth, e, distance)[1]);
          for (let i = 1; i < shifts.length; i++) {
            worst = Math.max(worst, Math.abs(shifts[i] - shifts[i - 1]));
            if (i > 1)
              kink = Math.max(kink, Math.abs(shifts[i] - 2 * shifts[i - 1] + shifts[i - 2]));
          }
        }
      }
      // A quarter of a degree moves the view's centre under 2 px (zoomed all
      // the way in, where it moves fastest), and it never lurches: no step
      // differs from the one before by a third of a pixel
      expect(worst).toBeLessThan(2);
      expect(kink).toBeLessThan(0.3);
    });

    it(`keeps the tower and every label in frame, clear of the HUD, in ${width}x${height}`, async () => {
      const bad: string[] = [];
      let tightest = Infinity;
      for (const elevation of ELEVATIONS) {
        const view = await mount(width, height, [16, elevation]);
        const { camera, bands } = view;
        const { minDistance: min, maxDistance: max } = view.controls;
        for (const [name, distance] of [
          ['fitted', view.fitted],
          ['zoomed out', max],
          ['zoomed in', min],
        ] as const) {
          let state: AnchorState | null = null;
          for (const azimuth of AZIMUTHS) {
            view.turn(azimuth, elevation, distance);
            const eye = camera.position.toArray() as Vec3;
            const grow = Math.min(Math.max((distance / view.fitted) ** 0.5, 0.6), 2);
            const result = labelAnchors(layout, 'white', eye, [0, 0, 0], state);
            state = result.state;
            const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
            const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
            const glyph = GLYPH_REACH * SIZE * grow;
            const points = [
              // The platforms with their glass and border, and the tallest
              // pieces on the top one's outer squares
              ...frame.levelY.flatMap((y) =>
                CORNERS.map(([x, z]) => new Vector3(x * 2.58, y, z * 2.58)),
              ),
              ...CORNERS.map(([x, z]) => new Vector3(x * 2.3, layout.halfExtents[1], z * 2.3)),
              // Every label's glyph
              ...result.labels.flatMap((l) =>
                CORNERS.map(([a, b]) =>
                  new Vector3(...l.position)
                    .addScaledVector(right, a * glyph)
                    .addScaledVector(up, b * glyph),
                ),
              ),
            ].map((p) => {
              const n = p.project(camera);
              return [((n.x + 1) / 2) * width, ((1 - n.y) / 2) * height];
            });
            if (name === 'zoomed in') {
              // Too near to fit; the tower's axis still stands in the middle
              const axis = new Vector3(0, 0, 0).project(camera);
              if (Math.abs(axis.x) > 1e-9) bad.push(`el ${elevation} az ${azimuth}: off centre`);
              continue;
            }
            const room = Math.min(
              ...points.map(([x, y]) =>
                Math.min(x, width - x, y - bands.top, height - bands.bottom - y),
              ),
            );
            tightest = Math.min(tightest, room);
            if (room < 0)
              bad.push(`el ${elevation} az ${azimuth} ${name}: ${room.toFixed(1)} px out`);
          }
        }
      }
      expect(bad.slice(0, 10)).toEqual([]);
      expect(tightest).toBeGreaterThan(0);
    });
  }

  it('is the rings’ own fit and centring, which do not depend on the azimuth', async () => {
    const view = await mount(1280, 720);
    const bounds = ringBounds(layout.frameRings, 18 * DEG, view.fitted, FIT_SOFTNESS);
    const [, y] = view.turn(123, 18);
    const px = 720 / (2 * Math.tan(18 * DEG));
    const band = (hudBands(1280, 720, false).top / 720) * Math.tan(18 * DEG);
    expect(y / px).toBeCloseTo((bounds.top + bounds.bottom) / 2 + band, 9);
  });
});
