import { Routes, Route, matchPath, useLocation, useParams } from 'react-router-dom';
import StartScreen from './screens/StartScreen';
import GameScreen from './screens/GameScreen';
import { useGameSocket } from './hooks/useGameSocket';
import type { GameSocket } from './hooks/useGameSocket';
import React from 'react';

// One GameScreen per game: moving between two game pages (browser history can
// jump straight from one to another) mounts a fresh screen, so nothing the
// previous game's screen held (a join in flight, dismissed errors, a move
// awaiting its echo) carries over. It is not mounted until the socket session
// belongs to this game: for one render after a jump the log still holds the
// previous game's messages, and a screen reading them would take that game's
// seat for this one's (and store it).
function GameRoute({
  gameSocket,
  readyGameId,
}: {
  gameSocket: GameSocket;
  readyGameId: string | null;
}) {
  const { gameId } = useParams<{ gameId: string }>();
  if (gameId !== readyGameId) return null;
  return <GameScreen key={gameId} gameSocket={gameSocket} />;
}

function App() {
  const gameSocket = useGameSocket();
  const location = useLocation();
  const { reset } = gameSocket;
  const gameId = matchPath('/game/:gameId', location.pathname)?.params.gameId ?? null;
  const previousGameId = React.useRef(gameId);
  // The game the socket session now belongs to (see GameRoute)
  const [readyGameId, setReadyGameId] = React.useState(gameId);

  // A layout effect, so the reset lands before the new page first paints: the
  // new screen never shows the previous game's board under its address.
  React.useLayoutEffect(() => {
    const previous = previousGameId.current;
    previousGameId.current = gameId;
    // Leaving a game ends its socket session: navigating back to the start
    // screen, or from one game's page straight to another's. A fresh session
    // keeps the previous game's messages and server-side seat from leaking
    // into the next page, which then rejoins or creates as a new page would.
    // (Arriving at a game from the start screen keeps the session: it holds
    // the creator's game_created.) `reset` is stable and a no-op unless the
    // session saw traffic, so this runs exactly once per navigation.
    if (location.pathname === '/' || (previous !== null && gameId !== previous)) {
      reset();
    }
    setReadyGameId(gameId);
  }, [location.pathname, gameId, reset]);

  return (
    <Routes>
      <Route path="/" element={<StartScreen gameSocket={gameSocket} />} />
      <Route
        path="/game/:gameId"
        element={<GameRoute gameSocket={gameSocket} readyGameId={readyGameId} />}
      />
    </Routes>
  );
}

export default App;
