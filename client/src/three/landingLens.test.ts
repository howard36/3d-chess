import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { FIT_SOFTNESS, elevationOf, fitView, ringBounds } from './cameraFit';
import type { FitWindow } from './cameraFit';
import {
  LANDING_CAMERAS,
  LANDING_PICTURES,
  PICTURE_FADE,
  landingLens,
  pictureSource,
  pictureSourceSet,
  picturePlacement,
} from './landingLens';
import { COMMON_WINDOWS } from './landingWindows';
import { landingFrameRings, landingViewDirection } from './landingView';
import { LANDING_BANDS, landingLayoutOf } from '../screens/landingLayout';
import type { LandingLayout } from '../screens/landingLayout';

const opening = elevationOf(new Vector3(...landingViewDirection), new Vector3());
const fitWindow = (width: number, height: number, fov = 36): FitWindow => ({
  width,
  height,
  fov,
  topInset: LANDING_BANDS.top(height, width),
  bottomInset: LANDING_BANDS.bottom(height, width),
  leftInset: LANDING_BANDS.left(width, height),
  centre: 'rings',
});

const REFERENCE: Record<LandingLayout, [number, number]> = {
  phone: [390, 700],
  tablet: [820, 1180],
  wide: [1440, 900],
};

// Every common window, and a sweep of others from a small phone to a wall
const windows: [number, number][] = [
  ...Object.values(COMMON_WINDOWS).flat(),
  ...[320, 480, 599, 600, 700, 900, 1200, 1600, 2400, 3200].flatMap((w) =>
    [0.4, 0.6, 0.9, 1, 1.3, 1.8, 2.2].map((r) => [w, Math.round(w * r)] as [number, number]),
  ),
];

describe('the layouts’ cameras', () => {
  it('stand where the game’s fit stands at each layout’s reference window', () => {
    for (const layout of Object.keys(REFERENCE) as LandingLayout[]) {
      const [w, h] = REFERENCE[layout];
      expect(landingLayoutOf(w, h)).toBe(layout);
      const { distance } = fitView(opening, landingFrameRings, fitWindow(w, h));
      const camera = LANDING_CAMERAS[layout];
      // Out of date: the rings, the opening view or the bands changed. Bake
      // the numbers again and re-render the pictures (landing-pictures.mjs)
      expect(camera.distance).toBeCloseTo(distance, 9);
      const b = ringBounds(landingFrameRings, opening, camera.distance, FIT_SOFTNESS);
      expect([camera.right, camera.top, camera.bottom]).toEqual(
        [b.right, b.top, b.bottom].map((v) => expect.closeTo(v, 12)),
      );
    }
  });

  it('show the reference windows exactly as the fit would, with the same lens', () => {
    for (const [w, h] of Object.values(REFERENCE)) {
      expect(landingLens(w, h).fov).toBeCloseTo(36, 9);
    }
  });
});

describe('landingLens', () => {
  it('frames the tower as the fit would, the camera held at its layout’s distance', () => {
    for (const [w, h] of windows) {
      const lens = landingLens(w, h);
      expect(lens.layout).toBe(landingLayoutOf(w, h));
      expect(lens.distance).toBe(LANDING_CAMERAS[lens.layout].distance);
      // The fit, given this lens, stands the camera at this distance with this shift
      const fit = fitView(opening, landingFrameRings, fitWindow(w, h, lens.fov));
      expect(fit.distance).toBeCloseTo(lens.distance, 6);
      expect(fit.shift[0]).toBeCloseTo(lens.shift[0], 9);
      expect(fit.shift[1]).toBeCloseTo(lens.shift[1], 9);
    }
  });

  it('keeps the lens near the fit’s 36° on every common window', () => {
    for (const [w, h] of Object.values(COMMON_WINDOWS).flat()) {
      const { fov } = landingLens(w, h);
      expect(fov).toBeGreaterThan(30);
      // The widest, an iPhone SE's browser with its bars showing (375x553)
      expect(fov).toBeLessThan(50);
    }
  });
});

describe('the pictures', () => {
  it('cover every common window, with their faded edges outside it', () => {
    for (const [layout, list] of Object.entries(COMMON_WINDOWS)) {
      for (const [w, h] of list) {
        const p = picturePlacement(w, h);
        expect(p.layout).toBe(layout);
        const [fx, fy] = [p.width * PICTURE_FADE, p.height * PICTURE_FADE];
        expect(p.left + fx).toBeLessThanOrEqual(0);
        expect(p.top + fy).toBeLessThanOrEqual(0);
        expect(p.left + p.width - fx).toBeGreaterThanOrEqual(w);
        expect(p.top + p.height - fy).toBeGreaterThanOrEqual(h);
      }
    }
  });

  it('keep their shape at every density: the same scene across and down, to a pixel', () => {
    for (const p of Object.values(LANDING_PICTURES)) {
      for (const [w, h] of Object.values(p.pixels)) {
        expect((w % 2) + (h % 2)).toBe(0);
        expect(Math.abs(w - h * p.aspect)).toBeLessThanOrEqual(1);
      }
      // 2x is the finer
      expect(p.pixels['2x'][1]).toBeGreaterThan(p.pixels['1x'][1]);
    }
  });

  it('are named for their density', () => {
    expect(pictureSource('wide', 'avif')).toBe('/landing/wide.avif');
    expect(pictureSource('wide', 'webp', '2x')).toBe('/landing/wide@2x.webp');
    expect(pictureSourceSet('phone', 'avif')).toBe(
      '/landing/phone.avif 1x, /landing/phone@2x.avif 2x',
    );
  });

  it('are placed by the window’s lens: a tangent of the view lands where the camera puts it', () => {
    for (const [w, h] of windows) {
      const lens = landingLens(w, h);
      const p = picturePlacement(w, h);
      const picture = LANDING_PICTURES[lens.layout];
      // The picture's middle, a point of the scene at its centre tangents
      const perTangent = h / (2 * Math.tan((lens.fov * Math.PI) / 360));
      const x = w / 2 + (picture.centre[0] - lens.shift[0]) * perTangent;
      const y = h / 2 - (picture.centre[1] - lens.shift[1]) * perTangent;
      expect(p.left + p.width / 2).toBeCloseTo(x, 6);
      expect(p.top + p.height / 2).toBeCloseTo(y, 6);
      expect(p.height).toBeCloseTo(picture.span * perTangent, 6);
    }
  });
});
