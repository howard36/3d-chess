import { Routes, Route, useLocation } from 'react-router-dom';
// import { Canvas } from '@react-three/fiber';
// import { OrbitControls } from '@react-three/drei';
// import Board from './three/Board';
// import { useWindowSize } from './hooks/useWindowSize';
// import TurnIndicator from './three/TurnIndicator';
// import { useState } from 'react';
import StartScreen from './screens/StartScreen';
import GameScreen from './screens/GameScreen';
import { useGameSocket } from './hooks/useGameSocket';
import React from 'react';

function App() {
  const gameSocket = useGameSocket();
  const [isCreator, setIsCreator] = React.useState(false);
  const location = useLocation();

  React.useEffect(() => {
    // Reset isCreator when navigating to StartScreen
    if (location.pathname === '/') {
      setIsCreator(false);
    }
  }, [location.pathname]);

  // const { width, height } = useWindowSize();
  // const [turn, setTurn] = useState<'white' | 'black'>('white');
  return (
    // <div style={{ position: 'relative', width, height }}>
    //   <TurnIndicator turn={turn} />
    //   <Canvas data-testid="r3f-canvas" style={{ height, width }}>
    //     <ambientLight intensity={0.5} />
    //     <pointLight position={[10, 10, 10]} />
    //     <Board onTurnChange={setTurn} currentTurn={turn} />
    //     <OrbitControls makeDefault />
    //   </Canvas>
    // </div>
    <Routes>
      <Route
        path="/"
        element={<StartScreen gameSocket={gameSocket} setIsCreator={setIsCreator} />}
      />
      <Route
        path="/game/:gameId"
        element={<GameScreen gameSocket={gameSocket} isCreator={isCreator} />}
      />
    </Routes>
  );
}

export default App;
