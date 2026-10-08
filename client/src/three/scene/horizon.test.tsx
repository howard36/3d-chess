import { afterEach, describe, expect, it } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { Material, Mesh, Object3D, Scene, ShaderMaterial } from 'three';
import { Stage, gardenBoost } from './stage';
import { BACKDROP_END } from './backdropCache';
import { OTHER_TOWER, otherTowerStrokes } from './horizon';
import { LEVEL_COLORS } from './palette';
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
  'horizon-hills',
  'horizon-tower',
  'horizon-mist',
  'horizon-lights',
  'horizon-other-tower',
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

  it('turns with the board for Black, but not its veil (the ground’s own)', async () => {
    withEnv('?env=recommended');
    const { scene } = await mount('black');
    expect(scene.getObjectByName('horizon')!.rotation.y).toBeCloseTo(Math.PI);
    const ground = scene.getObjectByName('ground')!;
    expect(ground.rotation.y).toBe(0);
    for (const part of ['middle', 'court', 'board', 'far']) {
      const m = (ground.getObjectByName(`ground-${part}`) as Mesh).material as ShaderMaterial;
      // Worked out per vertex, mixed in per pixel
      expect(m.vertexShader, part).toContain('skyColorShaded');
      expect(m.fragmentShader, part).toContain('vVeil');
    }
  });

  it('veils the plain only with its edge fixed, main’s square plain otherwise', async () => {
    withEnv('?env=recommended,horizonEdgeFix:off');
    const { scene } = await mount();
    const far = scene.getObjectByName('ground-far') as Mesh;
    expect((far.material as ShaderMaterial).vertexShader).not.toContain('skyColorShaded');
    far.geometry.computeBoundingBox();
    expect(far.geometry.boundingBox!.max.x).toBeCloseTo(130, 3);
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

  it('stands the other tower as the game’s: five floating plates, square from the side', () => {
    const plates = otherTowerStrokes();
    expect(plates).toHaveLength(LEVEL_COLORS.length);
    const { side, foot } = OTHER_TOWER;
    // Every stroke fixed in the world (never turned to face the camera), and
    // nothing but the plates: no frame holding them
    for (const s of plates.flat()) expect(s.mode).toBe(1);
    expect(plates.every((p) => p.length === 2)).toBe(true);
    // Each plate a level square, from A at the foot up, with its reflection
    // below the ground
    let last = -Infinity;
    plates.forEach(([plate, mirrored]) => {
      const ys = new Set(plate.points.map((p) => p[1]));
      expect(ys.size).toBe(1);
      const [y] = ys;
      expect(y).toBeGreaterThan(last);
      last = y;
      expect(mirrored.points.every((p) => p[1] === -y)).toBe(true);
    });
    // As tall as it is wide, seen from its front: the stack spans the side
    // upward, as each plate's front edge does across the view
    expect(plates[0][0].points[0][1]).toBeCloseTo(foot, 6);
    expect(last - foot).toBeCloseTo(side, 6);
    const corners = plates[0][0].points;
    const across = Math.hypot(corners[1][0] - corners[0][0], corners[1][2] - corners[0][2]);
    expect(across).toBeCloseTo(side, 6);
  });

  it('draws the other tower in the sculptures’ tube program, no new one', async () => {
    withEnv('?env=recommended');
    const { scene } = await mount();
    const tower = scene.getObjectByName('horizon-other-tower')!;
    const shaders = new Set<string>();
    tower.traverse((o) => {
      const m = (o as Mesh).material as ShaderMaterial | undefined;
      if (m) shaders.add(m.vertexShader + m.fragmentShader);
    });
    expect(shaders.size).toBe(1);
    let sculptures = false;
    scene.traverse((o) => {
      const m = (o as Mesh).material as ShaderMaterial | undefined;
      if (m && !tower.getObjectById(o.id) && shaders.has(m.vertexShader + m.fragmentShader))
        sculptures = true;
    });
    expect(sculptures).toBe(true);
  });
});
