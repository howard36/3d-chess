import { afterEach, describe, expect, it } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { Mesh, Scene, ShaderMaterial } from 'three';
import { AdditiveBlending } from 'three';
import {
  baseRadius,
  GLOW_CORE,
  GLOW_REACH,
  glowGeometry,
  glowMaterial,
  glowProfile,
} from './sculptureGlow';
import type { GlowStyle } from './sculptureGlow';
import { GARDEN, gardenBoost, gardenDim, gardenTurn, gardenWhole, Stage } from './stage';
import { BACKDROP_END } from './backdropCache';
import { createEnvStore, replaceEnvStoreForTest } from '../../envPreview';
import type { EnvStore } from '../../envPreview';

// The light under each colossal sculpture (sculptureGlow): a disc lying on
// the ground, round in the world, a broad even glow with no hot centre that
// fades to nothing within its reach, drawn with the garden and taking the
// garden's dim, turn and each sculpture's share of its light.

let before: EnvStore | null = null;
const withEnv = (search: string) => {
  const store = createEnvStore({ start: { host: 'localhost', search }, storage: null });
  const old = replaceEnvStoreForTest(store);
  before ??= old;
};
afterEach(() => {
  if (before) replaceEnvStoreForTest(before);
  before = null;
});

const STYLES = Object.keys(GLOW_CORE) as GlowStyle[];
const samples = (n: number, to = GLOW_REACH) =>
  Array.from({ length: n + 1 }, (_, k) => (k / n) * to);

describe('the glow', () => {
  for (const style of STYLES) {
    it(`${style}: brightest just past the base ring, never at the centre`, () => {
      const values = samples(2000).map((u) => glowProfile(u, style));
      const peak = Math.max(...values);
      expect(peak).toBeCloseTo(1, 3);
      const at = samples(2000)[values.indexOf(peak)];
      expect(at).toBeGreaterThan(1);
      expect(at).toBeLessThan(1.3);
      // The centre under its plateau: nothing in the middle stands out
      expect(glowProfile(0, style)).toBeLessThan(0.85);
      for (const u of samples(100, 1)) expect(glowProfile(u, style)).toBeLessThanOrEqual(1);
    });

    it(`${style}: fades smoothly to nothing at its reach, and is nothing past it`, () => {
      const peakAt = 1.12;
      let last = glowProfile(peakAt, style);
      for (const u of samples(400).filter((u) => u > peakAt)) {
        const v = glowProfile(u, style);
        expect(v).toBeLessThanOrEqual(last + 1e-12);
        last = v;
      }
      expect(glowProfile(GLOW_REACH, style)).toBe(0);
      expect(glowProfile(GLOW_REACH - 0.01, style)).toBeLessThan(1e-4);
      for (const u of [GLOW_REACH + 0.1, 6, 50]) expect(glowProfile(u, style)).toBe(0);
      // Wide: still a fifth of its light a base's width out from the ring
      expect(glowProfile(2, style)).toBeGreaterThan(0.2);
    });
  }

  it('grounded is dimmer under the base than soft', () => {
    expect(glowProfile(0, 'grounded')).toBeLessThan(glowProfile(0, 'soft') - 0.2);
  });

  it('lies flat on the ground, round about each sculpture, within its reach', () => {
    const g = glowGeometry();
    const pos = g.getAttribute('position');
    const anchor = g.getAttribute('aAnchor');
    const base = g.getAttribute('aBase');
    const sculpt = g.getAttribute('aSculpt');
    const radii = GARDEN.map(() => [] as number[]);
    for (let k = 0; k < pos.count; k++) {
      const i = sculpt.getX(k);
      expect(pos.getY(k)).toBe(0);
      expect(anchor.getX(k)).toBe(GARDEN[i].at[0]);
      expect(anchor.getZ(k)).toBe(GARDEN[i].at[2]);
      expect(base.getX(k)).toBeCloseTo(baseRadius(i), 5);
      radii[i].push(Math.hypot(pos.getX(k), pos.getZ(k)));
    }
    GARDEN.forEach((_, i) => {
      const reach = baseRadius(i) * GLOW_REACH;
      expect(Math.max(...radii[i])).toBeCloseTo(reach, 4);
      // Its rim a circle in the world (every rim vertex as far out)
      const rim = radii[i].filter((r) => r > reach * 0.999);
      expect(rim.length).toBeGreaterThanOrEqual(24);
      for (const r of rim) expect(r).toBeCloseTo(reach, 4);
    });
  });

  it("takes the garden's dim, turn, boost and each sculpture's share of its light", () => {
    const m = glowMaterial('soft');
    expect(m.uniforms.uDim).toBe(gardenDim);
    expect(m.uniforms.uTurn).toBe(gardenTurn);
    expect(m.uniforms.uBoost).toBe(gardenBoost);
    expect(m.uniforms.uWhole).toBe(gardenWhole);
    expect(m.vertexShader).toMatch(/uWhole\[int\(aSculpt \+ 0\.5\)\] \* uDim/);
    expect(m.vertexShader).toMatch(/aAnchor\.x \* uTurn/);
    expect(m.vertexShader).toMatch(/shadeOfClip/);
    // Added light, writing no depth
    expect(m.blending).toBe(AdditiveBlending);
    expect(m.depthWrite).toBe(false);
    m.dispose();
  });
});

describe('the light under the sculptures in the garden', () => {
  const mount = async () => {
    const r = await ReactThreeTestRenderer.create(<Stage orientation="white" />);
    return r.scene.instance as unknown as Scene;
  };
  const groundShaders = (scene: Scene) =>
    ['ground-court', 'ground-board'].map(
      (n) => ((scene.getObjectByName(n) as Mesh).material as ShaderMaterial).vertexShader,
    );

  it('off: the mist and the pools as they were, no glow', async () => {
    withEnv('?env=recommended,sculptureGlow:off');
    const scene = await mount();
    expect(scene.getObjectByName('sculpture-glow')).toBeUndefined();
    for (const s of groundShaders(scene)) expect(s).toMatch(/vPool/);
  });

  for (const style of STYLES)
    it(`${style}: one glow drawn with the garden, no reflection, no pools`, async () => {
      withEnv(`?env=recommended,sculptureGlow:${style}`);
      const scene = await mount();
      const glows: Mesh[] = [];
      scene.traverse((o) => {
        if (o.name === 'sculpture-glow') glows.push(o as Mesh);
      });
      expect(glows).toHaveLength(1);
      expect(glows[0].renderOrder).toBeGreaterThan(-900);
      expect(glows[0].renderOrder).toBeLessThan(BACKDROP_END);
      for (const s of groundShaders(scene)) expect(s).not.toMatch(/vPool/);
    });
});
