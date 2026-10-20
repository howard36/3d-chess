import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GameOver, LastMove as LastMoveInfo } from '../game/history';
import type { RefObject } from 'react';
import { useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import {
  BoxGeometry,
  CircleGeometry,
  DoubleSide,
  MeshBasicMaterial,
  Raycaster,
  Vector2,
} from 'three';
import type { Group, Object3D } from 'three';
import { Board as EngineBoard } from '../engine';
import type { Move, Piece } from '../engine';
import { PieceMesh } from './PieceMesh';
import { PieceType } from '../engine/pieces';
import { Coord, fromZXY, sameCoord, toZXY } from '../engine/coords';
import { CELLS } from './layout';
import { clearsSourceAtMs, contactAtMs, planGlide, screenScale, touchdownMs } from './glide';
import type { GlidePlan } from './glide';
import { MoveGlide, Reveal } from './moveAnimation';
import { PIECE_LIFT } from './pieceMotion';
import { prefersReducedMotion } from './motion';
import { MATE_TUNING } from '../lib/mate';
import { isTap } from './tap';
import { useExactClicks } from './exactClicks';
import { useTouchIntent } from './useTouchIntent';
import type { Actionable, DirectHit } from './useTouchIntent';
import type { LevelFocus, MarkerProps, PieceColor, Vec3 } from './types';
import { resolveHover } from './hover';
import type { HoverHit } from './hover';
import type { FloorSquare } from './hover';
import { CaptureFx, Celebration } from './scene/fx';
import { KNOCK_STRIKE_MS } from './pieceMotion';
import { fallAway } from './mate';
import { focusLevelOf } from './scene/focus';
import { Grid } from './scene/grid';
import { Better, Capture, Check, LastMove, Quiet } from './scene/markers';
import { knightFacing, layout, MARK_HOVER_GROW, MARK_RADIUS, PIECE_SCALE } from './scene/palette';
import { Selection } from './scene/selection';
import { pieceArrival } from './intro/timeline';
import { useEntranceReplay } from './replay';

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

// A destination takes the click on its mark alone, a disc on its floor the
// size of the mark grown under the pointer (MARK_RADIUS), not on its whole
// square: a click in a square's empty corners goes on to a mark beneath.
const markReach = {
  quiet: MARK_RADIUS.quiet * MARK_HOVER_GROW,
  capture: MARK_RADIUS.capture * MARK_HOVER_GROW,
};
const markDisc = (radius: number) =>
  new CircleGeometry(radius, 40).rotateX(-Math.PI / 2).translate(0, layout.floorY, 0);
const markGeometry = { quiet: markDisc(markReach.quiet), capture: markDisc(markReach.capture) };
// Seen from under the horizon too
const markMaterial = new MeshBasicMaterial({ side: DoubleSide });

// Drops a cell-centre position to the cell floor, the plane a piece's base
// stands on and every marker lies on: a mark read as lying on the ground would
// skewer the piece in its cell at the cell's centre. Pieces are modeled
// base-at-y=0 and are shorter than their cell, so they stand on its floor
// rather than centred in it.

const atCellFloor = ([x, y, z]: Vec3): Vec3 => [x, y + layout.floorY, z];

// The last move as the history derives it (game/history.ts)
export type { LastMoveInfo };

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
  /**
   * The better move where the last move was played, drawn beside it: a
   * finished game's review shows it where it marks the move shown.
   */
  betterMove?: Move | null;
  /** Freezes interaction (selection and moves) while still rendering the position. */
  disabled?: boolean;
  /** Set once the game has ended: the mated king topples. */
  gameOver?: { result: GameOver['result']; winner?: PieceColor } | null;
  /** Whether to draw the coordinate labels (on by default; the landing preview has none). */
  labels?: boolean;
  /**
   * A square whose piece is picked up for the player (the tutorial's): on
   * mount and again whenever the position changes, once a live move has
   * landed, its moves ringed. It can still be put down and picked up by hand.
   */
  showMovesOf?: Coord | null;
  /**
   * The position steps through the game's record (the game's review), back
   * as well as on: one move back glides the undone move's piece home, and
   * a jump of several moves either way shows the new position at once.
   * Without it, a later position always glides its last move in.
   */
  review?: boolean;
}

