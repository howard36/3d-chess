import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

// Timing for Kontur's marks and effects. Everything runs on r3f's clock
// (never timers), so the showcase's virtual clock records it frame for
// frame, and asks for frames only while something is moving.

export const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1);
export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
export const easeOutBack = (t: number, s = 1.70158) =>
  1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;

/** The longest step one frame may take: the first frame after an idle stretch reports it all. */
const MAX_STEP = 1 / 30;

/**
 * Seconds since mount on r3f's clock, handed to `onFrame` every frame for
 * `lifeMs` (the last call gets exactly `lifeMs`), or for as long as it is
 * mounted if `lifeMs` is Infinity. Returns true once it has run its course,
 * so a one-shot effect can unmount itself.
 */
export const useTimeline = (lifeMs: number, onFrame: (t: number) => void): boolean => {
  const invalidate = useThree((s) => s.invalidate);
  const elapsed = useRef(0);
  const finished = useRef(false);
  const [done, setDone] = useState(false);
  useEffect(() => invalidate(), [invalidate]);
  useFrame((_, delta) => {
    if (finished.current) return;
    elapsed.current += Math.min(delta, MAX_STEP);
    if (elapsed.current * 1000 >= lifeMs) {
      finished.current = true;
      onFrame(lifeMs / 1000);
      setDone(true);
      return;
    }
    onFrame(elapsed.current);
    invalidate();
  });
  return done;
};
