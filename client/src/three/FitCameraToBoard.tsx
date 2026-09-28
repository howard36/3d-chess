import React from 'react';
import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { useThree } from '@react-three/fiber';
import { fitDistance, zoomRange } from './cameraFit';

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
  minDistance,
}: {
  /** Half the board's bounding box. */
  halfExtents: readonly [number, number, number];
  /** Where the camera looks from when it sits on the target. */
  viewDirection: readonly [number, number, number];
  /** The layout's nearest zoom, which may only narrow the range. */
  minDistance: number;
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsLike | null;
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const invalidate = useThree((s) => s.invalidate);

  React.useLayoutEffect(() => {
    if (!(camera instanceof PerspectiveCamera) || width === 0 || height === 0) return;
    const target = controls?.target ?? new Vector3();
    const direction = camera.position.clone().sub(target);
    if (direction.lengthSq() === 0) direction.copy(new Vector3(...viewDirection));
    direction.normalize();
    const fit = fitDistance(direction, width / height, camera.fov, halfExtents);
    const { min, max } = zoomRange(fit, minDistance);
    // The fitted view, or as near it as the zoom limits allow: the camera
    // never starts outside the range the player can zoom over.
    camera.position.copy(target).addScaledVector(direction, MathUtils.clamp(fit, min, max));
    camera.lookAt(target);
    if (controls) {
      controls.minDistance = min;
      controls.maxDistance = max;
      controls.update();
    }
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the layout's extents and limits are fixed
  }, [camera, controls, width, height, invalidate]);

  return null;
}
