// A mated king striking the floor (pieceMotion's Topple), for the game
// screen's end card to wait on. Kept apart from the scene, so the screen can
// listen without loading three.js.

const listeners = new Set<() => void>();

/** Calls `listener` each time a mated king strikes the floor; returns the unsubscribe. */
export const onToppled = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Tells every listener a mated king has struck the floor. */
export const toppled = () => listeners.forEach((listener) => listener());
