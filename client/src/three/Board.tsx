import { memo, useState, useMemo, useEffect } from 'react';
import { Box } from '@react-three/drei';
import { ThreeElements } from '@react-three/fiber';
import { Board as EngineBoard, Move } from '../engine';
import { PieceMesh } from './PieceMesh';
import React from 'react';
import { PieceType } from '../engine/pieces';
import { Coord } from '../engine/coords';

const GRID_SIZE = 5;
const SPACING = 1.1;
const HALF = (GRID_SIZE - 1) / 2;

const cubes = Array.from({ length: GRID_SIZE ** 3 }, (_, i) => {
  const x = i % GRID_SIZE;
  const y = Math.floor(i / GRID_SIZE) % GRID_SIZE;
  const z = Math.floor(i / (GRID_SIZE * GRID_SIZE));
  return [(x - HALF) * SPACING, (y - HALF) * SPACING, (z - HALF) * SPACING, `${x},${y},${z}`];
});

export type BoardTurn = 'white' | 'black';

export type ServerPromotionType = 'Q' | 'R' | 'B' | 'N' | 'U';

export interface BoardProps {
  currentTurn: BoardTurn;
  playerColor?: 'white' | 'black' | null;
  onMove?: (move: Move) => void;
  board: EngineBoard;
  children?: React.ReactNode;
  [key: string]: any; // allow passing arbitrary props to <group>
}

const Board = memo((props: BoardProps) => {
  // Remove internal board state, use props.board
  const board = props.board;

  // State for selected piece and its legal moves
  const [selected, setSelected] = useState<null | Coord>(null);
  const [legalMoves, setLegalMoves] = useState<Move[]>([]);

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

  // --- King in check logic ---
  let kingInCheck = false;
  let kingPos: { x: number; y: number; z: number } | null = null;
  try {
    kingInCheck = board.inCheck(props.currentTurn);
    kingPos = board.findKing(props.currentTurn);
  } catch {}

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
    try {
      // Directly call generateLegalMoves which already filters for checks
      const actualLegalMoves = board.generateLegalMoves({ x, y, z });
      setLegalMoves(actualLegalMoves);
    } catch (error) {
      // Handle cases like clicking on an empty square if generateLegalMoves throws an error
      console.error('Error generating legal moves:', error);
      setLegalMoves([]);
    }
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

  return (
    <group
      name="board-grid"
      {...props}
      onPointerDown={() => {
        if (selected) {
          setSelected(null);
          setLegalMoves([]);
        }
      }}
    >
      {props.children}
      {cubes.map(([x, y, z, key]) => {
        const gx = Math.round((x as number) / SPACING + HALF);
        const gy = Math.round((y as number) / SPACING + HALF);
        const gz = Math.round((z as number) / SPACING + HALF);
        const isDest = isHighlighted(gx, gy, gz);
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
            // Add pointer handler for highlighted cubes
            onPointerDown={
              isDest
                ? (e) => {
                    e.stopPropagation();
                    handleCubePointerDown(gx, gy, gz);
                  }
                : undefined
            }
          />
        );
      })}
      {pieces.map(({ type, color, x, y, z }) => (
        <PieceMesh
          key={`${type}-${color}-${x},${y},${z}`}
          type={type}
          color={color}
          position={[(x - HALF) * SPACING, (y - HALF) * SPACING, (z - HALF) * SPACING]}
          onPointerDown={(e) => {
            e.stopPropagation();
            handlePiecePointerDown(x, y, z);
          }}
          // Highlight king if in check
          emissive={
            type === PieceType.King &&
            color === props.currentTurn &&
            kingInCheck &&
            kingPos &&
            kingPos.x === x &&
            kingPos.y === y &&
            kingPos.z === z
              ? '#ff2222'
              : undefined
          }
        />
      ))}
    </group>
  );
});

export default Board;
