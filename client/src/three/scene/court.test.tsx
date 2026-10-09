import { describe, expect, it } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { AdditiveBlending } from 'three';
import type { Material, Mesh, Scene, ShaderMaterial } from 'three';
import { BACKDROP_END, BackdropCache } from './backdropCache';
import { Stage } from './stage';

// The court (court.tsx): drawn as the garden must be drawn
// (backdropCache.tsx), turned for Black and quieted for the lobby.

const mount = async (orientation: 'white' | 'black' = 'white') => {
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
  const ground = scene.getObjectByName('ground-court') as Mesh;
  return { r, scene, court, ground };
};

describe('the court', () => {
  it('draws as the garden must: added light, no depth, before the tower', async () => {
    const { court, scene, r } = await mount();
    expect(court.length).toBeGreaterThan(0);
    // The stone and the inlay are drawn in the ground's own pass, in its
    // court's part and the clear middle, never in the board's or the far plain's
    const courtLight = (name: string) =>
      ((scene.getObjectByName(name) as Mesh).material as ShaderMaterial).fragmentShader.includes(
        'courtLight',
      );
    expect(courtLight('ground-middle')).toBe(true);
    expect(courtLight('ground-court')).toBe(true);
    expect(courtLight('ground-board')).toBe(false);
    expect(courtLight('ground-far')).toBe(false);
    for (const o of court) {
      const m = o.material as Material;
      expect(m.transparent, o.name).toBe(false);
      expect(m.depthWrite, o.name).toBe(false);
      expect(m.blending, o.name).toBe(AdditiveBlending);
      // Over the ground (-900), under the sculptures' reflections (-880)
      expect(o.renderOrder, o.name).toBeGreaterThanOrEqual(-895);
      expect(o.renderOrder, o.name).toBeLessThanOrEqual(-885);
      expect(o.renderOrder, o.name).toBeLessThan(BACKDROP_END);
      expect(o.raycast.length, o.name).toBe(0);
    }
    await r.unmount();
  });

  it('turns with the colossal board for Black, and quiets for the lobby', async () => {
    const white = await mount('white');
    await white.r.advanceFrames(1, 1 / 60);
    for (const o of [...white.court, white.ground])
      expect((o.material as ShaderMaterial).uniforms.uTurn.value, o.name).toBe(1);
    await white.r.unmount();
    const black = await mount('black');
    await black.r.advanceFrames(1, 1 / 60);
    for (const o of [...black.court, black.ground])
      expect((o.material as ShaderMaterial).uniforms.uTurn.value, o.name).toBe(-1);
    await black.r.unmount();

    const r = await ReactThreeTestRenderer.create(
      <BackdropCache>
        <Stage orientation="white" dim={() => 0.22} />
      </BackdropCache>,
    );
    await r.advanceFrames(2, 1 / 60);
    const scene = r.scene.instance as unknown as Scene;
    let seen = 0;
    scene.traverse((o) => {
      if (!o.name.startsWith('court-') && o.name !== 'ground-court') return;
      seen++;
      expect(((o as Mesh).material as ShaderMaterial).uniforms.uDim.value, o.name).toBe(0.22);
    });
    expect(seen).toBe(2);
  });
});
