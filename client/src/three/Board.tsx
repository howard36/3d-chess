import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { BoxGeometry, MeshBasicMaterial, Raycaster, Vector2 } from 'three';
import type { Group, Object3D } from 'three';
import { Board as EngineBoard } from '../engine';
import type { Move, Piece } from '../engine';
import { PieceMesh } from './PieceMesh';
import React from 'react';
import { PieceType } from '../engine/pieces';
import { Coord, fromZXY, toZXY } from '../engine/coords';
import { CELLS } from './layout';
import { GhostPiece, MoveGlide } from './moveAnimation';
import { prefersReducedMotion } from './motion';
import { theme } from './theme';
import { isTap } from './tap';
import { useDesign, useKnightMoves } from './designs/context';
import { moveArc } from './movePath';
import type { BoardLayout, LevelFocus, MarkerProps, Vec3 } from './designs/types';
import { resolveHover } from './hover';
import type { FloorSquare } from './hover';

// The 125 cell boxes share one geometry and one of three materials instead of
// owning a BoxGeometry and a transparent material each. A cell with nothing
// to draw is `visible={false}`: three's Raycaster tests layers, not
// visibility, so it still catches destination clicks and the empty-space
// click that clears a selection, while the renderer never queues it. It keeps
// a (never drawn) material because Mesh.raycast bails without one. The fills
// themselves come from the design.
//
// A layout with a `hitHeight` gets thin boxes standing on each cell's floor
// (the mesh stays at the cell's centre; its geometry is shifted down), so a
// click lands on the square whose floor is under the pointer.
const cellGeometries = new Map<string, BoxGeometry>();
const cellGeometryFor = (layout: BoardLayout) => {
  const { cellSize, hitHeight, floorY } = layout;
  const key = `${cellSize.join(',')}/${hitHeight ?? ''}/${floorY}`;
  let geometry = cellGeometries.get(key);
  if (!geometry) {
    geometry =
      hitHeight === undefined
        ? new BoxGeometry(...cellSize)
        : new BoxGeometry(cellSize[0], hitHeight, cellSize[2]).translate(
            0,
            floorY + hitHeight / 2,
            0,
          );
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

/** The cell under the pointer, and what stands on it. */
export interface HoveredCell {
  zxy: string;
  piece: Piece | null;
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
  /**
   * Told which cell the pointer is on (null when it is on none), for designs
   * with `hud.readout` or `hoverDestinations`.
   */
  onHoverCell?: (cell: HoveredCell | null) => void;
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
  // Every move runs straight; a knight arcs when the player asks for it. The
  // glide, the last-move line and the move's effects all take this one arc.
  const knightMoves = useKnightMoves();
  const lastArc = lastMove
    ? moveArc(layout, board.getPiece(lastMove.move.to)?.type, lastMove.move.promotion, knightMoves)
    : 0;

  // State for selected piece and its legal moves
  const [selected, setSelected] = useState<null | Coord>(null);
  const [legalMoves, setLegalMoves] = useState<Move[]>([]);
  // The piece under the pointer, when the design lifts pieces on hover.
  const [hovered, setHovered] = useState<string | null>(null);
  // The cell (or the piece on it) under the pointer, for designs that
  // brighten the destination there, emphasise its level, or read it out.
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);
  const trackHover = design.hoverDestinations === true || design.hud.readout === true;

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
    // A second click on the selected piece puts it back down
    if (selected && coordEquals(selected, coord)) {
      setSelected(null);
      setLegalMoves([]);
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
  // On a stacked board a knight looks along the ranks — toward the opponent —
  // turned a little to show its profile. (The lattice keeps PieceMesh's
  // default turn, which already shows the profile to the opening camera.)
  const knightFacing = (color: BoardTurn) =>
    layout.kind === 'tower'
      ? (color === orientation ? 1 : -1) * (Math.PI / 2 - (design.knightYaw ?? 0.5))
      : undefined;
  const matedKing = pieces.find(
    ({ type, color }) => type === PieceType.King && color === matedColor,
  );

  // --- Hover: the cell under the pointer, from the pointer's ray (see hover.ts)
  const grid = useRef<Group>(null);
  const floors = useMemo<FloorSquare[]>(
    () => CELLS.map((cell) => ({ key: toZXY(cell), floor: atCellFloor(worldOf(cell), layout) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- worldOf reads worldPositions
    [worldPositions, layout],
  );
  const cellAt = useMemo(
    () => new Map([...worldPositions].map(([key, p]) => [p.join(','), key])),
    [worldPositions],
  );
  const destinationKeys = new Set(destinations.map(({ to }) => toZXY(to)));
  const probe = (raycaster: Raycaster | null) => {
    if (!raycaster || !grid.current) return null;
    // The pieces (a gliding piece sits in a MoveGlide wrapper)
    const bodies: Object3D[] = [];
    for (const child of grid.current.children) {
      if (child.userData.piece) bodies.push(child);
      else if (child.userData.moveGlide) {
        child.traverse((o) => {
          if (o.userData.piece) bodies.push(o);
        });
      }
    }
    let pieceHit: { key: string; distance: number } | null = null;
    for (const hit of raycaster.intersectObjects(bodies, true)) {
      let o: Object3D | null = hit.object;
      while (o && !o.userData.piece) o = o.parent;
      const key = o && cellAt.get(o.position.toArray().join(','));
      if (key) {
        pieceHit = { key, distance: hit.distance };
        break;
      }
    }
    const { origin, direction } = raycaster.ray;
    return resolveHover(
      { origin: origin.toArray(), direction: direction.toArray() },
      floors,
      [layout.cellSize[0] / 2 + 0.011, layout.cellSize[2] / 2 + 0.011],
      pieceHit,
      destinationKeys,
    );
  };
  const latestProbe = useRef(probe);
  useLayoutEffect(() => {
    latestProbe.current = probe;
  });
  const onHoverCell = props.onHoverCell;
  const hoveredPiece = hoveredCell ? board.getPiece(fromZXY(hoveredCell)) : null;
  useEffect(() => {
    if (trackHover) onHoverCell?.(hoveredCell ? { zxy: hoveredCell, piece: hoveredPiece } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the piece is read with the cell
  }, [trackHover, onHoverCell, hoveredCell, hoveredPiece?.type, hoveredPiece?.color]);
  useEffect(() => () => onHoverCell?.(null), [onHoverCell]);

  const selectedLevel = selected?.z ?? null;
  const hoveredLevel = hoveredCell ? fromZXY(hoveredCell).z : null;
  const focus = useMemo<LevelFocus>(
    () => ({ selected: selectedLevel, hovered: hoveredLevel }),
    [selectedLevel, hoveredLevel],
  );

  return (
    <>
      {trackHover && <HoverProbe probe={latestProbe} onHover={setHoveredCell} />}
      <group
        ref={grid}
        name="board-grid"
        onClick={(e: ThreeEvent<MouseEvent>) => {
          if (selected && isTap(e)) {
            setSelected(null);
            setLegalMoves([]);
          }
        }}
        // A click that hits nothing on the board (the sky, the gap between
        // levels) puts the selection down too; r3f reports only taps as
        // misses, never the end of a drag round the board
        onPointerMissed={() => {
          if (selected) {
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
          const material =
            (isDest
              ? design.cellFills.destination
              : isLastTo || isLastFrom
                ? design.cellFills.lastMove
                : noFill) ?? noFill;
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
              hovered={!!design.hoverLift && hovered === key && canPick(coord)}
              inCheck={inCheck}
              level={coord.z}
              mated={type === PieceType.King && color === matedColor}
              facing={knightFacing(color)}
              orientation={orientation}
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
                arc={lastArc}
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
        <design.Grid layout={layout} orientation={orientation} focus={focus} />
        {destinations.map(({ to, capture }) => {
          const key = toZXY(to);
          const hover = design.hoverDestinations ? { hovered: hoveredCell === key } : {};
          return capture ? (
            <Capture key={`capture-${key}`} {...markerAt(to)} {...hover} />
          ) : (
            <Quiet key={`quiet-${key}`} {...markerAt(to)} {...hover} />
          );
        })}
        {selected && <Selection {...markerAt(selected)} />}
        {/* Keyed by move: an entrance a design plays on mount (when fresh)
            plays once per move, and not again on a reconnect */}
        {LastMove && lastMove && (
          <LastMove
            key={`lastmove-${lastMove.moveCount}`}
            from={markerAt(lastMove.move.from)}
            to={markerAt(lastMove.move.to)}
            fresh={animate}
            arc={lastArc}
          />
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
            orientation={orientation}
            arc={lastArc}
          />
        )}
        {animate &&
          lastMove?.capturedPiece &&
          (design.CaptureFx ? (
            <design.CaptureFx
              key={`capturefx-${lastMove.moveCount}`}
              {...markerAt(lastMove.move.to)}
              victim={lastMove.capturedPiece}
              victimFacing={knightFacing(lastMove.capturedPiece.color)}
              durationMs={design.motion.durationMs}
              orientation={orientation}
            />
          ) : (
            <GhostPiece
              key={`ghost-${lastMove.moveCount}`}
              type={lastMove.capturedPiece.type}
              color={lastMove.capturedPiece.color}
              position={worldOf(lastMove.move.to)}
              level={lastMove.move.to.z}
            />
          ))}
        {matedKing && design.Celebration && (
          <design.Celebration
            {...markerAt(matedKing.coord)}
            winner={props.gameOver?.winner ?? null}
            orientation={orientation}
          />
        )}
      </group>
    </>
  );
};

/**
 * Follows the pointer over the canvas and asks `probe` which cell is under
 * it: on every pointer move, whenever the camera moves (a wheel zoom leaves
 * the pointer still), and after every render of the board (a new position or
 * selection changes what is there).
 */
const HoverProbe = ({
  probe,
  onHover,
}: {
  probe: React.RefObject<(raycaster: Raycaster | null) => string | null>;
  onHover: (key: string | null) => void;
}) => {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as EventTarget | null;
  const pointer = useRef<Vector2 | null>(null);
  const raycaster = useMemo(() => new Raycaster(), []);
  const update = useRef(() => {});
  update.current = () => {
    if (!pointer.current) return onHover(null);
    raycaster.setFromCamera(pointer.current, camera);
    onHover(probe.current(raycaster));
  };
  useEffect(() => {
    const el = gl.domElement;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      pointer.current = new Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
      update.current();
    };
    const leave = () => {
      pointer.current = null;
      update.current();
    };
    const moved = () => update.current();
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    controls?.addEventListener?.('change', moved);
    return () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
      controls?.removeEventListener?.('change', moved);
    };
  }, [gl, controls]);
  // After the board's own effects, so the probe sees this render's position
  useEffect(() => update.current());
  return null;
};

export default Board;
