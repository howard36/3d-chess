import { describe, expect, it } from 'vitest';
import { act } from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { ReactThreeTestInstance } from '@react-three/test-renderer/dist/declarations/src/types/public.js';
import type { Group } from 'three';
import { MoveGlide } from './moveAnimation';
import { Lift, Topple } from './designs/kit/motion';
import type { DesignMotion } from './designs/types';

type Vec = { x: number; y: number; z: number };
const FROM: [number, number, number] = [0, 0, 2];
const TO: [number, number, number] = [0, 0, 0];

async function glide(motion: DesignMotion) {
  const renderer = await ReactThreeTestRenderer.create(
    <MoveGlide from={FROM} to={TO} motion={motion} floorY={-0.5}>
      <mesh userData={{ body: true }} />
    </MoveGlide>,
  );
  const scene = renderer.scene as ReactThreeTestInstance;
  const outer = scene.findAll((n) => n.props.userData?.moveGlide === true)[0]
    .instance as unknown as Group;
  // The scaling group sits between the glide and the piece (bounce, teleport)
  const scaler = () => {
    let g = (scene.findAll((n) => n.props.userData?.body === true)[0].instance as unknown as Group)
      .parent;
    while (g && g !== outer && g.scale.x === 1 && g.scale.y === 1) g = g.parent;
    return g === outer ? null : g;
  };
  const frames = (n: number) => act(async () => renderer.advanceFrames(n, 0.03));
  return { outer, scaler, frames, pos: () => outer.position as Vec };
}

describe('MoveGlide styles', () => {
  it('slides in a straight line, without lifting', async () => {
    const { frames, pos } = await glide({ style: 'slide', durationMs: 300, lift: 0.5 });
    expect(pos().z).toBeCloseTo(2);
    await frames(5);
    expect(pos().y).toBe(0);
    expect(pos().z).toBeGreaterThan(0);
    expect(pos().z).toBeLessThan(2);
    await frames(6);
    expect(pos()).toMatchObject({ x: 0, y: 0, z: 0 });
  });

  it('teleports: shrinks away at the source, pops in at the destination', async () => {
    const { frames, pos, scaler } = await glide({ style: 'teleport', durationMs: 300, lift: 0 });
    await frames(3); // ~90ms: still at the source, shrinking
    expect(pos().z).toBeCloseTo(2);
    expect(scaler()!.scale.x).toBeLessThan(1);
    await frames(3); // ~180ms: already home, growing back
    expect(pos().z).toBe(0);
    await frames(6);
    expect(scaler()).toBeNull(); // back to full size
  });

  it('bounces: squashes on landing and settles back to shape', async () => {
    const { frames, pos, scaler } = await glide({ style: 'bounce', durationMs: 300, lift: 0.6 });
    await frames(5);
    expect(pos().y).toBeGreaterThan(0.3); // airborne
    await frames(6); // landed, squashing
    expect(pos().z).toBeCloseTo(0);
    expect(scaler()).not.toBeNull();
    await frames(12);
    expect(scaler()).toBeNull();
    expect(pos()).toMatchObject({ x: 0, y: 0, z: 0 });
  });
});

describe('Lift and Topple', () => {
  it('raises a lifted piece and lowers it again', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Lift height={0.2}>
        <mesh />
      </Lift>,
    );
    const group = () =>
      (renderer.scene as ReactThreeTestInstance).children[0].instance as unknown as Group;
    await act(async () => renderer.advanceFrames(30, 0.03));
    expect(group().position.y).toBeGreaterThan(0.12);
    await renderer.update(
      <Lift height={0}>
        <mesh />
      </Lift>,
    );
    await act(async () => renderer.advanceFrames(40, 0.03));
    expect(group().position.y).toBe(0);
  });

  it('tips a mated king onto its side', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Topple active>
        <mesh />
      </Topple>,
    );
    await act(async () => renderer.advanceFrames(40, 0.03));
    const pivot = (renderer.scene as ReactThreeTestInstance).children[0].children[0]
      .instance as unknown as Group;
    expect(pivot.rotation.x).toBeLessThan(-1.2);
  });
});
