import { afterEach, describe, expect, it } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { Material, Mesh, Object3D, Scene, ShaderMaterial } from 'three';
import { Stage, gardenBoost } from './stage';
import { BACKDROP_END } from './backdropCache';
import { createEnvStore, replaceEnvStoreForTest } from '../../envPreview';
import type { EnvStore } from '../../envPreview';

// The horizon's parts, each mounted only while its setting is on (off is
// main's garden exactly), drawn with the garden, turned with the board for
// Black, and still at rest: the lighthouse waits unlit and the window burns
// until a game is won.

let before: EnvStore | null = null;
const withEnv = (search: string) => {
  const store = createEnvStore({ start: { host: 'localhost', search }, storage: null });
  const old = replaceEnvStoreForTest(store);
  before ??= old;
};
afterEach(() => {
  if (before) replaceEnvStoreForTest(before);
  before = null;
  gardenBoost.value = 0;
});

const PARTS = [
  'horizon-veil',
  'horizon-hills',
  'horizon-tower',
  'horizon-mist',
  'horizon-lights',
  'horizon-events',
];

const mount = async (orientation: 'white' | 'black' = 'white') => {
  const r = await ReactThreeTestRenderer.create(<Stage orientation={orientation} />);
  return { r, scene: r.scene.instance as unknown as Scene };
};

describe('the horizon', () => {
  it('adds nothing with every setting off', async () => {
    withEnv('?env=baseline');
    const { scene } = await mount();
    for (const name of PARTS) expect(scene.getObjectByName(name), name).toBeUndefined();
  });

  it('draws each part with the garden: after the ground, never normal blending', async () => {
    withEnv('?env=recommended');
    const { scene } = await mount();
    for (const name of PARTS) expect(scene.getObjectByName(name), name).toBeTruthy();
    const horizon: Object3D[] = PARTS.map((n) => scene.getObjectByName(n)!);
    for (const part of horizon)
      part.traverse((o) => {
        const m = (o as Mesh).material as Material | undefined;
        if (!m) return;
        expect(o.renderOrder, o.name).toBeGreaterThan(-900);
        expect(o.renderOrder, o.name).toBeLessThan(BACKDROP_END);
        expect(m.blending, o.name).not.toBe(1);
        expect(m.depthWrite, o.name).toBe(false);
      });
  });

  it('turns with the board for Black, but not its veil', async () => {
    withEnv('?env=recommended');
    const { scene } = await mount('black');
    expect(scene.getObjectByName('horizon')!.rotation.y).toBeCloseTo(Math.PI);
    expect(scene.getObjectByName('horizon-veil')!.parent!.name).not.toBe('horizon');
  });

  it('keeps its lighthouse unlit at rest, drawn from the first frame', async () => {
    withEnv('?env=recommended');
    const { r, scene } = await mount();
    await r.advanceFrames(120, 1 / 30);
    const events = scene.getObjectByName('horizon-events')!;
    events.traverse((o) => {
      const m = (o as Mesh).material as ShaderMaterial | undefined;
      if (!m) return;
      expect(o.visible).toBe(true);
      expect(m.uniforms.uLight?.value ?? m.uniforms.uGlow?.value).toBe(0);
    });
  });

  it('puts the far window out when a game is won', async () => {
    withEnv('?env=recommended');
    const { r, scene } = await mount();
    const windowLight = () => {
      let light = -1;
      scene.getObjectByName('horizon-tower')!.traverse((o) => {
        const m = (o as Mesh).material as ShaderMaterial | undefined;
        if (m?.uniforms.uLight) light = m.uniforms.uLight.value as number;
      });
      return light;
    };
    await r.advanceFrames(2, 1 / 30);
    expect(windowLight()).toBe(1);
    gardenBoost.value = 0.8;
    await r.advanceFrames(2, 1 / 30);
    gardenBoost.value = 0;
    await r.advanceFrames(2, 1 / 30);
    expect(windowLight()).toBe(0);
  });
});
