import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Raycaster, Vector2 } from 'three';
import type { RootState } from '@react-three/fiber';
import { eventPoint, exactClickCompute } from './exactClicks';

const at = (type: string, offsetX: number, offsetY: number) =>
  ({ type, offsetX, offsetY }) as unknown as PointerEvent;

describe('eventPoint', () => {
  it('aims a click at the exact point of the release that made it', () => {
    // Chromium's whole-pixel click, a third of a pixel from its release
    expect(eventPoint(at('click', 542, 328), [541.66, 328.28])).toEqual([541.66, 328.28]);
    expect(eventPoint(at('click', 541, 329), [541.66, 328.28])).toEqual([541.66, 328.28]);
  });

  it('leaves every other event, and a click far from the last release, where it says', () => {
    expect(eventPoint(at('pointerdown', 541.66, 328.28), [10, 10])).toEqual([541.66, 328.28]);
    expect(eventPoint(at('pointermove', 20, 30), [20.5, 30.5])).toEqual([20, 30]);
    expect(eventPoint(at('click', 300, 200), [541.66, 328.28])).toEqual([300, 200]);
    expect(eventPoint(at('click', 300, 200), null)).toEqual([300, 200]);
  });
});

describe('exactClickCompute', () => {
  const state = () => {
    const camera = new PerspectiveCamera(36, 2, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    return {
      pointer: new Vector2(),
      raycaster: new Raycaster(),
      camera,
      size: { width: 800, height: 400 },
    } as unknown as RootState;
  };

  it('raycasts a click from the pointer-up before it, as r3f raycast the press', () => {
    const s = state();
    const compute = exactClickCompute();
    compute(at('pointerdown', 541.66, 328.28), s);
    const pressed = s.raycaster.ray.direction.clone();
    compute(at('pointerup', 541.66, 328.28), s);
    compute(at('click', 542, 328), s);
    expect(s.pointer.x).toBeCloseTo((541.66 / 800) * 2 - 1, 9);
    expect(s.pointer.y).toBeCloseTo(-(328.28 / 400) * 2 + 1, 9);
    // The very ray of the press: the click reaches what the press reached
    expect(s.raycaster.ray.direction.distanceTo(pressed)).toBeLessThan(1e-9);
  });

  it('aims everything else as r3f does, at the event itself', () => {
    const s = state();
    const compute = exactClickCompute();
    compute(at('pointerup', 100.4, 50.4), s);
    compute(at('pointermove', 400, 200), s);
    expect(s.pointer.x).toBeCloseTo(0, 9);
    expect(s.pointer.y).toBeCloseTo(0, 9);
    // A click elsewhere (a keyboard's, say) keeps its own point
    compute(at('click', 600, 100), s);
    expect(s.pointer.x).toBeCloseTo(0.5, 9);
    expect(s.pointer.y).toBeCloseTo(0.5, 9);
  });
});
