import { memo } from 'react';
import { Box } from '@react-three/drei';
import { ThreeElements } from '@react-three/fiber';

const GRID_SIZE = 5;
const SPACING = 1.1;
const HALF = (GRID_SIZE - 1) / 2;

const cubes = Array.from({ length: GRID_SIZE ** 3 }, (_, i) => {
  const x = i % GRID_SIZE;
  const y = Math.floor(i / GRID_SIZE) % GRID_SIZE;
  const z = Math.floor(i / (GRID_SIZE * GRID_SIZE));
  return [(x - HALF) * SPACING, (y - HALF) * SPACING, (z - HALF) * SPACING, `${x},${y},${z}`];
});

const Board = memo((props: ThreeElements['group']) => (
  <group name="board-grid" {...props}>
    {cubes.map(([x, y, z, key]) => (
      <Box
        key={key as string}
        position={[x as number, y as number, z as number]}
        args={[1, 1, 1]}
        material-color="#b0c4de"
        material-transparent
        material-opacity={0.3}
        castShadow={false}
        receiveShadow={false}
      />
    ))}
  </group>
));

export default Board;
