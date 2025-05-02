import { Routes, Route } from 'react-router-dom';
// import { Canvas } from '@react-three/fiber';
// import { OrbitControls } from '@react-three/drei';
// import Board from './three/Board';
// import { useWindowSize } from './hooks/useWindowSize';
// import TurnIndicator from './three/TurnIndicator';
// import { useState } from 'react';
import StartScreen from './screens/StartScreen';
import GameScreen from './screens/GameScreen';
import './App.css'; // Assuming some base styles might be here
import { useGameSocket } from './hooks/useGameSocket';

function App() {
  const gameSocket = useGameSocket();
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
      <Route path="/" element={<StartScreen gameSocket={gameSocket} />} />
      <Route path="/game/:gameId" element={<GameScreen gameSocket={gameSocket} />} />
    </Routes>
  );
}

export default App;
