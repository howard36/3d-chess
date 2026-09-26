import React from 'react';
import { useParams } from 'react-router-dom';
import Board from '../three/Board';
import { Canvas } from '@react-three/fiber';
import type { RootState } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import TurnIndicator from '../three/TurnIndicator';
import { FitCameraToBoard } from '../three/FitCameraToBoard';
import MoveInput from './MoveInput';
import type { Move } from '../engine';
import { moveToMessage } from '../engine/protocol';
import EndGameModal from './EndGameModal';
import MoveList from './MoveList';
import PromotionPicker from './PromotionPicker';
import { deriveHistory } from '../game/history';
import type { GameHistory } from '../game/history';
import { hasSessionSince, selectErrors, selectOpponentOnline, selectSeat } from '../game/session';
import type { GameSocket } from '../hooks/useGameSocket';
import { getStoredRole, setStoredRole, clearStoredRole } from '../lib/playerRole';
import { getClientId } from '../lib/clientId';
import { useResendOnReconnect } from '../hooks/useResendOnReconnect';
import { theme } from '../three/theme';

interface GameScreenProps {
  gameSocket: GameSocket;
}

type Phase = 'waiting' | 'joined' | 'started';

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
  const seatInUse =
    !sessionReady &&
    messages.slice(sessionStartIndex).some((m) => m.type === 'error' && m.code === 'seat_in_use');

  // The replayed game. deriveHistory hands back the previous object while the
  // move record is unchanged (it memoizes itself through `prev`), so a
  // presence or error message neither replays the game nor gives the 3D
  // board a new position (which would clear the player's selection).
  const historyRef = React.useRef<GameHistory | null>(null);
  const history = deriveHistory(messages, historyRef.current);
  historyRef.current = history;
  const { board, moveRecords, currentTurn, lastMove, replayFailedAt, gameOver } = history;

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
  React.useEffect(() => {
    if (!gameId || !storedRole || sessionId === 0) return;
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
    takeoverRef.current = false;
  }, [gameId, storedRole, messages, sessionId, sessionStartIndex, gameSocket]);

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
    if (!gameId || boardDisabled) return;
    // Only send move to server; the board updates when move_made comes back
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

  const errorBanner = latestError && (
    <div
      role="alert"
      style={{
        padding: '10px 16px',
        backgroundColor: 'rgba(180,30,30,0.92)',
        color: 'white',
        borderRadius: '8px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        pointerEvents: 'auto',
      }}
    >
      <span>Error: {latestError.message}</span>
      <button
        onClick={() => setDismissedErrorCount(errors.length)}
        aria-label="Dismiss error"
        style={{ fontWeight: 700, background: 'none', border: 'none', color: 'white' }}
      >
        ✕
      </button>
    </div>
  );

  const reconnectingBanner = status === 'reconnecting' && (
    <div
      role="status"
      style={{
        padding: '8px 14px',
        backgroundColor: 'rgba(200,140,20,0.92)',
        color: 'white',
        borderRadius: '8px',
        fontWeight: 600,
      }}
    >
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
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="replaced-title"
      aria-describedby="replaced-body"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 1002,
      }}
    >
      <div
        style={{
          background: 'white',
          color: '#222',
          padding: '2rem',
          borderRadius: 16,
          boxShadow: '0 4px 32px rgba(0,0,0,0.18)',
          textAlign: 'center',
          maxWidth: 420,
        }}
      >
        <h2 id="replaced-title" style={{ marginTop: 0 }}>
          This game is open in another tab
        </h2>
        <p id="replaced-body">
          Your seat moved to the newer tab or window. Close this one, or take the game back here.
        </p>
        {/* A dialog takes focus, so Enter answers it without hunting for it */}
        <button
          autoFocus
          style={{ marginTop: 8, fontSize: 18, padding: '0.7em 2em' }}
          onClick={handlePlayHere}
        >
          Play here
        </button>
      </div>
    </div>
  );

  // Not dismissible: the game record itself is broken, and every reload will
  // hit the same move. Everything before it stays viewable.
  const replayErrorBanner = replayFailedAt !== null && (
    <div
      role="alert"
      style={{
        alignSelf: 'center',
        maxWidth: '480px',
        padding: '10px 16px',
        backgroundColor: 'rgba(180,30,30,0.92)',
        color: 'white',
        borderRadius: '8px',
        textAlign: 'center',
      }}
    >
      Move {replayFailedAt + 1} in this game's history is not a legal move for this client (likely
      an app version mismatch). The board is frozen at the position before it.
    </div>
  );

  if (phase === 'started') {
    const inCheck = !gameOver && board.inCheck(currentTurn);
    // While a dialog is up, everything behind it is out of reach: not
    // clickable (the backdrop covers it) and not focusable or readable either.
    const behindDialog = replaced || !!gameOver || (!!promotionChoices && !boardDisabled);
    return (
      <div style={{ position: 'relative', height: '100dvh', width: '100vw', overflow: 'hidden' }}>
        <div inert={behindDialog} style={{ position: 'absolute', inset: 0 }}>
          {/* Main 3D Board canvas. The camera starts on the viewing player's
              side (mostly +Z, up and to the right) so their levels stay
              nearest and the depth layers don't perfectly occlude;
              FitCameraToBoard then sets its distance so the whole cube fits
              whatever the window's shape. */}
          <Canvas
            data-testid="r3f-canvas"
            role="img"
            aria-label={`The 3D board, ${color ?? 'white'} side nearest. Pieces are selected and moved with a pointer; to play from the keyboard, type moves in the move box.`}
            style={{ height: '100%', width: '100%' }}
            camera={{ position: [6.5, 5, 8.5], fov: 40 }}
            // A chess position is static: render only when something changes.
            // React commits and OrbitControls invalidate on their own; the move
            // animations (three/moveAnimation.tsx) request frames while they run.
            frameloop="demand"
            // Test hook: r3f v9 no longer exposes its store on the canvas
            // element, so drivers (e2e/helpers/board.ts) read the live camera
            // here to project board cells to pixels — correct even after the
            // user orbits or the camera setup above changes.
            onCreated={(state: RootState) => {
              (window as Window & { __r3fState?: RootState }).__r3fState = state;
            }}
          >
            <color attach="background" args={[theme.background]} />
            {/* Fog matched to the background gently fades the far side of the
                lattice, giving a depth cue the flat grid lines can't */}
            <fog attach="fog" args={[theme.background, 10, 26]} />
            <hemisphereLight args={['#f5f7fb', '#46506b', 1.1]} />
            <directionalLight position={[6, 10, 6]} intensity={2.2} />
            <directionalLight position={[-6, -4, -8]} intensity={1.0} color="#dfe6f2" />
            <Board
              board={board} // Pass the EngineBoard instance
              currentTurn={currentTurn}
              playerColor={color} // Pass the determined player color
              onMove={handleMove}
              onChoosePromotion={setPromotionChoices}
              lastMove={lastMove}
              disabled={boardDisabled}
            />
            <OrbitControls makeDefault minDistance={6} />
            <FitCameraToBoard />
          </Canvas>
          {/* HUD over the canvas. Its layers let the pointer through to the
              board except on the controls themselves. Three columns in a wide
              window (seat, turn centred, connection); in a narrow one the turn
              takes the first row and the rest share the second, so nothing
              overlaps at any width. */}
          <div
            className="pointer-events-none absolute inset-x-2.5 top-2.5 flex flex-col gap-2"
            style={{ zIndex: 1000 }}
          >
            <div className="grid grid-cols-2 items-start gap-2 sm:grid-cols-[1fr_auto_1fr]">
              <div className="justify-self-start">
                {color && (
                  <div
                    style={{
                      padding: '10px',
                      backgroundColor: 'rgba(0,0,0,0.7)',
                      color: 'white',
                      borderRadius: '5px',
                    }}
                  >
                    You are playing as {color}.
                    {opponentOnline !== null && (
                      <div
                        data-testid="opponent-presence"
                        role="status"
                        style={{ marginTop: 4, fontSize: 13, opacity: 0.85 }}
                      >
                        Opponent: {opponentOnline ? 'online' : 'offline'}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="order-first col-span-2 justify-self-center sm:order-none sm:col-span-1">
                <TurnIndicator turn={currentTurn} inCheck={inCheck} />
              </div>
              <div className="justify-self-end">{reconnectingBanner}</div>
            </div>
            {replayErrorBanner}
          </div>
          <div
            className="pointer-events-none absolute inset-x-2.5 bottom-4 grid grid-cols-2 items-end gap-2 sm:grid-cols-[1fr_auto_1fr]"
            style={{ zIndex: 1000 }}
          >
            <div className="flex min-w-0 justify-start">
              <MoveInput
                board={board}
                color={color}
                canMove={!boardDisabled && !gameOver && color === currentTurn}
                onMove={handleMove}
              />
            </div>
            <div className="order-first col-span-2 justify-self-center sm:order-none sm:col-span-1">
              {errorBanner}
            </div>
            <div className="flex min-w-0 justify-end">
              <MoveList moves={moveRecords} />
            </div>
          </div>
        </div>
        {promotionChoices && !boardDisabled && (
          <PromotionPicker
            choices={promotionChoices}
            onPick={(move) => {
              setPromotionChoices(null);
              handleMove(move);
            }}
            onCancel={() => setPromotionChoices(null)}
          />
        )}
        {/* End Game Modal */}
        {gameOver && <EndGameModal result={gameOver.result} winner={gameOver.winner} />}
        {replacedNotice}
      </div>
    );
  }

  const shareLink = `${window.location.origin}/game/${gameId}`;

  // UI for waiting/joining phase
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-8">
      <div
        inert={replaced}
        className="text-center flex flex-col items-center gap-8 w-full max-w-2xl"
      >
        <h1 className="text-5xl sm:text-6xl font-bold text-white tracking-wide">3D Chess</h1>
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
      {reconnectingBanner && (
        <div className="absolute top-2.5 right-2.5" style={{ zIndex: 1001 }}>
          {reconnectingBanner}
        </div>
      )}
      {errorBanner && (
        <div className="absolute inset-x-2.5 bottom-4 flex justify-center" style={{ zIndex: 1001 }}>
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
