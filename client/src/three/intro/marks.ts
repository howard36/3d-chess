import { useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useIntro } from './clock';
import { introDone, MARKS_AFTER } from './timeline';

/** Which of the position's marks of play the scene shows yet (MARKS_AFTER). */
export interface MarksShown {
  /** The last move's line and marks. */
  lastMove: boolean;
  /** A check, a mate. */
  kings: boolean;
  /** Whether they waited for an entrance (and so draw themselves in when they come). */
  late: boolean;
}

const ALL: MarksShown = { lastMove: true, kings: true, late: false };

/** Like the entrance's own (IntroDirector): a stalled frame resumes the wait, not skips it. */
const MAX_STEP = 0.25;

/**
 * The marks of the position the board opens on, kept back while the entrance
 * plays and brought in its beats after it (MARKS_AFTER), on r3f's clock;
 * with no entrance (or one already over), there from the start.
 */
export function useMarksAfterEntrance(): MarksShown {
  const intro = useIntro();
  const invalidate = useThree((s) => s.invalidate);
  const [shown, setShown] = useState<MarksShown>(() =>
    introDone(intro.plan, intro.t) ? ALL : { lastMove: false, kings: false, late: true },
  );
  const after = useRef(0);
  useFrame((_, delta) => {
    // (the entrance asks for its own frames while it plays)
    if (shown.kings || !introDone(intro.plan, intro.t)) return;
    after.current += Math.min(delta, MAX_STEP);
    const lastMove = after.current >= MARKS_AFTER.lastMove;
    const kings = after.current >= MARKS_AFTER.kings;
    if (lastMove !== shown.lastMove || kings) setShown({ lastMove, kings, late: true });
    if (!kings) invalidate();
  });
  return shown;
}
