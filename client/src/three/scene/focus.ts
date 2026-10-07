import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { LevelFocus } from '../types';
import { toward } from './ease';

/**
 * The level to emphasise, from GridProps.focus: the level under the pointer
 * (a square on it, a piece or a destination), else none. Never the selected
 * piece's own level: its moves to other levels are as much in play as those
 * on its own, so holding a piece steps no level back.
 */
export const focusLevelOf = (focus: LevelFocus | null | undefined): number | null =>
  focus?.hovered ?? null;

/** How long a change of focus takes to ease in, ms. */
export const LEVEL_FOCUS_MS = 160;

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
    ms = 150,
    key,
  }: {
    ms?: number;
    /** Anything whose change means the weights must be applied again (new materials). */
    key?: unknown;
  } = {},
) => {
  const invalidate = useThree((s) => s.invalidate);
  const weights = useRef<number[]>(Array.from({ length: 5 }, () => 0));
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
    const step = Math.min(delta, 1 / 20) / (ms / 1000);
    let moving = false;
    weights.current = weights.current.map((w, z) => {
      const next = toward(w, z === focusLevel ? 1 : 0, step);
      if (next !== (z === focusLevel ? 1 : 0)) moving = true;
      return next;
    });
    const goalAny = focusLevel === null || focusLevel === undefined ? 0 : 1;
    any.current = toward(any.current, goalAny, step);
    if (any.current !== goalAny) moving = true;
    latest.current(weights.current, any.current);
    if (moving) invalidate();
    else settled.current = true;
  });
};
