import React from 'react';
import { useParams } from 'react-router-dom';
import Board from '../three/Board';
import { Canvas } from '@react-three/fiber';
import type { RootState } from '@react-three/fiber';
import { FitCameraToBoard } from '../three/FitCameraToBoard';
import { hudBands } from '../three/cameraFit';
import { usePixelBudget } from '../three/pixelBudget';
import { CameraControls } from '../three/CameraControls';
import type { Move } from '../engine';
import { moveToMessage } from '../engine/protocol';
import EndGameModal from './EndGameModal';
import PromotionPicker from './PromotionPicker';
import { deriveHistory } from '../game/history';
import type { GameHistory } from '../game/history';
import { hasSessionSince, selectErrors, selectOpponentOnline, selectSeat } from '../game/session';
import type { GameSocket } from '../hooks/useGameSocket';
import { getStoredRole, setStoredRole, clearStoredRole } from '../lib/playerRole';
import { getClientId } from '../lib/clientId';
import { useResendOnReconnect } from '../hooks/useResendOnReconnect';
import { NeutralToneMapping } from 'three';
import { useSetting } from '../three/settings';
import { onToppled } from '../three/pieceMotion';
import { layout } from '../three/scene/palette';
import { Stage } from '../three/scene/stage';
import SettingsGear from './SettingsPanel';
import TurnPill from './TurnPill';
import CapturedPieces from './CapturedPieces';
import MoveCard from './MoveCard';
import MoveAnnouncer from './MoveAnnouncer';
import type { HoveredCell } from '../three/Board';

interface GameScreenProps {
  gameSocket: GameSocket;
}

type Phase = 'waiting' | 'joined' | 'started';

/** After the mated king has fallen, a beat more before the result card (the pulse plays on). */
const RESULT_BEAT_MS = 400;
/** If the scene never says the king has fallen (frames stopped), the card shows anyway. */
const MATE_FALLBACK_MS = 12000;
/** At stalemate nothing plays out: the last move lands and the card follows. */
const STALEMATE_WAIT_MS = 1200;

