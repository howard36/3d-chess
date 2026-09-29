import React from 'react';
import { Canvas } from '@react-three/fiber';
import type { RootState } from '@react-three/fiber';
import { NeutralToneMapping } from 'three';
import Board from '../three/Board';
import { FitCameraToBoard } from '../three/FitCameraToBoard';
import { hudTop } from '../three/cameraFit';
import { usePixelBudget } from '../three/pixelBudget';
import { CameraControls } from '../three/CameraControls';
import { prefersReducedMotion } from '../three/motion';
import { IntroContext } from '../three/intro/clock';
import type { IntroClock } from '../three/intro/clock';
import { IntroDirector, INTRO_HUD_VAR, INTRO_SCENE_VAR } from '../three/intro/IntroDirector';
import { hudFade, introDone, introPlan, sceneFade } from '../three/intro/timeline';
import type { IntroVariant } from '../three/intro/timeline';
import { layout } from '../three/scene/palette';
import { Stage } from '../three/scene/stage';
import type { Move } from '../engine';
import type { GameHistory } from '../game/history';
import type { Color } from '../types/messages';
import EndGameModal from './EndGameModal';
import PromotionPicker from './PromotionPicker';
import TurnPill from './TurnPill';
import CapturedPieces from './CapturedPieces';
import MoveCard from './MoveCard';
import MoveAnnouncer from './MoveAnnouncer';

export type { IntroVariant };

export interface GameViewProps {
  /** The replayed game (deriveHistory). */
  history: GameHistory;
  /** The seat this page holds; null until the server has said. */
  color: Color | null;
  /** Whether the opponent has a live connection; null until the server has said. */
  opponentOnline: boolean | null;
  /** The connection is being re-established: the pill and the captured pieces dim. */
  reconnecting: boolean;
  /** The board takes no input (disconnected, a stale snapshot, a move awaiting its echo). */
  boardDisabled: boolean;
  /** Sends a move (a click on the board, the move box, the promotion dialog). */
  onMove: (move: Move) => void;
  /** A promotion waiting for the player's pick: one move per piece. */
  promotionChoices: Move[] | null;
  /** Sets (or, with null, clears) the promotion waiting for a pick. */
  onChoosePromotion: (choices: Move[] | null) => void;
  /** The result card is up. */
  showEndModal: boolean;
  /** Another tab holds the seat: `replacedNotice` is up and nothing else can be reached. */
  replaced: boolean;
  /** The "open in another tab" dialog, while `replaced`. */
  replacedNotice?: React.ReactNode;
  /** The "Reconnecting…" line under the pill (announced: it sits in a live region). */
  reconnectingBanner?: React.ReactNode;
  /** Alerts under the pill: the latest error, the frozen-record notice. */
  alerts?: React.ReactNode;
  /**
   * The entrance (three/intro/timeline.ts): `full` for a game that starts
   * while the page is open, `short` for a page that opens on a game already
   * under way, `none` for the finished scene at once. Read once, when the
   * view mounts. With prefers-reduced-motion any entrance is a short fade.
   */
  intro?: IntroVariant;
  /**
   * Holds the entrance at its first frame (the canvas drawn, nothing on it
   * yet but the dark) until set false: for a caller that covers the canvas
   * while it mounts and reveals it before the entrance plays.
   */
  introPaused?: boolean;
  /** Called once, after the canvas has drawn its first frame (its shaders compiled). */
  onFirstFrame?: () => void;
}

/**
 * The game in play: the 3D board and the HUD over it, the promotion dialog,
 * the result card and the notice of another tab taking the seat. Everything
 * it shows comes from GameScreen, which keeps the socket and the rules of
 * when the board takes input; this view adds only the game's entrance.
 *
 * The entrance (IntroDirector) plays on the canvas's clock: the camera
 * closes in as the tower builds itself level by level, the pieces form, and
 * the pill fades in last. The board takes no input until it is over; the
 * canvas's wrapper carries `data-intro` ("playing", then "done") for tests
 * and tools.
 */
