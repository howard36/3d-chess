import React from 'react';
import { useParams } from 'react-router-dom';
import Board, { BoardTurn } from '../three/Board';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import TurnIndicator from '../three/TurnIndicator';

interface GameScreenProps {
  gameSocket: {
    send: (msg: any) => void;
    lastMessage: MessageEvent | null;
  };
  isCreator: boolean;
}

type PlayerColor = 'white' | 'black' | null;

type Phase = 'waiting' | 'joined' | 'started';

const GameScreen: React.FC<GameScreenProps> = ({ gameSocket, isCreator }) => {
  const { gameId } = useParams<{ gameId: string }>();
  const [phase, setPhase] = React.useState<Phase>('waiting');
  const [color, setColor] = React.useState<PlayerColor>(null);
  const [currentTurn, setCurrentTurn] = React.useState<BoardTurn>('white');
  const [joinSent, setJoinSent] = React.useState(false);

  // Listen for game_start message
  React.useEffect(() => {
    const event = gameSocket.lastMessage;
    if (event) {
      const data = JSON.parse(event.data);
      if (data.type === 'game_start' && data.color) {
        setColor(data.color);
        setPhase('started');
      }
    }
  }, [gameSocket.lastMessage]);

  // TODO: Listen for move_made messages to update currentTurn

  // Send join_game when button is clicked
  const handleJoin = () => {
    if (!gameId || joinSent) return;
    gameSocket.send({ type: 'join_game', gameId });
    setPhase('joined');
    setJoinSent(true);
  };

  // Render only Canvas and TurnIndicator when game starts
  if (phase === 'started') {
    return (
      <div style={{ position: 'relative', height: '100vh', width: '100vw' }}>
        {/* Player color indicator */}
        {color && (
          <div
            style={{
              position: 'absolute',
              top: 56,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(255,255,255,0.85)',
              color: 'black',
              padding: '4px 16px',
              borderRadius: 8,
              fontWeight: 500,
              fontSize: 16,
              zIndex: 10,
              pointerEvents: 'none',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              border: color === 'white' ? '2px solid #eee' : '2px solid #222',
            }}
            data-testid="player-color-indicator"
          >
            {`You are ${color}`}
          </div>
        )}
        <TurnIndicator turn={currentTurn} />
        <Canvas data-testid="r3f-canvas" style={{ height: '100%', width: '100%' }}>
          <ambientLight intensity={0.5} />
          <pointLight position={[10, 10, 10]} />
          <Board currentTurn={currentTurn} onTurnChange={setCurrentTurn} playerColor={color} />
          <OrbitControls makeDefault />
        </Canvas>
      </div>
    );
  }

  // Render pre-game info otherwise
  return (
    <div>
      <h1>Game Screen</h1>
      <p>Game ID: {gameId}</p>
      <p>You are the creator: {isCreator ? 'true' : 'false'}</p>
      {phase === 'waiting' &&
        (isCreator ? (
          <p>Waiting for player to join...</p>
        ) : (
          <button onClick={handleJoin} disabled={phase !== 'waiting'}>
            Join Game
          </button>
        ))}
      {phase === 'joined' && !isCreator && <p>Joining game...</p>}
    </div>
  );
};

export default GameScreen;
