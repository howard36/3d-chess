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
import { MoveGlide } from './moveAnimation';
import { prefersReducedMotion } from './motion';
import { isTap } from './tap';
import { useSetting } from './settings';
import { useTapAssist } from './useTapAssist';
import type { AssistedTap } from './useTapAssist';
import { moveArc } from './movePath';
import type { KnightMoves } from './movePath';
import type { LevelFocus, MarkerProps, Vec3 } from './types';
import { resolveHover } from './hover';
import type { FloorSquare } from './hover';
import { CaptureFx, Celebration } from './scene/fx';
import { Grid } from './scene/grid';
import { Capture, Check, LastMove, Quiet } from './scene/markers';
import { KNIGHT_YAW, layout, MOTION } from './scene/palette';
import { Selection } from './scene/selection';

// The 125 cell boxes are click targets only, never drawn: every one is
// `visible={false}`, and three's Raycaster tests layers, not visibility, so
// they still catch destination clicks and the empty-space click that clears
// a selection. They share one geometry and one material (never drawn, but
// Mesh.raycast bails without one); everything visible about a cell is drawn
// on its floor by the markers.
//
// Each box is a thin slab standing on its cell's floor (the mesh stays at the
// cell's centre; its geometry is shifted down), so a click lands on the
// square whose floor is under the pointer.
const cellGeometry = new BoxGeometry(
  layout.cellSize[0],
  layout.hitHeight,
  layout.cellSize[2],
).translate(0, layout.floorY + layout.hitHeight / 2, 0);
const cellMaterial = new MeshBasicMaterial();

// Drops a cell-centre position to the cell floor, the plane a piece's base
// stands on and every marker lies on: a mark read as lying on the ground would
// skewer the piece in its cell at the cell's centre. Pieces are modeled
// base-at-y=0 and are shorter than their cell, so they stand on its floor
// rather than centred in it.
const atCellFloor = ([x, y, z]: Vec3): Vec3 => [x, y + layout.floorY, z];

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
  /** Set once the game has ended: the mated king topples. */
  gameOver?: { result: 'checkmate' | 'stalemate'; winner?: BoardTurn } | null;
  /** Told which cell the pointer is on (null when it is on none), for the HUD's readout. */
  onHoverCell?: (cell: HoveredCell | null) => void;
}

