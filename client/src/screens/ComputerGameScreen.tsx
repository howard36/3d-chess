import React from 'react';
import { useParams } from 'react-router';
import GameScreen from './GameScreen';
import { useComputerGame } from '../hooks/useComputerGame';
import { doneArriving, isArriving, loadComputerGame } from '../lib/computerGames';

// A game against the computer (/computer/:gameId): the game screen, with the
// computer standing in for the server and the opponent. One per game, so
// nothing carries over from one game's page to another's.
const ComputerGameScreen: React.FC = () => {
  const { gameId = '' } = useParams<{ gameId: string }>();
  return <ComputerGame key={gameId} gameId={gameId} />;
};

const ComputerGame: React.FC<{ gameId: string }> = ({ gameId }) => {
  // The computer holds its moves until the game's entrance is over, so its
  // first move as White lands on a board in play, not on one still building
  const [playing, setPlaying] = React.useState(false);
  const socket = useComputerGame(gameId, { hold: !playing });
  // Read once: the side and the level never change in a game. With no game
  // stored under this id, the page says so (as for a game the server has
  // never heard of)
  const [game] = React.useState(() => loadComputerGame(gameId));
  // Opened from its side choice, still on the lobby's stage: the computer's
  // arrival plays there. Once only: a later visit opens on the game itself
  const [arriving] = React.useState(() => isArriving(gameId));
  React.useEffect(() => doneArriving(gameId), [gameId]);
  return (
    <GameScreen
      gameSocket={socket}
      computer={game ? { color: game.color, difficulty: game.difficulty, arriving } : undefined}
      newGamePath="/computer"
      onPlaying={() => setPlaying(true)}
    />
  );
};

export default ComputerGameScreen;
