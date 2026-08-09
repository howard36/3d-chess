import { useState } from 'react';
import { Box } from '@react-three/drei';
import { Board as EngineBoard } from '../engine';
import type { Move } from '../engine';
import { PieceMesh } from './PieceMesh';
import React from 'react';
import { PieceType } from '../engine/pieces';
import { Coord, toZXY } from '../engine/coords';
import { CELLS, toWorld } from './layout';

export type BoardTurn = 'white' | 'black';

export interface BoardProps {
  currentTurn: BoardTurn;
  playerColor?: 'white' | 'black' | null;
  onMove?: (move: Move) => void;
  board: EngineBoard;
  children?: React.ReactNode;
}

const Board = (props: BoardProps) => {
  const board = props.board;
  // Spectators (no assigned colour) get White's view.
  const orientation = props.playerColor ?? 'white';

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
  const pieces = CELLS.flatMap((coord) => {
    const piece = board.getPiece(coord);
    return piece ? [{ ...piece, coord }] : [];
  });

  // Handle piece selection
  const handlePiecePointerDown = (coord: Coord) => {
    const piece = board.getPiece(coord);
    // Only allow clicking pieces that match both the current turn and playerColor
    if (
      !piece ||
      piece.color !== props.currentTurn ||
      (props.playerColor && piece.color !== props.playerColor)
    )
      return;
    setSelected(coord);
    // Directly call generateLegalMoves which already filters for checks
    const actualLegalMoves = board.generateLegalMoves(coord);
    setLegalMoves(actualLegalMoves);
  };

  // Handle highlighted cube click (move application)
  const handleCubePointerDown = (targetCoord: Coord) => {
    if (!selected) return;

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
  const isHighlighted = ({ x, y, z }: Coord) =>
    legalMoves.some((m) => m.to.x === x && m.to.y === y && m.to.z === z);

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
      {CELLS.map((cell) => {
        const isDest = isHighlighted(cell);
        return (
          <Box
            key={toZXY(cell)}
            position={toWorld(cell, orientation)}
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
                    handleCubePointerDown(cell);
                  }
                : undefined
            }
          />
        );
      })}
      {pieces.map(({ type, color, coord }) => (
        <PieceMesh
          key={`${type}-${color}-${toZXY(coord)}`}
          type={type}
          color={color}
          position={toWorld(coord, orientation)}
          onPointerDown={(e: React.PointerEvent) => {
            e.stopPropagation();
            handlePiecePointerDown(coord);
          }}
          // Highlight king if in check
          emissive={
            type === PieceType.King && board.inCheck(color) ? '#ff2222' : '#000000'
          }
        />
      ))}
    </group>
  );
};

export default Board;
