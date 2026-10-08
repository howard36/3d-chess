import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMemo } from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { PerspectiveCamera, ShaderMaterial, Vector2 } from 'three';
import type { Material, Mesh, Scene, WebGLRenderer } from 'three';
import { BackdropCache } from '../three/scene/backdropCache';
import { Stage } from '../three/scene/stage';
import { EnvRedraw } from './EnvRedraw';
import { createEnvStore, defineEnvFeature, replaceEnvStoreForTest, useEnvSetting } from './index';
import type { EnvStore } from './index';
import { restoreEnvFeaturesForTest, takeEnvFeaturesForTest } from './registry';
import type { EnvFeature } from './registry';

// ENV PREVIEW (temporary): a setting changed on the menu shows on the very
// next frame: the canvas is asked for one, and the garden's copy
// (backdropCache.tsx) is not drawn stale whether the change mounts or
// unmounts a part of the garden, hides one or changes a uniform.

let saved: EnvFeature[];
let store: EnvStore;
let before: EnvStore;
beforeEach(() => {
  saved = takeEnvFeaturesForTest();
  defineEnvFeature({
    id: 'dummy',
    label: 'Dummy',
    group: 'Garden',
    options: [
      { id: 'off', label: 'Off' },
      { id: 'on', label: 'On' },
      { id: 'hidden', label: 'Hidden' },
      { id: 'bright', label: 'Bright' },
    ],
    default: 'on',
  });
  store = createEnvStore({ start: { host: 'localhost', search: '?envpanel' }, storage: null });
  before = replaceEnvStoreForTest(store);
});
afterEach(() => {
  replaceEnvStoreForTest(before);
  restoreEnvFeaturesForTest(saved);
});

/** A garden part as a feature would add one: mounted, shown and lit by its setting. */
const Dummy = () => {
  const value = useEnvSetting('dummy');
  const material = useMemo(
    () => new ShaderMaterial({ depthWrite: false, uniforms: { uLight: { value: 0 } } }),
    [],
  );
  material.uniforms.uLight.value = value === 'bright' ? 1 : 0.4;
  if (value === 'off') return null;
  return <mesh name="dummy" material={material} renderOrder={-890} visible={value !== 'hidden'} />;
};

/** A stand-in for the renderer, as the cache sees it. */
const fakeRenderer = () => ({
  copies: 0,
  getDrawingBufferSize: (v: Vector2) => v.set(640, 480),
  getRenderTarget: () => null,
  copyFramebufferToTexture() {
    this.copies++;
  },
});

const mount = async () => {
  const sky = new ShaderMaterial({ depthWrite: false, uniforms: { uTop: { value: 1 } } });
  const r = await ReactThreeTestRenderer.create(
    <BackdropCache>
      <EnvRedraw />
      <mesh name="sky" material={sky} renderOrder={-1000} />
      <Dummy />
    </BackdropCache>,
  );
  const scene = r.scene.instance as unknown as Scene;
  const state = (
    scene as unknown as { __r3f: { root: { getState(): { invalidate: () => void } } } }
  ).__r3f.root.getState();
  const invalidate = vi.spyOn(state, 'invalidate');
  const copy = scene.getObjectByName('backdrop-copy')!;
  const take = scene.getObjectByName('backdrop-take')! as Mesh;
  const gl = fakeRenderer();
  const cam = new PerspectiveCamera(36, 4 / 3, 0.1, 1000);
  cam.position.set(3, 4, 12);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  /** One frame as three.js draws it: matrices, the scene's hook, the copy taken. */
  const frame = () => {
    scene.updateMatrixWorld(true);
    const args = [null, null, null] as never[];
    scene.onBeforeRender(gl as unknown as WebGLRenderer, scene, cam, args[0], args[1], args[2]);
    const mode = copy.visible ? 'cached' : take.visible ? 'capture' : 'plain';
    if (take.visible)
      take.onAfterRender(
        gl as unknown as WebGLRenderer,
        scene,
        cam,
        take.geometry,
        take.material as Material,
        args[0],
      );
    return mode;
  };
  /** Frames until the copy is drawn. */
  const rest = () => {
    frame();
    frame();
    expect(frame()).toBe('cached');
  };
  const choose = async (option: string) => {
    invalidate.mockClear();
    await ReactThreeTestRenderer.act(async () => store.set('dummy', option));
  };
  return { r, scene, frame, rest, choose, invalidate };
};

describe('a setting changed on the menu', () => {
  it('asks for a frame and draws the garden afresh, whatever the change does to it', async () => {
    const { scene, frame, rest, choose, invalidate } = await mount();
    rest();
    // Nothing asked for on mounting
    expect(invalidate).not.toHaveBeenCalled();
    for (const [option, shown, only] of [
      ['off', undefined], // a part unmounts
      ['on', true], // a part mounts
      ['hidden', false], // a part hides
      ['bright', true], // shows again, lit by a uniform
      ['on', true, 'only'], // only a uniform changes: nothing but EnvRedraw asks
    ] as const) {
      await choose(option);
      // (r3f asks too when it mounts something; a uniform alone only EnvRedraw asks for)
      expect(invalidate, option).toHaveBeenCalled();
      if (only) expect(invalidate, option).toHaveBeenCalledTimes(1);
      expect(scene.getObjectByName('dummy')?.visible, option).toBe(shown);
      // That frame draws the garden, not the stale copy, then a new copy is taken
      expect(frame(), option).toBe('plain');
      expect(frame(), option).toBe('capture');
      expect(frame(), option).toBe('cached');
    }
  });

  it('does the same for the comparison with main', async () => {
    const { frame, rest, invalidate, scene } = await mount();
    rest();
    await ReactThreeTestRenderer.act(async () => store.setCompare(true));
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(scene.getObjectByName('dummy')).toBeUndefined();
    expect(frame()).toBe('plain');
    rest();
    await ReactThreeTestRenderer.act(async () => store.setCompare(false));
    expect(scene.getObjectByName('dummy')).toBeTruthy();
    expect(frame()).toBe('plain');
  });
});

describe('the garden with the preview', () => {
  it('drops the shooting star with shootingStar:off and keeps it otherwise', async () => {
    restoreEnvFeaturesForTest(saved);
    const r = await ReactThreeTestRenderer.create(
      <BackdropCache>
        <Stage orientation="white" />
      </BackdropCache>,
    );
    const scene = r.scene.instance as unknown as Scene;
    const lines = () => {
      let n = 0;
      scene.traverse((o) => {
        if (o.type === 'Line') n++;
      });
      return n;
    };
    const on = lines();
    expect(on).toBeGreaterThan(0);
    await ReactThreeTestRenderer.act(async () => store.set('shootingStar', 'off'));
    expect(lines()).toBe(on - 1);
    await ReactThreeTestRenderer.act(async () => store.set('shootingStar', 'often'));
    expect(lines()).toBe(on);
    await r.unmount();
  });
});