const GameView: React.FC<GameViewProps> = ({
  history,
  color,
  opponentOnline,
  reconnecting,
  boardDisabled,
  onMove,
  promotionChoices,
  onChoosePromotion,
  showEndModal,
  replaced,
  replacedNotice,
  reconnectingBanner,
  alerts,
  intro = 'full',
  introPaused = false,
  onFirstFrame,
}) => {
  const { board, moveRecords, currentTurn, lastMove, captured, gameOver } = history;
  const pixelRatio = usePixelBudget();

  // The entrance's plan and clock, fixed when the view mounts
  const [clock] = React.useState<IntroClock>(() => {
    const plan = introPlan(intro, prefersReducedMotion());
    return { plan, t: introDone(plan, 0) ? Infinity : 0 };
  });
  const [introPlaying, setIntroPlaying] = React.useState(() => !introDone(clock.plan, clock.t));
  const screen = React.useRef<HTMLDivElement>(null);
  // Until the director takes over on the first frame: the entrance's start
  const introStyle = introPlaying
    ? ({
        [INTRO_SCENE_VAR]: sceneFade(clock.plan, 0),
        [INTRO_HUD_VAR]: hudFade(clock.plan, 0),
      } as React.CSSProperties)
    : undefined;

  const inCheck = !gameOver && board.inCheck(currentTurn);
  // While a dialog is up, everything behind it is out of reach: not
  // clickable (the backdrop covers it) and not focusable or readable either.
  const behindDialog = replaced || showEndModal || (!!promotionChoices && !boardDisabled);
  return (
    // game-screen (index.css): no text selection, callout or double-tap
    // zoom on a touch screen, except in the move box and the move list
    <div
      ref={screen}
      className="game-screen"
      style={{
        position: 'relative',
        height: '100dvh',
        width: '100vw',
        overflow: 'hidden',
        fontFamily: 'var(--hud-font)',
        // The night the entrance fades the scene up from
        background: 'var(--page-bg)',
        ...introStyle,
      }}
    >
      <div
        inert={behindDialog}
        data-intro={introPlaying ? 'playing' : 'done'}
        style={{ position: 'absolute', inset: 0 }}
      >
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
            (window as Window & { __r3fState?: RootState }).__r3fState = state;
          }}
        >
          <IntroContext.Provider value={clock}>
            <Stage orientation={color ?? 'white'} />
            <Board
              board={board} // Pass the EngineBoard instance
              currentTurn={currentTurn}
              playerColor={color} // Pass the determined player color
              onMove={onMove}
              onChoosePromotion={onChoosePromotion}
              lastMove={lastMove}
              // Nothing can be picked up while the entrance plays
              disabled={boardDisabled || introPlaying}
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
              styleTarget={screen}
              onFirstFrame={onFirstFrame}
              onDone={() => setIntroPlaying(false)}
            />
          </IntroContext.Provider>
        </Canvas>
        {/* The HUD over the canvas (index.css): the turn pill at the top
            centre with the status column under it, the move card at the
            bottom left. Only the controls
            take the pointer; the rest lets it through to the board. */}
        <div className="hud">
          <div className="hud-top">
            {color && (
              // The pill, and under it the pieces each side has taken (they
              // fade in last in the entrance: --intro-hud)
              <div className="hud-bar">
                <TurnPill
                  seat={color}
                  turn={currentTurn}
                  inCheck={inCheck}
                  gameOver={gameOver}
                  opponentOnline={opponentOnline}
                  stale={reconnecting}
                />
                <CapturedPieces seat={color} captured={captured} board={board} />
              </div>
            )}
            <div className="hud-status">
              {/* Always in the page, so its first change is announced */}
              <div role="status">{reconnectingBanner}</div>
              {alerts}
            </div>
          </div>
          <MoveCard
            board={board}
            color={color}
            moves={moveRecords}
            canMove={!boardDisabled && !gameOver && color === currentTurn}
            yourTurn={!gameOver && color === currentTurn}
            onMove={onMove}
          />
          {/* Said, not shown: each move as it lands, and the opponent's presence */}
          <MoveAnnouncer history={history} seat={color} />
          <div
            className="sr-only"
            role="status"
            data-testid="opponent-presence"
            data-online={opponentOnline === null ? undefined : String(opponentOnline)}
          >
            {opponentOnline === null
              ? ''
              : opponentOnline
                ? 'Your opponent is online.'
                : 'Your opponent is offline.'}
          </div>
        </div>
      </div>
      {promotionChoices && !boardDisabled && (
        <PromotionPicker
          choices={promotionChoices}
          color={color ?? 'white'}
          onPick={(move) => {
            onChoosePromotion(null);
            onMove(move);
          }}
          onCancel={() => onChoosePromotion(null)}
        />
      )}
      {/* End Game Modal */}
      {gameOver && showEndModal && (
        <div inert={replaced}>
          <EndGameModal result={gameOver.result} winner={gameOver.winner} seat={color ?? 'white'} />
        </div>
      )}
      {replacedNotice}
    </div>
  );
};

export default GameView;
