import type { ThreeEvent } from '@react-three/fiber';

// How far (in CSS pixels) the pointer may travel between press and release
// and still count as a click. OrbitControls listens to the same pointer, so
// anything longer is a view drag and must not select or move. r3f reports
// the distance as `delta` but, unlike for missed clicks, does not filter hits
// by it. A little above r3f's own 2 px to absorb a finger's jitter.
export const CLICK_SLOP_PX = 6;

/**
 * Whether a board click is a deliberate tap: the primary button (the DOM only
 * fires `click` for it, but a synthetic one could say otherwise) released
 * where it was pressed. The board acts on click rather than pointer-down so
 * that a drag, right-drag or pinch started over the cube only turns the view.
 */
export const isTap = (e: Pick<ThreeEvent<MouseEvent>, 'delta' | 'nativeEvent'>) =>
  e.nativeEvent.button === 0 && e.delta <= CLICK_SLOP_PX;
