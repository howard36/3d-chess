import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Move } from '../engine';
import { moveToMessage } from '../engine/protocol';
import { deriveHistory } from '../game/history';
import type { GameHistory } from '../game/history';
import {
  hasSessionSince,
  selectErrors,
  selectOpponentOnline,
  selectSeat,
  startedLive,
} from '../game/session';
import type { GameSocket } from '../hooks/useGameSocket';
import { getStoredRole, setStoredRole, clearStoredRole } from '../lib/playerRole';
import { getClientId } from '../lib/clientId';
import { gameLink } from '../lib/gameLink';
import { useResendOnReconnect } from '../hooks/useResendOnReconnect';
import { onToppled } from '../three/pieceMotion';
import GameView from './GameView';
import { selectInvitation } from '../game/invitation';
import type { Color } from '../types/messages';
import { InvitationCard, InviteCard, SeatLabels } from './lobby/LobbyCards';
import { Stone } from './TurnPill';
import { useLobbyView } from './lobby/lobbyContext';
import type { LobbyStage } from './lobby/lobbyContext';

interface GameScreenProps {
  gameSocket: GameSocket;
}

type Phase = 'waiting' | 'joined' | 'started';

/** If the scene never says the king has fallen (frames stopped), the card shows anyway. */
const MATE_FALLBACK_MS = 12000;
/**
 * At stalemate nothing plays out: the card follows the last move as soon as
 * it has landed (its glide takes 460 ms) and a moment more.
 */
const STALEMATE_WAIT_MS = 600;
/** The longest the lobby holds its arrival for the game's first frame. */
const FIRST_FRAME_WAIT_MS = 4000;

