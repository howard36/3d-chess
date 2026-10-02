import React from 'react';
import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { useThree } from '@react-three/fiber';
import { elevationOf, fitShift, fitView, zoomRange } from './cameraFit';
import type { FitWindow, FrameRing } from './cameraFit';
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
 * its centre in the middle of the room below the HUD's top band (fitView).
 * The zoom limits follow the fit (zoomRange), so they are recomputed with it:
 * a phone turned on its side zooms over the same share of its view as before.
 *
 * The fit is always taken from the opening elevation (`viewDirection`),
 * however far the view has climbed or dipped when the window changes: a
 * resized window is framed exactly as a fresh load at that size would be.
 * (Fitting from the camera's elevation of the moment made the tower's size,
 * and where it stood, depend on the angle the player happened to be at.)
 *
 * The centring is a lens shift (a view offset), never a pan: the camera
 * stands and turns about the board's centre, and the shift is vertical only.
 * What it fits is the layout's rings (BoardLayout.frameRings), circles about
 * the tower's axis that look the same from every side. The shift is set with
 * the fit and then left alone: turning, climbing and zooming the view never
 * move the board's centre on screen, so the camera only ever turns about it
 * and moves nearer or farther.
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
  bottomBand,
  centre,
}: {
  /** Where the camera looks from when it sits on the target. */
  viewDirection: readonly [number, number, number];
  /** The layout's nearest zoom, which may only narrow the range. */
  minDistance: number;
  /** What the view keeps in frame (BoardLayout.frameRings). */
  frameRings: readonly FrameRing[];
  /** The HUD's band at the top for a window this size (hudTop). */
  hudTopBand: (height: number) => number;
  /** The band kept clear at the bottom for a window this size, if any. */
  bottomBand?: (height: number) => number;
  /** What the shift centres (FitWindow.centre): the board's centre by default. */
  centre?: FitWindow['centre'];
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsLike | null;
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const invalidate = useThree((s) => s.invalidate);

  React.useLayoutEffect(() => {
    if (!(camera instanceof PerspectiveCamera) || width === 0 || height === 0) return;
    const target = controls?.target ?? new Vector3();
    const view: FitWindow = {
      width,
      height,
      fov: camera.fov,
      topInset: hudTopBand(height),
      bottomInset: bottomBand?.(height),
      centre,
    };
    const direction = camera.position.clone().sub(target);
    if (direction.lengthSq() === 0) direction.copy(new Vector3(...viewDirection));
    direction.normalize();
    // Fitted from the opening elevation, wherever the view stands now
    const opening = elevationOf(new Vector3(...viewDirection), new Vector3());
    const fit = fitView(opening, frameRings, view).distance;
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
    // The shift that centres the view as fitted, kept as the view moves
    setLensShift(camera, fitShift(frameRings, opening, distance, view), width, height);
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the layout's extents and limits are fixed
  }, [camera, controls, width, height, invalidate, hudTopBand, bottomBand, centre, frameRings]);

  return null;
}
