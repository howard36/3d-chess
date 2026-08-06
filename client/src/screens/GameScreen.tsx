import React from 'react';
import { useParams } from 'react-router-dom';
import Board, { BoardTurn } from '../three/Board';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import TurnIndicator from '../three/TurnIndicator';
import { Board as EngineBoard, Move } from '../engine';
import { moveFromMessage, moveToMessage } from '../engine/protocol';
import EndGameModal from './EndGameModal';
import type { GameStart, MoveMade, Error as ServerError } from '../types/messages';
import type { GameSocket } from '../hooks/useGameSocket';

interface GameScreenProps {
  gameSocket: GameSocket;
  isCreator: boolean;
}

type Phase = 'waiting' | 'joined' | 'started';

const GameScreen: React.FC<GameScreenProps> = ({ gameSocket, isCreator }) => {
  const { gameId } = useParams<{ gameId: string }>();
  // Whether this client has sent join_game (creator never does)
  const [joinRequested, setJoinRequested] = React.useState(false);
  // Errors the user has already dismissed (by count, since the log is append-only)
  const [dismissedErrorCount, setDismissedErrorCount] = React.useState(0);

  const messages = gameSocket.messages;

  // --- All game state is derived from the message log ---
  const gameStart = React.useMemo(
    () => messages.find((m): m is GameStart => m.type === 'game_start'),
    [messages],
  );
  const color = gameStart?.color ?? null;

  const moves: Move[] = React.useMemo(
    () => messages.filter((m): m is MoveMade => m.type === 'move_made').map(moveFromMessage),
    [messages],
  );

  const board = React.useMemo(() => {
    let b = EngineBoard.setupStartingPosition();
    for (const move of moves) {
      b = b.applyMove(move);
    }
    return b;
  }, [moves]);

  // White moves first; turn alternates with each applied move
  const currentTurn: BoardTurn = moves.length % 2 === 0 ? 'white' : 'black';

  const gameOver = React.useMemo((): null | {
    result: 'checkmate' | 'stalemate';
    winner?: 'white' | 'black';
  } => {
    if (board.isCheckmate(currentTurn)) {
      return { result: 'checkmate', winner: currentTurn === 'white' ? 'black' : 'white' };
    }
    if (board.isStalemate(currentTurn)) {
      return { result: 'stalemate' };
    }
    return null;
  }, [board, currentTurn]);

  const errors = React.useMemo(
    () => messages.filter((m): m is ServerError => m.type === 'error'),
    [messages],
  );
  const latestError = errors.length > dismissedErrorCount ? errors[errors.length - 1] : null;

  // A failed join (bad game id, game full) returns the user to the join button
  React.useEffect(() => {
    if (
      joinRequested &&
      !gameStart &&
      errors.some((e) => e.code === 'invalid_game' || e.code === 'game_full')
    ) {
      setJoinRequested(false);
    }
  }, [errors, gameStart, joinRequested]);

  const phase: Phase = gameStart ? 'started' : joinRequested ? 'joined' : 'waiting';

  // Send move message on local move
  const handleMove = (move: Move) => {
    if (!gameId) return;
    // Only send move to server; the board updates when move_made comes back
    gameSocket.send(moveToMessage(move));
  };

  // Send join_game when button is clicked
  const handleJoin = () => {
    if (!gameId || phase !== 'waiting') return;
    gameSocket.send({ type: 'join_game', gameId });
    setJoinRequested(true);
  };

  const errorBanner = latestError && (
    <div
      role="alert"
      style={{
        position: 'absolute',
        bottom: '16px',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '10px 16px',
        backgroundColor: 'rgba(180,30,30,0.92)',
        color: 'white',
        borderRadius: '8px',
        zIndex: 1001,
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
      }}
    >
      <span>Error: {latestError.message}</span>
      <button
        onClick={() => setDismissedErrorCount(errors.length)}
        aria-label="Dismiss error"
        style={{ fontWeight: 700, background: 'none', border: 'none', color: 'white' }}
      >
        ✕
      </button>
    </div>
  );

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
        {errorBanner}
        {/* End Game Modal */}
        {gameOver && <EndGameModal result={gameOver.result} winner={gameOver.winner} />}
      </div>
    );
  }

  // UI for waiting/joining phase
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-8">
      <div className="text-center flex flex-col items-center gap-8">
        <h1 className="text-6xl font-bold text-white tracking-wide">3D Chess</h1>
        {phase === 'waiting' && !isCreator && (
          <button
            onClick={handleJoin}
            className="py-3 px-6 text-2xl font-semibold text-gray-900 bg-white rounded-xl hover:bg-gray-100 focus:outline-none focus:ring-4 focus:ring-blue-500 focus:ring-opacity-50 transition-all duration-200 transform hover:scale-105"
          >
            Join Game
          </button>
        )}
        {phase === 'waiting' && isCreator && (
          <div className="text-center">
            <p className="text-xl mb-4">Game created! Share this link with a friend:</p>
            <p className="text-2xl font-bold bg-gray-800 px-4 py-2 rounded-lg">
              {window.location.origin}/game/{gameId}
            </p>
          </div>
        )}
        {phase === 'joined' && <p className="text-xl">Joined game, waiting for start...</p>}
      </div>
      {errorBanner}
    </div>
  );
};

export default GameScreen;
