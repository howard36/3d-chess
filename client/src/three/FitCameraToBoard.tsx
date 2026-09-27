import React from 'react';
import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { useThree } from '@react-three/fiber';
import { DEFAULT_VIEW_DIRECTION, fitDistance, zoomRange } from './cameraFit';
import type { OrbitLimits } from './designs/types';

interface OrbitControlsLike {
  target: Vector3;
  minDistance: number;
  maxDistance: number;
  update: () => void;
}

/**
 * Frames the whole board: on first render, and again whenever the canvas
 * changes size, the camera moves along its current line of sight (so a turned
 * view stays turned) to the distance that fits the board in the new window.
 * The zoom limits follow the fit (zoomRange), so they are recomputed with it:
 * a phone turned on its side zooms over the same share of its view as before.
 */
export function FitCameraToBoard({
  halfExtents,
  viewDirection,
  limits,
}: {
  halfExtents?: readonly [number, number, number];
  viewDirection?: readonly [number, number, number];
  /** The design's own zoom limits, which may only narrow the range. */
  limits?: Pick<OrbitLimits, 'minDistance' | 'maxDistance'>;
} = {}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsLike | null;
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const invalidate = useThree((s) => s.invalidate);

  React.useLayoutEffect(() => {
    if (!(camera instanceof PerspectiveCamera) || width === 0 || height === 0) return;
    const target = controls?.target ?? new Vector3();
    const direction = camera.position.clone().sub(target);
    if (direction.lengthSq() === 0) {
      direction.copy(viewDirection ? new Vector3(...viewDirection) : DEFAULT_VIEW_DIRECTION);
    }
    direction.normalize();
    const fit = fitDistance(direction, width / height, camera.fov, halfExtents);
    const { min, max } = zoomRange(fit, limits);
    // The fitted view, or as near it as a design's limits allow: the camera
    // never starts outside the range the player can zoom over.
    camera.position.copy(target).addScaledVector(direction, MathUtils.clamp(fit, min, max));
    camera.lookAt(target);
    if (controls) {
      controls.minDistance = min;
      controls.maxDistance = max;
      controls.update();
    }
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a design's extents and limits are fixed per canvas
  }, [camera, controls, width, height, invalidate]);

  return null;
}
