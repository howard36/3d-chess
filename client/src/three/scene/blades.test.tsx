import { describe, expect, it } from 'vitest';
import { act } from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { ReactThreeTestInstance } from '@react-three/test-renderer/dist/declarations/src/types/public.js';
import type { Mesh } from 'three';
import { Blades } from './blades';

describe('the blades round a king in check', () => {
  it('sink into the glass at mate and are gone, not left lying flat', async () => {
    const tree = (mated: boolean) => <Blades floor={[0, 0, 0]} mated={mated} strength={1} />;
    const r = await ReactThreeTestRenderer.create(tree(false));
    const mesh = () =>
      (r.scene as ReactThreeTestInstance).findAll((n) => n.type === 'Mesh')[0]
        .instance as unknown as Mesh;
    await act(async () => r.advanceFrames(20, 0.05));
    expect(mesh().visible).toBe(true);
    await r.update(tree(true));
    await act(async () => r.advanceFrames(5, 0.05));
    expect(mesh().visible).toBe(true);
    await act(async () => r.advanceFrames(20, 0.05));
    expect(mesh().visible).toBe(false);
  });
});
