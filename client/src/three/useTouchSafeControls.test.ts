import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  dropPointers,
  reconcileTouches,
  stalePointers,
  useTouchSafeControls,
} from './useTouchSafeControls';
import type { OrbitPointerState } from './useTouchSafeControls';

describe('stalePointers', () => {
  it('drops nothing while every tracked pointer has a finger', () => {
    expect(stalePointers([{ id: 1, x: 0, y: 0 }], [{ x: 50, y: 50 }])).toEqual([]);
    expect(stalePointers([], [])).toEqual([]);
  });

  it('drops the tracked pointers no finger is near', () => {
    const tracked = [
      { id: 1, x: 100, y: 300 },
      { id: 2, x: 400, y: 300 },
    ];
    expect(stalePointers(tracked, [{ x: 401, y: 299 }])).toEqual([1]);
    expect(stalePointers(tracked, [{ x: 99, y: 300 }])).toEqual([2]);
    expect(stalePointers(tracked, [])).toEqual([1, 2]);
  });

  it('pairs closest first, so one finger never keeps two pointers', () => {
    const tracked = [
      { id: 1, x: 0, y: 0 },
      { id: 2, x: 10, y: 0 },
      { id: 3, x: 200, y: 0 },
    ];
    expect(
      stalePointers(tracked, [
        { x: 9, y: 0 },
        { x: 150, y: 0 },
      ]),
    ).toEqual([1]);
  });

  it('keeps the later-pressed pointer on a tie', () => {
    const tracked = [
      { id: 1, x: 50, y: 50 },
      { id: 2, x: 50, y: 50 },
    ];
    expect(stalePointers(tracked, [{ x: 50, y: 50 }])).toEqual([1]);
  });
});

// three's OrbitControls, driven through its real listeners on a jsdom element
// (which lacks pointer capture and layout, so both are stubbed).
const setup = () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  Object.defineProperty(el, 'clientHeight', { value: 600 });
  const captured = new Set<number>();
  el.setPointerCapture = (id: number) => void captured.add(id);
  el.releasePointerCapture = (id: number) => {
    // As a browser does for a pointer it no longer knows
    if (!captured.delete(id)) throw new DOMException('No active pointer', 'NotFoundError');
  };
  el.hasPointerCapture = (id: number) => captured.has(id);
  const camera = new PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0, 6, 14);
  const controls = new OrbitControls(camera, el);
  controls.enablePan = false;
  controls.update();
  const internals = controls as unknown as OrbitPointerState;
  const send = (type: string, pointerId: number, x: number, y: number) =>
    el.dispatchEvent(
      Object.assign(new Event(type), {
        pointerId,
        pointerType: 'touch',
        pageX: x,
        pageY: y,
        clientX: x,
        clientY: y,
        button: 0,
      }),
    );
  const finger = {
    down: (id: number, x: number, y: number) => send('pointerdown', id, x, y),
    move: (id: number, x: number, y: number) => send('pointermove', id, x, y),
    up: (id: number, x: number, y: number) => send('pointerup', id, x, y),
  };
  const view = () => ({
    distance: controls.getDistance(),
    azimuth: controls.getAzimuthalAngle(),
  });
  const touch = (x: number, y: number) => ({ pageX: x, pageY: y, target: el });
  return { el, controls, internals, finger, view, touch, captured };
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('a finger whose pointer-up is lost', () => {
  // A pinch: two fingers down, spread apart, and the first lifted without
  // the browser delivering its pointer-up.
  const pinchThenLoseAnUp = () => {
    const s = setup();
    s.finger.down(1, 100, 300);
    s.finger.down(2, 300, 300);
    s.finger.move(2, 400, 300);
    return s;
  };

  it('turns the next one-finger drag into a zoom, left alone', () => {
    const { finger, view } = pinchThenLoseAnUp();
    const before = view();
    finger.move(2, 500, 300);
    // The bug: the drag dollies against where the lifted finger was
    expect(view().distance).not.toBeCloseTo(before.distance, 3);
  });

  it('is dropped when the touch list no longer has it, and the finger left turns the view', () => {
    const { internals, finger, view, touch, el } = pinchThenLoseAnUp();
    // touchend for the lifted finger: only the second is still down
    expect(reconcileTouches(internals, [touch(400, 300)], el)).toEqual([1]);
    expect(internals._pointers).toEqual([2]);
    const before = view();
    finger.move(2, 500, 300);
    expect(view().distance).toBeCloseTo(before.distance, 6);
    expect(view().azimuth).not.toBeCloseTo(before.azimuth, 2);
  });

  it('is dropped when a new finger lands, which then turns the view on its own', () => {
    const { internals, finger, view, touch, el } = setup();
    finger.down(1, 100, 300); // its up is lost
    finger.down(3, 250, 250);
    expect(internals._pointers).toEqual([1, 3]);
    // touchstart for the new finger: it is the only one on the screen
    expect(reconcileTouches(internals, [touch(250, 250)], el)).toEqual([1]);
    const before = view();
    finger.move(3, 150, 250);
    expect(view().distance).toBeCloseTo(before.distance, 6);
    expect(view().azimuth).not.toBeCloseTo(before.azimuth, 2);
  });

  it('with no finger left, idles the controls and lets the next touch start afresh', () => {
    const { internals, controls, finger, view, el, captured } = setup();
    const end = vi.fn();
    controls.addEventListener('end', end);
    finger.down(1, 100, 300);
    finger.move(1, 120, 300);
    expect(captured.has(1)).toBe(true);
    // touchend with no fingers left; the pointer-up never came
    expect(reconcileTouches(internals, [], el)).toEqual([1]);
    expect(internals._pointers).toEqual([]);
    expect(internals.state).toBe(-1);
    expect(end).toHaveBeenCalledTimes(1);
    expect(captured.size).toBe(0);
    // A stray move of the forgotten finger does nothing
    const before = view();
    finger.move(1, 300, 300);
    expect(view()).toEqual(before);
    // The next finger is captured and turns the view
    finger.down(4, 200, 200);
    expect(captured.has(4)).toBe(true);
    finger.move(4, 260, 200);
    expect(view().azimuth).not.toBeCloseTo(before.azimuth, 2);
    finger.up(4, 260, 200);
    expect(internals._pointers).toEqual([]);
  });

  it('leaves the controls alone while the counts agree', () => {
    const { internals, finger, touch, el } = setup();
    finger.down(1, 100, 300);
    finger.down(2, 300, 300);
    const state = internals.state;
    expect(reconcileTouches(internals, [touch(100, 300), touch(300, 300)], el)).toEqual([]);
    expect(internals._pointers).toEqual([1, 2]);
    expect(internals.state).toBe(state);
  });

  it('counts only fingers that went down on the controls, but trusts one whose element left', () => {
    const { internals, finger, el } = setup();
    finger.down(1, 100, 300);
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    const detached = document.createElement('span');
    // A finger on a HUD button does not account for the canvas's pointer...
    expect(reconcileTouches(internals, [{ pageX: 100, pageY: 300, target: outside }], el)).toEqual([
      1,
    ]);
    finger.down(2, 100, 300);
    // ...but one whose element was removed mid-touch may be it
    expect(reconcileTouches(internals, [{ pageX: 100, pageY: 300, target: detached }], el)).toEqual(
      [],
    );
  });
});

