import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { GameCreated, Error as ServerError } from '../types/messages';
import type { GameSocket } from '../hooks/useGameSocket';

interface StartScreenProps {
  gameSocket: GameSocket;
  setIsCreator: React.Dispatch<React.SetStateAction<boolean>>;
}

const StartScreen: React.FC<StartScreenProps> = ({ gameSocket, setIsCreator }) => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = React.useState(false);

  const gameCreated = gameSocket.messages.find(
    (m): m is GameCreated => m.type === 'game_created',
  );
  const errors = gameSocket.messages.filter((m): m is ServerError => m.type === 'error');
  const latestError = errors.length > 0 ? errors[errors.length - 1] : null;

  React.useEffect(() => {
    if (gameCreated) {
      navigate(`/game/${gameCreated.gameId}`);
    }
  }, [gameCreated, navigate]);

  const handleCreateGame = () => {
    setIsCreator(true);
    setIsLoading(true);
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
      </div>
    </div>
  );
};

export default StartScreen;
