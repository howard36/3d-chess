import React from 'react';
import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { useThree } from '@react-three/fiber';
import {
  boxCorners,
  centringShift,
  fitDistance,
  fitView,
  HUD_TOP_PX,
  viewBounds,
  zoomRange,
} from './cameraFit';
import { setLensShift } from './viewOffset';
import type { Vec3 } from './types';

interface OrbitControlsLike {
  target: Vector3;
  minDistance: number;
  maxDistance: number;
  update: () => void;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
}

/**
 * Frames the whole board: on first render, and again whenever the canvas
 * changes size, the camera moves along its current line of sight (so a turned
 * view stays turned) to the distance that fits the board in the new window,
 * with its outline centred below the HUD's top band (fitView). The zoom
 * limits follow the fit (zoomRange), so they are recomputed with it: a phone
 * turned on its side zooms over the same share of its view as before.
 *
 * The centring is a lens shift (a view offset), never a pan: the camera
 * stands and turns about the board's centre, and the shift is worked out
 * afresh whenever the view turns or zooms, so the board stays in the middle.
 */
export function FitCameraToBoard({
  halfExtents,
  viewDirection,
  minDistance,
  framePoints,
  bands,
}: {
  /** Half the board's bounding box. */
  halfExtents: readonly [number, number, number];
  /** Where the camera looks from when it sits on the target. */
  viewDirection: readonly [number, number, number];
  /** The layout's nearest zoom, which may only narrow the range. */
  minDistance: number;
  /** What the view keeps in frame instead of the box (BoardLayout.framePoints). */
  framePoints?: (eye: Vec3) => Vec3[];
  /** The HUD's bands at the top and bottom for a window this size (hudBands); the top one alone by default. */
  bands?: (width: number, height: number) => { top: number; bottom: number };
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsLike | null;
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const invalidate = useThree((s) => s.invalidate);

  // What the view keeps in frame, seen from `eye`: the layout's own outline
  // and labels, or the board's box
  const frame = React.useCallback(
    (eye: Vector3) =>
      framePoints
        ? framePoints(eye.toArray()).map((p) => new Vector3(...p))
        : boxCorners(halfExtents),
    [halfExtents, framePoints],
  );

  React.useLayoutEffect(() => {
    if (!(camera instanceof PerspectiveCamera) || width === 0 || height === 0) return;
    const target = controls?.target ?? new Vector3();
    const { top, bottom } = bands?.(width, height) ?? { top: HUD_TOP_PX, bottom: 0 };
    const view = { width, height, fov: camera.fov, topInset: top, bottomInset: bottom };
    // The shift that centres what the camera sees now, however it has turned
    const centre = () => {
      camera.updateMatrixWorld();
      const shift = centringShift(viewBounds(frame(camera.position), camera), view);
      setLensShift(camera, shift, width, height);
    };
    const direction = camera.position.clone().sub(target);
    if (direction.lengthSq() === 0) direction.copy(new Vector3(...viewDirection));
    direction.normalize();
    // The labels framed stand where this view puts them
    const guess = fitDistance(direction, width / height, camera.fov, halfExtents);
    const fit = fitView(direction, frame(direction.clone().multiplyScalar(guess)), view).distance;
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
    centre();
    invalidate();
    // OrbitControls says when it has moved the camera, before the frame is drawn
    controls?.addEventListener?.('change', centre);
    return () => controls?.removeEventListener?.('change', centre);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the layout's extents and limits are fixed
  }, [camera, controls, width, height, invalidate, bands]);

  return null;
}
