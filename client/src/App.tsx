import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import Board from './three/Board';
import { useWindowSize } from './hooks/useWindowSize';

function App() {
  const { width, height } = useWindowSize();
  return (
    <Canvas data-testid="r3f-canvas" style={{ height, width }}>
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} />
      <Board />
      <OrbitControls makeDefault />
    </Canvas>
  );
}

export default App;
