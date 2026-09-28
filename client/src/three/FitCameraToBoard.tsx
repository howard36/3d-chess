import React from 'react';
import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { useThree } from '@react-three/fiber';
import {
  boxRings,
  centringShift,
  elevationOf,
  FIT_SOFTNESS,
  fitView,
  HUD_TOP_PX,
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
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
}

/**
 * Frames the whole board: on first render, and again whenever the canvas
 * changes size, the camera moves along its current line of sight (so a turned
 * view stays turned) to the distance that fits the board in the new window,
 * centred between the HUD's bands (fitView). The zoom limits follow the fit
 * (zoomRange), so they are recomputed with it: a phone turned on its side
 * zooms over the same share of its view as before.
 *
 * The centring is a lens shift (a view offset), never a pan: the camera
 * stands and turns about the board's centre. What it centres is the layout's
 * rings (BoardLayout.frameRings), circles about the tower's axis that look
 * the same from every side, so the shift is vertical only and follows the
 * camera's elevation and distance alone: it is worked out again as the view
 * climbs, dips or zooms, and turning the view never moves it.
 */
export function FitCameraToBoard({
  halfExtents,
  viewDirection,
  minDistance,
  frameRings,
  bands,
}: {
  /** Half the board's bounding box, framed when there are no rings. */
  halfExtents: readonly [number, number, number];
  /** Where the camera looks from when it sits on the target. */
  viewDirection: readonly [number, number, number];
  /** The layout's nearest zoom, which may only narrow the range. */
  minDistance: number;
  /** What the view keeps in frame instead of the box (BoardLayout.frameRings). */
  frameRings?: readonly FrameRing[];
  /** The HUD's bands at the top and bottom for a window this size (hudBands); the top one alone by default. */
  bands?: (width: number, height: number) => { top: number; bottom: number };
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsLike | null;
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const invalidate = useThree((s) => s.invalidate);
  const rings = React.useMemo(() => frameRings ?? boxRings(halfExtents), [frameRings, halfExtents]);

  React.useLayoutEffect(() => {
    if (!(camera instanceof PerspectiveCamera) || width === 0 || height === 0) return;
    const target = controls?.target ?? new Vector3();
    const { top, bottom } = bands?.(width, height) ?? { top: HUD_TOP_PX, bottom: 0 };
    const view = { width, height, fov: camera.fov, topInset: top, bottomInset: bottom };
    // The shift that centres the rings at the camera's elevation and distance
    const centre = () => {
      const bounds = ringBounds(
        rings,
        elevationOf(camera.position, target),
        camera.position.distanceTo(target),
        FIT_SOFTNESS,
      );
      setLensShift(camera, centringShift(bounds, view), width, height);
    };
    const direction = camera.position.clone().sub(target);
    if (direction.lengthSq() === 0) direction.copy(new Vector3(...viewDirection));
    direction.normalize();
    const fit = fitView(Math.asin(MathUtils.clamp(direction.y, -1, 1)), rings, view).distance;
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
  }, [camera, controls, width, height, invalidate, bands, rings]);

  return null;
}