/** How the shown position arrived: a piece gliding into it. */
interface Glide {
  /** The piece standing on `to` glides in from `from`. */
  from: Coord;
  to: Coord;
  plan: GlidePlan;
  /** A step back through the record: the undone move's piece goes home. */
  back: boolean;
  /**
   * Forward, what the move took (the capture's effect). Back, the piece the
   * undone move had taken, standing again on `from`: it shows once the
   * gliding piece has left it, `revealMs` in.
   */
  captured: Piece | null;
  revealMs: number;
}

interface Arrival {
  /** The shown position's move count, which the arrival was decided for. */
  count: number;
  /** One more for each arrival, keying what plays once per arrival. */
  key: number;
  glide: Glide | null;
  /** The shown position's last move (a step back undoes it). */
  lastMove: LastMoveInfo | undefined;
}

const Board = (props: BoardProps) => {
  // A page opened on a game under way forms the position before its last
  // move while the entrance plays, and then plays that move as it would have
  // landed live (replay.ts); the board takes no input meanwhile
  const replay = useEntranceReplay(props.board, props.lastMove);
  const board = replay?.board ?? props.board;
  const disabled = !!props.disabled || !!replay;
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

  const lastMove = replay ? undefined : props.lastMove;
  // The piece the player has just played, held up until its move comes back
  // (so its glide sets off from where the player's hand left it)
  const [carried, setCarried] = useState<Coord | null>(null);
  // The move a tap on one of the held piece's destinations sent (a
  // promotion's, once its piece is chosen, too): when it comes back it is
  // the player's own, and glides at once; any other move arrives unannounced
  const sent = useRef<Move | null>(null);
  // The view, read as a move arrives: its glide's length on screen
  const view = useThree((s) => s.get);

  // How the shown position arrived, decided once each time it changes (its
  // move count). One move on (a move landing, a step forward through the
  // record) glides that move's piece in from its source; in review, one move
  // back glides the undone move's piece home. Anything else is simply there:
  // the moves already played when this board mounted (a reconnect's replay
  // keeps their highlight but must not animate; the entrance's replay of the
  // last move, above, is one move on), a jump through the record.
  const shownCount = replay?.ply ?? lastMove?.moveCount ?? 0;
  const arrival = useRef<Arrival>({ count: shownCount, key: 0, glide: null, lastMove });
  if (arrival.current.count !== shownCount) {
    const was = arrival.current;
    const step = shownCount - was.count;
    // (Nothing glides for a player who asked for less motion)
    const still = prefersReducedMotion();
    let glide: Glide | null = null;
    const { camera, size } = view();
    const scaleAt = (cell: Coord) => screenScale(camera, size.height, worldOf(cell));
    if (!still && lastMove && (props.review ? step === 1 : step > 0)) {
      const { from, to } = lastMove.move;
      const mine = sent.current;
      const played = step === 1 && !!mine && sameCoord(mine.from, from) && sameCoord(mine.to, to);
      const lift =
        played && carried && sameCoord(carried, from) ? PIECE_LIFT.selected * PIECE_SCALE : 0;
      const capture = !!lastMove.capturedPiece;
      const scale = scaleAt(to);
      const plan = planGlide(worldOf(from), worldOf(to), { lift, played, capture, scale });
      glide = { from, to, plan, back: false, captured: lastMove.capturedPiece, revealMs: 0 };
    } else if (!still && props.review && step === -1 && was.lastMove) {
      const { from, to } = was.lastMove.move;
      const captured = was.lastMove.capturedPiece;
      const plan = planGlide(worldOf(to), worldOf(from), { scale: scaleAt(from) });
      // The taken piece stands again once its taker, going home, has left
      // it: as far from it as the taker was when it reached it
      glide = { from: to, to: from, plan, back: true, captured, revealMs: clearsSourceAtMs(plan) };
    }
    sent.current = null;
    arrival.current = { count: shownCount, key: was.key + 1, glide, lastMove };
  }
  const { glide, key: arrivalKey } = arrival.current;
  // A glide forward lands a move: what it brings about for the kings (a
  // check's strike, a mate's topple and pulse) waits for the moving piece to
  // land (MoveGlide's onLanded); a move from history shows it at once.
  const [landedKey, setLandedKey] = useState(arrivalKey);
  const landing = !!glide && !glide.back && arrivalKey > landedKey;
  // The kings show what a move did to them once it has landed (and nothing
  // while the position before the last move waits for it)
  const kingsWait = landing || !!replay;
  const glideToKey = glide ? toZXY(glide.to) : null;
  const revealKey = glide?.back && glide.captured ? toZXY(glide.from) : null;

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
  // The cell (or the piece on it) under the pointer: its level stands out,
  // and, when the pointer is on its mark or its piece (not just its floor),
  // its destination marker brightens.
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);
  const [hoverOnFloor, setHoverOnFloor] = useState(false);
  const onHover = useCallback((hit: HoverHit | null) => {
    setHoveredCell(hit?.key ?? null);
    setHoverOnFloor(hit?.on === 'floor');
  }, []);
  // The piece last tapped in vain, with a count so each tap answers
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
  }, [board, props.currentTurn, disabled]);
  // The piece kept picked up (showMovesOf) is picked up again, after the
  // clearing above, in each new position once its move has landed
  const shown = props.showMovesOf ?? null;
  const shownKey = shown && toZXY(shown);
  useEffect(() => {
    if (!shown || landing || !canPick(shown)) return;
    choose(shown, board.generateLegalMoves(shown));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- as the clearing above, and the landing
  }, [board, props.currentTurn, disabled, shownKey, landing]);
  // The played piece goes down once its move is back (a new board), or once
  // the board takes input again without it (the move refused)
  useEffect(() => setCarried(null), [board]);
  useEffect(() => {
    if (!disabled) setCarried(null);
  }, [disabled]);

  // Collect all pieces with their coordinates from the provided board
  const pieces = CELLS.flatMap((coord) => {
    const piece = board.getPiece(coord);
    return piece ? [{ ...piece, coord }] : [];
  });

  // Whether the player may pick up the piece on this cell right now.
  const canPick = (coord: Coord) => {
    if (disabled) return false;
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
      if (!disabled) {
        const key = toZXY(coord);
        setRefused((r) => ({ key, count: (r?.count ?? 0) + 1 }));
      }
      return;
    }
    // generateLegalMoves already filters out moves into check
    choose(coord, board.generateLegalMoves(coord));
  };

  // A click on a piece acts on it, and one on a destination's mark plays its
  // move; a finger's taps were decided as it lifted (useTouchIntent, below)
  const handlePieceTap = (coord: Coord, event: MouseEvent) => {
    if (!touch.tap(event)) handlePieceClick(coord);
  };
  const handleMarkTap = (coord: Coord, event: MouseEvent) => {
    if (!touch.tap(event)) handleCubeClick(coord);
  };

  // Same reason as worldPositions: each piece gets a handler whose identity
  // never changes, delegating to the latest closure through a ref.
  const latestPieceTap = useRef(handlePieceTap);
  const latestCanPick = useRef(canPick);
  useLayoutEffect(() => {
    latestPieceTap.current = handlePieceTap;
    latestCanPick.current = canPick;
    latestMarkTap.current = handleMarkTap;
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
  const latestMarkTap = useRef<(cell: Coord, event: MouseEvent) => void>(() => {});
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
                if (isTap(e) && take(e.nativeEvent)) latestMarkTap.current(cell, e.nativeEvent);
              },
            },
          ];
        }),
      ),
    [],
  );

  // Handle highlighted cube click (move application)
  const handleCubeClick = (targetCoord: Coord) => {
    if (disabled || !selected || !held.current) return;
    // Several legal moves share a destination only when a pawn promotes there
    // (one per promotion piece); otherwise there is exactly one.
    const choices = legalMoves.filter((m) => sameCoord(m.to, targetCoord));
    if (choices.length === 0) return; // Should not happen if cube is highlighted

    // Put the piece down first, so the move cannot be played twice
    choose(null);
    sent.current = { from: selected, to: targetCoord };
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
  const checkedKings = kingsWait
    ? []
    : pieces.filter(({ type, color }) => type === PieceType.King && board.inCheck(color));
  const checked = checkedKings.map(({ color }) => color);
  const matedColor =
    !kingsWait && props.gameOver?.result === 'checkmate' && props.gameOver.winner
      ? props.gameOver.winner === 'white'
        ? 'black'
        : 'white'
      : null;
  const matedKing = pieces.find(
    ({ type, color }) => type === PieceType.King && color === matedColor,
  );

  // --- The mate (lib/mate.ts): the mating piece's arrival knocks the
  // king back, away from it, and he hangs at the edge of his balance and
  // falls, and as he strikes, the winning army hops in a
  // wave out from him. Its beats count from the mating move's landing, and
  // play out only for a mate that arrived live: from history he just falls.
  const matedSquare = matedKing && toZXY(matedKing.coord);
  const mate = useMemo(() => {
    if (!matedKing || !props.gameOver?.winner || !lastMove) return null;
    const live = !!glide && !glide.back;
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
          KNOCK_STRIKE_MS + MATE_TUNING.waveDelayMs + (1000 * far) / MATE_TUNING.waveSpeed,
        );
      }
    }
    return { live, away, cheer };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fixed when the mate arrives
  }, [matedSquare, props.gameOver, lastMove?.moveCount, arrivalKey]);

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
  const destinationReach = new Map(
    destinations.map(({ to, capture }) => [
      toZXY(to),
      capture ? markReach.capture : markReach.quiet,
    ]),
  );
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
      destinationReach,
    );
  };
  const latestProbe = useRef(probe);
  useLayoutEffect(() => {
    latestProbe.current = probe;
  });
  // --- A finger's taps: each goes at once to what it was meant for
  // (tapIntent.ts, useTouchIntent.ts). A mouse click keeps exactly the hit it
  // makes.
  const touch = useTouchIntent(grid, (o) => cellAt.get(o.position.toArray().join(',')), {
    actionable: (): Actionable => ({
      pieces: new Set(
        pieces.filter(({ coord }) => canPick(coord)).map(({ coord }) => toZXY(coord)),
      ),
      destinations: destinationKeys,
      held: held.current && toZXY(held.current),
    }),
    act: (cell, kind) =>
      kind === 'destination' ? handleCubeClick(fromZXY(cell)) : handlePieceClick(fromZXY(cell)),
    // Meant for nothing: a piece hit shakes its head (if it is not the
    // player's to pick up), and anything else puts the held piece down
    miss: (direct: DirectHit | null) => {
      if (direct?.kind === 'piece') handlePieceClick(fromZXY(direct.cell));
      else if (held.current) choose(null);
    },
  });
  // A click that reached nothing the player can act on
  const handleEmptyTap = (event: MouseEvent | undefined) => {
    if (!touch.tap(event) && selected) choose(null);
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
  // While the pointer is on a level, the others step back: their glass, their
  // destinations, their pieces (a haze)
  const focusLevel = focusLevelOf(focus);

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
      <HoverProbe probe={latestProbe} onHover={onHover} />
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
        {/* Cell boxes: raycast targets for the empty-space click that clears
            the selection; a destination's is a disc the size of its mark
            instead, which plays the move. Never drawn. */}
        {CELLS.map((cell) => {
          const cellKey = toZXY(cell);
          const reach = destinationReach.get(cellKey);
          const isDest = reach !== undefined;
          const { idle, destination, onClick } = cellProps.get(cellKey)!;
          return (
            <mesh
              key={cellKey}
              position={worldOf(cell)}
              geometry={
                !isDest
                  ? cellGeometry
                  : reach === markReach.capture
                    ? markGeometry.capture
                    : markGeometry.quiet
              }
              material={isDest ? markMaterial : cellMaterial}
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
              focus={focusLevel === null || isSelected(coord) ? 0 : coord.z === focusLevel ? 1 : -1}
              mated={isMated}
              knocked={isMated && !!mate?.live}
              fallAway={isMated ? mate?.away : undefined}
              cheerAt={mate?.cheer.get(key)}
              carried={!!carried && sameCoord(carried, coord)}
              refused={refused?.key === key ? refused.count : 0}
              facing={knightFacing(color, orientation)}
              arrival={pieceArrival({ type, color, ...coord })}
            />
          );
          // The just-moved piece glides in from its source cell. Piece keys are
          // position-derived and can recur across moves, so the wrapper is keyed
          // by arrival: every new one mounts a fresh tween, superseding one
          // still in flight.
          if (glide && key === glideToKey) {
            return (
              <MoveGlide
                key={`anim-${arrivalKey}`}
                plan={glide.plan}
                fromLevel={glide.from.z}
                toLevel={coord.z}
                onLanded={() => setLandedKey((n) => Math.max(n, arrivalKey))}
                // The mate's knock (and a check's strike) as it looks landed
                landsEarlyMs={MATE_TUNING.knockLeadMs}
              >
                {mesh}
              </MoveGlide>
            );
          }
          // A step back puts a taken piece back, once its taker has left it
          if (glide && key === revealKey) {
            return (
              <Reveal key={`reveal-${arrivalKey}`} afterMs={glide.revealMs}>
                {mesh}
              </Reveal>
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
          const hovered = hoveredCell === key && !hoverOnFloor;
          const dim = focusLevel !== null && to.z !== focusLevel;
          return capture ? (
            <Capture key={`capture-${key}`} {...markerAt(to)} hovered={hovered} dim={dim} />
          ) : (
            <Quiet key={`quiet-${key}`} {...markerAt(to)} hovered={hovered} dim={dim} />
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
            fresh={!!glide && !glide.back}
            glideMs={glide && !glide.back ? touchdownMs(glide.plan) : 0}
          />
        )}
        {/* Keyed by its squares: a still mark, made again only for another move */}
        {props.betterMove && (
          <Better
            key={`better-${toZXY(props.betterMove.from)}-${toZXY(props.betterMove.to)}`}
            from={markerAt(props.betterMove.from)}
            to={markerAt(props.betterMove.to)}
          />
        )}
        {checkedKings.map(({ color, coord }) => (
          <Check
            key={`check-${color}`}
            {...markerAt(coord)}
            checkers={board.checkers(color).map(markerAt)}
            {...(color === matedColor ? { mated: true } : {})}
          />
        ))}
        {glide && !glide.back && glide.captured && (
          <CaptureFx
            key={`capturefx-${arrivalKey}`}
            {...markerAt(glide.to)}
            victim={glide.captured}
            victimFacing={knightFacing(glide.captured.color, orientation)}
            hitMs={contactAtMs(glide.plan) ?? touchdownMs(glide.plan)}
            landMs={touchdownMs(glide.plan)}
            heading={glide.plan.heading}
            orientation={orientation}
          />
        )}
        {matedKing && mate && (
          <Celebration
            {...markerAt(matedKing.coord)}
            // The pulse leaves as he strikes the floor
            delayMs={mate.live ? KNOCK_STRIKE_MS - 60 : 0}
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
  probe: RefObject<(raycaster: Raycaster | null) => HoverHit | null>;
  onHover: (hit: HoverHit | null) => void;
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
