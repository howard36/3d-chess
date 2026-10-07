import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getStepBack, setStepBack, STEP_BACK_DEFAULT, subscribeStepBack, tuningOn } from './tuning';

describe('tuning', () => {
  beforeEach(() => localStorage.clear());

  it('shows its controls once a page asks with ?tune, until ?tune=off', () => {
    expect(tuningOn('')).toBe(false);
    expect(tuningOn('?tune')).toBe(true);
    expect(tuningOn('')).toBe(true);
    expect(tuningOn('?tune=off')).toBe(false);
    expect(tuningOn('')).toBe(false);
  });

  it('keeps the step back between 0 and 1, tells its listeners, and remembers it', () => {
    expect(getStepBack()).toBe(STEP_BACK_DEFAULT);
    const listener = vi.fn();
    const stop = subscribeStepBack(listener);
    setStepBack(0.5);
    expect(getStepBack()).toBe(0.5);
    expect(localStorage.getItem('tune.stepBack')).toBe('0.5');
    setStepBack(1.4);
    expect(getStepBack()).toBe(1);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    setStepBack(STEP_BACK_DEFAULT);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
