import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { MOVE_ANIMATION } from './motion';

const UP = new Vector3(0, 1, 0);
const ORIGIN = new Vector3();

/**
 * Turns the camera slowly round the tower's vertical axis, a full turn every
 * `period` seconds, for a view that shows the tower from every side on its
 * own (the landing page). Only the azimuth changes: the camera keeps its
 * elevation and distance, so the fitted view (FitCameraToBoard, whose fit and
 * lens shift depend on the elevation alone) holds all the way round. Runs on
 * r3f's clock and asks for the next frame itself, so it turns on a canvas
 * that renders on demand.
 */
export function AutoOrbit({ period }: { period: number }) {
  const controls = useThree((s) => s.controls) as unknown as { target?: Vector3 } | null;
  useFrame(({ camera, invalidate }, delta) => {
    // A stalled frame (a background tab) resumes the turn, never jumps it
    const step = Math.min(delta, MOVE_ANIMATION.maxFrameMs / 1000);
    const target = controls?.target ?? ORIGIN;
    camera.position
      .sub(target)
      .applyAxisAngle(UP, (2 * Math.PI * step) / period)
      .add(target);
    camera.lookAt(target);
    invalidate();
  });
  return null;
}
