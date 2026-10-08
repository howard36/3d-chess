import { afterEach, describe, expect, it } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { AdditiveBlending } from 'three';
import type { Material, Mesh, Scene, ShaderMaterial } from 'three';
import { BACKDROP_END, BackdropCache } from './backdropCache';
import { Stage } from './stage';
import { createEnvStore, replaceEnvStoreForTest } from '../../envPreview';
import { courtEggs, courtFloor, courtInlay, courtLife } from '../../envPreview/features/court';

// The court (court.tsx) in every setting: drawn as the garden must be drawn
// (backdropCache.tsx), and nothing at all when every setting is off.

let before: ReturnType<typeof replaceEnvStoreForTest> | null = null;
afterEach(() => {
  if (before) replaceEnvStoreForTest(before);
  before = null;
});

const mountWith = async (env: string, orientation: 'white' | 'black' = 'white') => {
  before = replaceEnvStoreForTest(
    createEnvStore({ start: { host: 'localhost', search: `?env=${env}` }, storage: null }),
  );
  const r = await ReactThreeTestRenderer.create(
    <BackdropCache>
      <Stage orientation={orientation} />
    </BackdropCache>,
  );
  const scene = r.scene.instance as unknown as Scene;
  const court: Mesh[] = [];
  scene.traverse((o) => {
    if (o.name.startsWith('court-')) court.push(o as Mesh);
  });
  return { r, scene, court };
};

const all = (f: { options: readonly { id: string }[] }) => f.options.map((o) => o.id);

describe('the court', () => {
  it('draws nothing when every setting is off: the garden as it was', async () => {
    const { court } = await mountWith('courtFloor:off,courtInlay:off,courtLife:off,courtEggs:off');
    expect(court).toEqual([]);
  });

  it('draws as the garden must in every setting: added light, no depth, before the tower', async () => {
    const combos = [
      ...all(courtFloor).map((o) => `courtFloor:${o}`),
      ...all(courtInlay).map((o) => `courtInlay:${o}`),
      ...all(courtLife).map((o) => `courtLife:${o}`),
      ...all(courtEggs).map((o) => `courtEggs:${o}`),
    ];
    for (const one of combos) {
      const { court, r } = await mountWith(`baseline,${one}`);
      if (one.endsWith(':off')) expect(court, one).toEqual([]);
      else expect(court.length, one).toBeGreaterThan(0);
      for (const o of court) {
        const m = o.material as Material;
        expect(m.transparent, one).toBe(false);
        expect(m.depthWrite, one).toBe(false);
        expect(m.blending, one).toBe(AdditiveBlending);
        // Over the ground (-900), under the sculptures' reflections (-880)
        expect(o.renderOrder, one).toBeGreaterThanOrEqual(-895);
        expect(o.renderOrder, one).toBeLessThanOrEqual(-885);
        expect(o.renderOrder, one).toBeLessThan(BACKDROP_END);
        expect(o.raycast.length, one).toBe(0);
      }
      await r.unmount();
    }
  });

  it('turns with the colossal board for Black, and quiets for the lobby', async () => {
    const env = 'recommended,courtFloor:sheen,courtInlay:ring,courtLife:on,courtEggs:on';
    const white = await mountWith(env, 'white');
    for (const o of white.court)
      expect((o.material as ShaderMaterial).uniforms.uTurn.value, o.name).toBe(1);
    await white.r.unmount();
    replaceEnvStoreForTest(before!);
    const black = await mountWith(env, 'black');
    for (const o of black.court)
      expect((o.material as ShaderMaterial).uniforms.uTurn.value, o.name).toBe(-1);
    await black.r.unmount();
    replaceEnvStoreForTest(before!);

    before = replaceEnvStoreForTest(
      createEnvStore({ start: { host: 'localhost', search: `?env=${env}` }, storage: null }),
    );
    const r = await ReactThreeTestRenderer.create(
      <BackdropCache>
        <Stage orientation="white" dim={() => 0.22} />
      </BackdropCache>,
    );
    await r.advanceFrames(2, 1 / 60);
    const scene = r.scene.instance as unknown as Scene;
    let seen = 0;
    scene.traverse((o) => {
      if (!o.name.startsWith('court-')) return;
      seen++;
      expect(((o as Mesh).material as ShaderMaterial).uniforms.uDim.value, o.name).toBe(0.22);
    });
    expect(seen).toBe(3);
  });
});
