import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { LevelFocus } from '../types';

/**
 * The level to emphasise, from GridProps.focus: the level under the pointer
 * while the pointer is on the board, else the selected piece's level, else
 * none. Hover wins because it is what the player is asking about right now;
 * with the pointer off the board, the selection still says where play is.
 */
export const focusLevelOf = (focus: LevelFocus | null | undefined): number | null =>
  focus?.hovered ?? focus?.selected ?? null;

/**
 * One eased weight per level, 1 for `focusLevel` and 0 for the others,
 * moving at a steady rate so a change of focus takes `ms` (a calm ease, never
 * a pulse). `onChange` gets the weights each frame they move, and once when
 * they settle; frames are only requested while they move.
 */
export const useLevelFocus = (
  focusLevel: number | null | undefined,
  onChange: (weights: number[], anyFocus: number) => void,
  {
    levels = 5,
    ms = 150,
    key,
  }: {
    levels?: number;
    ms?: number;
    /** Anything whose change means the weights must be applied again (new materials). */
    key?: unknown;
  } = {},
) => {
  const invalidate = useThree((s) => s.invalidate);
  const weights = useRef<number[]>(Array.from({ length: levels }, () => 0));
  const any = useRef(0);
  const settled = useRef(false);
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    settled.current = false;
    invalidate();
  }, [focusLevel, key, invalidate]);
  useFrame((_, delta) => {
    if (settled.current) return;
    const step = ms > 0 ? Math.min(delta, 1 / 20) / (ms / 1000) : 1;
    const toward = (v: number, goal: number) =>
      goal > v ? Math.min(goal, v + step) : Math.max(goal, v - step);
    let moving = false;
    weights.current = weights.current.map((w, z) => {
      const next = toward(w, z === focusLevel ? 1 : 0);
      if (next !== (z === focusLevel ? 1 : 0)) moving = true;
      return next;
    });
    const goalAny = focusLevel === null || focusLevel === undefined ? 0 : 1;
    any.current = toward(any.current, goalAny);
    if (any.current !== goalAny) moving = true;
    latest.current(weights.current, any.current);
    if (moving) invalidate();
    else settled.current = true;
  });
};
