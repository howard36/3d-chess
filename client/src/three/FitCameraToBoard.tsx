import React from 'react';
import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { useThree } from '@react-three/fiber';
import { elevationOf, fitShift, fitView, settleLeftInset, zoomRange } from './cameraFit';
import type { FitWindow, FrameRing } from './cameraFit';
import { setLensShift } from './viewOffset';

interface OrbitControlsLike {
  target: Vector3;
  minDistance: number;
  maxDistance: number;
  update: () => void;
}

/**
 * Frames the whole board: on first render the camera stands at the distance
 * that fits the board in the window, and whenever the canvas changes size it
 * moves along its current line of sight (so a turned view stays turned) to
 * the same multiple of the new fit as it stood at of the old one (so a
 * zoomed view stays zoomed, the tower taking the same share of the window),
 * its centre a little above the middle of the room below the HUD's top band
 * (fitView), and the tower in that room from every elevation of `sweep`.
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
 * stands and turns about the board's centre, and the shift is vertical only
 * (but in the tutorial, beside a card at the left: `leftBand`).
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
  leftBand,
  centre,
  sweep,
  balanceInset,
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
  bottomBand?: (height: number, width: number) => number;
  /** The band at the left the tower is kept clear of, should it run under it (FitWindow.leftInset). */
  leftBand?: (width: number, height: number) => number;
  /** What the shift centres (FitWindow.centre): the board's centre by default. */
  centre?: FitWindow['centre'];
  /** The elevations the view can turn between, kept in frame (FitWindow.sweep; orbitSweep). */
  sweep?: FitWindow['sweep'];
  /** The line under the HUD the board's centre is balanced below (FitWindow.balanceInset). */
  balanceInset?: number;
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsLike | null;
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const invalidate = useThree((s) => s.invalidate);

  React.useLayoutEffect(() => {
    if (!(camera instanceof PerspectiveCamera) || width === 0 || height === 0) return;
    const target = controls?.target ?? new Vector3();
    // Fitted from the opening elevation, wherever the view stands now
    const opening = elevationOf(new Vector3(...viewDirection), new Vector3());
    const view = settleLeftInset(opening, frameRings, {
      width,
      height,
      fov: camera.fov,
      topInset: hudTopBand(height),
      bottomInset: bottomBand?.(height, width),
      leftInset: leftBand?.(width, height),
      centre,
      sweep,
      balanceInset,
    });
    const direction = camera.position.clone().sub(target);
    if (direction.lengthSq() === 0) direction.copy(new Vector3(...viewDirection));
    direction.normalize();
    const fit = fitView(opening, frameRings, view).distance;
    const { min, max } = zoomRange(fit, minDistance);
    const fitted = MathUtils.clamp(fit, min, max);
    // The player's zoom, as a multiple of the fit it was made against: none
    // on opening
    const before = camera.userData.fitDistance as number | undefined;
    const zoom = before ? camera.position.distanceTo(target) / before : 1;
    // The fitted view so zoomed, or as near it as the zoom limits allow: the
    // camera never stands outside the range the player can zoom over.
    const distance = MathUtils.clamp(fitted * zoom, min, max);
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.lookAt(target);
    // The fit, for the game's entrance (IntroDirector), which dollies in to
    // it, and for the next resize
    camera.userData.fitDistance = fitted;
    if (controls) {
      controls.minDistance = min;
      controls.maxDistance = max;
      controls.update();
    }
    // The shift that centres the view as fitted (whatever the zoom), kept as
    // the view moves
    setLensShift(camera, fitShift(frameRings, opening, fitted, view), width, height);
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the layout's extents and limits are fixed
  }, [
    camera,
    controls,
    width,
    height,
    invalidate,
    hudTopBand,
    bottomBand,
    leftBand,
    centre,
    sweep,
    frameRings,
  ]);

  return null;
}
