import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { BoxGeometry, MeshBasicMaterial, Raycaster, Vector2 } from 'three';
import type { Group, Object3D } from 'three';
import { Board as EngineBoard } from '../engine';
import type { Move, Piece } from '../engine';
import { PieceMesh } from './PieceMesh';
import { PieceType } from '../engine/pieces';
import { Coord, fromZXY, sameCoord, toZXY } from '../engine/coords';
import { CELLS } from './layout';
import { contactAtMs, planGlide, touchdownMs } from './glide';
import type { GlidePlan } from './glide';
import { MoveGlide } from './moveAnimation';
import { PIECE_LIFT } from './pieceMotion';
import { prefersReducedMotion } from './motion';
import { useMateTuning } from '../lib/mateTuning';
import { isTap } from './tap';
import { useExactClicks } from './exactClicks';
import { useTapAssist } from './useTapAssist';
import type { AssistedTap } from './useTapAssist';
import type { LevelFocus, MarkerProps, PieceColor, Vec3 } from './types';
import { resolveHover } from './hover';
import type { FloorSquare } from './hover';
import { CaptureFx, Celebration } from './scene/fx';
import { TEETER_STRIKE_MS } from './pieceMotion';
import { fallAway } from './mate';
import { Grid } from './scene/grid';
import { Capture, Check, LastMove, Quiet } from './scene/markers';
import { KNIGHT_YAW, layout, PIECE_SCALE } from './scene/palette';
import { Selection } from './scene/selection';
import { pieceArrival } from './intro/timeline';

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

export interface LastMoveInfo {
  move: Move;
  /** Total moves played; increments exactly once per new move. */
  moveCount: number;
  /** Piece that stood on move.to before the move, if the move captured. */
  capturedPiece: Piece | null;
}

export interface BoardProps {
  currentTurn: PieceColor;
  playerColor?: PieceColor | null;
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
  gameOver?: { result: 'checkmate' | 'stalemate'; winner?: PieceColor } | null;
  /** Whether to draw the coordinate labels (on by default; the landing preview has none). */
  labels?: boolean;
}

