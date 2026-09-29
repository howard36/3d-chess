import React from 'react';
import { prefersReducedMotion } from '../three/motion';
import type { IntroClock } from '../three/intro/clock';
import { INTRO_HUD_VAR, INTRO_SCENE_VAR } from '../three/intro/vars';
import { hudFade, introDone, introPlan, sceneFade } from '../three/intro/timeline';
import type { IntroVariant } from '../three/intro/timeline';
import { cachedImport } from '../lib/cachedImport';
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

// The 3D board (three.js, the scene, the entrance's director) is a chunk of
// its own, the one the lobby's canvas loads too, asked for as soon as this
// view loads: the HUD and the move record show without waiting for it
const loadGameCanvas = cachedImport(() => import('./GameCanvas'));
const GameCanvas = React.lazy(loadGameCanvas);
void loadGameCanvas().catch(() => {});

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
        {/* The 3D board, from its own chunk: nothing shows there until it
            has loaded (the HUD over it does) */}
        <React.Suspense fallback={null}>
          <GameCanvas
            color={color}
            board={board}
            currentTurn={currentTurn}
            lastMove={lastMove}
            gameOver={gameOver}
            // Nothing can be picked up while the entrance plays
            disabled={boardDisabled || introPlaying}
            onMove={onMove}
            onChoosePromotion={onChoosePromotion}
            clock={clock}
            introPaused={introPaused}
            styleTarget={screen}
            onFirstFrame={onFirstFrame}
            onIntroDone={() => setIntroPlaying(false)}
          />
        </React.Suspense>
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
