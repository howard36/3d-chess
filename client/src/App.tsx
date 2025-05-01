import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import Board from './three/Board';
import { useWindowSize } from './hooks/useWindowSize';
import TurnIndicator from './three/TurnIndicator';
import { useState } from 'react';

function App() {
  const { width, height } = useWindowSize();
  const [turn, setTurn] = useState<'white' | 'black'>('white');
  return (
    <div style={{ position: 'relative', width, height }}>
      <TurnIndicator turn={turn} />
      <Canvas data-testid="r3f-canvas" style={{ height, width }}>
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} />
        <Board onTurnChange={setTurn} currentTurn={turn} />
        <OrbitControls makeDefault />
      </Canvas>
    </div>
  );
}

export default App;
