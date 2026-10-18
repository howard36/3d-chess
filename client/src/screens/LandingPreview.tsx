import React from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { NeutralToneMapping } from 'three';
import Board from '../three/Board';
import { AutoOrbit } from '../three/AutoOrbit';
import { FitCameraToBoard } from '../three/FitCameraToBoard';
import { usePixelBudget } from '../three/pixelBudget';
import { LANDING_VIEW, landingFrameRings, landingViewDirection } from '../three/landingView';
import { LANDING_CAMERAS, LANDING_PICTURES, landingLens } from '../three/landingLens';
import { LANDING_BANDS } from './landingLayout';
import type { LandingLayout } from './landingLayout';
import { layout } from '../three/scene/palette';
import { Stage } from '../three/scene/stage';
import { demoFrame, demoLog, demoOrder } from '../game/demo';
import type { DemoFrame } from '../game/demo';
import { deriveHistory } from '../game/history';
import type { GameHistory } from '../game/history';
import { linkBeforeFirstFrame, setUpRenderer } from '../three/rendererSetup';

/** The longest step one frame may advance the demo: a background tab resumes it, never skips it. */
const MAX_STEP_S = 0.1;

/** Seconds the preview takes to fade in over the start page's picture of it. */
const REVEAL_S = 0.3;

/**
 * Where the demo starts, in seconds: from the start, but in development a
 * `?t=` in the address starts it later (to look at a mate or the fade
 * between games without sitting through a game on a slow software renderer).
 */
const startAt = (): number => {
  if (!import.meta.env.DEV) return 0;
  const t = Number(new URLSearchParams(window.location.search).get('t'));
  return Number.isFinite(t) && t > 0 ? t : 0;
};

/**
 * Fades the preview in over the start page's picture of its first frame
 * (StartScreen), on r3f's clock, once that frame is on screen: the first
 * frame is held until its programs are linked and the second until the GPU
 * has drawn the first (linkBeforeFirstFrame), so the fade starts on the
 * second. Nothing moves until it is done, so the picture and the frame
 * fading in over it are one picture.
 */
function Reveal({
  wrapper,
  onShown,
}: {
  wrapper: React.RefObject<HTMLDivElement | null>;
  onShown: () => void;
}) {
  const frames = React.useRef(0);
  const shown = React.useRef(0);
  const done = React.useRef(false);
  useFrame(({ invalidate }, delta) => {
    if (done.current) return;
    frames.current += 1;
    if (frames.current >= 2) shown.current = Math.min(1, shown.current + delta / REVEAL_S);
    if (wrapper.current) wrapper.current.style.opacity = String(shown.current);
    if (shown.current >= 1) {
      done.current = true;
      onShown();
    } else invalidate();
  });
  return null;
}

/**
 * Builds the scene (the garden and the board, the most work the page does)
 * in a transition, after the canvas is made: React yields to input every few
 * milliseconds while it renders, so a click in the first second, which
 * otherwise waited on the whole build, is answered at once. The programs of
 * the scene so built are linked ahead of its first frame (LinkAhead).
 */
function Yielding({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => React.startTransition(() => setMounted(true)), []);
  return mounted ? (
    <>
      {children}
      <LinkAhead />
    </>
  ) : null;
}

/** Links the programs of everything mounted before it ahead of the next frame (linkBeforeFirstFrame). */
function LinkAhead() {
  const get = useThree((s) => s.get);
  React.useLayoutEffect(() => linkBeforeFirstFrame(get()), [get]);
  return null;
}

/**
 * Runs the demo's clock on r3f's (so scripts/showcase.mjs, which records on a
 * virtual clock, captures it) and reports each new ply or pass. The veil
 * changes every frame of a fade, so it is written straight to its element
 * rather than through React.
 */
