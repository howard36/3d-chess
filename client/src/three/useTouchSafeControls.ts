import { useEffect } from 'react';

// Keeps OrbitControls' idea of which fingers are down honest.
//
// The controls count pointers from pointerdown to pointerup/pointercancel. If
// an up is ever lost (a mobile browser handing the touch to one of its own
// gestures, the page losing focus mid-touch, an event aimed outside the
// canvas), the lifted finger stays in the controls' list with its last
// position. The next single finger then makes two, and a one-finger drag is
// read as a pinch against a finger that is no longer there: it zooms instead
// of turning the view, and keeps doing so until the page is reloaded.
//
// Touch events carry the authoritative list of fingers on the screen, so on
// every touch event (start, move, end, cancel: a finger's touchend may be
// lost as well, and the fingers still down keep moving) the controls' touch
// pointers are checked against it, and any the list cannot account for are
// dropped. A lost pointer capture, a blur and a hidden page drop pointers
// too. Whatever is left restarts its gesture, so a lone finger always turns
// the view.

/**
 * The pointer bookkeeping of three's OrbitControls (r176). These fields are
 * not public API; this module is the only place that touches them.
 */
export interface OrbitPointerState {
  domElement: HTMLElement | null;
  state: number;
  _pointers: number[];
  _pointerPositions: Record<number, { x: number; y: number } | undefined>;
  _onTouchStart(event: { pointerId: number; pageX: number; pageY: number }): void;
  _onPointerMove(event: PointerEvent): void;
  _onPointerUp(event: PointerEvent): void;
  dispatchEvent(event: { type: 'end' }): void;
}

const TOUCH_EVENTS = ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const;

/** OrbitControls' idle state. */
const NONE = -1;

export interface Point {
  x: number;
  y: number;
}

/**
 * Which tracked pointers no live touch accounts for, when more are tracked
 * than there are touches (none otherwise). Each live touch keeps the tracked
 * pointer nearest it, closest pairs first; a tie goes to the pointer pressed
 * later (`tracked` is in press order). Positions are page coordinates, the
 * pointer's as last seen by the controls and the touch's as it is now: the
 * browser sends a finger's pointer events just before its touch events, so a
 * live finger's two agree.
 */
export function stalePointers(
  tracked: ReadonlyArray<Point & { id: number }>,
  live: readonly Point[],
): number[] {
  if (tracked.length <= live.length) return [];
  const pairs = [...tracked]
    .reverse()
    .flatMap((t) => live.map((l, j) => ({ id: t.id, j, d: Math.hypot(t.x - l.x, t.y - l.y) })))
    .sort((a, b) => a.d - b.d);
  const kept = new Set<number>();
  const used = new Set<number>();
  for (const { id, j } of pairs) {
    if (kept.has(id) || used.has(j)) continue;
    kept.add(id);
    used.add(j);
  }
  return tracked.filter((t) => !kept.has(t.id)).map((t) => t.id);
}

/** The touch pointers the controls hold (a mouse or pen has no tracked position), in press order. */
const trackedTouches = (c: OrbitPointerState) =>
  c._pointers.flatMap((id) => {
    const at = c._pointerPositions[id];
    return at ? [{ id, x: at.x, y: at.y }] : [];
  });

/**
 * Makes the controls forget these pointers, then restarts the gesture of the
 * ones still down, as the controls themselves do when one finger of a pinch
 * lifts: one finger left turns the view, two pinch. With none left they go
 * idle and stop listening for moves, as after their own last pointer-up.
 */
export function dropPointers(c: OrbitPointerState, ids: readonly number[]): void {
  const el = c.domElement;
  let dropped = false;
  for (const id of ids) {
    const i = c._pointers.indexOf(id);
    if (i < 0) continue;
    c._pointers.splice(i, 1);
    delete c._pointerPositions[id];
    dropped = true;
    try {
      if (el?.hasPointerCapture(id)) el.releasePointerCapture(id);
    } catch {
      // The browser has already forgotten the pointer
    }
  }
  if (!dropped) return;
  if (c._pointers.length === 0) {
    el?.removeEventListener('pointermove', c._onPointerMove);
    el?.removeEventListener('pointerup', c._onPointerUp);
    c.state = NONE;
    c.dispatchEvent({ type: 'end' });
    return;
  }
  const first = c._pointers[0];
  const at = c._pointerPositions[first];
  if (at && c._pointers.every((id) => c._pointerPositions[id])) {
    c._onTouchStart({ pointerId: first, pageX: at.x, pageY: at.y });
  } else {
    c.state = NONE;
  }
}

/** The fields of a Touch this needs. */
export interface TouchLike {
  pageX: number;
  pageY: number;
  target: EventTarget | null;
}

/**
 * Drops the controls' touch pointers that the fingers on the screen (a touch
 * event's `touches`) cannot account for. Only fingers that went down inside
 * the controls' element count; one whose element has left the page is given
 * the benefit of the doubt. Returns the pointers dropped.
 */
export function reconcileTouches(
  c: OrbitPointerState,
  touches: ArrayLike<TouchLike>,
  within: Node,
): number[] {
  const live = Array.from(touches)
    .filter(
      (t) => !(t.target instanceof Node) || !t.target.isConnected || within.contains(t.target),
    )
    .map((t) => ({ x: t.pageX, y: t.pageY }));
  const stale = stalePointers(trackedTouches(c), live);
  dropPointers(c, stale);
  return stale;
}

/**
 * Keeps `controls` (connected to `element`) in step with the fingers really
 * on the screen; see the top of this file.
 */
export function useTouchSafeControls(
  controls: OrbitPointerState | null,
  element: HTMLElement | null,
): void {
  useEffect(() => {
    if (!controls || !element) return;
    const doc = element.ownerDocument;
    const win = doc.defaultView;
    // In the capture phase on the document, so no element's handler can hide
    // a touch event from it. A finger's pointer events come first, so the
    // controls have already counted a new finger, or forgotten a lifted one,
    // by the time its touch event arrives.
    const onTouch = (e: TouchEvent) => reconcileTouches(controls, e.touches, element);
    // Losing the capture while still counted means the pointer's later
    // events may land elsewhere, its up included.
    const onLostCapture = (e: PointerEvent) => {
      if (controls._pointers.includes(e.pointerId)) dropPointers(controls, [e.pointerId]);
    };
    // A page in the background hears no pointer-ups.
    const dropAll = () => dropPointers(controls, [...controls._pointers]);
    const onVisibility = () => {
      if (doc.visibilityState === 'hidden') dropAll();
    };
    const opts = { capture: true, passive: true } as const;
    for (const type of TOUCH_EVENTS) {
      doc.addEventListener(type, onTouch, opts);
    }
    element.addEventListener('lostpointercapture', onLostCapture);
    win?.addEventListener('blur', dropAll);
    doc.addEventListener('visibilitychange', onVisibility);
    return () => {
      for (const type of TOUCH_EVENTS) {
        doc.removeEventListener(type, onTouch, opts);
      }
      element.removeEventListener('lostpointercapture', onLostCapture);
      win?.removeEventListener('blur', dropAll);
      doc.removeEventListener('visibilitychange', onVisibility);
    };
  }, [controls, element]);
}
