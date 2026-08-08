import { Routes, Route, useLocation } from 'react-router-dom';
import StartScreen from './screens/StartScreen';
import GameScreen from './screens/GameScreen';
import { useGameSocket } from './hooks/useGameSocket';
import React from 'react';

function App() {
  const gameSocket = useGameSocket();
  const location = useLocation();
  const { reset } = gameSocket;

  React.useEffect(() => {
    // Navigating back to the start screen ends the current game session:
    // start a fresh socket session so the previous game's messages and
    // server-side state don't leak into the next game.
    if (location.pathname === '/') {
      reset();
    }
    // `reset` is a no-op unless the session saw traffic; depending on
    // pathname alone ensures this runs exactly once per navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return (
    <Routes>
      <Route path="/" element={<StartScreen gameSocket={gameSocket} />} />
      <Route path="/game/:gameId" element={<GameScreen gameSocket={gameSocket} />} />
    </Routes>
  );
}

export default App;
