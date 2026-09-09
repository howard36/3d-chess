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
    // `reset` is stable and a no-op unless the session saw traffic, so this
    // runs exactly once per navigation.
    if (location.pathname === '/') {
      reset();
    }
  }, [location.pathname, reset]);

  return (
    <Routes>
      <Route path="/" element={<StartScreen gameSocket={gameSocket} />} />
      <Route path="/game/:gameId" element={<GameScreen gameSocket={gameSocket} />} />
    </Routes>
  );
}

export default App;
