import React from 'react';
import { useParams } from 'react-router-dom';
import Board, { BoardTurn, ServerPromotionType } from '../three/Board';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import TurnIndicator from '../three/TurnIndicator';
import { toZXY, fromZXY } from '../engine/coords';
import { Board as EngineBoard, Move } from '../engine';
import { PieceType } from '../engine/pieces';
import EndGameModal from './EndGameModal';

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
  const [moves, setMoves] = React.useState<Move[]>([]);
  const [gameOver, setGameOver] = React.useState<null | {
    result: 'checkmate' | 'stalemate';
    winner?: 'white' | 'black';
  }>(null);
  // Maintain the board state in GameScreen
  const [board, setBoard] = React.useState(() => {
    return EngineBoard.setupStartingPosition();
  });

  // Apply moves to the board when moves change
  React.useEffect(() => {
    let b = EngineBoard.setupStartingPosition();
    for (const move of moves) {
      b = b.applyMove(move);
    }
    setBoard(b);
    // Print the new list of moves
    console.log('Current moves:', moves);
    // Check for checkmate/stalemate after move
    // The player who just moved is (moves.length % 2 === 0 ? 'black' : 'white')
    // The *other* player is the one whose turn it now is:
    const nextTurn = moves.length % 2 === 0 ? 'white' : 'black';
    if (b.isCheckmate(nextTurn)) {
      setGameOver({ result: 'checkmate', winner: moves.length % 2 === 0 ? 'black' : 'white' });
    } else if (b.isStalemate(nextTurn)) {
      setGameOver({ result: 'stalemate' });
    } else {
      setGameOver(null);
    }
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
        const parsedMove: Move = {
          from: fromZXY(fromStr),
          to: fromZXY(toStr),
          // TODO: Handle promotion string from server properly
          promotion: promotion ? PieceType[promotion as keyof typeof PieceType] : undefined,
        };
        setMoves((prev) => [...prev, parsedMove]);
        // Use the 'by' field from the server to set the current turn
        setCurrentTurn(by === 'white' ? 'black' : 'white');
      }
    }
  }, [gameSocket.lastMessage]);

  // Send move message on local move
  const handleMove = (move: Move) => {
    if (!gameId) return;
    // Only send move to server; moves will be updated on move_made
    gameSocket.send({
      type: 'move',
      from: toZXY(move.from),
      to: toZXY(move.to),
      promotion: move.promotion
        ? (move.promotion.toString()[0].toUpperCase() as ServerPromotionType)
        : undefined, // if any
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
              top: '10px',
              left: '10px',
              padding: '10px',
              backgroundColor: 'rgba(0,0,0,0.7)',
              color: 'white',
              borderRadius: '5px',
              zIndex: 1000, // Ensure it's above the canvas
            }}
          >
            You are playing as {color}.
          </div>
        )}
        {/* Turn indicator */}
        <TurnIndicator turn={currentTurn} />
        {/* Main 3D Board canvas */}
        <Canvas data-testid="r3f-canvas" style={{ height: '100%', width: '100%' }}>
          <ambientLight intensity={Math.PI / 2} />
          <spotLight
            position={[10, 10, 10]}
            angle={0.15}
            penumbra={1}
            decay={0}
            intensity={Math.PI}
          />
          <pointLight position={[-10, -10, -10]} decay={0} intensity={Math.PI} />
          <Board
            board={board} // Pass the EngineBoard instance
            currentTurn={currentTurn}
            playerColor={color} // Pass the determined player color
            onMove={handleMove}
          />
          <OrbitControls makeDefault />
        </Canvas>
        {/* End Game Modal */}
        {gameOver && <EndGameModal result={gameOver.result} winner={gameOver.winner} />}
      </div>
    );
  }

  // UI for waiting/joining phase
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
      }}
    >
      <h1>3D Chess</h1>
      <p>Game ID: {gameId}</p>
      {phase === 'waiting' && !isCreator && <button onClick={handleJoin}>Join Game</button>}
      {phase === 'waiting' && isCreator && <p>Waiting for player to join...</p>}
      {phase === 'joined' && <p>Joined game, waiting for start...</p>}
    </div>
  );
};

export default GameScreen;