const GameScreen: React.FC<GameScreenProps> = ({ gameSocket }) => {
  const { gameId } = useParams<{ gameId: string }>();
  // Whether this client has sent join_game (players with a stored role never do)
  const [joinRequested, setJoinRequested] = React.useState(false);
  // Errors the user has already dismissed (by count, since the log is append-only)
  const [dismissedErrorCount, setDismissedErrorCount] = React.useState(0);
  // Render mirror of the persisted role; localStorage is the source of truth
  const [storedRole, setStoredRoleState] = React.useState(() =>
    gameId ? getStoredRole(gameId) : null,
  );
  // The socket session a rejoin_game was last sent on, so each fresh socket
  // (page load or mid-game reconnect) rejoins at most once.
  const rejoinSessionRef = React.useRef(0);
  // Whether the next rejoin may take the seat from another tab's live
  // connection. Arriving on the page, or clicking "Play here", is the player
  // choosing this tab; an automatic reconnect is not, and must not evict the
  // tab they moved to while this one was offline (the server answers
  // seat_in_use instead, and this tab offers "Play here").
  const takeoverRef = React.useRef(true);
  // Where in the log the last move was sent, and on which socket session.
  // Until the server answers (the move_made echo, or an error), the board
  // stays disabled so a quick second move can't be sent into a turn that is
  // no longer ours. A drop before the answer frees it: the session changes,
  // and the move was never delivered (useGameSocket drops queued moves).
  const [moveSent, setMoveSent] = React.useState<{ sessionId: number; index: number } | null>(null);

  React.useEffect(() => {
    // Re-sync when the route's gameId changes (a different game's page)
    setStoredRoleState(gameId ? getStoredRole(gameId) : null);
    rejoinSessionRef.current = 0;
  }, [gameId]);

  const { messages, sessionId, sessionStartIndex, status } = gameSocket;

  // --- All game state is derived from the message log ---
  const seat = React.useMemo(() => selectSeat(messages), [messages]);
  const { color } = seat;
  const opponentOnline = React.useMemo(
    () => selectOpponentOnline(messages, color),
    [messages, color],
  );
  const allErrors = React.useMemo(() => selectErrors(messages), [messages]);
  // seat_in_use is answered with the "open in another tab" dialog, not the banner
  const errors = React.useMemo(
    () => allErrors.filter((e) => e.code !== 'seat_in_use'),
    [allErrors],
  );
  // This socket holds a seat on the server: its create, join or rejoin was
  // answered. Until then the page shows the position from before the socket
  // opened, which may be moves behind the server's.
  const sessionReady = hasSessionSince(messages, sessionStartIndex);
  // (Only while connected: after "Play here" the old socket's refusal must not
  // keep the dialog up while the new one opens.)
  const seatInUse =
    status === 'connected' &&
    !sessionReady &&
    messages.slice(sessionStartIndex).some((m) => m.type === 'error' && m.code === 'seat_in_use');

  // The replayed game. deriveHistory hands back the previous object while the
  // move record is unchanged (it memoizes itself through `prev`), so a
  // presence or error message neither replays the game nor gives the 3D
  // board a new position (which would clear the player's selection).
  const historyRef = React.useRef<GameHistory | null>(null);
  const history = deriveHistory(messages, historyRef.current);
  historyRef.current = history;
  const { board, moveRecords, currentTurn, lastMove, captured, replayFailedAt, gameOver } = history;

  const pixelRatio = usePixelBudget();
  // The Notation panel (a setting): the move card, with the moves so far, the
  // cell under the pointer and a field to type a move, stays on screen
  const notationPanel = useSetting<boolean>('play.notation');
  // The board is framed clear of the pill and the captured pieces under it,
  // and of the move card while it spans the bottom of the window (turning the
  // Notation panel on or off refits)
  const bandsFor = React.useCallback(
    (width: number, height: number) => hudBands(width, height, notationPanel),
    [notationPanel],
  );
  // The cell under the pointer, read out in the move card while it shows
  const [hoverCell, setHoverCell] = React.useState<HoveredCell | null>(null);
  // The mate plays out (the king topples) before the result covers the
  // board, while the pulse runs on behind it — when the mate was just played,
  // not when a finished game is reopened.
  const endedLive =
    [...messages].reverse().find((m) => m.type === 'move_made' || m.type === 'game_state')?.type ===
    'move_made';
  // The game end whose wait is over (the replay keeps the same object while
  // the record is unchanged).
  const [endShown, setEndShown] = React.useState<typeof gameOver>(null);
  React.useEffect(() => {
    if (!gameOver || !endedLive) return;
    // A mate: once the scene says the king has fallen (on its own clock, so
    // a slow device never covers it early), and a beat more; with a generous
    // fallback in case frames stop. A stalemate: a moment. Timed on
    // animation frames, the clock the scene runs on.
    const mate = gameOver.result === 'checkmate';
    const start = performance.now();
    let fellAt: number | null = null;
    const unsubscribe = mate
      ? onToppled(() => {
          fellAt ??= performance.now();
        })
      : () => {};
    let frame = requestAnimationFrame(function tick() {
      const now = performance.now();
      const waited = mate
        ? (fellAt !== null && now - fellAt >= RESULT_BEAT_MS) || now - start >= MATE_FALLBACK_MS
        : now - start >= STALEMATE_WAIT_MS;
      if (waited) setEndShown(gameOver);
      else frame = requestAnimationFrame(tick);
    });
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
    };
  }, [gameOver, endedLive]);
  const showEndModal = !!gameOver && (!endedLive || endShown === gameOver);

  const awaitingMove =
    moveSent !== null &&
    moveSent.sessionId === sessionId &&
    !messages
      .slice(moveSent.index)
      .some((m) => m.type === 'move_made' || m.type === 'error' || m.type === 'game_state');

  // The board takes no input while disconnected (a frozen snapshot), until
  // the new connection's rejoin is answered (the snapshot may be stale, and a
  // move made against it could be recorded but unplayable), while a move
  // awaits its echo, or when the record is broken.
  const boardDisabled =
    status !== 'connected' || !sessionReady || replayFailedAt !== null || awaitingMove;
  // Set the moment a move is sent, cleared once it is no longer awaited (its
  // echo, a refusal or error, or a new connection)
  const moveInFlight = React.useRef(false);
  React.useLayoutEffect(() => {
    if (!awaitingMove) moveInFlight.current = false;
  }, [awaitingMove, moveSent]);

  // A pawn moved onto a promotion square: the legal moves for that square,
  // one per piece, until the player picks one. The choices belong to the
  // position they were made against, so they go away when it moves on or
  // when the board stops taking input (a drop would otherwise leave a live
  // dialog whose pick is silently discarded).
  const [promotionChoices, setPromotionChoices] = React.useState<Move[] | null>(null);
  React.useEffect(() => setPromotionChoices(null), [board, boardDisabled]);

  // Once this page has held the seat, a later rejoin is a reconnect, not the
  // player choosing this tab.
  React.useEffect(() => {
    if (sessionReady) takeoverRef.current = false;
  }, [sessionReady]);

  // Rejoin whenever a socket session opens without a server-side seat: on page
  // load with a stored role, and again after every mid-game reconnect (the
  // server forgets a socket the moment it drops). The creator arriving from
  // StartScreen is the exception — their session already has game_created.
  // Only on an open socket: a rejoin queued on a closed one would be flushed
  // on the next open and then sent again for that session.
  React.useEffect(() => {
    if (!gameId || !storedRole || sessionId === 0 || status !== 'connected') return;
    if (rejoinSessionRef.current === sessionId) return;
    if (hasSessionSince(messages, sessionStartIndex)) return;
    rejoinSessionRef.current = sessionId;
    gameSocket.send({
      type: 'rejoin_game',
      gameId,
      color: storedRole,
      clientId: getClientId(),
      takeover: takeoverRef.current,
    });
    // takeoverRef stays set until a rejoin is answered (the effect above), so
    // a page whose first answer is lost to a drop still takes the seat.
  }, [gameId, storedRole, messages, sessionId, sessionStartIndex, status, gameSocket]);

  // Persist the assigned role the moment the server confirms it, so the
  // player can rejoin later (idempotent for a creator who already stored it).
  const assignedColor = seat.assigned;
  React.useEffect(() => {
    if (gameId && assignedColor) {
      setStoredRole(gameId, assignedColor);
      setStoredRoleState(assignedColor);
    }
  }, [gameId, assignedColor]);

  const latestError = errors.length > dismissedErrorCount ? errors[errors.length - 1] : null;

  // A failed join (bad game id, game full) returns the user to the join button
  React.useEffect(() => {
    if (
      joinRequested &&
      !seat.started &&
      errors.some((e) => e.code === 'invalid_game' || e.code === 'game_full')
    ) {
      setJoinRequested(false);
    }
  }, [errors, seat.started, joinRequested]);

  // A failed rejoin means the stored role is stale (the game expired or the
  // seat was never claimed): forget it and fall back to the join button.
  React.useEffect(() => {
    if (
      gameId &&
      storedRole &&
      !seat.started &&
      !history.snapshot &&
      errors.some((e) => e.code === 'invalid_rejoin' || e.code === 'invalid_game')
    ) {
      clearStoredRole(gameId);
      setStoredRoleState(null);
    }
  }, [errors, gameId, storedRole, seat.started, history.snapshot]);

  const phase: Phase = seat.started
    ? 'started'
    : joinRequested || seat.joined
      ? 'joined'
      : 'waiting';

  // Send move message on local move. While disconnected the board is a frozen
  // snapshot, so a move made against it is not sent (the Board is disabled
  // too — this is the backstop).
  const handleMove = (move: Move) => {
    if (!gameId || boardDisabled || moveInFlight.current) return;
    // Only send move to server; the board updates when move_made comes back.
    // Marked in flight at once: boardDisabled only follows on the next
    // render, and a second call before it must not send the move again.
    moveInFlight.current = true;
    gameSocket.send(moveToMessage(move));
    setMoveSent({ sessionId, index: messages.length });
  };

  // A join whose answer is lost to a drop is sent again on the next
  // connection; the server recognises this tab's client id and hands back the
  // seat it already claimed for it.
  const requestJoin = useResendOnReconnect(
    gameSocket,
    !joinRequested || seat.joined || seat.started,
  );

  // Send join_game when button is clicked
  const handleJoin = () => {
    if (!gameId || phase !== 'waiting') return;
    requestJoin({ type: 'join_game', gameId, clientId: getClientId() });
    setJoinRequested(true);
  };

  const handlePlayHere = () => {
    takeoverRef.current = true;
    gameSocket.reconnect();
  };

  // The latest error, until dismissed: glass with a thin red rule. A screen
  // reader hears "Error:" first; the eye has the rule.
  const errorBanner = latestError && (
    <div role="alert" className="hud-notice hud-glass" data-testid="error-banner">
      <span>
        <span className="sr-only">Error: </span>
        {latestError.message}
      </span>
      <button
        className="hud-dismiss"
        onClick={() => setDismissedErrorCount(errors.length)}
        aria-label="Dismiss error"
      >
        <span aria-hidden>✕</span>
      </button>
    </div>
  );

  const reconnectingBanner = status === 'reconnecting' && (
    <div className="hud-line hud-glass">
      <span className="hud-dot" aria-hidden />
      Reconnecting…
    </div>
  );

  // The server closed this socket because a newer connection (another tab, a
  // refreshed window) took the seat. The hook deliberately does not retry —
  // that would evict the other tab, which would retry in turn, forever — so
  // this stays until the user picks a side. The same applies when this tab
  // reconnected after the seat had moved (seat_in_use). The board is already
  // disabled: the socket is closed or holds no seat.
  const replaced = status === 'replaced' || seatInUse;
  const replacedNotice = replaced && (
    <div className="hud-veil" style={{ zIndex: 1002 }}>
      <div
        className="hud-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="replaced-title"
        aria-describedby="replaced-body"
        style={{ padding: '22px 28px 20px' }}
      >
        <h2 id="replaced-title" style={{ fontSize: 20 }}>
          This game is open in another tab
        </h2>
        <p id="replaced-body">
          Your seat moved to the newer tab or window. Close this one, or take the game back here.
        </p>
        {/* A dialog takes focus, so Enter answers it without hunting for it */}
        <button autoFocus className="hud-button" onClick={handlePlayHere}>
          Play here
        </button>
      </div>
    </div>
  );

  // Not dismissible: the game record itself is broken, and every reload will
  // hit the same move. Everything before it stays viewable.
  const replayErrorBanner = replayFailedAt !== null && (
    <div role="alert" className="hud-notice hud-glass" data-frozen="">
      Move {replayFailedAt + 1} of this game can't be replayed by this version of the app. The board
      stays at the position before it.
    </div>
  );

  if (phase === 'started') {
    const inCheck = !gameOver && board.inCheck(currentTurn);
    // While a dialog is up, everything behind it is out of reach: not
    // clickable (the backdrop covers it) and not focusable or readable either.
    const behindDialog = replaced || showEndModal || (!!promotionChoices && !boardDisabled);
    return (
      // game-screen (index.css): no text selection, callout or double-tap
      // zoom on a touch screen, except in the move box and the move list
      <div
        className="game-screen"
        style={{
          position: 'relative',
          height: '100dvh',
          width: '100vw',
          overflow: 'hidden',
          fontFamily: 'var(--hud-font)',
        }}
      >
        <div inert={behindDialog} style={{ position: 'absolute', inset: 0 }}>
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
            // square: never a page scroll or zoom, and no grey tap flash
            style={{
              height: '100%',
              width: '100%',
              touchAction: 'none',
              WebkitTapHighlightColor: 'transparent',
            }}
            camera={{ position: layout.viewDirection, fov: 36 }}
            // A pixel budget rather than r3f's fixed cap: the screen's own
            // ratio up to 2x, a large high-density window a little under it
            dpr={pixelRatio}
            gl={{ antialias: true, toneMapping: NeutralToneMapping, toneMappingExposure: 1 }}
            // A chess position is static: render only when something changes.
            // React commits and OrbitControls invalidate on their own; the
            // animations (the move glide, the lift, the scene's effects)
            // request frames while they run.
            frameloop="demand"
            // Test hook: r3f v9 no longer exposes its store on the canvas
            // element, so drivers (e2e/helpers/board.ts) read the live camera
            // here to project board cells to pixels — correct even after the
            // user orbits or the camera setup above changes.
            onCreated={(state: RootState) => {
              (window as Window & { __r3fState?: RootState }).__r3fState = state;
            }}
          >
            <Stage orientation={color ?? 'white'} />
            <Board
              board={board} // Pass the EngineBoard instance
              currentTurn={currentTurn}
              playerColor={color} // Pass the determined player color
              onMove={handleMove}
              onChoosePromotion={setPromotionChoices}
              lastMove={lastMove}
              disabled={boardDisabled}
              gameOver={gameOver}
              onHoverCell={notationPanel ? setHoverCell : undefined}
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
              halfExtents={layout.halfExtents}
              viewDirection={layout.viewDirection}
              minDistance={layout.orbit.minDistance}
              framePoints={layout.framePoints}
              bands={bandsFor}
            />
          </Canvas>
          {/* The HUD over the canvas (index.css): the turn pill at the top
              centre with the status column under it, the settings gear at the
              top right, the move card at the bottom left. Only the controls
              take the pointer; the rest lets it through to the board. */}
          <div className="hud">
            <div className="hud-top">
              {color && (
                // The pill, and under it the pieces each side has taken
                <div className="hud-bar">
                  <TurnPill
                    seat={color}
                    turn={currentTurn}
                    inCheck={inCheck}
                    gameOver={gameOver}
                    opponentOnline={opponentOnline}
                    stale={status === 'reconnecting'}
                  />
                  <CapturedPieces seat={color} captured={captured} board={board} />
                </div>
              )}
              <div className="hud-status">
                {/* Always in the page, so its first change is announced */}
                <div role="status">{reconnectingBanner}</div>
                {errorBanner}
                {replayErrorBanner}
              </div>
            </div>
            <MoveCard
              board={board}
              color={color}
              moves={moveRecords}
              canMove={!boardDisabled && !gameOver && color === currentTurn}
              yourTurn={!gameOver && color === currentTurn}
              onMove={handleMove}
              shown={notationPanel}
              hovered={hoverCell}
            />
            <div className="hud-gear-slot">
              {/* The board's settings: a gear that opens their panel */}
              <SettingsGear />
            </div>
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
              setPromotionChoices(null);
              handleMove(move);
            }}
            onCancel={() => setPromotionChoices(null)}
          />
        )}
        {/* End Game Modal */}
        {gameOver && showEndModal && (
          <div inert={replaced}>
            <EndGameModal
              result={gameOver.result}
              winner={gameOver.winner}
              seat={color ?? 'white'}
            />
          </div>
        )}
        {replacedNotice}
      </div>
    );
  }

  const shareLink = `${window.location.origin}/game/${gameId}`;

  // UI for waiting/joining phase
  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen p-8"
      style={{
        background: 'var(--page-bg)',
        color: 'var(--page-fg)',
        fontFamily: 'var(--hud-font)',
      }}
    >
      <div
        inert={replaced}
        className="text-center flex flex-col items-center gap-8 w-full max-w-2xl"
      >
        <h1 className="text-5xl sm:text-6xl font-bold tracking-wide">3D Chess</h1>
        {phase === 'waiting' && !storedRole && (
          <button
            onClick={handleJoin}
            className="py-3 px-6 text-2xl font-semibold text-gray-900 bg-white rounded-xl hover:bg-gray-100 focus:outline-none focus:ring-4 focus:ring-blue-500 focus:ring-opacity-50 transition-all duration-200 transform hover:scale-105"
          >
            Join Game
          </button>
        )}
        {phase === 'waiting' && storedRole && (
          <div className="text-center w-full">
            <p className="text-xl mb-4">Game created! Share this link with a friend:</p>
            {/* Wraps anywhere, so a long address never runs off a phone */}
            <p className="text-lg sm:text-2xl font-bold bg-gray-800 px-4 py-2 rounded-lg break-all">
              {shareLink}
            </p>
            <CopyLinkButton link={shareLink} />
          </div>
        )}
        {phase === 'joined' && <p className="text-xl">Joined game, waiting for start...</p>}
      </div>
      <div className="absolute top-2.5 right-2.5" role="status" style={{ zIndex: 1001 }}>
        {reconnectingBanner}
      </div>
      {errorBanner && (
        <div
          inert={replaced}
          className="absolute inset-x-2.5 bottom-4 flex justify-center"
          style={{ zIndex: 1001 }}
        >
          {errorBanner}
        </div>
      )}
      {replacedNotice}
    </div>
  );
};

/** Copies the share link, for a phone where selecting a long address is fiddly. */
const CopyLinkButton: React.FC<{ link: string }> = ({ link }) => {
  const [copied, setCopied] = React.useState<boolean | null>(null);
  if (typeof navigator === 'undefined' || !navigator.clipboard) return null;
  return (
    <div className="mt-3 flex items-center justify-center gap-3">
      <button
        onClick={() => {
          navigator.clipboard.writeText(link).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
        className="py-2 px-4 text-lg font-semibold text-gray-900 bg-white rounded-lg hover:bg-gray-100 focus:outline-none focus:ring-4 focus:ring-blue-500"
      >
        Copy link
      </button>
      <span role="status" className="text-gray-300">
        {copied === true
          ? 'Copied'
          : copied === false
            ? 'Could not copy; select the link instead'
            : ''}
      </span>
    </div>
  );
};

export default GameScreen;
