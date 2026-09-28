import React from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useTouchSafeControls } from './useTouchSafeControls';
import type { OrbitPointerState } from './useTouchSafeControls';

export interface CameraControlsProps {
  /** Polar-angle limits in radians (0 is straight overhead); three's defaults without them. */
  minPolarAngle?: number;
  maxPolarAngle?: number;
}

/**
 * The game's camera control: the player turns the view about the board's
 * centre and zooms, nothing else. Pan is off everywhere (right-drag,
 * two-finger drag, keys), so the orbit target never leaves the centre; two
 * fingers only pinch. FitCameraToBoard sets the zoom limits.
 *
 * This is three's own OrbitControls, not drei's (which wraps three-stdlib's
 * copy): three's keeps its pointer bookkeeping on the instance, where
 * useTouchSafeControls can mend it when a browser loses a finger's pointer-up,
 * and it captures the pointer, so a finger's up and cancel reach it wherever
 * the finger goes. Otherwise it behaves as drei's did: damped, updated every
 * frame, redrawing the demand-driven canvas when the view moves, and
 * registered as the default controls (drei's makeDefault), which
 * FitCameraToBoard, the scene and scripts/showcase.mjs read.
 */
export function CameraControls({
  minPolarAngle = 0,
  maxPolarAngle = Math.PI,
}: CameraControlsProps) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  // r3f's event wrapper round the canvas, as drei connects to
  const connected = useThree((s) => s.events.connected) as HTMLElement | null | undefined;
  const invalidate = useThree((s) => s.invalidate);
  const set = useThree((s) => s.set);
  const get = useThree((s) => s.get);
  const element = connected ?? gl.domElement;

  const controls = React.useMemo(() => {
    const c = new OrbitControls(camera);
    c.enablePan = false;
    c.enableDamping = true;
    return c;
  }, [camera]);

  React.useEffect(() => {
    controls.minPolarAngle = minPolarAngle;
    controls.maxPolarAngle = maxPolarAngle;
    controls.update();
    invalidate();
  }, [controls, minPolarAngle, maxPolarAngle, invalidate]);

  useFrame(() => {
    if (controls.enabled) controls.update();
  }, -1);

  React.useEffect(() => {
    controls.connect(element);
    return () => controls.disconnect();
  }, [controls, element]);

  useTouchSafeControls(controls as unknown as OrbitPointerState, element);

  React.useEffect(() => {
    const redraw = () => invalidate();
    controls.addEventListener('change', redraw);
    return () => controls.removeEventListener('change', redraw);
  }, [controls, invalidate]);

  React.useEffect(() => {
    const previous = get().controls;
    set({ controls });
    return () => set({ controls: previous });
  }, [controls, get, set]);

  return null;
}
