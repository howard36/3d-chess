import { useState, useSyncExternalStore } from 'react';
import { getStepBack, setStepBack, subscribeStepBack, tuningOn } from '../tuning';

/**
 * A slider for how far the levels the pointer is not on step back, shown only
 * while tuning is on (`?tune`, tuning.ts).
 */
export const StepBackTuner = () => {
  const [on] = useState(() => tuningOn());
  const value = useSyncExternalStore(subscribeStepBack, getStepBack);
  if (!on) return null;
  const percent = Math.round(value * 100);
  return (
    <label className="hud-tune hud-glass">
      <span>Step back</span>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={percent}
        onChange={(e) => setStepBack(Number(e.target.value) / 100)}
      />
      <output>{percent}%</output>
    </label>
  );
};
