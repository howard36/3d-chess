import React from 'react';
import { PerspectiveCamera, Vector3 } from 'three';
import { useThree } from '@react-three/fiber';
import { DEFAULT_VIEW_DIRECTION, fitDistance } from './cameraFit';

interface OrbitControlsLike {
  target: Vector3;
  maxDistance: number;
  update: () => void;
}

/**
 * Frames the whole board: on first render, and again whenever the canvas
 * changes size, the camera moves along its current line of sight (so a turned
 * view stays turned) to the distance that fits the board in the new window.
 */
export function FitCameraToBoard() {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsLike | null;
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const invalidate = useThree((s) => s.invalidate);

  React.useLayoutEffect(() => {
    if (!(camera instanceof PerspectiveCamera) || width === 0 || height === 0) return;
    const target = controls?.target ?? new Vector3();
    const direction = camera.position.clone().sub(target);
    if (direction.lengthSq() === 0) direction.copy(DEFAULT_VIEW_DIRECTION);
    direction.normalize();
    const distance = fitDistance(direction, width / height, camera.fov);
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.lookAt(target);
    if (controls) {
      // Leave room to zoom out past the fitted view even in a narrow window
      controls.maxDistance = Math.max(25, distance * 1.5);
      controls.update();
    }
    invalidate();
  }, [camera, controls, width, height, invalidate]);

  return null;
}