const Board = (props: BoardProps) => {
  const board = props.board;
  // Spectators (no assigned colour) get White's view.
  const orientation = props.playerColor ?? 'white';

  // World position of every cell, computed once per orientation. PieceMesh is
  // memoized on a shallow prop comparison, so the position it receives has to
  // be the same array from one render to the next, not a fresh toWorld result.
  const worldPositions = useMemo(
    () => new Map(CELLS.map((cell) => [toZXY(cell), layout.toWorld(cell, orientation)])),
    [orientation],
  );
  const worldOf = (cell: Coord) => worldPositions.get(toZXY(cell))!;
  const markerAt = (cell: Coord): MarkerProps => ({ floor: atCellFloor(worldOf(cell)) });

  const lastMove = props.lastMove;
  // Moves already played when this board mounted are history (a rejoin
  // replay): they keep their highlight but must not animate.
  const mountMoveCount = React.useRef(lastMove?.moveCount ?? 0);
  const animate =
    !!lastMove && lastMove.moveCount > mountMoveCount.current && !prefersReducedMotion();
  const lastToKey = lastMove ? toZXY(lastMove.move.to) : null;
  // Every move runs straight; a knight arcs when the player asks for it (a
  // setting). The glide and the last-move line both take this one arc.
  const knightMoves = useSetting<KnightMoves>('piece.knightMoves');
  const lastArc = lastMove
    ? moveArc(layout, board.getPiece(lastMove.move.to)?.type, lastMove.move.promotion, knightMoves)
    : 0;

  // State for selected piece and its legal moves
  const [selected, setSelected] = useState<null | Coord>(null);
  const [legalMoves, setLegalMoves] = useState<Move[]>([]);
  // The piece under the pointer, which lifts.
  const [hovered, setHovered] = useState<string | null>(null);
  // The cell (or the piece on it) under the pointer: its destination marker
  // brightens, its level stands out, and the HUD reads it out.
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);

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

  // A tap on a piece the player can act on (pick up, put down, capture) acts
  // on it; a finger's tap on any other piece goes to what it was meant for
  // (tap assist, below), if anything
  const handlePieceTap = (coord: Coord, event: MouseEvent) => {
    const actionable = canPick(coord) || (!!selected && isHighlighted(coord));
    const meant = actionable ? null : assisted(event);
    if (meant) actOn(meant);
    else handlePieceClick(coord);
  };

  // Same reason as worldPositions: each piece gets a handler whose identity
  // never changes, delegating to the latest closure through a ref.
  const latestPieceTap = useRef(handlePieceTap);
  const latestCanPick = useRef(canPick);
  useLayoutEffect(() => {
    latestPieceTap.current = handlePieceTap;
    latestCanPick.current = canPick;
  });
  const pieceHandlers = useMemo(
    () =>
      new Map(
        CELLS.map((cell) => [
          toZXY(cell),
          (e: ThreeEvent<MouseEvent>) => {
            e.stopPropagation();
            if (isTap(e)) latestPieceTap.current(cell, e.nativeEvent);
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
  // A knight looks along the ranks — toward the opponent — turned a little to
  // show its profile.
  const knightFacing = (color: BoardTurn) =>
    (color === orientation ? 1 : -1) * (Math.PI / 2 - KNIGHT_YAW);
  const matedKing = pieces.find(
    ({ type, color }) => type === PieceType.King && color === matedColor,
  );

  // --- Hover: the cell under the pointer, from the pointer's ray (see hover.ts)
  const grid = useRef<Group>(null);
  const floors = useMemo<FloorSquare[]>(
    () => CELLS.map((cell) => ({ key: toZXY(cell), floor: atCellFloor(worldOf(cell)) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- worldOf reads worldPositions
    [worldPositions],
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
  // --- Tap assist: a finger's tap that reaches nothing the player can act on
  // goes to the nearest thing they can (an own piece, a destination) within a
  // finger's reach (tapAssist.ts). A mouse click is never assisted.
  const assistTap = useTapAssist(grid, (o) => cellAt.get(o.position.toArray().join(',')));
  const assisted = (event: MouseEvent | undefined) =>
    assistTap(event, {
      pieces: new Set(
        pieces.filter(({ coord }) => canPick(coord)).map(({ coord }) => toZXY(coord)),
      ),
      destinations: destinationKeys,
      holding: !!selected,
    });
  const actOn = ({ cell, kind }: AssistedTap) =>
    kind === 'destination' ? handleCubeClick(fromZXY(cell)) : handlePieceClick(fromZXY(cell));

  const onHoverCell = props.onHoverCell;
  const hoveredPiece = hoveredCell ? board.getPiece(fromZXY(hoveredCell)) : null;
  useEffect(() => {
    onHoverCell?.(hoveredCell ? { zxy: hoveredCell, piece: hoveredPiece } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the piece is read with the cell
  }, [onHoverCell, hoveredCell, hoveredPiece?.type, hoveredPiece?.color]);
  useEffect(() => () => onHoverCell?.(null), [onHoverCell]);

  const selectedLevel = selected?.z ?? null;
  const hoveredLevel = hoveredCell ? fromZXY(hoveredCell).z : null;
  const focus = useMemo<LevelFocus>(
    () => ({ selected: selectedLevel, hovered: hoveredLevel }),
    [selectedLevel, hoveredLevel],
  );

  return (
    <>
      <HoverProbe probe={latestProbe} onHover={setHoveredCell} />
      <group
        ref={grid}
        name="board-grid"
        // A click on an empty square puts the selection down, and so does one
        // that hits nothing on the board (the sky, the gap between levels);
        // r3f reports only taps as misses, never the end of a drag round the
        // board. A finger's tap goes first to anything actionable in reach.
        onClick={(e: ThreeEvent<MouseEvent>) => {
          if (!isTap(e)) return;
          const meant = assisted(e.nativeEvent);
          if (meant) actOn(meant);
          else if (selected) {
            setSelected(null);
            setLegalMoves([]);
          }
        }}
        onPointerMissed={(event: MouseEvent) => {
          const meant = assisted(event);
          if (meant) actOn(meant);
          else if (selected) {
            setSelected(null);
            setLegalMoves([]);
          }
        }}
      >
        {/* Cell boxes: raycast targets for selecting a destination and for the
            empty-space click that clears the selection, never drawn. */}
        {CELLS.map((cell) => {
          const cellKey = toZXY(cell);
          const isDest = isHighlighted(cell);
          return (
            <mesh
              key={cellKey}
              position={worldOf(cell)}
              geometry={cellGeometry}
              material={cellMaterial}
              visible={false}
              userData={{ highlight: isDest, cube: true, zxy: cellKey }}
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
              {...hoverHandlers.get(key)}
              selected={isSelected(coord)}
              hovered={hovered === key && canPick(coord)}
              inCheck={inCheck}
              level={coord.z}
              mated={type === PieceType.King && color === matedColor}
              facing={knightFacing(color)}
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
                durationMs={MOTION.durationMs}
                arc={lastArc}
                fromLevel={lastMove.move.from.z}
                toLevel={coord.z}
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
        <Grid layout={layout} orientation={orientation} focus={focus} />
        {destinations.map(({ to, capture }) => {
          const key = toZXY(to);
          const hovered = hoveredCell === key;
          return capture ? (
            <Capture key={`capture-${key}`} {...markerAt(to)} hovered={hovered} />
          ) : (
            <Quiet key={`quiet-${key}`} {...markerAt(to)} hovered={hovered} />
          );
        })}
        {/* Keyed by square, so selecting another piece plays its entrance again */}
        {selected && <Selection key={`selection-${toZXY(selected)}`} {...markerAt(selected)} />}
        {/* Keyed by move: an entrance the marker plays on mount (when fresh)
            plays once per move, and not again on a reconnect */}
        {lastMove && (
          <LastMove
            key={`lastmove-${lastMove.moveCount}`}
            from={markerAt(lastMove.move.from)}
            to={markerAt(lastMove.move.to)}
            fresh={animate}
            arc={lastArc}
          />
        )}
        {checkedKings.map(({ color, coord }) => (
          <Check
            key={`check-${color}`}
            {...markerAt(coord)}
            {...(color === matedColor ? { mated: true } : {})}
          />
        ))}
        {animate && lastMove?.capturedPiece && (
          <CaptureFx
            key={`capturefx-${lastMove.moveCount}`}
            {...markerAt(lastMove.move.to)}
            victim={lastMove.capturedPiece}
            victimFacing={knightFacing(lastMove.capturedPiece.color)}
            durationMs={MOTION.durationMs}
            orientation={orientation}
          />
        )}
        {matedKing && <Celebration {...markerAt(matedKing.coord)} />}
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
