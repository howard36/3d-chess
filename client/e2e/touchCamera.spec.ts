import { test, expect } from '@playwright/test';
import type { CDPSession, Page } from '@playwright/test';
import { startGame } from './helpers/game';

// A phone's gestures on the board, sent as real touch input through the
// DevTools protocol, so the page sees the pointer and touch events a phone
// sends. The bug this guards against: when the browser loses a lifted
// finger's pointer-up, the camera controls kept counting that finger, and
// the next one-finger drag was read as a pinch against it, zooming instead
// of turning the view (src/three/useTouchSafeControls.ts). The lost events
// are simulated by swallowing them before any of the page's listeners.
//
// The protocol cannot lift one finger of several (a point left out of a
// move stays down until touchEnd, which lifts every finger in turn), so each
// case pinches, lifts both fingers, then drags a fresh one. The first
// finger's pointer-up is always lost; losing its touchend too, or both
// touchends, leaves the controls to find out at the second touchend or at
// the next finger's touchstart. (Dragging the finger still down after the
// other lifts is covered in useTouchSafeControls.test.ts.)

type Finger = [x: number, y: number, id: number];

const touch = (
  cdp: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd',
  fingers: Finger[] = [],
) =>
  cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: fingers.map(([x, y, id]) => ({ x, y, id })),
  });

type Probe = Window & {
  __r3fState?: {
    get: () => {
      camera: {
        position: {
          x: number;
          y: number;
          z: number;
          sub(v: unknown): { setLength(d: number): { add(v: unknown): void } };
        };
      };
      controls: { target: { x: number; y: number; z: number }; update(): void };
      invalidate(): void;
    };
  };
  __loseFirstFinger?: boolean;
  __lost?: Set<number>;
  __loseTouchEnds?: number;
};

/** The camera's distance from the orbit target, its heading in degrees, and the target. */
const view = (page: Page) =>
  page.evaluate(() => {
    const { camera, controls } = (window as Probe).__r3fState!.get();
    const { position: p } = camera;
    const { target: t } = controls;
    const [dx, dy, dz] = [p.x - t.x, p.y - t.y, p.z - t.z];
    return {
      distance: Math.hypot(dx, dy, dz),
      azimuth: (Math.atan2(dx, dz) * 180) / Math.PI,
      target: [t.x, t.y, t.z],
    };
  });

/**
 * Waits for the damped camera to come to rest: unchanged over half a second
 * (a software-rendered frame can take longer than one poll).
 */
const settled = async (page: Page) => {
  let last = await view(page);
  let still = 0;
  for (let i = 0; i < 100 && still < 5; i++) {
    await page.waitForTimeout(100);
    const now = await view(page);
    const moved =
      Math.abs(now.azimuth - last.azimuth) > 0.01 || Math.abs(now.distance - last.distance) > 1e-4;
    still = moved ? 0 : still + 1;
    last = now;
  }
  return last;
};

test('a one-finger drag turns the view even after a finger was never reported up', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const game = await startGame(browser);
  const page = game.white;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  await page.evaluate(() => {
    const w = window as Probe;
    w.__lost = new Set();
    w.__loseFirstFinger = false;
    w.__loseTouchEnds = 0;
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType !== 'touch' || !w.__loseFirstFinger) return;
        w.__loseFirstFinger = false;
        w.__lost!.add(e.pointerId);
      },
      true,
    );
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      window.addEventListener(
        type,
        (e) => {
          if (w.__lost!.has((e as PointerEvent).pointerId)) e.stopImmediatePropagation();
        },
        true,
      );
    }
    window.addEventListener(
      'touchend',
      (e) => {
        if (w.__loseTouchEnds! <= 0) return;
        w.__loseTouchEnds!--;
        e.stopImmediatePropagation();
      },
      true,
    );
  });

  const start = await settled(page);
  // Over the middle of the board, clear of the HUD
  const y = 400;
  for (const lostTouchEnds of [0, 1, 2]) {
    // Back to the opening distance, so each pinch has room to zoom
    await page.evaluate((d) => {
      const state = (window as Probe).__r3fState!.get();
      const { camera, controls } = state;
      camera.position.sub(controls.target).setLength(d).add(controls.target);
      controls.update();
      state.invalidate();
    }, start.distance);
    await page.evaluate((n) => {
      const w = window as Probe;
      w.__loseFirstFinger = true;
      w.__loseTouchEnds = n;
    }, lostTouchEnds);

    // A pinch: spreading two fingers zooms in
    await touch(cdp, 'touchStart', [[540, y, 1]]);
    await touch(cdp, 'touchStart', [
      [540, y, 1],
      [740, y, 2],
    ]);
    // (not so far that the zoom reaches its limit, where a stray dolly would not show)
    for (let k = 1; k <= 4; k++) {
      await touch(cdp, 'touchMove', [
        [540 - 8 * k, y, 1],
        [740 + 8 * k, y, 2],
      ]);
    }
    await touch(cdp, 'touchEnd');
    const pinched = await settled(page);
    expect(pinched.distance, `pinch (${lostTouchEnds} touchends lost)`).toBeLessThan(
      start.distance * 0.97,
    );

    // The next single finger turns the view and does not zoom
    await touch(cdp, 'touchStart', [[600, y, 3]]);
    for (let k = 1; k <= 10; k++) await touch(cdp, 'touchMove', [[600 - 15 * k, y, 3]]);
    const dragged = await settled(page);
    await touch(cdp, 'touchEnd');
    const context = `drag (${lostTouchEnds} touchends lost)`;
    expect(Math.abs(dragged.azimuth - pinched.azimuth), context).toBeGreaterThan(5);
    expect(dragged.distance, context).toBeCloseTo(pinched.distance, 3);
    expect(dragged.target, context).toEqual([0, 0, 0]);
  }

  await game.close();
});
