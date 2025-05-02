import React from 'react';
import { useParams } from 'react-router-dom';

interface GameScreenProps {
  gameSocket: {
    send: (msg: any) => void;
    lastMessage: React.RefObject<MessageEvent | null>;
  };
  isCreator: boolean;
}

const GameScreen: React.FC<GameScreenProps> = ({ gameSocket, isCreator }) => {
  const { gameId } = useParams<{ gameId: string }>();

  // For now, always in waiting phase (before game start)
  const waitingPhase = true;

  return (
    <div>
      <h1>Game Screen</h1>
      <p>Game ID: {gameId}</p>
      <p>You are the creator: {isCreator ? 'true' : 'false'}</p>
      {waitingPhase &&
        (isCreator ? (
          <p>Waiting for player to join...</p>
        ) : (
          <button disabled={false}>Join Game</button>
        ))}
    </div>
  );
};

export default GameScreen;
