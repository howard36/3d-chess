import { useEffect, useRef } from 'react';
import { addAfterEffect, useFrame, useThree } from '@react-three/fiber';
import { Color } from 'three';
import type { Group } from 'three';
import { obsidianMaterial } from './blades';
import { outlineMaterial } from './fx';
import { lineMaterial } from './line';
import { markMaterial, shimmerMaterial } from './markers';
import { PALETTE } from './palette';
import { poolMaterial } from './pieces';
import { keepPrograms, WARM, warmObjects } from './programs';
import { selectionMaterials } from './selection';

/**
 * Warms up the shader programs of the marks of play that are not on the
 * board yet (a piece picked up and its hover pool, the last move's mark,
 * line and shimmer, check's blades, a capture's outline): draws them once,
 * touching no pixel (warmObjects), in one frame, then keeps their programs
 * (keepPrograms). A program's first draw compiles and links it and waits on
 * the GPU for it, a long task; this way it comes once, after the entrance,
 * instead of in the frame of the first move or the first piece picked up.
 * GameCanvas mounts it once the board's first frame is drawn and the
 * entrance is over, so it never holds up either.
 */
export const WarmPrograms = () => {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  // A frame of this canvas is being drawn with the warm objects in it
  const drawing = useRef<Group | null>(null);
  useFrame(({ scene: s }) => {
    drawing.current = s.getObjectByName(WARM) as Group | null;
  });
  useEffect(() => {
    const selection = selectionMaterials(new Color(PALETTE.select));
    const meshes = [
      markMaterial(),
      lineMaterial(),
      shimmerMaterial(),
      outlineMaterial(),
      obsidianMaterial({}),
      poolMaterial(0),
      selection.columnMaterial,
      selection.floorMaterial,
    ];
    const points = [selection.moteMaterial];
    const { group, dispose } = warmObjects(meshes, points);
    // The warm objects join the scene for the next frame; once it has drawn
    // them they leave, and their programs stay
    scene.add(group);
    invalidate();
    let off: (() => void) | null = addAfterEffect(() => {
      if (!drawing.current || !off) return;
      scene.remove(group);
      keepPrograms(gl, [...meshes, ...points]);
      dispose();
      off();
      off = null;
    });
    return () => {
      off?.();
      scene.remove(group);
      dispose();
    };
  }, [gl, scene, invalidate]);
  return null;
};
