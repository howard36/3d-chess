import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { BoxGeometry, MeshBasicMaterial } from 'three';
import { Board as EngineBoard } from '../engine';
import type { Move, Piece } from '../engine';
import { PieceMesh } from './PieceMesh';
import React from 'react';
import { PieceType } from '../engine/pieces';
import { Coord, toZXY } from '../engine/coords';
import { CELLS } from './layout';
import { GhostPiece, MoveGlide } from './moveAnimation';
import { prefersReducedMotion } from './motion';
import { theme } from './theme';
import { isTap } from './tap';
import { useDesign } from './designs/context';
import type { BoardLayout, MarkerProps, Vec3 } from './designs/types';

// The 125 cell boxes share one geometry and one of three materials instead of
// owning a BoxGeometry and a transparent material each. A cell with nothing
// to draw is `visible={false}`: three's Raycaster tests layers, not
// visibility, so it still catches destination clicks and the empty-space
// click that clears a selection, while the renderer never queues it. It keeps
// a (never drawn) material because Mesh.raycast bails without one. The fills
// themselves come from the design.
const cellGeometries = new Map<string, BoxGeometry>();
const cellGeometryFor = (layout: BoardLayout) => {
  const key = layout.cellSize.join(',');
  let geometry = cellGeometries.get(key);
  if (!geometry) {
    geometry = new BoxGeometry(...layout.cellSize);
    cellGeometries.set(key, geometry);
  }
  return geometry;
};
const noFill = new MeshBasicMaterial();

// Drops a cell-centre position to the cell floor, the plane a piece's base disc
// sits on. Both rings ride on it: a ring is read as lying on the ground, so at
// the cell centre it instead skewers whatever piece occupies the cell, at a
// different height for every piece. Pieces are all modeled base-at-y=0 and are
// shorter than their cell, so they are bottom-aligned rather than centred in it,
// and their tops range from ~0.55 (pawn) to 0.87 (king).
const atCellFloor = ([x, y, z]: Vec3, layout: BoardLayout): Vec3 => [x, y + layout.floorY, z];

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
  /**
   * Called instead of onMove when the clicked destination is a promotion
   * square, with one move per promotion piece, so the caller can ask the
   * player which piece they want. Without it the board promotes to a Queen.
   */
  onChoosePromotion?: (choices: Move[]) => void;
  board: EngineBoard;
  lastMove?: LastMoveInfo;
  /** Freezes interaction (selection and moves) while still rendering the position. */
  disabled?: boolean;
  /** Set once the game has ended; a design may mark the mated king. */
  gameOver?: { result: 'checkmate' | 'stalemate'; winner?: BoardTurn } | null;
}

