import { useEffect } from 'react';
import { addAfterEffect, useThree } from '@react-three/fiber';
import { Color } from 'three';
import { obsidianMaterial } from './blades';
import { outlineMaterial } from './fx';
import { lineMaterial } from './line';
import { markMaterial, shimmerMaterial } from './markers';
import { PALETTE } from './palette';
import { warmPrograms } from './programs';
import { selectionMaterials } from './selection';

/**
 * Compiles the shader programs of the marks of play that are not on the
 * board yet (a piece picked up, the last move's line and shimmer, check's
 * blades, a capture's outline) as soon as it mounts, so the first move and
 * the first piece picked up draw without linking a program in their frame.
 * GameCanvas mounts it once the entrance is over, and it compiles after the
 * next frame drawn, so the compiling never competes with the entrance's
 * frames or the board's first.
 */
export const WarmPrograms = () => {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    // After a frame has been drawn, so the board's own programs go first
    let off: (() => void) | null = addAfterEffect(() => {
      if (!off) return;
      off();
      off = null;
      const selection = selectionMaterials(new Color(PALETTE.select));
      warmPrograms(
        gl,
        camera,
        scene,
        [
          markMaterial(),
          lineMaterial(),
          shimmerMaterial(),
          outlineMaterial(),
          obsidianMaterial({}),
          selection.columnMaterial,
          selection.floorMaterial,
        ],
        [selection.moteMaterial],
      );
    });
    return () => off?.();
  }, [gl, camera, scene]);
  return null;
};
