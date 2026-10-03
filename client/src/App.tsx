import { Routes, Route, matchPath, useLocation, useParams } from 'react-router-dom';
import StartScreen from './screens/StartScreen';
// Small: the game's 3D board (GameCanvas) and the lobby's canvas are its lazily loaded parts
import GameScreen from './screens/GameScreen';
import LobbyLayout from './screens/lobby/LobbyLayout';
import ChooseSide from './screens/lobby/ChooseSide';
import { computerGame } from './screens/computerGameChunk';
import { ChunkBoundary } from './components/ChunkBoundary';
import { reloadPage } from './lib/cachedImport';
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

// A game against the computer (/computer/:gameId), from its own chunk; should
// that fail to load, the lobby's page says so with a way to try again
function ComputerGameRoute() {
  const [failed, setFailed] = React.useState(false);
  if (failed) {
    return (
      <div className="lobby-page">
        <p className="lobby-foot" role="alert">
          Couldn't load the game{' '}
          <button className="hud-retry" onClick={reloadPage}>
            Retry
          </button>
        </p>
      </div>
    );
  }
  const Screen = computerGame.Component;
  return (
    <ChunkBoundary onFail={() => setFailed(true)}>
      <React.Suspense fallback={null}>
        <Screen />
      </React.Suspense>
    </ChunkBoundary>
  );
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
    // (Arriving at a game from the side choice keeps the session: it holds
    // the creator's game_created.) `reset` is stable and a no-op unless the
    // session saw traffic, so this runs exactly once per navigation.
    if (location.pathname === '/' || (previous !== null && gameId !== previous)) {
      reset();
    }
    setReadyGameId(gameId);
  }, [location.pathname, gameId, reset]);

  return (
    <Routes>
      <Route path="/" element={<StartScreen />} />
      {/* The lobby's stage stays up from choosing a side to the game's
          first frame, across the move from /new to the game's page */}
      <Route element={<LobbyLayout />}>
        <Route path="/new" element={<ChooseSide gameSocket={gameSocket} />} />
        <Route
          path="/game/:gameId"
          element={<GameRoute gameSocket={gameSocket} readyGameId={readyGameId} />}
        />
        {/* Against the computer: no server, the game kept in the browser */}
        <Route path="/computer" element={<ChooseSide gameSocket={gameSocket} computer />} />
        <Route path="/computer/:gameId" element={<ComputerGameRoute />} />
      </Route>
    </Routes>
  );
}

export default App;
