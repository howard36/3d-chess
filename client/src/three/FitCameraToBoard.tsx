import React from 'react';
import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { useThree } from '@react-three/fiber';
import {
  centringShift,
  elevationOf,
  FIT_SOFTNESS,
  fitView,
  ringBounds,
  zoomRange,
} from './cameraFit';
import type { FrameRing } from './cameraFit';
import { setLensShift } from './viewOffset';

interface OrbitControlsLike {
  target: Vector3;
  minDistance: number;
  maxDistance: number;
  update: () => void;
}

/**
 * Frames the whole board: on first render, and again whenever the canvas
 * changes size, the camera moves along its current line of sight (so a turned
 * view stays turned) to the distance that fits the board in the new window,
 * centred below the HUD's top band (fitView). The zoom limits follow the fit
 * (zoomRange), so they are recomputed with it: a phone turned on its side
 * zooms over the same share of its view as before.
 *
 * The centring is a lens shift (a view offset), never a pan: the camera
 * stands and turns about the board's centre. What it centres is the layout's
 * rings (BoardLayout.frameRings), circles about the tower's axis that look
 * the same from every side, so the shift is vertical only. It is set with the
 * fit and then left alone: turning, climbing and zooming the view never move
 * the board's centre on screen, so the camera only ever turns about it and
 * moves nearer or farther.
 *
 * The fitted distance is kept on the camera (`userData.fitDistance`): the
 * game's entrance (intro/IntroDirector.tsx) starts farther out on the same
 * line of sight and dollies in to it.
 */
export function FitCameraToBoard({
  viewDirection,
  minDistance,
  frameRings,
  hudTopBand,
}: {
  /** Where the camera looks from when it sits on the target. */
  viewDirection: readonly [number, number, number];
  /** The layout's nearest zoom, which may only narrow the range. */
  minDistance: number;
  /** What the view keeps in frame (BoardLayout.frameRings). */
  frameRings: readonly FrameRing[];
  /** The HUD's band at the top for a window this size (hudTop). */
  hudTopBand: (height: number) => number;
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsLike | null;
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const invalidate = useThree((s) => s.invalidate);

  React.useLayoutEffect(() => {
    if (!(camera instanceof PerspectiveCamera) || width === 0 || height === 0) return;
    const target = controls?.target ?? new Vector3();
    const view = {
      width,
      height,
      fov: camera.fov,
      topInset: hudTopBand(height),
    };
    const direction = camera.position.clone().sub(target);
    if (direction.lengthSq() === 0) direction.copy(new Vector3(...viewDirection));
    direction.normalize();
    const fit = fitView(Math.asin(MathUtils.clamp(direction.y, -1, 1)), frameRings, view).distance;
    const { min, max } = zoomRange(fit, minDistance);
    // The fitted view, or as near it as the zoom limits allow: the camera
    // never starts outside the range the player can zoom over.
    const distance = MathUtils.clamp(fit, min, max);
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.lookAt(target);
    // Where the view lands, for the game's entrance (IntroDirector), which
    // dollies in to it
    camera.userData.fitDistance = distance;
    if (controls) {
      controls.minDistance = min;
      controls.maxDistance = max;
      controls.update();
    }
    // The shift that centres the rings as fitted, kept as the view moves
    const bounds = ringBounds(
      frameRings,
      elevationOf(camera.position, target),
      camera.position.distanceTo(target),
      FIT_SOFTNESS,
    );
    setLensShift(camera, centringShift(bounds, view), width, height);
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the layout's extents and limits are fixed
  }, [camera, controls, width, height, invalidate, hudTopBand, frameRings]);

  return null;
}