const Board = (props: BoardProps) => {
  const board = props.board;
  const design = useDesign();
  const layout = design.layout;
  const { Quiet, Capture, Selection, LastMove, Check } = design.markers;
  // Spectators (no assigned colour) get White's view.
  const orientation = props.playerColor ?? 'white';

  // World position of every cell, computed once per orientation. PieceMesh is
  // memoized on a shallow prop comparison, so the position it receives has to
  // be the same array from one render to the next, not a fresh toWorld result.
  const worldPositions = useMemo(
    () => new Map(CELLS.map((cell) => [toZXY(cell), layout.toWorld(cell, orientation)])),
    [orientation, layout],
  );
  const worldOf = (cell: Coord) => worldPositions.get(toZXY(cell))!;
  const markerAt = (cell: Coord): MarkerProps => {
    const centre = worldOf(cell);
    return { centre, floor: atCellFloor(centre, layout) };
  };
  const cellGeometry = cellGeometryFor(layout);

  const lastMove = props.lastMove;
  // Moves already played when this board mounted are history (a rejoin
  // replay): they keep their highlight but must not animate.
  const mountMoveCount = React.useRef(lastMove?.moveCount ?? 0);
  const animate =
    !!lastMove && lastMove.moveCount > mountMoveCount.current && !prefersReducedMotion();
  const lastFromKey = lastMove ? toZXY(lastMove.move.from) : null;
  const lastToKey = lastMove ? toZXY(lastMove.move.to) : null;

  // State for selected piece and its legal moves
  const [selected, setSelected] = useState<null | Coord>(null);
  const [legalMoves, setLegalMoves] = useState<Move[]>([]);
  // The piece under the pointer, when the design lifts pieces on hover.
  const [hovered, setHovered] = useState<string | null>(null);

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

  // Whether the player may pick up the piece on this cell right now.
  const canPick = (coord: Coord) => {
    if (props.disabled) return false;
    const piece = board.getPiece(coord);
    // Only allow clicking pieces that match both the current turn and playerColor
    return (
      !!piece &&
      piece.color === props.currentTurn &&
      (!props.playerColor || piece.color === props.playerColor)
    );
  };

  // Handle piece selection. A click on an opposing piece that the selected
  // piece can take is the capture itself: the piece stands in its cell and
  // would otherwise swallow the click meant for the cell behind it.
  const handlePieceClick = (coord: Coord) => {
    if (selected && isHighlighted(coord) && !canPick(coord)) {
      handleCubeClick(coord);
      return;
    }
    if (!canPick(coord)) return;
    setSelected(coord);
    // Directly call generateLegalMoves which already filters for checks
    const actualLegalMoves = board.generateLegalMoves(coord);
    setLegalMoves(actualLegalMoves);
  };

  // Same reason as worldPositions: each piece gets a handler whose identity
  // never changes, delegating to the latest closure through a ref.
  const latestPieceClick = useRef(handlePieceClick);
  const latestCanPick = useRef(canPick);
  useLayoutEffect(() => {
    latestPieceClick.current = handlePieceClick;
    latestCanPick.current = canPick;
  });
  const pieceHandlers = useMemo(
    () =>
      new Map(
        CELLS.map((cell) => [
          toZXY(cell),
          (e: ThreeEvent<MouseEvent>) => {
            e.stopPropagation();
            if (isTap(e)) latestPieceClick.current(cell);
          },
        ]),
      ),
    [],
  );
  const hoverHandlers = useMemo(
    () =>
      new Map(
        CELLS.map((cell) => {
          const key = toZXY(cell);
          return [
            key,
            {
              onPointerOver: (e: ThreeEvent<PointerEvent>) => {
                e.stopPropagation();
                if (latestCanPick.current(cell)) setHovered(key);
              },
              onPointerOut: () => setHovered((h) => (h === key ? null : h)),
            },
          ];
        }),
      ),
    [],
  );

  // Handle highlighted cube click (move application)
  const handleCubeClick = (targetCoord: Coord) => {
    if (props.disabled || !selected) return;
    // Several legal moves share a destination only when a pawn promotes there
    // (one per promotion piece); otherwise there is exactly one.
    const choices = legalMoves.filter((m) => coordEquals(m.to, targetCoord));
    if (choices.length === 0) return; // Should not happen if cube is highlighted

    if (choices.length > 1 && props.onChoosePromotion) {
      props.onChoosePromotion(choices);
    } else if (props.onMove) {
      props.onMove(choices.find((m) => m.promotion === PieceType.Queen) ?? choices[0]);
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

  // Kings standing in check, with where they stand.
  const checkedKings = pieces.filter(
    ({ type, color }) => type === PieceType.King && board.inCheck(color),
  );
  const checked = checkedKings.map(({ color }) => color);
  const matedColor =
    props.gameOver?.result === 'checkmate' && props.gameOver.winner
      ? props.gameOver.winner === 'white'
        ? 'black'
        : 'white'
      : null;
  // On a stacked board the ranks run away from the camera, so a knight looks
  // along them — toward the opponent — turned a little to show its profile.
  // (In the lattice the ranks run up the screen; PieceMesh's default turn
  // already shows the profile.)
  const knightFacing = (color: BoardTurn) =>
    layout.kind === 'tower'
      ? (color === orientation ? 1 : -1) * (Math.PI / 2 - (design.knightYaw ?? 0.5))
      : undefined;
  const matedKing = pieces.find(
    ({ type, color }) => type === PieceType.King && color === matedColor,
  );

  return (
    <>
      <group
        name="board-grid"
        onClick={(e: ThreeEvent<MouseEvent>) => {
          if (selected && isTap(e)) {
            setSelected(null);
            setLegalMoves([]);
          }
        }}
      >
        {/* Cell boxes: raycast targets for selecting a destination and for the
            empty-space click that clears the selection. Destination cells get a
            faint fill, the last move's cells another, and every other cell is
            not drawn at all; everything else visible about a destination is
            drawn by the markers. The flags reflect what is drawn: a
            legal-destination fill replaces the last-move fill on a shared cell. */}
        {CELLS.map((cell) => {
          const cellKey = toZXY(cell);
          const isDest = isHighlighted(cell);
          const isLastTo = !isDest && cellKey === lastToKey;
          const isLastFrom = !isDest && !isLastTo && cellKey === lastFromKey;
          const material = isDest
            ? design.cellFills.destination
            : isLastTo || isLastFrom
              ? design.cellFills.lastMove
              : noFill;
          return (
            <mesh
              key={cellKey}
              position={worldOf(cell)}
              geometry={cellGeometry}
              material={material}
              visible={material !== noFill}
              userData={{
                highlight: isDest,
                lastMoveFrom: isLastFrom,
                lastMoveTo: isLastTo,
                cube: true,
                zxy: cellKey,
              }}
              // Clicking a highlighted cube plays the move
              onClick={
                isDest
                  ? (e: ThreeEvent<MouseEvent>) => {
                      e.stopPropagation();
                      if (isTap(e)) handleCubeClick(cell);
                    }
                  : undefined
              }
            />
          );
        })}
        {pieces.map(({ type, color, coord }) => {
          const key = toZXY(coord);
          const inCheck = type === PieceType.King && checked.includes(color);
          const mesh = (
            <PieceMesh
              key={`${type}-${color}-${key}`}
              type={type}
              color={color}
              position={worldOf(coord)}
              onClick={pieceHandlers.get(key)}
              {...(design.hoverLift ? hoverHandlers.get(key) : {})}
              selected={isSelected(coord)}
              hovered={design.hoverLift === true && hovered === key && canPick(coord)}
              inCheck={inCheck}
              mated={type === PieceType.King && color === matedColor}
              facing={knightFacing(color)}
              // Check trumps selection for the king's glow
              emissive={
                inCheck ? theme.check : isSelected(coord) ? theme.selectEmissive : '#000000'
              }
            />
          );
          // The just-moved piece glides in from its source cell. Piece keys are
          // position-derived and can recur across moves, so the wrapper is keyed
          // by moveCount: every new move mounts a fresh tween, superseding one
          // still in flight.
          if (animate && lastMove && key === lastToKey) {
            return (
              <MoveGlide
                key={`anim-${lastMove.moveCount}`}
                from={worldOf(lastMove.move.from)}
                to={worldOf(coord)}
                motion={design.motion}
                floorY={layout.floorY}
              >
                {mesh}
              </MoveGlide>
            );
          }
          return mesh;
        })}
      </group>
      {/* Everything else is decoration, outside the group that takes pointer
          events: r3f only raycasts objects with handlers and their children,
          so nothing here can intercept a click meant for a cell or piece. */}
      <group name="board-decor">
        <design.Grid layout={layout} orientation={orientation} />
        {destinations.map(({ to, capture }) =>
          capture ? (
            <Capture key={`capture-${toZXY(to)}`} {...markerAt(to)} />
          ) : (
            <Quiet key={`quiet-${toZXY(to)}`} {...markerAt(to)} />
          ),
        )}
        {selected && <Selection {...markerAt(selected)} />}
        {LastMove && lastMove && (
          <LastMove from={markerAt(lastMove.move.from)} to={markerAt(lastMove.move.to)} />
        )}
        {Check &&
          checkedKings.map(({ color, coord }) => (
            <Check key={`check-${color}`} {...markerAt(coord)} />
          ))}
        {animate && lastMove && design.MoveFx && (
          <design.MoveFx
            key={`movefx-${lastMove.moveCount}`}
            from={worldOf(lastMove.move.from)}
            to={worldOf(lastMove.move.to)}
            color={board.getPiece(lastMove.move.to)?.color ?? 'white'}
            piece={board.getPiece(lastMove.move.to)?.type ?? PieceType.Pawn}
            capture={!!lastMove.capturedPiece}
            durationMs={design.motion.durationMs}
          />
        )}
        {animate &&
          lastMove?.capturedPiece &&
          (design.CaptureFx ? (
            <design.CaptureFx
              key={`capturefx-${lastMove.moveCount}`}
              {...markerAt(lastMove.move.to)}
              victim={lastMove.capturedPiece}
              durationMs={design.motion.durationMs}
            />
          ) : (
            <GhostPiece
              key={`ghost-${lastMove.moveCount}`}
              type={lastMove.capturedPiece.type}
              color={lastMove.capturedPiece.color}
              position={worldOf(lastMove.move.to)}
            />
          ))}
        {matedKing && design.Celebration && (
          <design.Celebration
            {...markerAt(matedKing.coord)}
            winner={props.gameOver?.winner ?? null}
          />
        )}
      </group>
    </>
  );
};

export default Board;