const Board = (props: BoardProps) => {
  const board = props.board;
  // A click is aimed where it was released, as its press was (exactClicks.ts)
  useExactClicks();
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
  const mountMoveCount = useRef(lastMove?.moveCount ?? 0);
  const tuning = useMateTuning();
  const animate =
    !!lastMove && lastMove.moveCount > mountMoveCount.current && !prefersReducedMotion();
  // What a live move brings about for the kings (a check's strike, a mate's
  // topple and pulse) waits for the moving piece to land (MoveGlide's
  // onLanded); a move from history shows it at once.
  const [landedMove, setLandedMove] = useState(mountMoveCount.current);
  const landing = animate && !!lastMove && lastMove.moveCount > landedMove;
  const lastToKey = lastMove ? toZXY(lastMove.move.to) : null;

  // State for selected piece and its legal moves
  const [selected, setSelected] = useState<null | Coord>(null);
  const [legalMoves, setLegalMoves] = useState<Move[]>([]);
  // The held piece as of now, not as of the last render: a move clears it at
  // once, so nothing later in the same event (or before the next render) can
  // play it again
  const held = useRef<Coord | null>(null);
  const choose = (coord: Coord | null, moves: Move[] = []) => {
    held.current = coord;
    setSelected(coord);
    setLegalMoves(moves);
  };
  // One click, one action. r3f hands a click to every object under the
  // pointer, nearest first, until one stops it, and the board's own group
  // (the empty squares) hears it once for each square the ray crosses before
  // it reaches a piece or destination behind them. So a piece or destination
  // takes the click at once, and the group acts only after r3f is done, if
  // nothing took it (a finger's tap once sent a capture three times).
  const taken = useRef(new WeakSet<object>());
  const take = (event: object | undefined) => {
    if (!event) return true;
    if (taken.current.has(event)) return false;
    taken.current.add(event);
    return true;
  };
  // The piece under the pointer, which lifts.
  const [hovered, setHovered] = useState<string | null>(null);
  // The cell (or the piece on it) under the pointer: its destination marker
  // brightens, its level stands out, and the HUD reads it out.
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);
  // The piece the player has just played, held up until its move comes back
  // (so its glide sets off from where the player's hand left it), and the
  // piece last tapped in vain, with a count so each tap answers
  const [carried, setCarried] = useState<Coord | null>(null);
  const [refused, setRefused] = useState<{ key: string; count: number } | null>(null);

  // A selection made against an earlier position is stale once the board or
  // turn changes (e.g. the opponent's move arrives) — clear it so a stale
  // highlighted destination can't be sent as a move. Disabling the board
  // (reconnect in progress, broken replay) clears it for the same reason.
  useEffect(() => {
    held.current = null;
    setSelected(null);
    // (The same empty list when nothing was held, so a move landing with no
    // piece picked up renders the board once, not twice)
    setLegalMoves((moves) => (moves.length === 0 ? moves : []));
  }, [props.board, props.currentTurn, props.disabled]);
  // The played piece goes down once its move is back (a new board), or once
  // the board takes input again without it (the move refused)
  useEffect(() => setCarried(null), [props.board]);
  useEffect(() => {
    if (!props.disabled) setCarried(null);
  }, [props.disabled]);

  // How the latest move glides, fixed when it arrives
  const glidePlan = useRef<{ count: number; plan: GlidePlan } | null>(null);
  if (animate && lastMove && glidePlan.current?.count !== lastMove.moveCount) {
    const { from, to } = lastMove.move;
    const lift = carried && sameCoord(carried, from) ? PIECE_LIFT.selected * PIECE_SCALE : 0;
    glidePlan.current = {
      count: lastMove.moveCount,
      plan: planGlide(worldOf(from), worldOf(to), {
        lift,
        capture: !!lastMove.capturedPiece,
      }),
    };
  }
  const plan = animate ? glidePlan.current?.plan : undefined;

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
    if (selected && sameCoord(selected, coord)) {
      choose(null);
      return;
    }
    if (!canPick(coord)) {
      // Not this player's to pick up (yet): it shakes its head
      if (!props.disabled) {
        const key = toZXY(coord);
        setRefused((r) => ({ key, count: (r?.count ?? 0) + 1 }));
      }
      return;
    }
    // generateLegalMoves already filters out moves into check
    choose(coord, board.generateLegalMoves(coord));
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
    latestCubeClick.current = handleCubeClick;
  });
  const pieceHandlers = useMemo(
    () =>
      new Map(
        CELLS.map((cell) => [
          toZXY(cell),
          (e: ThreeEvent<MouseEvent>) => {
            e.stopPropagation();
            if (isTap(e) && take(e.nativeEvent)) latestPieceTap.current(cell, e.nativeEvent);
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

  // Each cell box's props, the same objects from one render to the next:
  // r3f redraws the canvas for any prop it is handed anew, and the board
  // renders for things no cell shows (the board disabled while a move goes
  // to the server, a hover), which would each draw a frame identical to the
  // last. Its click plays the move through the latest closure.
  const latestCubeClick = useRef<(cell: Coord) => void>(() => {});
  const cellProps = useMemo(
    () =>
      new Map(
        CELLS.map((cell) => {
          const zxy = toZXY(cell);
          return [
            zxy,
            {
              idle: { highlight: false, cube: true, zxy },
              destination: { highlight: true, cube: true, zxy },
              onClick: (e: ThreeEvent<MouseEvent>) => {
                e.stopPropagation();
                if (isTap(e) && take(e.nativeEvent)) latestCubeClick.current(cell);
              },
            },
          ];
        }),
      ),
    [],
  );

  // Handle highlighted cube click (move application)
  const handleCubeClick = (targetCoord: Coord) => {
    if (props.disabled || !selected || !held.current) return;
    // Several legal moves share a destination only when a pawn promotes there
    // (one per promotion piece); otherwise there is exactly one.
    const choices = legalMoves.filter((m) => sameCoord(m.to, targetCoord));
    if (choices.length === 0) return; // Should not happen if cube is highlighted

    // Put the piece down first, so the move cannot be played twice
    choose(null);
    if (choices.length > 1 && props.onChoosePromotion) {
      props.onChoosePromotion(choices);
    } else if (props.onMove) {
      setCarried(selected);
      props.onMove(choices.find((m) => m.promotion === PieceType.Queen) ?? choices[0]);
    }
  };

  // Helper to check if a cube is a legal move destination
  const isHighlighted = (coord: Coord) => legalMoves.some((m) => sameCoord(m.to, coord));

  // Distinct destination cells (promotions produce several moves per cell),
  // split by whether the move is a capture, to pick the marker shape.
  const destinations = [...new Map(legalMoves.map((m) => [toZXY(m.to), m.to])).values()].map(
    (to) => ({ to, capture: !!board.getPiece(to) }),
  );

  const isSelected = (c: Coord) => !!selected && sameCoord(selected, c);

  // Kings standing in check, with where they stand (once a live move has landed).
  const checkedKings = landing
    ? []
    : pieces.filter(({ type, color }) => type === PieceType.King && board.inCheck(color));
  const checked = checkedKings.map(({ color }) => color);
  const matedColor =
    !landing && props.gameOver?.result === 'checkmate' && props.gameOver.winner
      ? props.gameOver.winner === 'white'
        ? 'black'
        : 'white'
      : null;
  // A knight looks along the ranks — toward the opponent — turned a little to
  // show its profile.
  const knightFacing = (color: PieceColor) =>
    (color === orientation ? 1 : -1) * (Math.PI / 2 - KNIGHT_YAW);
  const matedKing = pieces.find(
    ({ type, color }) => type === PieceType.King && color === matedColor,
  );

  // --- The mate (lib/mateStyle.ts): the mating piece's arrival knocks the
  // king back, away from it, and he teeters at the edge of his balance and
  // falls, and as he strikes, the winning army hops in a
  // wave out from him. Its beats count from the mating move's landing, and
  // play out only for a mate that arrived live: from history he just falls.
  const matedSquare = matedKing && toZXY(matedKing.coord);
  const mate = useMemo(() => {
    if (!matedKing || !props.gameOver?.winner || !lastMove) return null;
    const live = animate;
    const winner = props.gameOver.winner;
    const king = worldOf(matedKing.coord);
    const away = fallAway(king, worldOf(lastMove.move.to));
    // The winning army's cheer
    const cheer = new Map<string, number>();
    if (live) {
      for (const { color, coord } of pieces) {
        if (color !== winner) continue;
        const [x, y, z] = worldOf(coord);
        const far = Math.hypot(x - king[0], y - king[1], z - king[2]);
        cheer.set(
          toZXY(coord),
          TEETER_STRIKE_MS + tuning.waveDelayMs + (1000 * far) / tuning.waveSpeed,
        );
      }
    }
    return { live, away, cheer };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fixed when the mate arrives
  }, [
    matedSquare,
    props.gameOver,
    lastMove?.moveCount,
    animate,
    tuning.waveSpeed,
    tuning.waveDelayMs,
  ]);

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
  // A click that reached nothing the player can act on
  const handleEmptyTap = (event: MouseEvent | undefined) => {
    const meant = assisted(event);
    if (meant) actOn(meant);
    else if (selected) choose(null);
  };
  const latestEmptyTap = useRef(handleEmptyTap);
  useLayoutEffect(() => {
    latestEmptyTap.current = handleEmptyTap;
  });

  const selectedLevel = selected?.z ?? null;
  const hoveredLevel = hoveredCell ? fromZXY(hoveredCell).z : null;
  const focus = useMemo<LevelFocus>(
    () => ({ selected: selectedLevel, hovered: hoveredLevel }),
    [selectedLevel, hoveredLevel],
  );

  // The same handlers from one render to the next (as the cells', above)
  const emptyTaps = useMemo(
    () => ({
      onClick: (e: ThreeEvent<MouseEvent>) => {
        if (!isTap(e)) return;
        // After r3f has offered the click to everything behind this square
        const event = e.nativeEvent;
        queueMicrotask(() => {
          if (take(event)) latestEmptyTap.current(event);
        });
      },
      onPointerMissed: (event: MouseEvent) => {
        if (take(event)) latestEmptyTap.current(event);
      },
    }),
    [],
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
        onClick={emptyTaps.onClick}
        onPointerMissed={emptyTaps.onPointerMissed}
      >
        {/* Cell boxes: raycast targets for selecting a destination and for the
            empty-space click that clears the selection, never drawn. */}
        {CELLS.map((cell) => {
          const cellKey = toZXY(cell);
          const isDest = isHighlighted(cell);
          const { idle, destination, onClick } = cellProps.get(cellKey)!;
          return (
            <mesh
              key={cellKey}
              position={worldOf(cell)}
              geometry={cellGeometry}
              material={cellMaterial}
              visible={false}
              userData={isDest ? destination : idle}
              // Clicking a highlighted cube plays the move
              onClick={isDest ? onClick : undefined}
            />
          );
        })}
        {pieces.map(({ type, color, coord }) => {
          const key = toZXY(coord);
          const inCheck = type === PieceType.King && checked.includes(color);
          const isMated = type === PieceType.King && color === matedColor;
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
              mated={isMated}
              teeter={isMated && !!mate?.live}
              fallAway={isMated ? mate?.away : undefined}
              cheerAt={mate?.cheer.get(key)}
              carried={!!carried && sameCoord(carried, coord)}
              refused={refused?.key === key ? refused.count : 0}
              facing={knightFacing(color)}
              arrival={pieceArrival({ type, color, ...coord })}
            />
          );
          // The just-moved piece glides in from its source cell. Piece keys are
          // position-derived and can recur across moves, so the wrapper is keyed
          // by moveCount: every new move mounts a fresh tween, superseding one
          // still in flight.
          if (plan && lastMove && key === lastToKey) {
            return (
              <MoveGlide
                key={`anim-${lastMove.moveCount}`}
                plan={plan}
                fromLevel={lastMove.move.from.z}
                toLevel={coord.z}
                onLanded={() => setLandedMove((n) => Math.max(n, lastMove.moveCount))}
                // The mate's knock (and a check's strike) as it looks landed
                landsEarlyMs={tuning.knockLeadMs}
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
        <Grid layout={layout} orientation={orientation} focus={focus} labels={props.labels} />
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
            glideMs={plan ? touchdownMs(plan) : 0}
          />
        )}
        {checkedKings.map(({ color, coord }) => (
          <Check
            key={`check-${color}`}
            {...markerAt(coord)}
            {...(color === matedColor ? { mated: true } : {})}
          />
        ))}
        {plan && lastMove?.capturedPiece && (
          <CaptureFx
            key={`capturefx-${lastMove.moveCount}`}
            {...markerAt(lastMove.move.to)}
            victim={lastMove.capturedPiece}
            victimFacing={knightFacing(lastMove.capturedPiece.color)}
            hitMs={contactAtMs(plan) ?? touchdownMs(plan)}
            landMs={touchdownMs(plan)}
            heading={plan.heading}
            orientation={orientation}
          />
        )}
        {matedKing && mate && (
          <Celebration
            {...markerAt(matedKing.coord)}
            speed={tuning.pulseSpeed}
            // The pulse leaves as he strikes the floor
            delayMs={mate.live ? TEETER_STRIKE_MS - 60 : 0}
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
  probe: RefObject<(raycaster: Raycaster | null) => string | null>;
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
