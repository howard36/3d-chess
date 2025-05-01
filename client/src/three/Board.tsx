import { memo, useState, useMemo } from 'react';
import { Box } from '@react-three/drei';
import { ThreeElements } from '@react-three/fiber';
import { Board as EngineBoard } from '../engine';
import { PieceMesh } from './PieceMesh';

const GRID_SIZE = 5;
const SPACING = 1.1;
const HALF = (GRID_SIZE - 1) / 2;

const cubes = Array.from({ length: GRID_SIZE ** 3 }, (_, i) => {
  const x = i % GRID_SIZE;
  const y = Math.floor(i / GRID_SIZE) % GRID_SIZE;
  const z = Math.floor(i / (GRID_SIZE * GRID_SIZE));
  return [(x - HALF) * SPACING, (y - HALF) * SPACING, (z - HALF) * SPACING, `${x},${y},${z}`];
});

const Board = memo((props: ThreeElements['group']) => {
  // Set up the engine board and starting position
  const board = useMemo(() => {
    const b = new EngineBoard();
    EngineBoard.setupStartingPosition(b);
    return b;
  }, []);

  // State for selected piece and its legal moves
  const [selected, setSelected] = useState<null | { x: number; y: number; z: number }>(null);
  const [legalMoves, setLegalMoves] = useState<{ x: number; y: number; z: number }[]>([]);

  // Collect all pieces with their coordinates
  const pieces = [];
  for (let z = 0; z < GRID_SIZE; z++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      for (let y = 0; y < GRID_SIZE; y++) {
        const piece = board.getPiece({ x, y, z });
        if (piece) {
          pieces.push({ ...piece, x, y, z });
        }
      }
    }
  }

  // Handle piece selection
  const handlePiecePointerDown = (x: number, y: number, z: number) => {
    setSelected({ x, y, z });
    try {
      const moves = board.generateMoves({ x, y, z });
      setLegalMoves(moves);
    } catch {
      setLegalMoves([]);
    }
  };

  // Helper to check if a cube is a legal move destination
  const isHighlighted = (x: number, y: number, z: number) =>
    legalMoves.some((m) => m.x === x && m.y === y && m.z === z);

  return (
    <group name="board-grid" {...props}>
      {cubes.map(([x, y, z, key]) => {
        const isDest = isHighlighted(
          Math.round((x as number) / SPACING + HALF),
          Math.round((y as number) / SPACING + HALF),
          Math.round((z as number) / SPACING + HALF),
        );
        return (
          <Box
            key={key as string}
            position={[x as number, y as number, z as number]}
            args={[1, 1, 1]}
            material-color={isDest ? '#ffd600' : '#e3eaf2'}
            material-transparent
            material-opacity={isDest ? 0.5 : 0.1}
            castShadow={false}
            receiveShadow={false}
            userData={{
              highlight: isDest,
              cube: true,
            }}
          />
        );
      })}
      {pieces.map(({ type, color, x, y, z }) => (
        <PieceMesh
          key={`${type}-${color}-${x},${y},${z}`}
          type={type}
          color={color}
          position={[(x - HALF) * SPACING, (y - HALF) * SPACING, (z - HALF) * SPACING]}
          onPointerDown={() => handlePiecePointerDown(x, y, z)}
        />
      ))}
    </group>
  );
});

export default Board;
