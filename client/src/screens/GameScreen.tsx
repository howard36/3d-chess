import React from 'react';
import { useParams } from 'react-router-dom';
import Board, { BoardTurn } from '../three/Board';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import TurnIndicator from '../three/TurnIndicator';
import { Board as EngineBoard, Move } from '../engine';
import { moveFromMessage, moveToMessage } from '../engine/protocol';
import EndGameModal from './EndGameModal';
import type { GameStart, GameState, MoveMade, Error as ServerError } from '../types/messages';
import type { GameSocket } from '../hooks/useGameSocket';
import { getStoredRole, setStoredRole, clearStoredRole } from '../lib/playerRole';
import { theme } from '../three/theme';

interface GameScreenProps {
  gameSocket: GameSocket;
}

type Phase = 'waiting' | 'joined' | 'started';

const GameScreen: React.FC<GameScreenProps> = ({ gameSocket }) => {
  const { gameId } = useParams<{ gameId: string }>();
  // Whether this client has sent join_game (players with a stored role never do)
  const [joinRequested, setJoinRequested] = React.useState(false);
  // Errors the user has already dismissed (by count, since the log is append-only)
  const [dismissedErrorCount, setDismissedErrorCount] = React.useState(0);
  // Render mirror of the persisted role; localStorage is the source of truth
  const [storedRole, setStoredRoleState] = React.useState(() =>
    gameId ? getStoredRole(gameId) : null,
  );
  // Guards the auto-rejoin so it fires at most once per game page
  const rejoinSentRef = React.useRef(false);

  React.useEffect(() => {
    // Re-sync when the route's gameId changes (a different game's page)
    setStoredRoleState(gameId ? getStoredRole(gameId) : null);
    rejoinSentRef.current = false;
  }, [gameId]);

  const messages = gameSocket.messages;

  // --- All game state is derived from the message log ---
  const gameStart = React.useMemo(
    () => messages.find((m): m is GameStart => m.type === 'game_start'),
    [messages],
  );
  // A game_state reply (rejoin) carries the same role/history information a
  // live session accumulates from game_start + move_made messages.
  const gameState = React.useMemo(
    () => messages.find((m): m is GameState => m.type === 'game_state'),
    [messages],
  );
  const color = gameStart?.color ?? gameState?.color ?? null;

  const moves: Move[] = React.useMemo(
    () =>
      [
        ...(gameState?.moves ?? []),
        ...messages.filter((m): m is MoveMade => m.type === 'move_made'),
      ].map(moveFromMessage),
    [messages, gameState],
  );

  // Rejoin on page load: with a stored role and no session in the log (a fresh
  // socket, unlike the creator arriving from StartScreen with game_created
  // already present), reclaim the seat and let the server replay history.
  React.useEffect(() => {
    if (rejoinSentRef.current || !gameId || !storedRole) return;
    const hasSession = messages.some(
      (m) => m.type === 'game_created' || m.type === 'game_start' || m.type === 'game_state',
    );
    if (hasSession) return;
    rejoinSentRef.current = true;
    gameSocket.send({ type: 'rejoin_game', gameId, color: storedRole });
  }, [gameId, storedRole, messages, gameSocket]);

  // The joiner learns their role from game_start; persist it immediately so
  // they can rejoin later (idempotent for a creator who already stored it).
  React.useEffect(() => {
    if (gameId && gameStart) {
      setStoredRole(gameId, gameStart.color);
      setStoredRoleState(gameStart.color);
    }
  }, [gameId, gameStart]);

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

  // A failed rejoin means the stored role is stale (the game expired or the
  // seat was never claimed): forget it and fall back to the join button.
  React.useEffect(() => {
    if (
      gameId &&
      storedRole &&
      !gameStart &&
      !gameState &&
      errors.some((e) => e.code === 'invalid_rejoin' || e.code === 'invalid_game')
    ) {
      clearStoredRole(gameId);
      setStoredRoleState(null);
    }
  }, [errors, gameId, storedRole, gameStart, gameState]);

  const phase: Phase =
    gameStart || gameState?.started ? 'started' : joinRequested ? 'joined' : 'waiting';

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
        <Canvas
          data-testid="r3f-canvas"
          style={{ height: '100%', width: '100%' }}
          camera={{ position: [6.5, 5, 8.5], fov: 40 }}
        >
          <color attach="background" args={[theme.background]} />
          {/* Fog matched to the background gently fades the far side of the
              lattice, giving a depth cue the flat grid lines can't */}
          <fog attach="fog" args={[theme.background, 10, 26]} />
          <hemisphereLight args={['#f5f7fb', '#46506b', 1.1]} />
          <directionalLight position={[6, 10, 6]} intensity={2.2} />
          <directionalLight position={[-6, -4, -8]} intensity={1.0} color="#dfe6f2" />
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
        {phase === 'waiting' && !storedRole && (
          <button
            onClick={handleJoin}
            className="py-3 px-6 text-2xl font-semibold text-gray-900 bg-white rounded-xl hover:bg-gray-100 focus:outline-none focus:ring-4 focus:ring-blue-500 focus:ring-opacity-50 transition-all duration-200 transform hover:scale-105"
          >
            Join Game
          </button>
        )}
        {phase === 'waiting' && storedRole && (
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
