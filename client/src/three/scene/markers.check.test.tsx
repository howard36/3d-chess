import { describe, expect, it } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { Color, Mesh, ShaderMaterial } from 'three';
import { Check } from './markers';
import { LAYER } from './layers';
import { PALETTE } from './palette';

// The check's lines: one from each piece giving check to the king, red.

const lines = (r: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>) =>
  r.scene.findAll((n) => n.type === 'Mesh' && n.instance.renderOrder === LAYER.trace + 0.1);

describe('check', () => {
  it('draws a line to the king from each checker, none without', async () => {
    const king = { floor: [0, 0.5, 0] as [number, number, number] };
    const double = await ReactThreeTestRenderer.create(
      <Check {...king} checkers={[{ floor: [1, 0.5, -1] }, { floor: [0, -1, 1] }]} />,
    );
    const drawn = lines(double);
    expect(drawn).toHaveLength(2);
    for (const line of drawn) {
      const color = ((line.instance as Mesh).material as ShaderMaterial).uniforms.uColor
        .value as Color;
      expect(`#${color.getHexString()}`).toBe(PALETTE.check.toLowerCase());
    }
    const bare = await ReactThreeTestRenderer.create(<Check {...king} />);
    expect(lines(bare)).toHaveLength(0);
  });
});