describe('dropPointers', () => {
  it('ignores pointers the controls do not hold', () => {
    const { internals, finger } = setup();
    finger.down(1, 100, 300);
    const state = internals.state;
    dropPointers(internals, [7]);
    expect(internals._pointers).toEqual([1]);
    expect(internals.state).toBe(state);
  });

  it('idles rather than restart a gesture it cannot place (a mouse button still held)', () => {
    const { internals, el } = setup();
    el.dispatchEvent(
      Object.assign(new Event('pointerdown'), {
        pointerId: 9,
        pointerType: 'mouse',
        button: 0,
        clientX: 10,
        clientY: 10,
        pageX: 10,
        pageY: 10,
      }),
    );
    internals._pointers.push(1);
    internals._pointerPositions[1] = { x: 0, y: 0 };
    dropPointers(internals, [1]);
    expect(internals._pointers).toEqual([9]);
    expect(internals.state).toBe(-1);
  });
});

describe('useTouchSafeControls', () => {
  const touchEvent = (type: string, touches: unknown[]) =>
    Object.assign(new Event(type, { bubbles: true }), { touches });

  it('reconciles on touch events, and drops pointers on a lost capture, a blur or a hidden page', () => {
    const { el, internals, finger, touch } = setup();
    const { unmount } = renderHook(() => useTouchSafeControls(internals, el));

    finger.down(1, 100, 300);
    finger.down(2, 300, 300);
    el.dispatchEvent(touchEvent('touchend', [touch(300, 300)]));
    expect(internals._pointers).toEqual([2]);

    el.dispatchEvent(Object.assign(new Event('lostpointercapture'), { pointerId: 2 }));
    expect(internals._pointers).toEqual([]);

    // A lost touchend is made up for by the next move of a finger still down
    finger.down(6, 100, 300);
    finger.down(7, 300, 300);
    el.dispatchEvent(touchEvent('touchmove', [touch(310, 300)]));
    expect(internals._pointers).toEqual([7]);
    finger.up(7, 310, 300);

    finger.down(3, 100, 100);
    window.dispatchEvent(new Event('blur'));
    expect(internals._pointers).toEqual([]);

    finger.down(4, 100, 100);
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    visibility.mockRestore();
    expect(internals._pointers).toEqual([]);

    unmount();
    finger.down(5, 100, 100);
    el.dispatchEvent(touchEvent('touchstart', []));
    window.dispatchEvent(new Event('blur'));
    expect(internals._pointers).toEqual([5]);
  });
});
