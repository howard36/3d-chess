import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { useThree } from '@react-three/fiber';
import { PerspectiveCamera, Vector3 } from 'three';
import { FitCameraToBoard } from '../FitCameraToBoard';
import { hudTop } from '../cameraFit';
import { layout } from '../scene/palette';
import { lensShiftOf } from '../viewOffset';
import { IntroDirector, INTRO_HUD_VAR, INTRO_SCENE_VAR } from './IntroDirector';
import type { IntroClock } from './clock';
import { dollyFactor, introPlan } from './timeline';

const { act } = ReactThreeTestRenderer;

/**
 * The game's camera (FitCameraToBoard, as GameView mounts it) with the
 * entrance's director, and stand-in orbit controls.
 */
async function mount(variant: 'full' | 'short', paused = false) {
  const camera = new PerspectiveCamera(36, 1280 / 720, 0.1, 1000);
  camera.position.set(...layout.viewDirection);
  const controls = {
    target: new Vector3(),
    enabled: true,
    minDistance: 0,
    maxDistance: Infinity,
    update: vi.fn(),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const Controls = () => {
    const set = useThree((s) => s.set);
    React.useLayoutEffect(() => set({ controls: controls as never }), [set]);
    return null;
  };
  const clock: IntroClock = { plan: introPlan(variant), t: 0 };
  const element = document.createElement('div');
  const onDone = vi.fn();
  const onFirstFrame = vi.fn();
  const App = ({ paused }: { paused: boolean }) => (
    <>
      <Controls />
      <FitCameraToBoard
        viewDirection={layout.viewDirection}
        minDistance={layout.orbit.minDistance}
        frameRings={layout.frameRings}
        hudTopBand={hudTop}
      />
      <IntroDirector
        clock={clock}
        paused={paused}
        styleTarget={{ current: element }}
        onDone={onDone}
        onFirstFrame={onFirstFrame}
      />
    </>
  );
  const renderer = await ReactThreeTestRenderer.create(<App paused={paused} />, {
    width: 1280,
    height: 720,
    camera,
  });
  const fitted = camera.userData.fitDistance as number;
  const shift = lensShiftOf(camera);
  const direction = camera.position.clone().normalize();
  return {
    camera,
    controls,
    clock,
    element,
    onDone,
    onFirstFrame,
    fitted,
    shift,
    direction,
    frames: (n: number, delta = 1 / 30) => act(async () => renderer.advanceFrames(n, delta)),
    unpause: () => act(async () => renderer.update(<App paused={false} />)),
  };
}

describe('the entrance’s camera', () => {
  it('dollies in along the opening line of sight to exactly the fitted view', async () => {
    const view = await mount('full');
    expect(view.fitted).toBeGreaterThan(0);
    await view.frames(1);
    // The first frame: far out, the controls taking no input
    expect(view.clock.t).toBe(0);
    expect(view.camera.position.length()).toBeCloseTo(view.fitted * 2.4, 5);
    expect(view.controls.enabled).toBe(false);
    let last = Infinity;
    for (let i = 0; i < 40; i++) {
      await view.frames(1);
      const d = view.camera.position.length();
      expect(d).toBeLessThanOrEqual(last + 1e-9);
      expect(d).toBeCloseTo(view.fitted * dollyFactor(view.clock.plan, view.clock.t), 5);
      // Only nearer or farther, on the same line, the lens shift untouched
      expect(view.camera.position.clone().normalize().distanceTo(view.direction)).toBeLessThan(
        1e-9,
      );
      expect(lensShiftOf(view.camera)).toEqual(view.shift);
      last = d;
    }
    expect(view.onDone).not.toHaveBeenCalled();
    await view.frames(200);
    expect(view.onDone).toHaveBeenCalledTimes(1);
    expect(view.camera.position.length()).toBeCloseTo(view.fitted, 9);
    expect(view.controls.enabled).toBe(true);
    expect(view.controls.update).toHaveBeenCalled();
  });

  it('fades the scene and the HUD by custom properties, removed once it is over', async () => {
    const view = await mount('short');
    await view.frames(1);
    expect(view.element.style.getPropertyValue(INTRO_SCENE_VAR)).toBe('0.0000');
    expect(view.element.style.getPropertyValue(INTRO_HUD_VAR)).toBe('0.0000');
    await view.frames(4);
    expect(Number(view.element.style.getPropertyValue(INTRO_SCENE_VAR))).toBeGreaterThan(0);
    await view.frames(100);
    expect(view.element.style.getPropertyValue(INTRO_SCENE_VAR)).toBe('');
    expect(view.element.style.getPropertyValue(INTRO_HUD_VAR)).toBe('');
  });

  it('holds at its first frame while paused, and plays once let go', async () => {
    const view = await mount('full', true);
    await view.frames(30);
    expect(view.clock.t).toBe(0);
    expect(view.camera.position.length()).toBeCloseTo(view.fitted * 2.4, 5);
    await view.unpause();
    await view.frames(10);
    expect(view.clock.t).toBeGreaterThan(0.25);
  });

  it('never skips ahead on a stalled frame', async () => {
    const view = await mount('full');
    await view.frames(2, 5);
    expect(view.clock.t).toBeLessThanOrEqual(0.25);
  });
});
