import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { addAfterEffect, useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import type { IntroClock } from './clock';
import { dollyFactor, hudFade, introDone, sceneFade } from './timeline';
import { INTRO_HUD_VAR, INTRO_SCENE_VAR } from './vars';

/**
 * The longest step one frame may take the entrance: a stalled frame (a tab
 * in the background, a hitch) resumes it where it was rather than skipping
 * to its end, while a slow renderer (a few frames a second in software)
 * still plays it in about its own time, if in fewer frames.
 */
const MAX_STEP = 0.25;

interface OrbitLike {
  target: Vector3;
  enabled: boolean;
  update: () => void;
}

// The CSS custom properties the entrance fades the page's parts by, in a
// module of their own so the page can name them without loading three.js
export { INTRO_HUD_VAR, INTRO_SCENE_VAR };

const ORIGIN = new Vector3();
const direction = new Vector3();

/**
 * Runs the game's entrance (timeline.ts) on r3f's clock: advances `clock`
 * in a frame callback ahead of every other (so each part of the scene reads
 * the same moment in its own), requests a frame while it plays, and moves
 * the camera.
 *
 * The camera only dollies: it stands on the line of sight FitCameraToBoard
 * chose (its opening view) and closes in to exactly the fitted distance
 * (`camera.userData.fitDistance`), keeping the fit's lens shift, so the
 * tower's centre stays at one point on screen throughout; a window resized
 * mid-way re-fits and the dolly carries on to the new fit. The orbit controls
 * take no input until it lands, then are handed the camera exactly where a
 * load without an entrance leaves it.
 *
 * The page's parts outside the canvas fade by two CSS custom properties set
 * on `styleTarget`: --intro-scene (the canvas) and --intro-hud (the pill),
 * removed when the entrance is over.
 *
 * Held at its first frame while `paused` (the lobby's overlay covers the
 * canvas as it mounts). `onFirstFrame` is called once the canvas has drawn
 * its first frame (its shaders compiled), `onDone` once the entrance is over.
 */
export function IntroDirector({
  clock,
  paused = false,
  styleTarget,
  onFirstFrame,
  onDone,
}: {
  clock: IntroClock;
  paused?: boolean;
  styleTarget?: RefObject<HTMLElement | null>;
  onFirstFrame?: () => void;
  onDone?: () => void;
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as OrbitLike | null;
  const invalidate = useThree((s) => s.invalidate);
  const started = useRef(false);
  const finished = useRef(introDone(clock.plan, clock.t));
  const drawn = useRef(false);
  const latest = useRef({ onFirstFrame, onDone });
  latest.current = { onFirstFrame, onDone };

  // The first frame this canvas draws, reported once it has been drawn
  useEffect(() => {
    let off: (() => void) | null = addAfterEffect(() => {
      if (!drawn.current || !off) return;
      off();
      off = null;
      latest.current.onFirstFrame?.();
    });
    return () => off?.();
  }, []);

  useEffect(() => {
    invalidate();
  }, [paused, invalidate]);

  // An entrance cut short (the game view leaves mid-way) hands the controls back
  useEffect(
    () => () => {
      if (controls) controls.enabled = true;
    },
    [controls],
  );

  const style = (name: string, value: number | null) => {
    const el = styleTarget?.current;
    if (!el) return;
    if (value === null) el.style.removeProperty(name);
    else el.style.setProperty(name, value.toFixed(4));
  };

  const place = (factor: number) => {
    const fit = camera.userData.fitDistance as number | undefined;
    if (!fit) return;
    const target = controls?.target ?? ORIGIN;
    direction.copy(camera.position).sub(target);
    if (direction.lengthSq() === 0) return;
    direction.normalize();
    camera.position.copy(target).addScaledVector(direction, fit * factor);
  };

  useFrame((_, delta) => {
    drawn.current = true;
    if (finished.current) return;
    const { plan } = clock;
    // The first frame shows the very start; after it the clock runs
    if (started.current && !paused)
      clock.t = Math.min(clock.t + Math.min(delta, MAX_STEP), plan.total);
    started.current = true;
    if (introDone(plan, clock.t)) {
      finished.current = true;
      place(1);
      if (controls) {
        controls.enabled = true;
        controls.update();
      }
      style(INTRO_SCENE_VAR, null);
      style(INTRO_HUD_VAR, null);
      invalidate();
      latest.current.onDone?.();
      return;
    }
    if (controls) controls.enabled = false;
    place(dollyFactor(plan, clock.t));
    style(INTRO_SCENE_VAR, sceneFade(plan, clock.t));
    style(INTRO_HUD_VAR, hudFade(plan, clock.t));
    if (!paused) invalidate();
  }, -3);

  return null;
}
