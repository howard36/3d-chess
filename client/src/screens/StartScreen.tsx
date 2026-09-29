import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { GameCreated, Error as ServerError } from '../types/messages';
import type { GameSocket } from '../hooks/useGameSocket';
import { setStoredRole } from '../lib/playerRole';
import { getClientId } from '../lib/clientId';
import { useResendOnReconnect } from '../hooks/useResendOnReconnect';
import { prefersReducedMotion } from '../three/motion';
import { cachedImport } from '../lib/cachedImport';
import { PieceGlyph } from './PieceGlyph';
import { PieceType } from '../engine/pieces';

// The preview (three.js, the scene, a demo game) is a chunk of its own,
// asked for at once, so the page's title and button show without waiting
// for it; the preview appears where it stands once it has loaded
const loadPreview = cachedImport(() => import('./LandingPreview'));
const LandingPreview = React.lazy(() => loadPreview().then((m) => ({ default: m.LandingPreview })));

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
      <React.Suspense fallback={null}>
        <LandingPreview still={still} />
      </React.Suspense>
      <p className="sr-only">
        Preview: a sample game plays itself on the five-level tower and ends in checkmate by White.
      </p>
      <div className="landing-scrim" aria-hidden="true" />
      <header className="landing-head">
        <h1>3D Chess</h1>
      </header>
      <div className="landing-foot">
        {/* Can be pressed before the socket opens: the request is queued
            and sent when it does (useResendOnReconnect), the button held
            meanwhile */}
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
