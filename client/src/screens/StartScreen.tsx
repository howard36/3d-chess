import React from 'react';
import { useNavigate } from 'react-router-dom';

// Placeholder for API call
const createGameApi = async (): Promise<{ gameId: string }> => {
  // Simulate API call delay
  await new Promise((resolve) => setTimeout(resolve, 500));
  // In a real app, this would be: fetch('/api/games', { method: 'POST' }).then(res => res.json())
  const gameId = `game_${Math.random().toString(36).substring(2, 9)}`;
  console.log(`Simulated game creation, ID: ${gameId}`);
  return { gameId };
};

const StartScreen: React.FC = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = React.useState(false);

  const handleCreateGame = async () => {
    setIsLoading(true);
    try {
      const { gameId } = await createGameApi();
      navigate(`/game/${gameId}`);
    } catch (error) {
      console.error('Failed to create game:', error);
      // Handle error appropriately, maybe show a message to the user
      setIsLoading(false);
    }
    // No need to set isLoading false on success as we navigate away
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
