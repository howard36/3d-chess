import { describe, expect, it } from 'vitest';
import { act } from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { ReactThreeTestInstance } from '@react-three/test-renderer/dist/declarations/src/types/public.js';
import { LessEqualDepth } from 'three';
import type { BufferGeometry, Mesh, ShaderMaterial } from 'three';
import { LastMoveLine } from './line';
import { LAYER } from './layers';
import type { Vec3 } from '../types';

const FROM: Vec3 = [0, 0, 0];
const TO: Vec3 = [2, 1.35, -1];
const LOOK = { color: '#4cc9f0', opacity: 0.7 };

const meshes = (scene: ReactThreeTestInstance) =>
  scene.findAll((n) => n.type === 'Mesh').map((n) => n.instance as unknown as Mesh);

describe('LastMoveLine', () => {
  it('is one thin tube from centre to centre, depth-tested (a piece hides it), with no arrowhead', async () => {
    const r = await ReactThreeTestRenderer.create(
      <LastMoveLine from={FROM} to={TO} radius={0.02} {...LOOK} />,
    );
    const all = meshes(r.scene as ReactThreeTestInstance);
    // One tube, no second pass drawn where it is hidden
    expect(all).toHaveLength(1);
    const [tube] = all;
    const material = tube.material as ShaderMaterial;
    expect(material.depthTest).toBe(true);
    expect(material.depthFunc).toBe(LessEqualDepth);
    expect(material.depthWrite).toBe(false);
    expect(tube.renderOrder).toBeGreaterThanOrEqual(LAYER.trace);
    const g = tube.geometry as BufferGeometry;
    g.computeBoundingBox();
    const box = g.boundingBox!;
    // Just the segment and its round ends: nothing reaches past them
    expect(box.min.x).toBeCloseTo(-0.02, 2);
    expect(box.max.x).toBeCloseTo(2 + 0.02, 2);
    expect(box.max.y).toBeLessThan(1.35 + 0.1);
    // No raycasting: decoration never takes a click
    expect(tube.raycast.length).toBe(0);
  });

  it('lands `inset` short of the destination, beside the piece standing there', async () => {
    const inset = 0.27;
    // Down a level, diagonally: it lands on the side facing the source
    const r = await ReactThreeTestRenderer.create(
      <LastMoveLine
        from={[0, 1.35, 0]}
        to={[1, 0, 1]}
        radius={0.01}
        lift={0.02}
        inset={inset}
        {...LOOK}
      />,
    );
    const [tube] = meshes(r.scene as ReactThreeTestInstance);
    const g = tube.geometry as BufferGeometry;
    g.computeBoundingBox();
    const k = 1 - inset / Math.SQRT2;
    expect(g.boundingBox!.max.x).toBeCloseTo(k + 0.01, 2);
    expect(g.boundingBox!.max.z).toBeCloseTo(k + 0.01, 2);
    // On the floor, not above it
    expect(g.boundingBox!.min.y).toBeGreaterThan(0);
    expect(g.boundingBox!.min.y).toBeLessThan(0.02);
    // Straight down: on the +x side
    const v = await ReactThreeTestRenderer.create(
      <LastMoveLine from={[0, 1.35, 0]} to={[0, 0, 0]} radius={0.01} inset={inset} {...LOOK} />,
    );
    const [down] = meshes(v.scene as ReactThreeTestInstance);
    const gd = down.geometry as BufferGeometry;
    gd.computeBoundingBox();
    expect(gd.boundingBox!.max.x).toBeCloseTo(inset + 0.01, 2);
    expect(gd.boundingBox!.max.z).toBeCloseTo(0.01, 2);
  });

  it('draws in from the source on a demand-rendered canvas', async () => {
    const r = await ReactThreeTestRenderer.create(
      <LastMoveLine from={FROM} to={TO} radius={0.02} drawInMs={300} {...LOOK} />,
    );
    const [tube] = meshes(r.scene as ReactThreeTestInstance);
    const u = (tube.material as ShaderMaterial).uniforms;
    await act(async () => r.advanceFrames(2, 1 / 30));
    const early = u.uReveal.value as number;
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(2.5);
    await act(async () => r.advanceFrames(20, 1 / 30));
    expect(u.uReveal.value).toBeGreaterThan(100);
  });
});
