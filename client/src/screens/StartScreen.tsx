import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { WebSocketMessage } from '../types/messages';

interface StartScreenProps {
  gameSocket: {
    send: (msg: WebSocketMessage) => void;
    lastMessage: MessageEvent | null;
  };
  setIsCreator: React.Dispatch<React.SetStateAction<boolean>>;
}

const StartScreen: React.FC<StartScreenProps> = ({ gameSocket, setIsCreator }) => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = React.useState(false);
  const [gameCreated, setGameCreated] = React.useState(false);
  const [gameId, setGameId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const event = gameSocket.lastMessage;
    if (event) {
      const data = JSON.parse(event.data);
      if (data.type === 'game_created' && data.gameId) {
        setIsLoading(false);
        setGameCreated(true);
        setGameId(data.gameId);
      }
    }
  }, [gameSocket.lastMessage, navigate]);

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
      </div>
    </div>
  );
};

export default StartScreen;