function DemoDirector({
  order,
  veil,
  onFrame,
}: {
  order: readonly number[];
  veil: React.RefObject<HTMLDivElement | null>;
  onFrame: (frame: DemoFrame) => void;
}) {
  const clock = React.useRef(startAt());
  // Nothing reported yet: the first frame always reports where the demo
  // stands, whatever the page showed before this director mounted
  const shown = React.useRef<DemoFrame | null>(null);
  const invalidate = useThree((s) => s.invalidate);
  // The canvas draws on demand: set off with a frame of its own, or nothing
  // asks for the first (the reveal, done, asks for no more)
  React.useEffect(() => invalidate(), [invalidate]);
  useFrame((_, delta) => {
    clock.current += Math.min(delta, MAX_STEP_S);
    const frame = demoFrame(clock.current, order);
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

/** The view of a layout's picture (LANDING_PICTURES): its camera, and a lens that takes in the whole picture. */
const pictureLens = (picture: LandingLayout) => () => ({
  distance: LANDING_CAMERAS[picture].distance,
  fov: (2 * Math.atan(LANDING_PICTURES[picture].span / 2) * 180) / Math.PI,
  shift: LANDING_PICTURES[picture].centre,
});

/**
 * The landing page's live preview: the real tower in its garden, playing
 * real games on their own (game/demo.ts, in an order drawn afresh for each
 * visit) and turning slowly round, over and over. Purely decorative: it
 * takes no pointer (the page's controls sit over it) and is hidden from
 * assistive technology, which hears the page's text description instead.
 *
 * It opens exactly as the start page's picture of it shows (the opening
 * position, from the turn's first angle, framed by the layout's lens:
 * landingLens.ts), fades in over the picture once its first frame is drawn
 * (Reveal), and only then sets off, telling the page with `onShown`.
 *
 * With `picture` (the dev-only landing-pictures.html, for
 * scripts/landing-pictures.mjs), it draws that layout's picture instead: the
 * opening, still, through a lens that takes in the whole picture, as finely
 * as the screen asks.
 */
export function LandingPreview({
  onShown,
  picture,
}: {
  onShown?: () => void;
  picture?: LandingLayout;
}) {
  const pixelRatio = usePixelBudget();
  const veil = React.useRef<HTMLDivElement>(null);
  const wrapper = React.useRef<HTMLDivElement>(null);
  const [order] = React.useState(() => demoOrder());
  const [revealed, setRevealed] = React.useState(false);
  // Where the moving demo stands (DemoDirector reports each new ply and pass)
  const [frame, setFrame] = React.useState<Pick<DemoFrame, 'pass' | 'game' | 'ply'>>(() =>
    demoFrame(picture ? 0 : startAt(), order),
  );
  const shown = React.useCallback(() => {
    setRevealed(true);
    onShown?.();
  }, [onShown]);

  // Handed to the fit unchanged from one render to the next (it refits when it changes)
  const lens = React.useMemo(() => (picture ? pictureLens(picture) : landingLens), [picture]);

  const historyRef = React.useRef<GameHistory | null>(null);
  const history = deriveHistory(demoLog(frame.game, frame.ply), historyRef.current);
  historyRef.current = history;

  return (
    <div
      ref={wrapper}
      className="landing-preview"
      aria-hidden="true"
      style={{ opacity: picture || revealed ? 1 : 0 }}
    >
      <Canvas
        data-testid="landing-canvas"
        style={{ height: '100%', width: '100%', pointerEvents: 'none' }}
        camera={{ position: landingViewDirection, fov: 36 }}
        dpr={picture ? window.devicePixelRatio : pixelRatio}
        gl={{ antialias: true, toneMapping: NeutralToneMapping, toneMappingExposure: 1 }}
        // The turn and the demo ask for their own frames; until they set
        // off, the preview draws only when something changes
        frameloop="demand"
        // The scene built in a transition, and its first frame's programs
        // linked before it, the page free meanwhile (Yielding): a click in
        // the first seconds waits on neither
        onCreated={setUpRenderer}
      >
        <Yielding>
          <Stage orientation="white" />
          {/* A fresh board for each pass (the next game opens under the veil):
            a board plays only the moves made after it mounts */}
          <Board
            key={frame.pass}
            board={history.board}
            currentTurn={history.currentTurn}
            playerColor={null}
            lastMove={history.lastMove}
            disabled
            gameOver={history.gameOver}
            labels={false}
          />
          {!picture && !revealed && <Reveal wrapper={wrapper} onShown={shown} />}
        </Yielding>
        <FitCameraToBoard
          viewDirection={landingViewDirection}
          minDistance={layout.orbit.minDistance}
          frameRings={landingFrameRings}
          hudTopBand={LANDING_BANDS.top}
          bottomBand={LANDING_BANDS.bottom}
          leftBand={LANDING_BANDS.left}
          centre="rings"
          lens={lens}
        />
        {revealed && <AutoOrbit period={LANDING_VIEW.period} />}
        {revealed && <DemoDirector order={order} veil={veil} onFrame={setFrame} />}
      </Canvas>
      <div ref={veil} className="landing-veil" style={{ opacity: 0 }} />
    </div>
  );
}
