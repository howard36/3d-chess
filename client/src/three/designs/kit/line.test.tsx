import { describe, expect, it } from 'vitest';
import { act } from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { ReactThreeTestInstance } from '@react-three/test-renderer/dist/declarations/src/types/public.js';
import { BackSide, LessEqualDepth, Matrix4, Vector3 } from 'three';
import type { BufferGeometry, InstancedMesh, Mesh, ShaderMaterial } from 'three';
import { LastMoveLine } from './line';
import { LevelGrid } from './grid';
import { LevelBand, levelBandGeometry } from './plates';
import { clarityTower, towerFrame } from './layouts';
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

  it('is hidden by whatever stands in front of it: never drawn through a piece', async () => {
    const r = await ReactThreeTestRenderer.create(<LastMoveLine from={FROM} to={TO} />);
    const all = meshes(r.scene as ReactThreeTestInstance);
    // One tube, one ordinary depth test (no second pass drawn where hidden)
    expect(all).toHaveLength(1);
    expect((all[0].material as ShaderMaterial).depthFunc).toBe(LessEqualDepth);
  });

  it('lands `inset` short of the destination, beside the piece standing there', async () => {
    const inset = 0.27;
    // Down a level, diagonally: it lands on the side facing the source
    const r = await ReactThreeTestRenderer.create(
      <LastMoveLine from={[0, 1.35, 0]} to={[1, 0, 1]} radius={0.01} lift={0.02} inset={inset} />,
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
    // Straight down: on the given side
    const v = await ReactThreeTestRenderer.create(
      <LastMoveLine
        from={[0, 1.35, 0]}
        to={[0, 0, 0]}
        radius={0.01}
        inset={inset}
        insetSide={[0, -1]}
      />,
    );
    const [down] = meshes(v.scene as ReactThreeTestInstance);
    const gd = down.geometry as BufferGeometry;
    gd.computeBoundingBox();
    expect(gd.boundingBox!.min.z).toBeCloseTo(-inset - 0.01, 2);
    expect(gd.boundingBox!.max.x).toBeCloseTo(0.01, 2);
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

describe('LevelGrid and LevelBand', () => {
  it('draws one grid per level, on its platform, in its level’s colour', async () => {
    const layout = clarityTower();
    const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff'];
    const r = await ReactThreeTestRenderer.create(<LevelGrid layout={layout} colors={colors} />);
    const grids = meshes(r.scene as ReactThreeTestInstance);
    expect(grids).toHaveLength(5);
    const { levelY } = towerFrame(layout);
    grids.forEach((g, z) => {
      expect(g.position.y).toBeCloseTo(levelY[z] + 0.003);
      const c = (g.material as ShaderMaterial).uniforms.uColor.value;
      expect(`#${c.getHexString()}`).toBe(colors[z]);
    });
  });

  it('builds a thin band at a piece’s foot', async () => {
    const r = await ReactThreeTestRenderer.create(
      <LevelBand color="#ff8800" radius={0.3} height={0.05} />,
    );
    const [band] = meshes(r.scene as ReactThreeTestInstance);
    const g = band.geometry as BufferGeometry;
    g.computeBoundingBox();
    expect(g.boundingBox!.min.y).toBeCloseTo(0);
    expect(g.boundingBox!.max.y).toBeCloseTo(0.05);
    expect(g.boundingBox!.max.x).toBeCloseTo(0.3);
    // Shared per shape
    expect(levelBandGeometry({ radius: 0.3, height: 0.05 })).toBe(g);
  });
});
