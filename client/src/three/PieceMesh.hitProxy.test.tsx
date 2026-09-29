import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { ReactThreeTestInstance } from '@react-three/test-renderer/dist/declarations/src/types/public.js';
import { Box3, Raycaster, Vector3 } from 'three';
import type { Group, Intersection, Object3D, Scene } from 'three';
import { PieceType } from '../engine';
import { PieceMesh } from './PieceMesh';
import { layout, PIECE_SCALE } from './scene/palette';
import type { PieceBodyProps } from './types';

// Regression: a piece that lifts under the pointer used to flicker when the
// pointer sat near its base. The lift carried the piece out from under the
// pointer, so it was no longer hovered and dropped back, under the pointer
// again, and so on. Pointer events now hit a still, invisible proxy that
// covers the piece at rest and lifted, and never the moving body.

// The piece's body stands in as a plain cylinder of this radius at its base,
// with a wide shadow on the floor round it made with noRaycast, as the
// scene's decoration is
const RADIUS = 0.25;
vi.mock('./scene/pieces', async () => {
  const { CircleGeometry, CylinderGeometry, MeshBasicMaterial } = await import('three');
  const { noRaycast } = await import('./noRaycast');
  const body = new CylinderGeometry(0.25 * 0.6, 0.25, 0.8, 24).translate(0, 0.8 / 2, 0);
  const material = new MeshBasicMaterial();
  const shadow = new CircleGeometry(0.6, 24).rotateX(-Math.PI / 2).translate(0, 0.004, 0);
  return {
    PieceBody: ({ hovered }: PieceBodyProps) => (
      <>
        {/* Decoration the proxy is not fitted to */}
        <mesh geometry={shadow} material={material} raycast={noRaycast} />
        <mesh geometry={body} material={material} userData={{ body: true, hovered }} />
      </>
    ),
  };
});

const floorY = layout.floorY;

async function renderPiece(props: { hovered?: boolean; selected?: boolean }) {
  const renderer = await ReactThreeTestRenderer.create(
    <PieceMesh type={PieceType.King} color="white" position={[0, 0, 0]} {...props} />,
  );
  const scene = renderer.scene as ReactThreeTestInstance;
  const root = scene.instance as unknown as Scene;
  const frames = (n: number) => act(async () => renderer.advanceFrames(n, 1 / 30));
  /** What a horizontal ray at world height `y` hits, nearest first. */
  const hitsAt = (y: number): Intersection<Object3D>[] => {
    root.updateMatrixWorld(true);
    const ray = new Raycaster(new Vector3(0, y, 5), new Vector3(0, 0, -1));
    return ray.intersectObject(root, true);
  };
  const visual = () => {
    const mesh = scene.findAll((n) => n.props.userData?.body === true)[0]
      .instance as unknown as Object3D;
    root.updateMatrixWorld(true);
    return new Box3().setFromObject(mesh);
  };
  const piece = scene.findAll((n) => n.props.userData?.piece)[0].instance as unknown as Group;
  return { renderer, frames, hitsAt, visual, piece };
}

/** The piece group a hit belongs to (where Board's handlers sit). */
const pieceOf = (hit: Intersection<Object3D>) => {
  let o: Object3D | null = hit.object;
  while (o && !o.userData.piece) o = o.parent;
  return o;
};

describe('a piece’s hit proxy', () => {
  it('keeps a lifted piece under a pointer resting at its base', async () => {
    const { frames, hitsAt, visual, piece } = await renderPiece({ hovered: true });
    await frames(40);
    // The body has risen clear of a pointer near its foot...
    const base = floorY + 0.03;
    expect(visual().min.y).toBeGreaterThan(base + 0.02);
    // ...yet that pointer still hits the piece, as it did at rest
    const hits = hitsAt(base);
    expect(hits.length).toBeGreaterThan(0);
    expect(pieceOf(hits[0])).toBe(piece);
  });

  it('covers the piece at its highest, held', async () => {
    const { frames, hitsAt, visual, piece } = await renderPiece({ selected: true });
    for (let i = 0; i < 12; i++) {
      await frames(5);
      const top = visual().max.y;
      expect(pieceOf(hitsAt(top - 0.01)[0])).toBe(piece);
    }
  });

  it('never hit-tests the moving body, only the still proxy', async () => {
    const { frames, hitsAt } = await renderPiece({ selected: true });
    const before = hitsAt(floorY + 0.3).map((h) => [h.object.uuid, h.distance.toFixed(6)]);
    await frames(30);
    const after = hitsAt(floorY + 0.3);
    expect(after.map((h) => [h.object.uuid, h.distance.toFixed(6)])).toEqual(before);
    for (const hit of after) {
      expect(hit.object.userData.hitProxy).toBe(true);
      expect(hit.object.visible).toBe(false);
    }
  });

  it('fits the body, not the decoration round it', async () => {
    const { renderer } = await renderPiece({});
    const root = (renderer.scene as ReactThreeTestInstance).instance as unknown as Scene;
    root.updateMatrixWorld(true);
    // Rays just above the floor, beside the base: the base (radius 0.25 at
    // the pieces' scale) takes them, the wider shadow round it does not
    const at = (x: number) =>
      new Raycaster(new Vector3(x, floorY + 0.02, 5), new Vector3(0, 0, -1)).intersectObject(
        root,
        true,
      );
    expect(at(RADIUS * PIECE_SCALE - 0.02).length).toBeGreaterThan(0);
    expect(at(RADIUS * PIECE_SCALE + 0.04)).toHaveLength(0);
  });

  it('lifts a held piece by the hover height and the held gap, and covers it', async () => {
    const { frames, hitsAt, visual, piece } = await renderPiece({ selected: true });
    const rest = visual().min.y;
    await frames(40);
    // At the pieces' scale
    expect(visual().min.y - rest).toBeCloseTo((0.09 + 0.05) * PIECE_SCALE, 3);
    expect(pieceOf(hitsAt(visual().max.y - 0.01)[0])).toBe(piece);
  });
});
