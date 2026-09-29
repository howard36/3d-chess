import { createContext, useContext } from 'react';
import { introPlan } from './timeline';
import type { IntroPlan } from './timeline';

/**
 * The entrance's clock, shared by everything it moves: its plan and how far
 * into it the scene is, in seconds. IntroDirector advances `t` on r3f's clock
 * (in a frame callback that runs before everyone else's), so a part reads
 * it in its own useFrame and sets its uniforms from the plan (timeline.ts).
 * A mutable object, never state: it changes every frame.
 */
export interface IntroClock {
  plan: IntroPlan;
  t: number;
}

/** No entrance: everything is already in its final state. */
export const FINISHED: IntroClock = Object.freeze({ plan: introPlan('none'), t: Infinity });

export const IntroContext = createContext<IntroClock>(FINISHED);

/**
 * The entrance's clock for the scene this part is drawn in; outside one (a
 * test, a gallery, the lobby drawing a level), the finished scene.
 */
export const useIntro = () => useContext(IntroContext);
