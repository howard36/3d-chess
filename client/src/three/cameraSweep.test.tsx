import { describe, expect, it } from 'vitest';
import React from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { useThree } from '@react-three/fiber';
import { PerspectiveCamera, Vector3 } from 'three';
import { FitCameraToBoard } from './FitCameraToBoard';
import { HUD_TOP_PX, hudTop, orbitSweep } from './cameraFit';
import { towerFrame } from './layout';
import { CORNERS, GLYPH_REACH, labelAnchors } from './scene/labelAnchors';
import type { AnchorState } from './scene/labelAnchors';
import { layout } from './scene/palette';
import { lensShiftOf } from './viewOffset';
import type { Vec3 } from './types';

// The game's camera fit (FitCameraToBoard, as GameScreen mounts it) swept
// through every pose: fitted with the view at each of seven elevations from
// 14° below the horizon to overhead (as when the window changes size), then
// turned all the way round at each of them, near, as fitted and far, in a
// desktop window and a phone either way up. What the player sees:
//
// - a window is framed the same whatever the view's elevation when it was
//   fitted: the fit is the opening view's, so a resized window looks as a
//   fresh load at that size would;
// - turning, climbing or zooming the view never moves it: the lens shift is
//   set with the fit, has no sideways part, and stays as the camera moves, so
//   the tower's centre stands still on screen and the camera only turns
//   about it;
// - the whole tower and every label, where the grid puts it, stays inside the
//   window clear of the HUD's top band from every elevation, at the fitted
//   distance and zoomed all the way out; zoomed all the way in (where it
//   cannot fit) it stays centred;
// - no view of it stands far off the middle of the room between the pill and
//   the window's bottom, and the views the game is played from are not left
//   low: the tower's fixed centre is placed to balance the whole orbit.

const DEG = Math.PI / 180;
// Each sweep takes a few seconds on an idle machine and several times that on
// a busy one, past vitest's 5 s default
const SWEEP = { timeout: 30_000 };
const WINDOWS = [
  [1280, 720],
  [390, 844],
  [844, 390],
  [856, 927],
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
  let setSize: ((width: number, height: number) => void) | undefined;
  const Controls = () => {
    const set = useThree((s) => s.set);
    setSize = useThree((s) => s.setSize);
    React.useLayoutEffect(() => set({ controls: controls as never }), [set]);
    return null;
  };
  await ReactThreeTestRenderer.create(
    <>
      <Controls />
      <FitCameraToBoard
        viewDirection={layout.viewDirection}
        minDistance={layout.orbit.minDistance}
        frameRings={layout.frameRings}
        hudTopBand={hudTop}
        balanceInset={HUD_TOP_PX}
        sweep={orbitSweep(layout.orbit)}
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
  /** Changes the canvas's size, as a window resize does. */
  const resize = (w: number, h: number) => ReactThreeTestRenderer.act(async () => setSize?.(w, h));
  return { camera, controls, fitted, turn, resize, top: hudTop(height), size: { width, height } };
}

/**
 * Every pose round the tower at this elevation and distance: the room left
 * between the tower or its labels and the window's edges or the HUD band, in
 * CSS px, and the poses where something stands outside; and how far below the
 * middle of the room between the pill and the window's bottom the tower
 * stands on average (CSS px, negative above it).
 */
function sweepRoom(view: Awaited<ReturnType<typeof mount>>, elevation: number, distance: number) {
  const { camera, top } = view;
  const { width, height } = view.size;
  const bad: string[] = [];
  let tightest = Infinity;
  let low = 0;
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
      ...frame.levelY.flatMap((y) => CORNERS.map(([x, z]) => new Vector3(x * 2.58, y, z * 2.58))),
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
    const room = Math.min(...points.map(([x, y]) => Math.min(x, width - x, y - top, height - y)));
    tightest = Math.min(tightest, room);
    if (room < 0) bad.push(`el ${elevation} az ${azimuth}: ${room.toFixed(1)} px out`);
    const ys = points.map(([, y]) => y);
    low += (Math.min(...ys) - HUD_TOP_PX - (height - Math.max(...ys))) / 2 / AZIMUTHS.length;
  }
  return { bad, tightest, low };
}

