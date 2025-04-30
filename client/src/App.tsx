import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import Board from './three/Board';

function App() {
  return (
    <Canvas data-testid="r3f-canvas" style={{ height: '100vh', width: '100vw' }}>
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} />
      <Board />
      <OrbitControls />
    </Canvas>
  );
}

export default App;
