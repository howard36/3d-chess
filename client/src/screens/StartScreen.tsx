import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { GameCreated, Error as ServerError } from '../types/messages';
import type { GameSocket } from '../hooks/useGameSocket';
import { setStoredRole } from '../lib/playerRole';

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

  const handleCreateGame = () => {
    setRequestIndex(messages.length);
    gameSocket.send({ type: 'create_game' });
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-8">
      <div className="text-center flex flex-col items-center gap-8">
        <h1 className="text-6xl font-bold text-white tracking-wide">3D Chess</h1>
        <button
          onClick={handleCreateGame}
          disabled={isLoading}
          className="py-3 px-6 text-2xl font-semibold text-gray-900 bg-white rounded-xl hover:bg-gray-100 focus:outline-none focus:ring-4 focus:ring-blue-500 focus:ring-opacity-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-105"
        >
          {isLoading ? 'Creating Game...' : 'Start New Game'}
        </button>
        {latestError && (
          <p role="alert" className="text-red-400 text-lg">
            Error: {latestError.message}
          </p>
        )}
        {status !== 'connected' && (
          <p role="status" className="text-gray-400 text-lg">
            {status === 'reconnecting' ? 'Reconnecting to server…' : 'Connecting to server…'}
          </p>
        )}
      </div>
    </div>
  );
};

export default StartScreen;
