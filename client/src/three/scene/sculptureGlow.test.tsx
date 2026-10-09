import { describe, expect, it } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { Mesh, Scene } from 'three';
import { AdditiveBlending } from 'three';
import { baseRadius, GLOW_REACH, glowGeometry, glowMaterial, glowProfile } from './sculptureGlow';
import { GARDEN, gardenBoost, gardenDim, gardenTurn, gardenWhole, Stage } from './stage';
import { BACKDROP_END } from './backdropCache';

// The light under each colossal sculpture (sculptureGlow.tsx): a disc lying on
// the ground, round in the world, a broad even glow with no hot centre that
// fades to nothing within its reach, drawn with the garden and taking the
// garden's dim, turn and each sculpture's share of its light.

const samples = (n: number, to = GLOW_REACH) =>
  Array.from({ length: n + 1 }, (_, k) => (k / n) * to);

describe('the glow', () => {
  it('is brightest just past the base ring, never at the centre', () => {
    const values = samples(2000).map((u) => glowProfile(u));
    const peak = Math.max(...values);
    expect(peak).toBeCloseTo(1, 3);
    const at = samples(2000)[values.indexOf(peak)];
    expect(at).toBeGreaterThan(1);
    expect(at).toBeLessThan(1.3);
    // The centre under its plateau: nothing in the middle stands out
    expect(glowProfile(0)).toBeLessThan(0.85);
    for (const u of samples(100, 1)) expect(glowProfile(u)).toBeLessThanOrEqual(1);
  });

  it('fades smoothly to nothing at its reach, and is nothing past it', () => {
    const peakAt = 1.12;
    let last = glowProfile(peakAt);
    for (const u of samples(400).filter((u) => u > peakAt)) {
      const v = glowProfile(u);
      expect(v).toBeLessThanOrEqual(last + 1e-12);
      last = v;
    }
    expect(glowProfile(GLOW_REACH)).toBe(0);
    expect(glowProfile(GLOW_REACH - 0.01)).toBeLessThan(1e-4);
    for (const u of [GLOW_REACH + 0.1, 6, 50]) expect(glowProfile(u)).toBe(0);
    // Wide: still a fifth of its light a base's width out from the ring
    expect(glowProfile(2)).toBeGreaterThan(0.2);
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
    const m = glowMaterial();
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

  it('is one glow drawn with the garden, no reflection', async () => {
    const scene = await mount();
    const glows: Mesh[] = [];
    scene.traverse((o) => {
      if (o.name === 'sculpture-glow') glows.push(o as Mesh);
    });
    expect(glows).toHaveLength(1);
    expect(glows[0].renderOrder).toBeGreaterThan(-900);
    expect(glows[0].renderOrder).toBeLessThan(BACKDROP_END);
  });
});
