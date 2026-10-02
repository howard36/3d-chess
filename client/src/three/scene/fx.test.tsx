import { describe, expect, it } from 'vitest';
import { act } from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { ReactThreeTestInstance } from '@react-three/test-renderer/dist/declarations/src/types/public.js';
import { Vector3 } from 'three';
import type { Mesh } from 'three';
import { CaptureFx, Celebration, PULSE_SPEED, pulseSeconds } from './fx';
import { PieceType } from '../../engine/pieces';
import type { ShaderMaterial } from 'three';
import { FRAME } from './palette';
import { fragmentsOf } from './fragments';
import { wholePiece } from './occlusion';

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
        hitMs={300}
        landMs={500}
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

  it('topples: stands until it is hit, then is knocked over away from the attacker, with a ring at its foot', async () => {
    const r = await ReactThreeTestRenderer.create(
      <CaptureFx
        floor={[0, FRAME.levelY[0], 0]}
        victim={{ type: PieceType.Pawn, color: 'black' }}
        hitMs={200}
        landMs={400}
        heading={[1, 0]}
        orientation="white"
      />,
    );
    const scene = r.scene as ReactThreeTestInstance;
    const body = () =>
      scene
        .findAll((n) => n.type === 'Mesh')
        .map((n) => n.instance as unknown as Mesh)
        .find((m) => (m.material as ShaderMaterial).fragmentShader.includes('uCut'))!;
    const ring = () =>
      scene
        .findAll((n) => n.type === 'Mesh')
        .map((n) => n.instance as unknown as Mesh)
        .find((m) => (m.material as ShaderMaterial).uniforms?.uRadius)!;
    const top = () => {
      const m = body();
      m.updateWorldMatrix(true, false);
      return new Vector3(0, 0.5, 0).applyMatrix4(m.matrixWorld);
    };
    const upright = top();
    await act(async () => r.advanceFrames(15, 0.01));
    // Not yet hit
    expect(top().x).toBeCloseTo(upright.x, 5);
    expect(ring().visible).toBe(false);
    // Hit: the ring spreads
    await act(async () => r.advanceFrames(8, 0.01));
    expect(ring().visible).toBe(true);
    // Then knocked over, toward +x, the way the attacker was going
    await act(async () => r.advanceFrames(25, 0.01));
    expect(top().x).toBeGreaterThan(upright.x + 0.1);
    // (tipping on the rim of its base, it rises a touch before it goes down)
    await act(async () => r.advanceFrames(25, 0.01));
    expect(top().x).toBeGreaterThan(upright.x + 0.3);
    expect(top().y).toBeLessThan(upright.y);
  });

  const meshesOf = (r: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>) =>
    (r.scene as ReactThreeTestInstance)
      .findAll((n) => n.type === 'Mesh')
      .map((n) => n.instance as unknown as Mesh);

  for (const style of ['crumble', 'shatter'] as const) {
    it(`${style}s: breaks into shards as it is hit, which come down onto the glass and go`, async () => {
      const r = await ReactThreeTestRenderer.create(
        <CaptureFx
          floor={[0, 0, 0]}
          victim={{ type: PieceType.Rook, color: 'black' }}
          hitMs={100}
          landMs={300}
          heading={[1, 0]}
          style={style}
          orientation="white"
        />,
      );
      const shards = () => meshesOf(r).filter((m) => !m.matrixAutoUpdate);
      expect(shards().length).toBeGreaterThan(8);
      const group = shards()[0].parent!;
      expect(group.visible).toBe(false);
      await act(async () => r.advanceFrames(40, 0.01));
      expect(group.visible).toBe(true);
      // Every shard has moved, and none has gone through the glass
      for (const m of shards()) {
        const centre = new Vector3();
        m.geometry.boundingBox!.getCenter(centre);
        const moved = centre.clone().applyMatrix4(m.matrix);
        expect(moved.distanceTo(centre)).toBeGreaterThan(1e-4);
        m.geometry.computeBoundingBox();
        const low = m.geometry.boundingBox!.min.clone().applyMatrix4(m.matrix);
        expect(low.y).toBeGreaterThan(-0.25);
      }
      await act(async () => r.advanceFrames(150, 0.01));
      expect(meshesOf(r)).toHaveLength(0);
    });
  }

  it('sinks: goes down through its square as it burns', async () => {
    const r = await ReactThreeTestRenderer.create(
      <CaptureFx
        floor={[0, 0, 0]}
        victim={{ type: PieceType.Pawn, color: 'black' }}
        hitMs={100}
        landMs={300}
        style="sink"
        orientation="white"
      />,
    );
    const body = () =>
      meshesOf(r).find((m) => (m.material as ShaderMaterial).fragmentShader.includes('uCut'))!;
    const y = () => {
      const m = body();
      m.updateWorldMatrix(true, false);
      return new Vector3().applyMatrix4(m.matrixWorld).y;
    };
    const standing = y();
    await act(async () => r.advanceFrames(50, 0.01));
    expect(y()).toBeLessThan(standing - 0.1);
    expect((body().material as ShaderMaterial).uniforms.uCut.value).toBeGreaterThan(0);
  });
});

describe('the shards of a piece', () => {
  it('cover the whole piece, each piece cut once and shared', () => {
    const shards = fragmentsOf(PieceType.Queen);
    const whole = wholePiece(PieceType.Queen);
    const count = (whole.index ? whole.index.count : whole.getAttribute('position').count) / 3;
    expect(shards.reduce((n, f) => n + f.geometry.getAttribute('position').count / 3, 0)).toBe(
      count,
    );
    expect(fragmentsOf(PieceType.Queen)).toBe(shards);
    for (const f of shards) expect(f.below).toBeGreaterThanOrEqual(0);
  });
});
