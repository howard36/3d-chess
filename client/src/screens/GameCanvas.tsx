import { useState } from 'react';
import type { RefObject } from 'react';
import { Canvas } from '@react-three/fiber';
import type { RootState } from '@react-three/fiber';
import { NeutralToneMapping } from 'three';
import Board from '../three/Board';
import { FitCameraToBoard } from '../three/FitCameraToBoard';
import { hudTop } from '../three/cameraFit';
import { usePixelBudget } from '../three/pixelBudget';
import { CameraControls } from '../three/CameraControls';
import { IntroContext } from '../three/intro/clock';
import type { IntroClock } from '../three/intro/clock';
import { IntroDirector } from '../three/intro/IntroDirector';
import { introDone } from '../three/intro/timeline';
import { INTRO_SCENE_VAR } from '../three/intro/vars';
import { layout } from '../three/scene/palette';
import { Stage } from '../three/scene/stage';
import { BackdropCache } from '../three/scene/backdropCache';
import { WarmPrograms } from '../three/scene/warm';
import { setUpRenderer } from '../three/rendererSetup';
import type { Board as EngineBoard, Move } from '../engine';
import type { GameOver, LastMove, Turn } from '../game/history';
import type { Color } from '../types/messages';

// The game's 3D board and its entrance: three.js, the scene and its camera,
// in the chunk the lobby's canvas and the landing page's preview share.
// GameView loads it lazily, so a game's page shows its HUD and move record
// before three.js has arrived.

export interface GameCanvasProps {
  color: Color | null;
  board: EngineBoard;
  currentTurn: Turn;
  lastMove: LastMove | undefined;
  gameOver: GameOver | null;
  /** The board takes no input (GameView's rules, and while the entrance plays). */
  disabled: boolean;
  onMove: (move: Move) => void;
  onChoosePromotion: (choices: Move[]) => void;
  /** The entrance's plan and clock (GameView's). */
  clock: IntroClock;
  introPaused: boolean;
  /** The page the entrance fades by its CSS custom properties. */
  styleTarget: RefObject<HTMLElement | null>;
  onFirstFrame?: () => void;
  onIntroDone: () => void;
}

const GameCanvas = ({
  color,
  board,
  currentTurn,
  lastMove,
  gameOver,
  disabled,
  onMove,
  onChoosePromotion,
  clock,
  introPaused,
  styleTarget,
  onFirstFrame,
  onIntroDone,
}: GameCanvasProps) => {
  const pixelRatio = usePixelBudget();
  // The entrance is over: the board takes input from now on
  const [introOver, setIntroOver] = useState(() => introDone(clock.plan, clock.t));
  const [drawn, setDrawn] = useState(false);
  return (
    <>
      {/* Main 3D Board canvas. The camera starts on the viewing player's
        side (mostly +Z, up and to the right) so their levels stay
        nearest and the depth layers don't perfectly occlude;
        FitCameraToBoard then sets its distance so the whole cube fits
        whatever the window's shape. */}
      <Canvas
        data-testid="r3f-canvas"
        role="img"
        aria-label={`The 3D board, ${color ?? 'white'} side nearest. Pieces are selected and moved with a pointer; to play from the keyboard, press Tab to type a move.`}
        // Every touch on the board is the camera's or a tap on a
        // square: never a page scroll or zoom, and no grey tap flash.
        // The entrance fades the whole scene up from the dark.
        style={{
          height: '100%',
          width: '100%',
          touchAction: 'none',
          WebkitTapHighlightColor: 'transparent',
          opacity: `var(${INTRO_SCENE_VAR}, 1)`,
        }}
        camera={{ position: layout.viewDirection, fov: 36 }}
        // A pixel budget rather than r3f's fixed cap: the screen's own
        // ratio up to 2x, a large high-density window a little under it
        dpr={pixelRatio}
        gl={{ antialias: true, toneMapping: NeutralToneMapping, toneMappingExposure: 1 }}
        // A chess position is static: render only when something changes.
        // React commits and OrbitControls invalidate on their own; the
        // animations (the move glide, the lift, the scene's effects, the
        // entrance) request frames while they run.
        frameloop="demand"
        // Test hook: r3f v9 no longer exposes its store on the canvas
        // element, so drivers (e2e/helpers/board.ts) read the live camera
        // here to project board cells to pixels — correct even after the
        // user orbits or the camera setup above changes.
        onCreated={(state: RootState) => {
          setUpRenderer(state);
          (window as Window & { __r3fState?: RootState }).__r3fState = state;
        }}
      >
        <IntroContext.Provider value={clock}>
          {/* The garden, drawn from a copy while the camera is at rest */}
          <BackdropCache>
            <Stage orientation={color ?? 'white'} />
          </BackdropCache>
          <Board
            board={board} // Pass the EngineBoard instance
            currentTurn={currentTurn}
            playerColor={color} // Pass the determined player color
            onMove={onMove}
            onChoosePromotion={onChoosePromotion}
            lastMove={lastMove}
            // Nothing can be picked up while the entrance plays
            disabled={disabled}
            gameOver={gameOver}
          />
          {/* The only camera control is turning the view about the
            board's centre, which never moves (no pan by mouse, touch or
            keyboard), plus a zoom that FitCameraToBoard limits relative
            to the fitted view. */}
          <CameraControls
            // The tower's orbit limits: the camera stays above the ground and
            // may rise to look straight down
            minPolarAngle={layout.orbit.minPolarAngle}
            maxPolarAngle={layout.orbit.maxPolarAngle}
          />
          <FitCameraToBoard
            viewDirection={layout.viewDirection}
            minDistance={layout.orbit.minDistance}
            frameRings={layout.frameRings}
            hudTopBand={hudTop}
          />
          <IntroDirector
            clock={clock}
            paused={introPaused}
            styleTarget={styleTarget}
            onFirstFrame={() => {
              setDrawn(true);
              onFirstFrame?.();
            }}
            onDone={() => {
              setIntroOver(true);
              onIntroDone();
            }}
          />
          {introOver && drawn && <WarmPrograms />}
        </IntroContext.Provider>
      </Canvas>
    </>
  );
};

export default GameCanvas;
