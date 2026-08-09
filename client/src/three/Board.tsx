import { useState } from 'react';
import { Box } from '@react-three/drei';
import { BoxGeometry, BufferAttribute, BufferGeometry, EdgesGeometry } from 'three';
import { Board as EngineBoard } from '../engine';
import type { Move } from '../engine';
import { PieceMesh } from './PieceMesh';
import React from 'react';
import { PieceType } from '../engine/pieces';
import { Coord } from '../engine/coords';
import { theme } from './theme';

const GRID_SIZE = 5;
const SPACING = 1.1;
const HALF = (GRID_SIZE - 1) / 2;

const toWorld = (c: Coord): [number, number, number] => [
  (c.x - HALF) * SPACING,
  (c.y - HALF) * SPACING,
  (c.z - HALF) * SPACING,
];

const cubes = Array.from({ length: GRID_SIZE ** 3 }, (_, i) => {
  const x = i % GRID_SIZE;
  const y = Math.floor(i / GRID_SIZE) % GRID_SIZE;
  const z = Math.floor(i / (GRID_SIZE * GRID_SIZE));
  return { coord: { x, y, z }, position: toWorld({ x, y, z }), key: `${x},${y},${z}` };
});

// The grid is drawn as a single wireframe lattice rather than translucent cube
// faces: stacked transparent faces compound into haze toward the center of the
// board and sort badly against the pieces. One merged geometry keeps it to a
// single draw call.
const buildLatticeGeometry = () => {
  const cellEdges = new EdgesGeometry(new BoxGeometry(1, 1, 1));
  const src = cellEdges.getAttribute('position');
  const merged = new Float32Array(cubes.length * src.count * 3);
  cubes.forEach(({ position }, cell) => {
    for (let v = 0; v < src.count; v++) {
      const o = (cell * src.count + v) * 3;
      merged[o] = src.getX(v) + position[0];
      merged[o + 1] = src.getY(v) + position[1];
      merged[o + 2] = src.getZ(v) + position[2];
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(merged, 3));
  return geometry;
};
const latticeGeometry = buildLatticeGeometry();

// Line raycasting has a generous default threshold that would steal pointer
// events from the cells; markers are decorative too.
const noRaycast = () => null;

export type BoardTurn = 'white' | 'black';

export interface BoardProps {
  currentTurn: BoardTurn;
  playerColor?: 'white' | 'black' | null;
  onMove?: (move: Move) => void;
  board: EngineBoard;
  children?: React.ReactNode;
}

const Board = (props: BoardProps) => {
  // Remove internal board state, use props.board
  const board = props.board;

  // State for selected piece and its legal moves
  const [selected, setSelected] = useState<null | Coord>(null);
  const [legalMoves, setLegalMoves] = useState<Move[]>([]);

  // A selection made against an earlier position is stale once the board or
  // turn changes (e.g. the opponent's move arrives) — clear it so a stale
  // highlighted destination can't be sent as a move.
  React.useEffect(() => {
    setSelected(null);
    setLegalMoves([]);
  }, [props.board, props.currentTurn]);

  // Collect all pieces with their coordinates from the provided board
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
    const piece = board.getPiece({ x, y, z });
    // Only allow clicking pieces that match both the current turn and playerColor
    if (
      !piece ||
      piece.color !== props.currentTurn ||
      (props.playerColor && piece.color !== props.playerColor)
    )
      return;
    setSelected({ x, y, z });
    // Directly call generateLegalMoves which already filters for checks
    const actualLegalMoves = board.generateLegalMoves({ x, y, z });
    setLegalMoves(actualLegalMoves);
  };

  // Handle highlighted cube click (move application)
  const handleCubePointerDown = (x: number, y: number, z: number) => {
    if (!selected) return;

    const targetCoord = { x, y, z };
    // Find the specific move from legalMoves that matches the targetCoord
    // This is important if there are multiple promotions to the same square.
    // For simplicity, if it's a pawn promotion, we'll default to Queen for now if onMove is not defined,
    // or expect onMove to handle the promotion choice if it is defined.
    let moveToSend = legalMoves.find(
      (m) => m.to.x === targetCoord.x && m.to.y === targetCoord.y && m.to.z === targetCoord.z,
    );

    if (!moveToSend) return; // Should not happen if cube is highlighted

    const piece = board.getPiece(selected);
    if (
      piece &&
      piece.type === PieceType.Pawn &&
      board.isPromotionSquare(targetCoord, piece.color)
    ) {
      // If multiple promotion moves exist for this square, prioritize Queen or the first one.
      // A better UI would let the user choose.
      const promotionMoves = legalMoves.filter(
        (m) =>
          m.to.x === targetCoord.x &&
          m.to.y === targetCoord.y &&
          m.to.z === targetCoord.z &&
          m.promotion,
      );
      if (promotionMoves.length > 0) {
        moveToSend =
          promotionMoves.find((m) => m.promotion === PieceType.Queen) || promotionMoves[0];
      }
    }

    if (props.onMove) {
      props.onMove(moveToSend);
    }
    // Clear selection and highlights
    setSelected(null);
    setLegalMoves([]);
  };

  // Helper to check if a cube is a legal move destination
  const isHighlighted = (x: number, y: number, z: number) =>
    legalMoves.some((m) => m.to.x === x && m.to.y === y && m.to.z === z);

  // Distinct destination cells (promotions produce several moves per cell),
  // split by whether the move is a capture, to pick the marker shape.
  const destinations = [
    ...new Map(legalMoves.map((m) => [`${m.to.x},${m.to.y},${m.to.z}`, m.to])).values(),
  ].map((to) => ({ to, capture: !!board.getPiece(to) }));

  const isSelected = (x: number, y: number, z: number) =>
    !!selected && selected.x === x && selected.y === y && selected.z === z;

  return (
    <group
      name="board-grid"
      onPointerDown={() => {
        if (selected) {
          setSelected(null);
          setLegalMoves([]);
        }
      }}
    >
      {props.children}
      <lineSegments geometry={latticeGeometry} raycast={noRaycast}>
        <lineBasicMaterial
          color={theme.gridLine}
          transparent
          opacity={theme.gridLineOpacity}
          depthWrite={false}
        />
      </lineSegments>
      {/* Invisible cell boxes: raycast targets for selecting a destination and
          for the empty-space click that clears the selection. Destination
          cells get a faint fill; everything visible about a destination is
          drawn by the markers below. */}
      {cubes.map(({ coord, position, key }) => {
        const isDest = isHighlighted(coord.x, coord.y, coord.z);
        return (
          <Box
            key={key}
            position={position}
            args={[1, 1, 1]}
            castShadow={false}
            receiveShadow={false}
            userData={{
              highlight: isDest,
              cube: true,
            }}
            // Add pointer handler for highlighted cubes
            onPointerDown={
              isDest
                ? (e) => {
                    e.stopPropagation();
                    handleCubePointerDown(coord.x, coord.y, coord.z);
                  }
                : undefined
            }
          >
            <meshBasicMaterial
              color={theme.highlightFill}
              transparent
              opacity={isDest ? 0.12 : 0}
              depthWrite={false}
            />
          </Box>
        );
      })}
      {/* Move markers: a dot for a quiet move, a ring around a capturable piece */}
      {destinations.map(({ to, capture }) =>
        capture ? (
          <mesh
            key={`capture-${to.x},${to.y},${to.z}`}
            position={toWorld(to)}
            rotation={[Math.PI / 2, 0, 0]}
            raycast={noRaycast}
          >
            <torusGeometry args={[0.42, 0.035, 8, 32]} />
            <meshBasicMaterial color={theme.capture} transparent opacity={0.9} depthWrite={false} />
          </mesh>
        ) : (
          <mesh key={`quiet-${to.x},${to.y},${to.z}`} position={toWorld(to)} raycast={noRaycast}>
            <sphereGeometry args={[0.11, 16, 16]} />
            <meshBasicMaterial
              color={theme.quietMove}
              transparent
              opacity={0.9}
              depthWrite={false}
            />
          </mesh>
        ),
      )}
      {/* Ring under the selected piece */}
      {selected && (
        <mesh
          position={[toWorld(selected)[0], toWorld(selected)[1] - 0.42, toWorld(selected)[2]]}
          rotation={[Math.PI / 2, 0, 0]}
          raycast={noRaycast}
        >
          <torusGeometry args={[0.38, 0.04, 8, 32]} />
          <meshBasicMaterial color={theme.select} transparent opacity={0.95} depthWrite={false} />
        </mesh>
      )}
      {pieces.map(({ type, color, x, y, z }) => (
        <PieceMesh
          key={`${type}-${color}-${x},${y},${z}`}
          type={type}
          color={color}
          position={toWorld({ x, y, z })}
          onPointerDown={(e: React.PointerEvent) => {
            e.stopPropagation();
            handlePiecePointerDown(x, y, z);
          }}
          // Check trumps selection for the king's glow
          emissive={
            type === PieceType.King && board.inCheck(color)
              ? theme.check
              : isSelected(x, y, z)
                ? theme.selectEmissive
                : '#000000'
          }
        />
      ))}
    </group>
  );
};

export default Board;
