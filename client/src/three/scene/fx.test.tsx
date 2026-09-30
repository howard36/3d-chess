import { describe, expect, it } from 'vitest';
import { act } from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { ReactThreeTestInstance } from '@react-three/test-renderer/dist/declarations/src/types/public.js';
import type { Mesh } from 'three';
import { CaptureFx, Celebration, PULSE_SPEED, pulseSeconds } from './fx';
import { PieceType } from '../../engine/pieces';
import type { ShaderMaterial } from 'three';
import { FRAME } from './palette';

describe('the checkmate pulse', () => {
  it('spreads at one speed, so it takes longer from a corner than from the middle', () => {
    const middle = pulseSeconds(0, 0);
    const corner = pulseSeconds(-2, -2);
    expect(corner).toBeGreaterThan(middle * 1.5);
    // The front covers the same ground each second, whatever the distance
    const reach = (x: number, z: number) =>
      Math.max(
        ...[-1, 1].flatMap((a) => [-1, 1].map((b) => Math.hypot(a * 2.55 - x, b * 2.55 - z))),
      );
    for (const [x, z] of [
      [0, 0],
      [-2, -2],
      [1, -2],
    ]) {
      expect(((reach(x, z) + 0.15) / pulseSeconds(x, z)) * (1 / 0.95)).toBeCloseTo(PULSE_SPEED, 6);
    }
  });

  it('is drawn on the mated king’s own level only, and clears once it has spread', async () => {
    const top = FRAME.levelY[4];
    const r = await ReactThreeTestRenderer.create(<Celebration floor={[0, top, 0]} />);
    const meshes = () =>
      (r.scene as ReactThreeTestInstance)
        .findAll((n) => n.type === 'Mesh')
        .map((n) => n.instance as unknown as Mesh);
    expect(meshes()).toHaveLength(1);
    expect(meshes()[0].position.y).toBeCloseTo(top, 1);
    // From the middle it lasts about a second
    await act(async () => r.advanceFrames(10, 0.1));
    expect(meshes()).toHaveLength(1);
    await act(async () => r.advanceFrames(6, 0.1));
    expect(meshes()).toHaveLength(0);
  });
});

describe('a capture', () => {
  it('burns its victim with the glaze that has the burn compiled in', async () => {
    const r = await ReactThreeTestRenderer.create(
      <CaptureFx
        floor={[0, 0, 0]}
        victim={{ type: PieceType.Rook, color: 'black' }}
        durationMs={600}
        orientation="white"
      />,
    );
    const glazes = (r.scene as ReactThreeTestInstance)
      .findAll((n) => n.type === 'Mesh')
      .map((n) => (n.instance as unknown as Mesh).material as ShaderMaterial)
      .filter((m) => m.fragmentShader.includes('uCut'));
    expect(glazes).toHaveLength(1);
    expect(glazes[0].defines).toEqual({ GLAZE_CUT: '' });
  });
});
