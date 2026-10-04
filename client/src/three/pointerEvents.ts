import { events } from '@react-three/fiber';

/**
 * r3f's pointer events, connected only to an element that is still there.
 * A Canvas connects its events from its root's first commit, which on a slow
 * renderer can land after the page has already unmounted the Canvas (a
 * player leaving the start page the moment it opens): r3f then hands
 * `connect` its container's ref, null by now, and it throws. With nothing to
 * connect to, this connects nothing.
 */
export const pointerEvents: typeof events = (store) => {
  const manager = events(store);
  return {
    ...manager,
    connect: (target) => {
      if (target) manager.connect?.(target);
    },
  };
};
