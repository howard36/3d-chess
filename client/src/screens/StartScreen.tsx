import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { GameCreated, Error as ServerError } from '../types/messages';
import type { GameSocket } from '../hooks/useGameSocket';
import { setStoredRole } from '../lib/playerRole';
import { getClientId } from '../lib/clientId';
import { useResendOnReconnect } from '../hooks/useResendOnReconnect';
import { prefersReducedMotion } from '../three/motion';
import { LandingPreview } from './LandingPreview';
import { PieceGlyph } from './PieceGlyph';
import { PieceType } from '../engine/pieces';

interface StartScreenProps {
  gameSocket: GameSocket;
}

const StartScreen: React.FC<StartScreenProps> = ({ gameSocket }) => {
  const navigate = useNavigate();
  const { messages, status } = gameSocket;
  // Index into the message log at which this screen sent create_game, or
  // null before the button is clicked. Only messages from there on are the
  // reply to *this* request: when "Start new game" brings a player back here
  // from a finished game, the log still holds that game's game_created for
  // the first render (App resets the session in an effect, which runs after
  // this screen's), and reacting to it would navigate straight back into the
  // old game.
  const [requestIndex, setRequestIndex] = React.useState<number | null>(null);
  const replies = requestIndex === null ? [] : messages.slice(requestIndex);

  const gameCreated = replies.find((m): m is GameCreated => m.type === 'game_created');
  const errors = replies.filter((m): m is ServerError => m.type === 'error');
  const latestError = errors.length > 0 ? errors[errors.length - 1] : null;
  // A server error is the reply to the create request; let the user try again.
  const isLoading = requestIndex !== null && !gameCreated && !latestError;

  React.useEffect(() => {
    if (gameCreated) {
      // Persist the role as soon as the server assigns it, so the creator can
      // leave and rejoin this game later.
      setStoredRole(gameCreated.gameId, gameCreated.color);
      navigate(`/game/${gameCreated.gameId}`);
    }
  }, [gameCreated, navigate]);

  // If the connection drops before the answer, ask again on the next one
  // rather than leave the button stuck at "Creating game…".
  const requestGame = useResendOnReconnect(gameSocket, !isLoading);

  const handleCreateGame = () => {
    // Held (aria-disabled, not disabled, so a keyboard player keeps their
    // place) while the request is answered
    if (isLoading) return;
    setRequestIndex(messages.length);
    requestGame({ type: 'create_game', clientId: getClientId() });
  };

  const [paused, setPaused] = React.useState(false);
  const still = useReducedMotion();

  // Nothing is written under the button: what the request is waiting on is
  // its label (the connection, then the game), and an error answering it
  // turns it to "Try again", the message itself said to a screen reader and
  // kept in the button's tooltip.
  const waitingOnSocket = isLoading && status !== 'connected';
  const label = !isLoading
    ? latestError
      ? 'Try again'
      : 'Start a game'
    : waitingOnSocket
      ? status === 'reconnecting'
        ? 'Reconnecting…'
        : 'Connecting…'
      : 'Creating game…';

  return (
    <main className="landing" data-testid="landing">
      <LandingPreview paused={paused} still={still} />
      <p className="sr-only">
        Preview: a sample game plays itself on the five-level tower and ends in checkmate by White.
      </p>
      <div className="landing-scrim" aria-hidden="true" />
      <header className="landing-head">
        <h1>3D Chess</h1>
      </header>
      <div className="landing-foot">
        {/* Not held while the socket connects: the request is queued and
            sent when it opens (useResendOnReconnect) */}
        <button
          className="landing-play"
          onClick={handleCreateGame}
          aria-disabled={isLoading || undefined}
          aria-busy={isLoading || undefined}
          title={latestError ? `Couldn't start a game: ${latestError.message}` : undefined}
        >
          <span className="landing-play-piece" aria-hidden>
            {isLoading ? (
              <span className="hud-dot" />
            ) : (
              <PieceGlyph type={PieceType.Knight} color="black" size={24} />
            )}
          </span>
          {label}
        </button>
        {/* Said, not shown */}
        <p role="alert" className="sr-only">
          {latestError ? `Couldn't start a game: ${latestError.message}` : ''}
        </p>
        <p role="status" className="sr-only">
          {waitingOnSocket
            ? status === 'reconnecting'
              ? 'Reconnecting to server…'
              : 'Connecting to server…'
            : ''}
        </p>
      </div>
      {/* The preview moves on its own for more than five seconds, beside the
          page's controls: it can be stopped (nothing moves for a player who
          asked for less motion, so there is nothing to stop) */}
      {!still && (
        <button
          className="landing-pause hud-glass"
          aria-label="Pause preview"
          aria-pressed={paused}
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? (
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M4.5 2.8v10.4L13 8z" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <rect x="3.5" y="2.8" width="3" height="10.4" rx="0.6" fill="currentColor" />
              <rect x="9.5" y="2.8" width="3" height="10.4" rx="0.6" fill="currentColor" />
            </svg>
          )}
        </button>
      )}
    </main>
  );
};

/** Whether the player asked their system for less motion, following a change while the page is open. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(prefersReducedMotion);
  React.useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

export default StartScreen;