describe('the fitted view', SWEEP, () => {
  for (const [width, height] of WINDOWS) {
    it(`never moves as the view turns, climbs or zooms, in ${width}x${height}`, async () => {
      const bad: string[] = [];
      for (const opening of ELEVATIONS) {
        const view = await mount(width, height, [16, opening]);
        const { min, max } = { min: view.controls.minDistance, max: view.controls.maxDistance };
        const [x0, y0] = view.turn(16, opening);
        for (const distance of [view.fitted, min, max]) {
          for (const elevation of ELEVATIONS) {
            for (let azimuth = 0; azimuth < 360; azimuth += 7.5) {
              const [x, y] = view.turn(azimuth, elevation, distance);
              if (x !== x0 || y !== y0) {
                bad.push(
                  `from ${opening}: el ${elevation} az ${azimuth} d ${distance.toFixed(1)}: shift ${x}, ${y}`,
                );
              }
            }
          }
        }
      }
      expect(bad.slice(0, 10)).toEqual([]);
    });

    it(`keeps the tower and every label in frame, clear of the HUD, in ${width}x${height}`, async () => {
      const bad: string[] = [];
      let tightest = Infinity;
      for (const elevation of ELEVATIONS) {
        const view = await mount(width, height, [16, elevation]);
        const { minDistance: min, maxDistance: max } = view.controls;
        for (const [name, distance] of [
          ['fitted', view.fitted],
          ['zoomed out', max],
          ['zoomed in', min],
        ] as const) {
          if (name === 'zoomed in') {
            // Too near to fit; the tower's axis still stands in the middle
            for (const azimuth of AZIMUTHS) {
              view.turn(azimuth, elevation, distance);
              const axis = new Vector3(0, 0, 0).project(view.camera);
              if (Math.abs(axis.x) > 1e-9) bad.push(`el ${elevation} az ${azimuth}: off centre`);
            }
            continue;
          }
          const room = sweepRoom(view, elevation, distance);
          tightest = Math.min(tightest, room.tightest);
          bad.push(...room.bad.map((b) => `${b} ${name}`));
        }
      }
      expect(bad.slice(0, 10)).toEqual([]);
      expect(tightest).toBeGreaterThan(0);
    });
  }

  // The fit at the opening keeps every elevation the view can reach in the
  // room: the tower and its labels stay clear of the HUD's band and the
  // window's edges however far the view climbs or dips.
  for (const [width, height] of WINDOWS) {
    it(`keeps the tower in frame from every elevation, fitted at the opening, in ${width}x${height}`, async () => {
      const view = await mount(width, height);
      const bad: string[] = [];
      let tightest = Infinity;
      for (let elevation = -14; elevation <= 89.9; elevation += elevation < 85 ? 5 : 4.9) {
        const room = sweepRoom(view, elevation, view.fitted);
        tightest = Math.min(tightest, room.tightest);
        bad.push(...room.bad);
      }
      expect(bad.slice(0, 10)).toEqual([]);
      expect(tightest).toBeGreaterThan(0);
    });

    // No one point centres every view: from low down the tower sits low,
    // from overhead or from under it high. Measured from the pill, the views
    // the game is played from are left no more than 5% of the room low, and
    // no view stands more than 6.5% off the middle. (In the middle of the
    // room between the band and the bottom, the opening stood 7.5% low.)
    it(`balances the tower in the room over the whole orbit, in ${width}x${height}`, async () => {
      const view = await mount(width, height);
      const room = height - HUD_TOP_PX;
      const lows: string[] = [];
      let worst = 0;
      for (const elevation of [-14, 0, 10, 18, 25, 35, 45, 55, 65, 75, 89.9]) {
        const { low } = sweepRoom(view, elevation, view.fitted);
        lows.push(`${elevation}°: ${low.toFixed(0)}`);
        worst = Math.max(worst, Math.abs(low) / room);
        if (elevation === 18) expect(low / room, lows.join(', ')).toBeLessThan(0.05);
      }
      expect(worst, lows.join(', ')).toBeLessThan(0.065);
    });
  }

  for (const [width, height] of WINDOWS) {
    it(`frames ${width}x${height} the same whatever the view's elevation when it was fitted`, async () => {
      const opening = await mount(width, height);
      const [, y0] = opening.turn(16, 18);
      for (const elevation of ELEVATIONS) {
        for (const azimuth of [16, 200]) {
          const view = await mount(width, height, [azimuth, elevation]);
          expect(view.fitted).toBeCloseTo(opening.fitted, 9);
          expect(view.controls.minDistance).toBeCloseTo(opening.controls.minDistance, 9);
          expect(view.controls.maxDistance).toBeCloseTo(opening.controls.maxDistance, 9);
          expect(view.turn(azimuth, elevation)).toEqual([0, y0]);
        }
      }
    });
  }

  it('keeps the player’s zoom and turn when the window changes size, framed as a fresh load', async () => {
    const view = await mount(1280, 720);
    const { camera, controls } = view;
    // Turned and zoomed in
    view.turn(100, 40, view.fitted * 0.85);
    const facing = camera.position.clone().normalize();
    for (const [width, height, zoom] of [
      [900, 900, 0.85],
      [390, 844, 0.85],
      [1440, 900, 0.85],
    ] as const) {
      await view.resize(width, height);
      const fresh = await mount(width, height);
      // The same multiple of the new fit, which is a fresh load's, with its
      // centre and zoom limits
      expect(camera.userData.fitDistance).toBeCloseTo(fresh.fitted, 9);
      expect(camera.position.length() / fresh.fitted).toBeCloseTo(zoom, 9);
      expect(camera.position.clone().normalize().distanceTo(facing)).toBeLessThan(1e-9);
      expect(lensShiftOf(camera)).toEqual(lensShiftOf(fresh.camera));
      expect(controls.minDistance).toBeCloseTo(fresh.controls.minDistance, 9);
      expect(controls.maxDistance).toBeCloseTo(fresh.controls.maxDistance, 9);
    }
    // Zoomed all the way out, it stays all the way out
    camera.position.setLength(controls.maxDistance);
    await view.resize(1280, 720);
    expect(camera.position.length()).toBeCloseTo(controls.maxDistance, 9);
  });

  it('stands the tower’s centre a little above the middle of the room below the HUD band, from any azimuth', async () => {
    const view = await mount(1280, 720);
    const [, y0] = view.turn(0, 18);
    // Above the room's middle (half the band below the window's middle), by
    // a few per cent of the room
    expect(y0).toBeLessThan(hudTop(720) / 2);
    expect(y0).toBeGreaterThan(hudTop(720) / 2 - 0.05 * (720 - hudTop(720)));
    for (const azimuth of [123, 250]) expect(view.turn(azimuth, 18)).toEqual([0, y0]);
  });
});
