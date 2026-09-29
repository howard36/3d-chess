import React from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { NeutralToneMapping } from 'three';
import Board from '../three/Board';
import { AutoOrbit } from '../three/AutoOrbit';
import { FitCameraToBoard } from '../three/FitCameraToBoard';
import { usePixelBudget } from '../three/pixelBudget';
import {
  LANDING_VIEW,
  landingBottomBand,
  landingFrameRings,
  landingTopBand,
  landingViewDirection,
} from '../three/landingView';
import { layout } from '../three/scene/palette';
import { Stage } from '../three/scene/stage';
import { DEMO_GAME, demoFrame, demoLog } from '../game/demo';
import type { DemoFrame } from '../game/demo';
import { deriveHistory } from '../game/history';
import type { GameHistory } from '../game/history';

/** The longest step one frame may advance the demo: a background tab resumes it, never skips it. */
const MAX_STEP_S = 0.1;

/**
 * Where the demo starts, in seconds: from the start, but in development a
 * `?t=` in the address starts it later (to look at the mate or the loop's
 * fade without sitting through the game on a slow software renderer).
 */
const startAt = (): number => {
  if (!import.meta.env.DEV) return 0;
  const t = Number(new URLSearchParams(window.location.search).get('t'));
  return Number.isFinite(t) && t > 0 ? t : 0;
};

/**
 * Runs the demo's clock on r3f's (so scripts/showcase.mjs, which records on a
 * virtual clock, captures it) and reports each new ply or pass. The veil
 * changes every frame of a fade, so it is written straight to its element
 * rather than through React.
 */
function DemoDirector({
  paused,
  veil,
  onFrame,
}: {
  paused: boolean;
  veil: React.RefObject<HTMLDivElement | null>;
  onFrame: (frame: DemoFrame) => void;
}) {
  const clock = React.useRef(startAt());
  // Nothing reported yet: the first frame always reports where the demo
  // stands, whatever the page showed before this director mounted
  const shown = React.useRef<DemoFrame | null>(null);
  const invalidate = useThree((s) => s.invalidate);
  // Coming back from a pause, the next frame has to be asked for
  React.useEffect(() => {
    if (!paused) invalidate();
  }, [paused, invalidate]);
  useFrame((_, delta) => {
    if (paused) return;
    clock.current += Math.min(delta, MAX_STEP_S);
    const frame = demoFrame(clock.current);
    if (veil.current) veil.current.style.opacity = String(frame.veil);
    const was = shown.current;
    if (!was || frame.ply !== was.ply || frame.pass !== was.pass) {
      shown.current = frame;
      onFrame(frame);
    }
    invalidate();
  });
  return null;
}

/**
 * Paused, the canvas draws no frames at all (the last move's shimmer and a
 * check's blades would otherwise play on); it draws one when the window
 * changes size, so a resize never leaves it blank.
 */
function RedrawWhilePaused({ paused }: { paused: boolean }) {
  const size = useThree((s) => s.size);
  const advance = useThree((s) => s.advance);
  React.useEffect(() => {
    if (paused) advance(performance.now());
  }, [paused, size, advance]);
  return null;
}

/**
 * The landing page's live preview: the real tower in its garden, playing a
 * real game on its own (the demo, game/demo.ts) and turning slowly round,
 * over and over. Purely decorative: it takes no pointer (the page's controls
 * sit over it) and is hidden from assistive technology, which hears the
 * page's text description instead.
 *
 * With `still`, for a player who asked for less motion, nothing moves: the
 * camera holds where it is on the game's final position, the mating move's
 * line and the check showing, the king still standing.
 */
export function LandingPreview({
  paused,
  still,
  onEnded,
}: {
  paused: boolean;
  still: boolean;
  /** Told whether the demo's game stands finished (its mate on the board), as that changes. */
  onEnded?: (ended: boolean) => void;
}) {
  const pixelRatio = usePixelBudget();
  const veil = React.useRef<HTMLDivElement>(null);
  const [frame, setFrame] = React.useState<Pick<DemoFrame, 'pass' | 'ply'>>(() =>
    still ? { pass: 0, ply: DEMO_GAME.length } : demoFrame(startAt()),
  );
  React.useEffect(() => {
    if (!still) return;
    setFrame({ pass: 0, ply: DEMO_GAME.length });
    // Held still mid-fade, the veil would stay part-way closed over the board
    if (veil.current) veil.current.style.opacity = '0';
  }, [still]);
  const halted = paused && !still;

  const historyRef = React.useRef<GameHistory | null>(null);
  const history = deriveHistory(demoLog(frame.ply), historyRef.current);
  historyRef.current = history;
  const ended = !!history.gameOver;
  React.useEffect(() => onEnded?.(ended), [ended, onEnded]);

  return (
    <div className="landing-preview" aria-hidden="true">
      <Canvas
        data-testid="landing-canvas"
        style={{ height: '100%', width: '100%', pointerEvents: 'none' }}
        camera={{ position: landingViewDirection, fov: 36 }}
        dpr={pixelRatio}
        gl={{ antialias: true, toneMapping: NeutralToneMapping, toneMappingExposure: 1 }}
        // The turn and the demo ask for their own frames; still, the preview
        // draws only when something changes, and paused, not at all
        frameloop={halted ? 'never' : 'demand'}
      >
        <Stage orientation="white" />
        {/* A fresh board for each pass (the next game opens under the veil),
            and when motion is turned off or on: a board plays only the
            moves made after it mounts */}
        <Board
          key={`${still}-${frame.pass}`}
          board={history.board}
          currentTurn={history.currentTurn}
          playerColor={null}
          lastMove={history.lastMove}
          disabled
          // The fallen king is motion too: held still, he stays standing
          gameOver={still ? null : history.gameOver}
          labels={false}
        />
        <FitCameraToBoard
          viewDirection={landingViewDirection}
          minDistance={layout.orbit.minDistance}
          frameRings={landingFrameRings}
          hudTopBand={landingTopBand}
          bottomBand={landingBottomBand}
        />
        {!still && <AutoOrbit period={LANDING_VIEW.period} paused={halted} />}
        {!still && <DemoDirector paused={halted} veil={veil} onFrame={setFrame} />}
        <RedrawWhilePaused paused={halted} />
      </Canvas>
      <div ref={veil} className="landing-veil" style={{ opacity: 0 }} />
    </div>
  );
}
