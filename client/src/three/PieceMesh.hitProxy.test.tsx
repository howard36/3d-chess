import { describe, expect, it } from 'vitest';
import { act } from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { ReactThreeTestInstance } from '@react-three/test-renderer/dist/declarations/src/types/public.js';
import {
  Box3,
  CircleGeometry,
  CylinderGeometry,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
} from 'three';
import type { Group, Intersection, Object3D, Scene } from 'three';
import { PieceType } from '../engine';
import { PieceMesh } from './PieceMesh';
import { DesignContext } from './designs/context';
import testDesign from './designs/testDesign';
import { noRaycast } from './designs/kit/noRaycast';
import { resetSettingStores, setDesignSetting } from './designs/settings';
import type { Design, PieceBodyProps } from './designs/types';

// Regression: a piece that lifts under the pointer used to flicker when the
// pointer sat near its base. The lift carried the piece out from under the
// pointer, so it was no longer hovered and dropped back, under the pointer
// again, and so on. Pointer events now hit a still, invisible proxy that
// covers the piece at rest and lifted, and never the moving body.

const HEIGHT = 0.8;
const RADIUS = 0.25;
const body = new CylinderGeometry(RADIUS * 0.6, RADIUS, HEIGHT, 24).translate(0, HEIGHT / 2, 0);
const material = new MeshBasicMaterial();
// A wide shadow on the floor, made with the kit's noRaycast like ContactShadow
const shadow = new CircleGeometry(0.6, 24).rotateX(-Math.PI / 2).translate(0, 0.004, 0);
const PieceBody = ({ hovered }: PieceBodyProps) => (
  <>
    {/* Decoration the proxy is not fitted to */}
    <mesh geometry={shadow} material={material} raycast={noRaycast} />
    <mesh geometry={body} material={material} userData={{ body: true, hovered }} />
  </>
);

const lifting: Design = {
  ...testDesign,
  id: 'hit-proxy-test',
  PieceBody,
  pieceScale: 0.8,
  hoverLift: () => ({ hover: 0.08, selected: 0.2, hoverSeconds: 0.24, selectSeconds: 0.6 }),
};
const floorY = testDesign.layout.floorY;

async function renderPiece(design: Design, props: { hovered?: boolean; selected?: boolean }) {
  const renderer = await ReactThreeTestRenderer.create(
    <DesignContext.Provider value={design}>
      <PieceMesh type={PieceType.King} color="white" position={[0, 0, 0]} {...props} />
    </DesignContext.Provider>,
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
    const { frames, hitsAt, visual, piece } = await renderPiece(lifting, { hovered: true });
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
    const { frames, hitsAt, visual, piece } = await renderPiece(lifting, { selected: true });
    for (let i = 0; i < 12; i++) {
      await frames(5);
      const top = visual().max.y;
      expect(pieceOf(hitsAt(top - 0.01)[0])).toBe(piece);
    }
  });

  it('never hit-tests the moving body, only the still proxy', async () => {
    const { frames, hitsAt } = await renderPiece(lifting, { selected: true });
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
    const { renderer } = await renderPiece(lifting, {});
    const root = (renderer.scene as ReactThreeTestInstance).instance as unknown as Scene;
    root.updateMatrixWorld(true);
    // Rays just above the floor, beside the base: the base (radius 0.25 at
    // the piece's 0.8 scale) takes them, the wider shadow round it does not
    const at = (x: number) =>
      new Raycaster(new Vector3(x, floorY + 0.02, 5), new Vector3(0, 0, -1)).intersectObject(
        root,
        true,
      );
    expect(at(RADIUS * 0.8 - 0.02).length).toBeGreaterThan(0);
    expect(at(RADIUS * 0.8 + 0.04)).toHaveLength(0);
  });

  it('lifts to the heights a design reads from its settings, and covers them', async () => {
    resetSettingStores();
    const tuned: Design = {
      ...lifting,
      id: 'hit-proxy-settings-test',
      hoverLift: (s) => ({
        hover: Number(s.lift),
        selected: Number(s.lift) + 0.1,
        hoverSeconds: 0.24,
        selectSeconds: 0.6,
      }),
      settings: [
        {
          kind: 'slider',
          key: 'lift',
          label: 'Lift',
          group: 'Pieces',
          default: 0.1,
          min: 0,
          max: 0.5,
          step: 0.05,
        },
      ],
    };
    const { frames, hitsAt, visual, piece } = await renderPiece(tuned, { selected: true });
    const rest = visual().min.y;
    await frames(40);
    // Held: the setting's hover height and the gap, at the piece's scale
    expect(visual().min.y - rest).toBeCloseTo(0.2 * 0.8, 3);
    await act(async () => setDesignSetting(tuned, 'lift', 0.4));
    await frames(40);
    expect(visual().min.y - rest).toBeCloseTo(0.5 * 0.8, 3);
    // The proxy grows with it
    expect(pieceOf(hitsAt(visual().max.y - 0.01)[0])).toBe(piece);
    resetSettingStores();
  });

  it('adds no height for a design that does not lift', async () => {
    const still: Design = {
      ...lifting,
      hoverLift: () => ({ hover: 0, selected: 0, hoverSeconds: 0.24, selectSeconds: 0.6 }),
    };
    const { hitsAt, visual } = await renderPiece(still, { hovered: true });
    const top = visual().max.y;
    expect(hitsAt(top - 0.01).length).toBeGreaterThan(0);
    expect(hitsAt(top + 0.03)).toHaveLength(0);
  });
});
