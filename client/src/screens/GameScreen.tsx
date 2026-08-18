import React from 'react';
import { useParams } from 'react-router-dom';
import Board, { BoardTurn, LastMoveInfo } from '../three/Board';
import { Canvas } from '@react-three/fiber';
import type { RootState } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import TurnIndicator from '../three/TurnIndicator';
import { Board as EngineBoard, Move } from '../engine';
import { moveFromMessage, moveToMessage } from '../engine/protocol';
import EndGameModal from './EndGameModal';
import MoveList from './MoveList';
import type {
  GameStart,
  GameState,
  MoveMade,
  Error as ServerError,
} from '../types/messages';
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
  // The socket session a rejoin_game was last sent on, so each fresh socket
  // (page load or mid-game reconnect) rejoins at most once.
  const rejoinSessionRef = React.useRef(0);

  React.useEffect(() => {
    // Re-sync when the route's gameId changes (a different game's page)
    setStoredRoleState(gameId ? getStoredRole(gameId) : null);
    rejoinSessionRef.current = 0;
  }, [gameId]);

  const { messages, sessionId, sessionStartIndex, status } = gameSocket;

  // --- All game state is derived from the message log ---
  const gameStart = React.useMemo(
    () => messages.find((m): m is GameStart => m.type === 'game_start'),
    [messages],
  );
  // A game_state reply (rejoin) carries the same role/history information a
  // live session accumulates from game_start + move_made messages. The LAST
  // game_state wins: every reconnect replays the full history in a fresh
  // snapshot that supersedes earlier ones, and only move_made messages after
  // it are new — counting earlier ones again would duplicate moves.
  const { gameState, moveRecords } = React.useMemo(() => {
    let lastStateIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].type === 'game_state') {
        lastStateIndex = i;
        break;
      }
    }
    const state = lastStateIndex >= 0 ? (messages[lastStateIndex] as GameState) : undefined;
    const tail = messages
      .slice(lastStateIndex + 1)
      .filter((m): m is MoveMade => m.type === 'move_made');
    return { gameState: state, moveRecords: [...(state?.moves ?? []), ...tail] };
  }, [messages]);
  const color = gameStart?.color ?? gameState?.color ?? null;

  // Rejoin whenever a socket session opens without a server-side seat: on page
  // load with a stored role, and again after every mid-game reconnect (the
  // server forgets a socket the moment it drops). The creator arriving from
  // StartScreen is the exception — their session already has game_created.
  React.useEffect(() => {
    if (!gameId || !storedRole || sessionId === 0) return;
    if (rejoinSessionRef.current === sessionId) return;
    const hasSession = messages
      .slice(sessionStartIndex)
      .some(
        (m) => m.type === 'game_created' || m.type === 'game_start' || m.type === 'game_state',
      );
    if (hasSession) return;
    rejoinSessionRef.current = sessionId;
    gameSocket.send({ type: 'rejoin_game', gameId, color: storedRole });
  }, [gameId, storedRole, messages, sessionId, sessionStartIndex, gameSocket]);

  // The joiner learns their role from game_start; persist it immediately so
  // they can rejoin later (idempotent for a creator who already stored it).
  React.useEffect(() => {
    if (gameId && gameStart) {
      setStoredRole(gameId, gameStart.color);
      setStoredRoleState(gameStart.color);
    }
  }, [gameId, gameStart]);

  // Replay the move log defensively: the server validates shape and turn
  // order but not legality, so a buggy or version-skewed client can have
  // written a move this engine can't apply. Stopping at the first bad move
  // (instead of throwing mid-render) keeps the game viewable at the last
  // good position rather than white-screening both players forever.
  //
  // prevBoard tracks the position before the most recently *applied* move
  // (not necessarily the last record): it only advances alongside a
  // successful applyMove, so on a mid-replay failure it still holds the
  // board before the last good move rather than collapsing to `board`.
  const { board, prevBoard, replayFailedAt } = React.useMemo(() => {
    let b = EngineBoard.setupStartingPosition();
    let beforeLastApplied = b;
    for (let i = 0; i < moveRecords.length; i++) {
      const before = b;
      try {
        b = b.applyMove(moveFromMessage(moveRecords[i]));
        beforeLastApplied = before;
      } catch {
        return { board: b, prevBoard: beforeLastApplied, replayFailedAt: i };
      }
    }
    return { board: b, prevBoard: beforeLastApplied, replayFailedAt: null };
  }, [moveRecords]);

  // White moves first; turn alternates with each *applied* move, so a frozen
  // board's indicator matches the position actually shown.
  const appliedMoveCount = replayFailedAt ?? moveRecords.length;
  const currentTurn: BoardTurn = appliedMoveCount % 2 === 0 ? 'white' : 'black';

  // The most recent applied move, for the board's highlight/animation and the
  // captured-piece ghost. moveRecords[appliedMoveCount - 1] is always one of
  // the records the replay above already applied successfully, so converting
  // it again here can't throw.
  const lastMoveInfo = React.useMemo<LastMoveInfo | undefined>(() => {
    if (appliedMoveCount === 0) return undefined;
    const move = moveFromMessage(moveRecords[appliedMoveCount - 1]);
    return { move, moveCount: appliedMoveCount, capturedPiece: prevBoard.getPiece(move.to) };
  }, [moveRecords, appliedMoveCount, prevBoard]);

  const gameOver = React.useMemo((): null | {
    result: 'checkmate' | 'stalemate';
    winner?: 'white' | 'black';
  } => {
    if (replayFailedAt !== null) return null;
    if (board.isCheckmate(currentTurn)) {
      return { result: 'checkmate', winner: currentTurn === 'white' ? 'black' : 'white' };
    }
    if (board.isStalemate(currentTurn)) {
      return { result: 'stalemate' };
    }
    return null;
  }, [board, currentTurn, replayFailedAt]);

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

  // Send move message on local move. While disconnected the board is a frozen
  // snapshot, so a move made against it is not sent (the Board is disabled
  // too — this is the backstop).
  const handleMove = (move: Move) => {
    if (!gameId || status !== 'connected') return;
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

  const reconnectingBanner = status === 'reconnecting' && (
    <div
      role="status"
      style={{
        position: 'absolute',
        top: '10px',
        right: '10px',
        padding: '8px 14px',
        backgroundColor: 'rgba(200,140,20,0.92)',
        color: 'white',
        borderRadius: '8px',
        fontWeight: 600,
        zIndex: 1001,
      }}
    >
      Reconnecting…
    </div>
  );

  // Not dismissible: the game record itself is broken, and every reload will
  // hit the same move. Everything before it stays viewable.
  const replayErrorBanner = replayFailedAt !== null && (
    <div
      role="alert"
      style={{
        position: 'absolute',
        top: '60px',
        left: '50%',
        transform: 'translateX(-50%)',
        maxWidth: '480px',
        padding: '10px 16px',
        backgroundColor: 'rgba(180,30,30,0.92)',
        color: 'white',
        borderRadius: '8px',
        zIndex: 1001,
        textAlign: 'center',
      }}
    >
      Move {replayFailedAt + 1} in this game's history is not a legal move for this client
      (likely an app version mismatch). The board is frozen at the position before it.
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
        <MoveList moves={moveRecords} />
        {/* Main 3D Board canvas */}
        {/* Camera sits mostly on +Z (up and to the right), so the whole 5x5x5
            cube is in frame, the viewing player's levels stay nearest, and the
            depth layers don't perfectly occlude. */}
        <Canvas
          data-testid="r3f-canvas"
          style={{ height: '100%', width: '100%' }}
          camera={{ position: [6.5, 5, 8.5], fov: 40 }}
          // Test hook: r3f v9 no longer exposes its store on the canvas
          // element, so drivers (e2e/helpers/board.ts) read the live camera
          // here to project board cells to pixels — correct even after the
          // user orbits or the camera setup above changes.
          onCreated={(state: RootState) => {
            (window as Window & { __r3fState?: RootState }).__r3fState = state;
          }}
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
            lastMove={lastMoveInfo}
            disabled={status !== 'connected' || replayFailedAt !== null}
          />
          <OrbitControls makeDefault minDistance={6} maxDistance={25} />
        </Canvas>
        {reconnectingBanner}
        {replayErrorBanner}
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
      {reconnectingBanner}
      {errorBanner}
    </div>
  );
};

export default GameScreen;
