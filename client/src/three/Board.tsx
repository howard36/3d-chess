import { useState } from 'react';
import { Box } from '@react-three/drei';
import { BoxGeometry, BufferAttribute, BufferGeometry, EdgesGeometry } from 'three';
import { Board as EngineBoard } from '../engine';
import type { Move, Piece } from '../engine';
import { PieceMesh } from './PieceMesh';
import React from 'react';
import { PieceType } from '../engine/pieces';
import { Coord, toZXY } from '../engine/coords';
import { CELL_FLOOR_Y, CELLS, toWorld } from './layout';
import { GhostPiece, MoveGlide } from './moveAnimation';
import { theme } from './theme';

// The grid is drawn as a single wireframe lattice rather than translucent cube
// faces: stacked transparent faces compound into haze toward the center of the
// board and sort badly against the pieces. One merged geometry keeps it to a
// single draw call. The lattice is the same set of cell edges under either
// orientation, so it is built once from White's view.
const buildLatticeGeometry = () => {
  const cellEdges = new EdgesGeometry(new BoxGeometry(1, 1, 1));
  const src = cellEdges.getAttribute('position');
  const merged = new Float32Array(CELLS.length * src.count * 3);
  CELLS.forEach((cell, i) => {
    const [cx, cy, cz] = toWorld(cell, 'white');
    for (let v = 0; v < src.count; v++) {
      const o = (i * src.count + v) * 3;
      merged[o] = src.getX(v) + cx;
      merged[o + 1] = src.getY(v) + cy;
      merged[o + 2] = src.getZ(v) + cz;
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

// Drops a cell-centre position to the cell floor, the plane a piece's base disc
// sits on. Both rings ride on it: a ring is read as lying on the ground, so at
// the cell centre it instead skewers whatever piece occupies the cell, at a
// different height for every piece. Pieces are all modeled base-at-y=0 and are
// shorter than their cell, so they are bottom-aligned rather than centred in it,
// and their tops range from ~0.55 (pawn) to 0.87 (king).
const atCellFloor = ([x, y, z]: [number, number, number]): [number, number, number] => [
  x,
  y + CELL_FLOOR_Y,
  z,
];

export type BoardTurn = 'white' | 'black';

const coordEquals = (a: Coord, b: Coord) => a.x === b.x && a.y === b.y && a.z === b.z;

export interface LastMoveInfo {
  move: Move;
  /** Total moves played; increments exactly once per new move. */
  moveCount: number;
  /** Piece that stood on move.to before the move, if the move captured. */
  capturedPiece: Piece | null;
}

export interface BoardProps {
  currentTurn: BoardTurn;
  playerColor?: 'white' | 'black' | null;
  onMove?: (move: Move) => void;
  board: EngineBoard;
  lastMove?: LastMoveInfo;
  /** Freezes interaction (selection and moves) while still rendering the position. */
  disabled?: boolean;
  children?: React.ReactNode;
}

const Board = (props: BoardProps) => {
  const board = props.board;
  // Spectators (no assigned colour) get White's view.
  const orientation = props.playerColor ?? 'white';

  const lastMove = props.lastMove;
  // Moves already played when this board mounted are history (a rejoin
  // replay): they keep their highlight but must not animate.
  const mountMoveCount = React.useRef(lastMove?.moveCount ?? 0);
  const animate = !!lastMove && lastMove.moveCount > mountMoveCount.current;
  const lastFromKey = lastMove ? toZXY(lastMove.move.from) : null;
  const lastToKey = lastMove ? toZXY(lastMove.move.to) : null;

  // State for selected piece and its legal moves
  const [selected, setSelected] = useState<null | Coord>(null);
  const [legalMoves, setLegalMoves] = useState<Move[]>([]);

  // A selection made against an earlier position is stale once the board or
  // turn changes (e.g. the opponent's move arrives) — clear it so a stale
  // highlighted destination can't be sent as a move. Disabling the board
  // (reconnect in progress, broken replay) clears it for the same reason.
  React.useEffect(() => {
    setSelected(null);
    setLegalMoves([]);
  }, [props.board, props.currentTurn, props.disabled]);

  // Collect all pieces with their coordinates from the provided board
  const pieces = CELLS.flatMap((coord) => {
    const piece = board.getPiece(coord);
    return piece ? [{ ...piece, coord }] : [];
  });

  // Handle piece selection
  const handlePiecePointerDown = (coord: Coord) => {
    if (props.disabled) return;
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
    if (props.disabled || !selected) return;

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

  // Distinct destination cells (promotions produce several moves per cell),
  // split by whether the move is a capture, to pick the marker shape.
  const destinations = [...new Map(legalMoves.map((m) => [toZXY(m.to), m.to])).values()].map(
    (to) => ({ to, capture: !!board.getPiece(to) }),
  );

  const isSelected = (c: Coord) => !!selected && coordEquals(selected, c);

  const selectedWorld = selected ? toWorld(selected, orientation) : null;

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
          cells get a faint fill, the last move's cells a teal one; everything
          else visible about a destination is drawn by the markers below. The
          flags reflect what is drawn: a legal-destination fill replaces the
          last-move fill on a shared cell. */}
      {CELLS.map((cell) => {
        const cellKey = toZXY(cell);
        const isDest = isHighlighted(cell);
        const isLastTo = !isDest && cellKey === lastToKey;
        const isLastFrom = !isDest && !isLastTo && cellKey === lastFromKey;
        const fill = isDest
          ? { color: theme.highlightFill, opacity: theme.highlightFillOpacity }
          : isLastTo || isLastFrom
            ? { color: theme.lastMoveFill, opacity: theme.lastMoveFillOpacity }
            : { color: theme.highlightFill, opacity: 0 };
        return (
          <Box
            key={cellKey}
            position={toWorld(cell, orientation)}
            args={[1, 1, 1]}
            castShadow={false}
            receiveShadow={false}
            userData={{
              highlight: isDest,
              lastMoveFrom: isLastFrom,
              lastMoveTo: isLastTo,
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
          >
            <meshBasicMaterial
              color={fill.color}
              transparent
              opacity={fill.opacity}
              depthWrite={false}
            />
          </Box>
        );
      })}
      {/* Move markers: a dot for a quiet move, a ring around a capturable piece.
          The dot marks empty space, so it sits at the cell centre; the ring
          encircles an occupied cell's piece, so it drops to that piece's base. */}
      {destinations.map(({ to, capture }) =>
        capture ? (
          <mesh
            key={`capture-${toZXY(to)}`}
            position={atCellFloor(toWorld(to, orientation))}
            rotation={[Math.PI / 2, 0, 0]}
            raycast={noRaycast}
            userData={{ captureRing: true }}
          >
            <torusGeometry args={[0.42, 0.035, 8, 32]} />
            <meshBasicMaterial color={theme.capture} transparent opacity={0.9} depthWrite={false} />
          </mesh>
        ) : (
          <mesh
            key={`quiet-${toZXY(to)}`}
            position={toWorld(to, orientation)}
            raycast={noRaycast}
          >
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
      {/* Ring around the foot of the selected piece. Slightly tighter than the
          capture ring, so the two read as different markers where they sit in
          neighbouring cells; the radius still clears the widest base (the
          king's, 0.28) while staying inside the cell. */}
      {selectedWorld && (
        <mesh
          position={atCellFloor(selectedWorld)}
          rotation={[Math.PI / 2, 0, 0]}
          raycast={noRaycast}
          userData={{ selectionRing: true }}
        >
          <torusGeometry args={[0.38, 0.04, 8, 32]} />
          <meshBasicMaterial color={theme.select} transparent opacity={0.95} depthWrite={false} />
        </mesh>
      )}
      {pieces.map(({ type, color, coord }) => {
        const mesh = (
          <PieceMesh
            key={`${type}-${color}-${toZXY(coord)}`}
            type={type}
            color={color}
            position={toWorld(coord, orientation)}
            onPointerDown={(e: React.PointerEvent) => {
              e.stopPropagation();
              handlePiecePointerDown(coord);
            }}
            // Check trumps selection for the king's glow
            emissive={
              type === PieceType.King && board.inCheck(color)
                ? theme.check
                : isSelected(coord)
                  ? theme.selectEmissive
                  : '#000000'
            }
          />
        );
        // The just-moved piece glides in from its source cell. Piece keys are
        // position-derived and can recur across moves, so the wrapper is keyed
        // by moveCount: every new move mounts a fresh tween, superseding one
        // still in flight.
        if (animate && lastMove && toZXY(coord) === lastToKey) {
          return (
            <MoveGlide
              key={`anim-${lastMove.moveCount}`}
              from={toWorld(lastMove.move.from, orientation)}
              to={toWorld(coord, orientation)}
            >
              {mesh}
            </MoveGlide>
          );
        }
        return mesh;
      })}
      {animate && lastMove?.capturedPiece && (
        <GhostPiece
          key={`ghost-${lastMove.moveCount}`}
          type={lastMove.capturedPiece.type}
          color={lastMove.capturedPiece.color}
          position={toWorld(lastMove.move.to, orientation)}
        />
      )}
    </group>
  );
};

export default Board;
