import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { GameCreated, Error as ServerError } from '../types/messages';
import type { GameSocket } from '../hooks/useGameSocket';
import { setStoredRole } from '../lib/playerRole';
import { getClientId } from '../lib/clientId';
import { useResendOnReconnect } from '../hooks/useResendOnReconnect';
import { prefersReducedMotion } from '../three/motion';
import { LandingPreview } from './LandingPreview';

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
    setRequestIndex(messages.length);
    requestGame({ type: 'create_game', clientId: getClientId() });
  };

  const [paused, setPaused] = React.useState(false);
  const still = useReducedMotion();
  // The preview's game stands finished: the slot names the result
  const [demoEnded, setDemoEnded] = React.useState(false);

  // One line under the button: an error answering this request, else the
  // connection's state, else the preview's result while its mate stands (the
  // mated king is small, far up the tower), else a few facts about the game.
  // One slot, so the band under the tower never grows.
  let note: React.ReactNode;
  if (latestError) {
    note = (
      <p role="alert" className="landing-note landing-error">
        Couldn't start a game: {latestError.message}
      </p>
    );
  } else if (status !== 'connected') {
    note = (
      <p role="status" className="landing-note landing-status">
        <span className="hud-dot" aria-hidden />
        {status === 'reconnecting' ? 'Reconnecting to server…' : 'Connecting to server…'}
      </p>
    );
  } else if (demoEnded) {
    // Part of the preview, which the page's text description already tells
    note = (
      <p className="landing-note landing-facts landing-result" aria-hidden="true">
        Checkmate · White wins
      </p>
    );
  } else {
    note = <p className="landing-note landing-facts">5×5×5 · 125 squares · No sign-up</p>;
  }

  return (
    <main className="landing" data-testid="landing">
      <LandingPreview paused={paused} still={still} onEnded={setDemoEnded} />
      <p className="sr-only">
        Preview: a sample game plays itself on the five-level tower and ends in checkmate by White.
      </p>
      <div className="landing-scrim" aria-hidden="true" />
      <header className="landing-head">
        <h1>3D Chess</h1>
        <p className="landing-tagline">Five stacked boards. One link to play a friend.</p>
      </header>
      <div className="landing-foot">
        {/* Not disabled while the socket connects: the request is queued
            and sent when it opens (useResendOnReconnect) */}
        <button
          className="landing-play"
          onClick={handleCreateGame}
          disabled={isLoading}
          aria-busy={isLoading || undefined}
        >
          {isLoading && <span className="hud-dot" aria-hidden />}
          {isLoading ? 'Creating game…' : 'Start a game'}
        </button>
        {note}
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
