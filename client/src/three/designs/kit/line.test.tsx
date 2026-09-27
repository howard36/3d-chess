import { describe, expect, it } from 'vitest';
import { act } from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { ReactThreeTestInstance } from '@react-three/test-renderer/dist/declarations/src/types/public.js';
import { BackSide, Matrix4, Vector3 } from 'three';
import type { BufferGeometry, InstancedMesh, Mesh, ShaderMaterial } from 'three';
import { LastMoveLine } from './line';
import { LAYER } from './layers';
import type { Vec3 } from '../types';

const FROM: Vec3 = [0, 0, 0];
const TO: Vec3 = [2, 1.35, -1];

const meshes = (scene: ReactThreeTestInstance) =>
  scene.findAll((n) => n.type === 'Mesh').map((n) => n.instance as unknown as Mesh);

describe('LastMoveLine', () => {
  it('is one thin tube from centre to centre, depth-tested, with no arrowhead', async () => {
    const r = await ReactThreeTestRenderer.create(
      <LastMoveLine from={FROM} to={TO} radius={0.02} />,
    );
    const [tube] = meshes(r.scene as ReactThreeTestInstance);
    const material = tube.material as ShaderMaterial;
    expect(material.depthTest).toBe(true);
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

  it('draws a keyline behind the tube when asked', async () => {
    const r = await ReactThreeTestRenderer.create(
      <LastMoveLine from={FROM} to={TO} outline="#111111" pattern="dashed" />,
    );
    const [hull, tube] = meshes(r.scene as ReactThreeTestInstance);
    expect((hull.material as ShaderMaterial).side).toBe(BackSide);
    expect(tube.renderOrder).toBeGreaterThan(hull.renderOrder);
  });

  it('keeps flowing on a demand-rendered canvas, and draws in from the source', async () => {
    const r = await ReactThreeTestRenderer.create(
      <LastMoveLine from={FROM} to={TO} flowSpeed={0.5} drawInMs={300} />,
    );
    const [tube] = meshes(r.scene as ReactThreeTestInstance);
    const u = (tube.material as ShaderMaterial).uniforms;
    await act(async () => r.advanceFrames(2, 1 / 30));
    const early = u.uReveal.value as number;
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(2.5);
    const t0 = u.uTime.value as number;
    await act(async () => r.advanceFrames(20, 1 / 30));
    expect(u.uReveal.value).toBeGreaterThan(100);
    expect(u.uTime.value).not.toBe(t0);
  });

  it('lays beads along the line for the dotted pattern', async () => {
    const r = await ReactThreeTestRenderer.create(
      <LastMoveLine from={FROM} to={[1, 0, 0]} pattern="dotted" spacing={0.2} beadRadius={0.04} />,
    );
    const beads = (r.scene as ReactThreeTestInstance).findAll(
      (n) => (n.instance as unknown as InstancedMesh).isInstancedMesh === true,
    )[0].instance as unknown as InstancedMesh;
    expect(beads.count).toBe(6);
    const m = new Matrix4();
    const p = new Vector3();
    for (let i = 0; i < beads.count; i++) {
      beads.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      // On the line from source to destination, just off the floor
      expect(p.z).toBeCloseTo(0);
      expect(p.y).toBeCloseTo(0.04 + 0.012);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
    }
  });
});
