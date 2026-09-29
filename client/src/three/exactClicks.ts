import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import type { ComputeFunction, DomEvent } from '@react-three/fiber';

// Where r3f aims a pointer event's ray. It raycasts every event from the
// event's own offsetX/Y, and a click only reaches an object that was also
// hit at the press. Chromium reports a pointer event's position to a
// fraction of a pixel but a click's in whole pixels, so a click released
// within half a pixel of a square's edge was raycast from the next pixel
// over: the press hit the lit destination, the click the square beside it,
// and the click only put the piece down instead of moving it (a mouse on a
// high-density screen, a trackpad or a finger does this; a test driver
// clicking on fractional pixels did it every time). Here a click is raycast
// from the exact point of the release that made it, as its press was.

/** A point in the canvas's CSS pixels. */
type CanvasPoint = readonly [number, number];

/**
 * The point to raycast `event` from: its own offset, except that a click
 * within a pixel of the last release (the rounding) takes the release's
 * exact point.
 */
export function eventPoint(
  event: Pick<MouseEvent, 'type' | 'offsetX' | 'offsetY'>,
  release: CanvasPoint | null,
): CanvasPoint {
  if (
    event.type === 'click' &&
    release &&
    Math.abs(event.offsetX - release[0]) <= 1 &&
    Math.abs(event.offsetY - release[1]) <= 1
  ) {
    return release;
  }
  return [event.offsetX, event.offsetY];
}

/**
 * r3f's compute function (what its default does: pointer and ray from the
 * event's point in the canvas), with clicks aimed by eventPoint. It sees
 * every event r3f handles, pointer-ups included, so it keeps the last
 * release itself.
 */
export function exactClickCompute(): ComputeFunction {
  let release: CanvasPoint | null = null;
  return (event: DomEvent, state) => {
    const [x, y] = eventPoint(event, release);
    if (event.type === 'pointerup') release = [event.offsetX, event.offsetY];
    state.pointer.set((x / state.size.width) * 2 - 1, -(y / state.size.height) * 2 + 1);
    state.raycaster.setFromCamera(state.pointer, state.camera);
  };
}

/** Aims the canvas's clicks where they were released (exactClickCompute), while mounted. */
export function useExactClicks(): void {
  const setEvents = useThree((s) => s.setEvents);
  const get = useThree((s) => s.get);
  useEffect(() => {
    const previous = get().events.compute;
    setEvents({ compute: exactClickCompute() });
    return () => setEvents({ compute: previous });
  }, [setEvents, get]);
}
