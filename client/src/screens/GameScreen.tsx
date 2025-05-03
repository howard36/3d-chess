import React from 'react';
import { useParams } from 'react-router-dom';
import Board, { BoardTurn } from '../three/Board';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import TurnIndicator from '../three/TurnIndicator';
import { toZXY, fromZXY } from '../engine/coords';
import { Board as EngineBoard } from '../engine';
import { PieceType } from '../engine/pieces';

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
  const [moves, setMoves] = React.useState<
    {
      from: { x: number; y: number; z: number };
      to: { x: number; y: number; z: number };
      promotion?: string;
    }[]
  >([]);
  // Maintain the board state in GameScreen
  const [board, setBoard] = React.useState(() => {
    const b = new EngineBoard();
    EngineBoard.setupStartingPosition(b);
    return b;
  });

  // Apply moves to the board when moves change
  React.useEffect(() => {
    const b = new EngineBoard();
    EngineBoard.setupStartingPosition(b);
    for (const move of moves) {
      let promotion: PieceType | undefined = undefined;
      if (move.promotion) {
        promotion =
          typeof move.promotion === 'string' ? (PieceType as any)[move.promotion] : move.promotion;
      }
      b.applyMove(move.from, move.to, promotion);
    }
    setBoard(b);
    // Print the new list of moves
    console.log('Current moves:', moves);
  }, [moves]);

  // Listen for game_start message
  React.useEffect(() => {
    const event = gameSocket.lastMessage;
    console.log('lastMessage:', event);
    if (event) {
      const parsed = JSON.parse(event.data);
      console.log('parsed before destructuring:', parsed);

      if (parsed.type === 'game_start' && parsed.color) {
        setColor(parsed.color);
        setPhase('started');
      }

      if (parsed.type === 'move_made' && parsed.by && parsed.from && parsed.to) {
        const { from: fromStr, to: toStr, promotion, by } = parsed;
        const parsedMove = {
          from: fromZXY(fromStr),
          to: fromZXY(toStr),
          promotion,
        };
        setMoves((prev) => [...prev, parsedMove]);
        // Use the 'by' field from the server to set the current turn
        setCurrentTurn(by === 'white' ? 'black' : 'white');
      }
    }
  }, [gameSocket.lastMessage]);

  // Send move message on local move
  const handleMove = (move: {
    from: { x: number; y: number; z: number };
    to: { x: number; y: number; z: number };
    promotion?: string;
  }) => {
    if (!gameId) return;
    // Only send move to server; moves will be updated on move_made
    gameSocket.send({
      type: 'move',
      from: toZXY(move.from),
      to: toZXY(move.to),
      promotion: move.promotion, // if any
    });
  };

  // Send join_game when button is clicked
  const handleJoin = () => {
    if (!gameId || phase !== 'waiting') return;
    gameSocket.send({ type: 'join_game', gameId });
    setPhase('joined');
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
          <Board currentTurn={currentTurn} playerColor={color} onMove={handleMove} board={board} />
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
