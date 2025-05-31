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

  React.useEffect(() => {
    const event = gameSocket.lastMessage;
    if (event) {
      const data = JSON.parse(event.data);
      if (data.type === 'game_created' && data.gameId) {
        setIsLoading(false);
        navigate(`/game/${data.gameId}`);
      }
    }
  }, [gameSocket.lastMessage, navigate]);

  const handleCreateGame = () => {
    setIsCreator(true);
    setIsLoading(true);
    gameSocket.send({ type: 'create_game' });
  };

  return (
    <div>
      <h1>3D Chess</h1>
      <button onClick={handleCreateGame} disabled={isLoading}>
        {isLoading ? 'Creating Game...' : 'Start New Game'}
      </button>
    </div>
  );
};

export default StartScreen;
