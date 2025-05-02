import React from 'react';
import { useParams } from 'react-router-dom';

interface GameScreenProps {
  gameSocket: {
    send: (msg: any) => void;
    lastMessage: React.RefObject<MessageEvent | null>;
  };
}

const GameScreen: React.FC<GameScreenProps> = ({ gameSocket }) => {
  const { gameId } = useParams<{ gameId: string }>();

  return (
    <div>
      <h1>Game Screen</h1>
      <p>Game ID: {gameId}</p>
      {/* Placeholder for the actual game board */}
      <div data-testid="empty-board">Empty Board Placeholder</div>
    </div>
  );
};

export default GameScreen;