const GameScreen: React.FC<GameScreenProps> = ({ gameSocket }) => {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
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
  const { board, replayFailedAt, gameOver } = history;

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
    // A mate: as soon as the scene says the king has struck the floor (on its
    // own clock, so a slow device never covers the fall early), while his
    // bounce and the pulse play on behind the card; with a generous fallback
    // in case frames stop. A stalemate: a moment. Timed on
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
        ? fellAt !== null || now - start >= MATE_FALLBACK_MS
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

  // A guest's invitation first asks which seats are taken (look_game), once
  // on each socket until answered, so it can say which side they will play,
  // or that the game is full or gone, before they accept.
  const lookSessionRef = React.useRef(0);
  // Answered by game_info, or by the one refusal a look can get (no such
  // game). Any other error (a stale role's refused rejoin, say) leaves the
  // question open: the invitation would wait on it forever.
  const looked = messages.some(
    (m) =>
      (m.type === 'game_info' && m.gameId === gameId) ||
      (m.type === 'error' && m.code === 'invalid_game'),
  );
  React.useEffect(() => {
    if (!gameId || storedRole || joinRequested || looked) return;
    if (sessionId === 0 || status !== 'connected' || lookSessionRef.current === sessionId) return;
    lookSessionRef.current = sessionId;
    gameSocket.send({ type: 'look_game', gameId });
  }, [gameId, storedRole, joinRequested, looked, sessionId, status, gameSocket]);

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

  // --- Before the game: the lobby (screens/lobby) ---------------------------------
  const other = (c: Color): Color => (c === 'white' ? 'black' : 'white');
  const invitation = selectInvitation(messages, gameId ?? '', joinRequested || seat.joined);
  // A guest: opened the invitation here (and may have accepted it); a host:
  // holds a seat it did not join here (it created the game)
  const guest = joinRequested || seat.joined || !storedRole;
  // The host, waiting: this page holds a seat and the game has not begun
  const hosting = !guest && sessionReady;
  const shareLink = gameLink(gameId ?? '');

  // The lobby hands over to the game when the game begins on this page: the
  // free seat fills (arrive), then the kings go up in light and the lobby
  // fades off the game's first frame (leave), whose entrance then plays.
  // A page that opens on a game already under way has no lobby to leave.
  const [handover, setHandover] = React.useState<'none' | 'arrive' | 'leave' | 'done'>('none');
  const [arrived, setArrived] = React.useState(false);
  // The lobby has begun to fade off the game: its entrance plays under it
  const [revealed, setRevealed] = React.useState(false);
  const [gameDrawn, setGameDrawn] = React.useState(false);
  const lobbyShown = React.useRef(false);
  if (phase === 'started' && lobbyShown.current && handover === 'none') setHandover('arrive');
  React.useEffect(() => {
    if (handover === 'arrive' && arrived && gameDrawn) setHandover('leave');
  }, [handover, arrived, gameDrawn]);
  // A safety net, not a beat: if the game's canvas never reports its first
  // frame (a lost WebGL context), the lobby leaves anyway rather than hold
  React.useEffect(() => {
    if (handover !== 'arrive' || !arrived || gameDrawn) return;
    const timer = window.setTimeout(() => setGameDrawn(true), FIRST_FRAME_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [handover, arrived, gameDrawn]);
  const wasHost = React.useRef(false);
  if (hosting) wasHost.current = true;

  // A host whose tab is in the background when the guest arrives: the tab's
  // title says so, and the arrival waits for them (the scene draws no
  // frames in a hidden tab)
  React.useEffect(() => {
    if (handover !== 'arrive' || !wasHost.current || !document.hidden) return;
    const title = document.title;
    document.title = '● Opponent joined · 3D Chess';
    const back = () => {
      if (!document.hidden) document.title = title;
    };
    document.addEventListener('visibilitychange', back);
    return () => {
      document.removeEventListener('visibilitychange', back);
      document.title = title;
    };
  }, [handover]);

  let lobbyView: LobbyStage | null = null;
  if (phase === 'started') {
    if ((handover === 'arrive' || handover === 'leave') && color) {
      const host = wasHost.current;
      lobbyView = {
        beat: handover,
        taken: { white: true, black: true },
        mine: color,
        hover: null,
        toss: null,
        seat: color,
        // The seat that has just filled: the guest's own, or the host's opponent's
        arriving: host ? other(color) : color,
        caption: host ? 'Opponent joined' : `You play ${color === 'white' ? 'White' : 'Black'}`,
        onArrived: () => setArrived(true),
        onReveal: () => setRevealed(true),
        onLeft: () => setHandover('done'),
      };
    }
  } else if (hosting && storedRole) {
    lobbyView = {
      beat: 'wait',
      taken: { [storedRole]: true, [other(storedRole)]: false } as Record<Color, boolean>,
      mine: storedRole,
      card: true,
      hover: null,
      toss: null,
      seat: storedRole,
    };
  } else if (guest && (invitation.state === 'open' || invitation.state === 'joining')) {
    const host = other(invitation.seat);
    const joining = invitation.state === 'joining';
    lobbyView = {
      beat: 'invited',
      // Accepting fills the guest's seat at once, before the server answers
      taken: { [host]: true, [invitation.seat]: joining } as Record<Color, boolean>,
      // Filled at once, on the glass; its light comes on with the host's
      // king's when the game starts
      mine: null,
      // Framed as the host's wait, with "Join game" under the kings; the
      // click eases the camera on as the game gets under way
      card: !joining,
      hover: null,
      toss: null,
      seat: invitation.seat,
    };
  } else if (guest) {
    lobbyView = {
      beat: 'invited',
      taken: { white: false, black: false },
      mine: null,
      card: true,
      hover: null,
      toss: null,
      seat: 'white',
    };
  }
  if (lobbyView && phase !== 'started') lobbyShown.current = true;
  useLobbyView(lobbyView);

  if (phase === 'started') {
    return (
      <GameView
        history={history}
        color={color}
        opponentOnline={opponentOnline}
        reconnecting={status === 'reconnecting'}
        boardDisabled={boardDisabled}
        onMove={handleMove}
        promotionChoices={promotionChoices}
        onChoosePromotion={setPromotionChoices}
        showEndModal={showEndModal}
        replaced={replaced}
        replacedNotice={replacedNotice}
        reconnectingBanner={reconnectingBanner}
        alerts={
          <>
            {errorBanner}
            {replayErrorBanner}
          </>
        }
        // The whole entrance for a game that started while this page was
        // open, a short one for a page that opened on a game under way
        intro={handover !== 'none' ? 'lobby' : startedLive(messages) ? 'full' : 'short'}
        // Held on its first frame while the lobby plays out over it
        introPaused={handover === 'arrive' || (handover === 'leave' && !revealed)}
        onFirstFrame={() => setGameDrawn(true)}
      />
    );
  }

  const acceptInvitation = () => {
    if (!gameId || phase !== 'waiting') return;
    requestJoin({ type: 'join_game', gameId, clientId: getClientId() });
    setJoinRequested(true);
  };

  return (
    <div className="lobby-page" inert={replaced}>
      <header className="lobby-top">
        <button className="lobby-link" onClick={() => navigate('/')}>
          <span aria-hidden>←</span> Home
        </button>
      </header>
      {hosting && storedRole && (
        <SeatLabels labels={{ [storedRole]: 'You', [other(storedRole)]: 'Opponent' }} />
      )}
      {guest && (invitation.state === 'open' || invitation.state === 'joining') && (
        <SeatLabels
          labels={{
            [other(invitation.seat)]: 'Opponent',
            [invitation.seat]: 'You',
          }}
        />
      )}
      {/* The story's line: the side this page plays, or the invitation */}
      {hosting && storedRole && (
        // Continues the side choice's last heading, so it does not rise again
        <div className="lobby-heading" data-still="">
          <h1>You play {storedRole === 'white' ? 'White' : 'Black'}</h1>
          <p className="lobby-heading-wait">
            <span className="hud-dot" aria-hidden />
            Waiting for your friend…
          </p>
        </div>
      )}
      {guest && (invitation.state === 'open' || invitation.state === 'joining') && (
        <div className="lobby-heading">
          <h1 id="invitation-title">
            You're invited to play <Stone color={invitation.seat} />
            {invitation.seat === 'white' ? 'White' : 'Black'}
          </h1>
        </div>
      )}
      {hosting && storedRole ? (
        <InviteCard link={shareLink} seat={storedRole} />
      ) : guest ? (
        <InvitationCard invitation={invitation} connection={status} onAccept={acceptInvitation} />
      ) : (
        // A stored seat, rejoining: a moment
        <p className="lobby-foot" role="status">
          Returning to your game…
        </p>
      )}
      <div className="lobby-status" role="status">
        {reconnectingBanner}
      </div>
      {errorBanner && !['invalid_game', 'game_full'].includes(latestError?.code ?? '') && (
        <div className="lobby-errors">{errorBanner}</div>
      )}
      {replacedNotice}
    </div>
  );
};

export default GameScreen;
