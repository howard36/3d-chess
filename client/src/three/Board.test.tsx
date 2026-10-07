import React from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import Board from './Board';
import type { BoardProps, LastMoveInfo } from './Board';
import { layout, PIECE_SCALE } from './scene/palette';
import { contactAtMs, glidePose, planGlide, touchdownMs } from './glide';
import { PIECE_LIFT } from './pieceMotion';
import { MATE_TUNING } from '../lib/mate';
import { useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import type { BufferGeometry, Camera, Object3D, PerspectiveCamera, Scene } from 'three';
import type {
  CaptureFxProps,
  GridProps,
  LastMoveMarkerProps,
  MarkerProps,
  PieceBodyProps,
} from './types';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { ReactThreeTestInstance } from '@react-three/test-renderer/dist/declarations/src/types/public.js';
import { PieceType } from '../engine';
import type { Coord, Move } from '../engine';
import { act } from 'react';
import { Board as EngineBoard } from '../engine';
import { fromZXY } from '../engine/coords';

type Renderer = { scene: unknown };
type Color = 'white' | 'black';
const root = (renderer: Renderer) => renderer.scene as ReactThreeTestInstance;
// The board's group: the scene's only child
const gridOf = (renderer: Renderer) => root(renderer).children[0];

// The scene's parts stand in as plain groups that record what Board hands
// them: these tests are about the board's rules, not about how the scene
// draws (which jsdom could not run fast anyway).
const drawn = vi.hoisted(() => ({
  bodies: [] as PieceBodyProps[],
  grids: [] as GridProps[],
  checks: [] as MarkerProps[],
  lastMoves: [] as LastMoveMarkerProps[],
  lastMoveMounts: [] as string[],
  captures: [] as CaptureFxProps[],
  selectionMounts: 0,
}));
vi.mock('./scene/pieces', () => ({
  PieceBody: (props: PieceBodyProps) => {
    drawn.bodies.push(props);
    return (
      <group position={[0, 0.3, 0]}>
        <mesh userData={{ hoveredBody: props.hovered }}>
          <cylinderGeometry args={[0.2, 0.25, 0.6, 12]} />
        </mesh>
      </group>
    );
  },
}));
vi.mock('./scene/markers', () => ({
  Quiet: ({ floor, hovered, dim }: MarkerProps) => (
    <group
      userData={{ quiet: true, hovered: hovered === true, dim: dim === true }}
      position={floor}
    />
  ),
  Capture: ({ floor }: MarkerProps) => <group userData={{ captureRing: true }} position={floor} />,
  LastMove: (props: LastMoveMarkerProps) => {
    drawn.lastMoves.push(props);
    React.useEffect(() => {
      drawn.lastMoveMounts.push(JSON.stringify(props.to.floor));
      // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
    }, []);
    return null;
  },
  Check: (props: MarkerProps) => {
    drawn.checks.push(props);
    return null;
  },
}));
vi.mock('./scene/selection', () => ({
  Selection: ({ floor }: MarkerProps) => {
    React.useEffect(() => {
      drawn.selectionMounts++;
    }, []);
    return <group userData={{ selectionRing: true }} position={floor} />;
  },
}));
vi.mock('./scene/grid', () => ({
  Grid: (props: GridProps) => {
    drawn.grids.push(props);
    return null;
  },
}));
vi.mock('./scene/fx', () => ({
  CaptureFx: (props: CaptureFxProps) => {
    drawn.captures.push(props);
    return null;
  },
  Celebration: () => null,
}));

beforeEach(() => {
  drawn.bodies.length = 0;
  drawn.grids.length = 0;
  drawn.checks.length = 0;
  drawn.lastMoves.length = 0;
  drawn.lastMoveMounts.length = 0;
  drawn.captures.length = 0;
  drawn.selectionMounts = 0;
});

// Where the board's layout (the tower) puts a cell's centre and its floor
const toWorld = (cell: Coord, orientation: Color) => layout.toWorld(cell, orientation);
const FLOOR_Y = layout.floorY;

// Helper to create a fresh board
function createTestBoard() {
  return EngineBoard.setupStartingPosition();
}

const sameVec = (a: unknown, b: [number, number, number]) =>
  JSON.stringify(a) === JSON.stringify(b);

// The rendered node for a piece of the given type/colour. Uses findAll so it
// is robust to wrapper groups (MoveGlide, GhostPiece) around the PieceMesh.
// Pass `at` to pick a specific piece when several of that kind are on the
// board; it is resolved in White's frame unless `orientation` says otherwise.
function findPiece(
  renderer: Renderer,
  type: PieceType,
  color: Color,
  at?: Coord,
  orientation: Color = 'white',
): ReactThreeTestInstance {
  const matches = root(renderer).findAll(
    (node) =>
      (node.type === 'Mesh' || node.type === 'Group') &&
      node.props.userData?.piece?.type === type &&
      node.props.userData?.piece?.color === color &&
      (!at || sameVec(node.props.position, toWorld(at, orientation))),
  );
  expect(matches.length).toBeGreaterThanOrEqual(1);
  return matches[0];
}

// A click as r3f delivers it: `delta` is how far the pointer travelled since
// its press, `button` which mouse button it was.
const clickEvent = ({ delta = 0, button = 0 } = {}) => ({
  stopPropagation: () => {},
  delta,
  nativeEvent: { button },
});

// Simulate a click on a rendered node, inside act.
async function press(node: ReactThreeTestInstance, opts?: { delta?: number; button?: number }) {
  await act(async () => {
    node.props.onClick?.(clickEvent(opts));
  });
}

function highlightedCells(renderer: Renderer): ReactThreeTestInstance[] {
  return root(renderer).findAll(
    (node) => node.type === 'Mesh' && node.props.userData?.highlight === true,
  );
}

function selectionRings(renderer: Renderer): ReactThreeTestInstance[] {
  return root(renderer).findAll((node) => node.props.userData?.selectionRing === true);
}

// World positions of every piece of a given type/colour currently rendered.
function piecePositions(
  renderer: Renderer,
  type: PieceType,
  color: Color,
): [number, number, number][] {
  return root(renderer)
    .findAll(
      (node) =>
        (node.type === 'Mesh' || node.type === 'Group') &&
        node.props.userData?.piece?.type === type &&
        node.props.userData?.piece?.color === color,
    )
    .map((node) => node.props.position as [number, number, number]);
}

// Piece types of a given colour sitting on one row, ordered left to right.
function rowLeftToRight(
  renderer: Renderer,
  color: Color,
  worldY: number,
  worldZ: number,
): PieceType[] {
  return root(renderer)
    .findAll(
      (node) =>
        (node.type === 'Mesh' || node.type === 'Group') &&
        node.props.userData?.piece?.color === color &&
        node.props.position?.[1] === worldY &&
        node.props.position?.[2] === worldZ,
    )
    .sort((a, b) => a.props.position[0] - b.props.position[0])
    .map((node) => node.props.userData.piece.type as PieceType);
}

// A white pawn on level B, rank 2 (Ba2) of the starting position: it can
// step forward or up, so it has exactly two legal moves. (Its neighbour on
// rank 1 is blocked forward by it.)
const LEVEL_B_PAWN: Coord = { x: 0, y: 1, z: 1 };

// A white rook on Cc3 with a black pawn one rank up to capture, and both kings
function rookAndPawnBoard() {
  const board = new EngineBoard();
  board.setPiece({ x: 2, y: 2, z: 2 }, { type: PieceType.Rook, color: 'white' });
  board.setPiece({ x: 2, y: 3, z: 2 }, { type: PieceType.Pawn, color: 'black' });
  board.setPiece({ x: 0, y: 0, z: 0 }, { type: PieceType.King, color: 'white' });
  board.setPiece({ x: 4, y: 4, z: 4 }, { type: PieceType.King, color: 'black' });
  return board;
}

// A white pawn one step from its promotion square (rank 5 on level E)
const PROMOTE_FROM: Coord = { x: 2, y: 3, z: 4 };
const PROMOTE_TO: Coord = { x: 2, y: 4, z: 4 };
function promotionBoard() {
  const board = new EngineBoard();
  board.setPiece(PROMOTE_FROM, { type: PieceType.Pawn, color: 'white' });
  board.setPiece({ x: 0, y: 0, z: 0 }, { type: PieceType.King, color: 'white' });
  board.setPiece({ x: 4, y: 0, z: 0 }, { type: PieceType.King, color: 'black' });
  return board;
}

// A lone white rook at `at` (plus both kings)
function rookBoard(at: Coord) {
  const board = new EngineBoard();
  board.setPiece(at, { type: PieceType.Rook, color: 'white' });
  board.setPiece({ x: 0, y: 0, z: 0 }, { type: PieceType.King, color: 'white' });
  board.setPiece({ x: 4, y: 4, z: 4 }, { type: PieceType.King, color: 'black' });
  return board;
}

// Mounts the board beside a probe that hands back the live camera, canvas and
// scene, with the canvas sized 800x600 for the pointer maths.
async function mountBoard(props: Partial<BoardProps> = {}) {
  let three: { camera: Camera; gl: { domElement: HTMLCanvasElement }; scene: Scene } | null = null;
  const Grab = () => {
    const camera = useThree((s) => s.camera);
    const gl = useThree((s) => s.gl);
    const scene = useThree((s) => s.scene);
    three = { camera, gl, scene };
    return null;
  };
  const renderer = await ReactThreeTestRenderer.create(
    <>
      <Grab />
      <Board board={createTestBoard()} currentTurn="white" {...props} />
    </>,
  );
  const { camera, gl, scene } = three!;
  const rect = { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 };
  vi.spyOn(gl.domElement, 'getBoundingClientRect').mockReturnValue(rect as DOMRect);
  return { renderer, camera, canvas: gl.domElement, scene, width: rect.width, height: rect.height };
}

describe('Board', () => {
  it('keeps every cell an invisible raycast target, destinations included', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Board board={createTestBoard()} currentTurn="white" />,
    );
    type CellMesh = { visible: boolean; geometry: unknown; material: unknown };
    const cells = () =>
      root(renderer)
        .findAll((node) => node.type === 'Mesh' && node.props.userData?.cube === true)
        .map((node) => node.instance as unknown as CellMesh);

    // No cell is drawn: they all share one geometry and one material, and
    // none has opted out of raycasting (a click on any of them must still
    // reach the board group to clear a selection).
    const idle = cells();
    expect(idle).toHaveLength(125);
    expect(idle.every((cell) => cell.visible === false)).toBe(true);
    expect(new Set(idle.map((cell) => cell.geometry)).size).toBe(1);
    expect(new Set(idle.map((cell) => cell.material)).size).toBe(1);
    expect(idle.some((cell) => Object.prototype.hasOwnProperty.call(cell, 'raycast'))).toBe(false);

    // A destination is marked on its floor by the markers; its box stays unseen
    await press(findPiece(renderer, PieceType.Pawn, 'white', LEVEL_B_PAWN));
    expect(highlightedCells(renderer)).toHaveLength(2);
    expect(cells().some((cell) => cell.visible)).toBe(false);
  });

  it('renders 40 piece meshes', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Board board={createTestBoard()} currentTurn="white" />,
    );
    const pieceCount = root(renderer).findAll(
      (node) =>
        (node.type === 'Mesh' || node.type === 'Group') && node.props.userData?.piece !== undefined,
    ).length;
    expect(pieceCount).toBe(40);
  });

  it('clicks a pawn and highlights exactly its two destination cubes', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Board board={createTestBoard()} currentTurn="white" />,
    );
    await press(findPiece(renderer, PieceType.Pawn, 'white', LEVEL_B_PAWN));

    const highlighted = highlightedCells(renderer);
    expect(highlighted).toHaveLength(2);
    const forward = toWorld({ x: 0, y: 2, z: 1 }, 'white');
    const up = toWorld({ x: 0, y: 1, z: 2 }, 'white');
    expect(highlighted.some((c) => sameVec(c.props.position, forward))).toBe(true);
    expect(highlighted.some((c) => sameVec(c.props.position, up))).toBe(true);
    expect(selectionRings(renderer)).toHaveLength(1);
  });

  it('unselects a piece when clicking empty space after selecting', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Board board={createTestBoard()} currentTurn="white" />,
    );
    const boardGroup = gridOf(renderer);

    await press(findPiece(renderer, PieceType.Pawn, 'white', LEVEL_B_PAWN));
    expect(highlightedCells(renderer)).toHaveLength(2);

    // Click empty space (simulate the group's onClick)
    await press(boardGroup);
    expect(highlightedCells(renderer)).toHaveLength(0);
    expect(selectionRings(renderer)).toHaveLength(0);
  });

  it('unselects a piece when a click misses the board altogether', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Board board={createTestBoard()} currentTurn="white" />,
    );
    const boardGroup = gridOf(renderer);

    await press(findPiece(renderer, PieceType.Pawn, 'white', LEVEL_B_PAWN));
    expect(highlightedCells(renderer)).toHaveLength(2);

    await act(async () => boardGroup.props.onPointerMissed(new MouseEvent('click')));
    expect(highlightedCells(renderer)).toHaveLength(0);
    expect(selectionRings(renderer)).toHaveLength(0);
  });

  it('puts the selected piece back down when it is clicked again', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Board board={createTestBoard()} currentTurn="white" />,
    );
    await press(findPiece(renderer, PieceType.Pawn, 'white', LEVEL_B_PAWN));
    expect(highlightedCells(renderer)).toHaveLength(2);

    await press(findPiece(renderer, PieceType.Pawn, 'white', LEVEL_B_PAWN));
    expect(highlightedCells(renderer)).toHaveLength(0);
    expect(selectionRings(renderer)).toHaveLength(0);

    // And a third picks it up again
    await press(findPiece(renderer, PieceType.Pawn, 'white', LEVEL_B_PAWN));
    expect(highlightedCells(renderer)).toHaveLength(2);
  });

  it('ignores piece clicks while disabled', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Board board={createTestBoard()} currentTurn="white" disabled />,
    );
    await press(findPiece(renderer, PieceType.Pawn, 'white', LEVEL_B_PAWN));
    expect(highlightedCells(renderer)).toHaveLength(0);
    expect(selectionRings(renderer)).toHaveLength(0);
  });

  it("cannot select the opponent's piece", async () => {
    // Black to move, but we are White: Black's pawn is not ours to pick up.
    const renderer = await ReactThreeTestRenderer.create(
      <Board board={createTestBoard()} currentTurn="black" playerColor="white" />,
    );
    await press(findPiece(renderer, PieceType.Pawn, 'black'));
    expect(highlightedCells(renderer)).toHaveLength(0);
    expect(selectionRings(renderer)).toHaveLength(0);
  });

  it('cannot select a piece whose side is not on turn', async () => {
    // Our own pawn, but it is Black's turn.
    const renderer = await ReactThreeTestRenderer.create(
      <Board board={createTestBoard()} currentTurn="black" playerColor="white" />,
    );
    await press(findPiece(renderer, PieceType.Pawn, 'white', LEVEL_B_PAWN));
    expect(highlightedCells(renderer)).toHaveLength(0);
    expect(selectionRings(renderer)).toHaveLength(0);

    // Same for a spectator view (no playerColor): only the side on turn moves.
    const spectator = await ReactThreeTestRenderer.create(
      <Board board={createTestBoard()} currentTurn="black" />,
    );
    await press(findPiece(spectator, PieceType.Pawn, 'white', LEVEL_B_PAWN));
    expect(highlightedCells(spectator)).toHaveLength(0);
  });

  it('clears the selection when the board prop changes', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Board board={createTestBoard()} currentTurn="white" />,
    );
    await press(findPiece(renderer, PieceType.Pawn, 'white', LEVEL_B_PAWN));
    expect(highlightedCells(renderer)).toHaveLength(2);

    // A new board instance (as after the server echoes a move) invalidates
    // the selection even if the position is identical.
    await renderer.update(<Board board={createTestBoard()} currentTurn="white" />);
    expect(highlightedCells(renderer)).toHaveLength(0);
    expect(selectionRings(renderer)).toHaveLength(0);
  });

  it('keeps the piece it is shown picked up, its moves ringed, again in each new position', async () => {
    const at: Coord = { x: 2, y: 2, z: 2 };
    const renderer = await ReactThreeTestRenderer.create(
      <Board board={rookBoard(at)} currentTurn="white" playerColor="white" showMovesOf={at} />,
    );
    // Picked up on mount: the rook's 12 squares, less its own king's
    expect(highlightedCells(renderer)).toHaveLength(12);
    expect(selectionRings(renderer)).toHaveLength(1);

    // Put down by hand, it stays down
    await press(findPiece(renderer, PieceType.Rook, 'white', at));
    expect(highlightedCells(renderer)).toHaveLength(0);

    // A new position (from history: nothing to land) picks it up again where it now stands
    const to: Coord = { x: 2, y: 2, z: 3 };
    await renderer.update(
      <Board board={rookBoard(to)} currentTurn="white" playerColor="white" showMovesOf={to} />,
    );
    expect(highlightedCells(renderer)).toHaveLength(12);
    expect(selectionRings(renderer).map((r) => r.props.position[1])).toEqual([
      toWorld(to, 'white')[1] + FLOOR_Y,
    ]);
  });

  it('picks the shown piece up after its live move has landed, not while it glides', async () => {
    const from: Coord = { x: 2, y: 2, z: 2 };
    const to: Coord = { x: 2, y: 2, z: 3 };
    const renderer = await ReactThreeTestRenderer.create(
      <Board board={rookBoard(from)} currentTurn="white" playerColor="white" showMovesOf={from} />,
    );
    await renderer.update(
      <Board
        board={rookBoard(to)}
        currentTurn="white"
        playerColor="white"
        showMovesOf={to}
        lastMove={{ move: { from, to }, moveCount: 1, capturedPiece: null }}
      />,
    );
    expect(highlightedCells(renderer)).toHaveLength(0);
    const plan = planGlide(toWorld(from, 'white'), toWorld(to, 'white'));
    await act(async () => renderer.advanceFrames(Math.ceil(touchdownMs(plan) / 10) + 10, 0.01));
    expect(highlightedCells(renderer)).toHaveLength(12);
  });

  it('leaves a shown piece down while the board takes no input', async () => {
    const at: Coord = { x: 2, y: 2, z: 2 };
    const renderer = await ReactThreeTestRenderer.create(
      <Board board={rookBoard(at)} currentTurn="white" showMovesOf={at} disabled />,
    );
    expect(highlightedCells(renderer)).toHaveLength(0);
    await renderer.update(<Board board={rookBoard(at)} currentTurn="white" showMovesOf={at} />);
    expect(highlightedCells(renderer)).toHaveLength(12);
  });

  it('renders once for a new board when nothing is held (the work a landing move costs)', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Board board={createTestBoard()} currentTurn="white" />,
    );
    drawn.grids.length = 0;
    // The opponent's move lands: a new board, and nothing was picked up
    await renderer.update(<Board board={createTestBoard()} currentTurn="black" />);
    expect(drawn.grids).toHaveLength(1);
  });

  it('draws no frame when only the board is disabled (a move on its way to the server)', async () => {
    // The canvas redraws for any prop r3f is handed anew: every frame asked
    // for goes through the store's invalidate
    const invalidate = vi.fn();
    const Probe = () => {
      const get = useThree((s) => s.get);
      React.useLayoutEffect(() => {
        get().set({ invalidate });
      }, [get]);
      return null;
    };
    const board = createTestBoard();
    const at = (disabled: boolean) => (
      <>
        <Probe />
        <Board board={board} currentTurn="white" playerColor="white" disabled={disabled} />
      </>
    );
    const renderer = await ReactThreeTestRenderer.create(at(false));
    invalidate.mockClear();
    // The mover's page: the move is sent, and the board waits for its echo
    await renderer.update(at(true));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('does not unselect when clicking another piece (selection moves)', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Board board={createTestBoard()} currentTurn="white" />,
    );
    const first: Coord = { x: 0, y: 1, z: 1 };
    const second: Coord = { x: 1, y: 1, z: 1 };

    await press(findPiece(renderer, PieceType.Pawn, 'white', first));
    expect(highlightedCells(renderer)).toHaveLength(2);
    const [fx, fy, fz] = toWorld(first, 'white');
    expect(selectionRings(renderer)[0].props.position).toEqual([fx, fy + FLOOR_Y, fz]);

    await press(findPiece(renderer, PieceType.Pawn, 'white', second));
    // Highlights still exist and now belong to the second pawn.
    const highlighted = highlightedCells(renderer);
    expect(highlighted).toHaveLength(2);
    expect(
      highlighted.some((c) => sameVec(c.props.position, toWorld({ x: 1, y: 1, z: 2 }, 'white'))),
    ).toBe(true);
    expect(selectionRings(renderer)).toHaveLength(1);
  });

  it('draws the selection ring on the floor the selected piece stands on', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Board board={createTestBoard()} currentTurn="white" />,
    );
    const knight = findPiece(renderer, PieceType.Knight, 'white');
    await press(knight);

    const rings = selectionRings(renderer);
    expect(rings).toHaveLength(1);
    // Same cell in x/z, and down at the piece's base rather than part-way up
    // its foot: PieceMesh seats the piece at the same FLOOR_Y offset.
    const piecePos = knight.props.position as [number, number, number];
    expect(rings[0].props.position).toEqual([piecePos[0], piecePos[1] + FLOOR_Y, piecePos[2]]);
  });

  it('draws the capture ring on the floor the marked piece stands on', async () => {
    const board = rookAndPawnBoard();

    const renderer = await ReactThreeTestRenderer.create(
      <Board board={board} currentTurn="white" />,
    );
    const pawn = findPiece(renderer, PieceType.Pawn, 'black');
    await press(findPiece(renderer, PieceType.Rook, 'white'));

    const rings = root(renderer).findAll((node) => node.props.userData?.captureRing === true);
    expect(rings).toHaveLength(1);
    // At the base of the piece it marks, not the cell centre — otherwise the
    // ring cuts through the piece at a height that varies with its silhouette.
    const pawnPos = pawn.props.position as [number, number, number];
    expect(rings[0].props.position).toEqual([pawnPos[0], pawnPos[1] + FLOOR_Y, pawnPos[2]]);
  });

  it('captures when the capturable piece itself is clicked, not just its cell', async () => {
    const board = rookAndPawnBoard();
    const onMove = vi.fn<(move: Move) => void>();
    const renderer = await ReactThreeTestRenderer.create(
      <Board board={board} currentTurn="white" playerColor="white" onMove={onMove} />,
    );

    // Without a selection an opposing piece is inert
    await press(findPiece(renderer, PieceType.Pawn, 'black'));
    expect(onMove).not.toHaveBeenCalled();

    await press(findPiece(renderer, PieceType.Rook, 'white'));
    await press(findPiece(renderer, PieceType.Pawn, 'black'));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0][0]).toMatchObject({
      from: { x: 2, y: 2, z: 2 },
      to: { x: 2, y: 3, z: 2 },
    });
    expect(highlightedCells(renderer)).toHaveLength(0);
  });

  it('calls onMove with the from/to of the clicked destination and clears the selection', async () => {
    const onMove = vi.fn<(move: Move) => void>();
    const renderer = await ReactThreeTestRenderer.create(
      <Board onMove={onMove} board={createTestBoard()} currentTurn="white" />,
    );
    await press(findPiece(renderer, PieceType.Pawn, 'white', LEVEL_B_PAWN));

    const up: Coord = { x: 0, y: 1, z: 2 };
    const dest = highlightedCells(renderer).find((c) =>
      sameVec(c.props.position, toWorld(up, 'white')),
    )!;
    expect(dest).toBeDefined();
    await press(dest);

    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0][0]).toEqual({
      from: LEVEL_B_PAWN,
      to: up,
      promotion: undefined,
    });
    // The board itself does not apply the move (state is event-sourced by the
    // parent); it only drops the selection.
    expect(highlightedCells(renderer)).toHaveLength(0);
    expect(selectionRings(renderer)).toHaveLength(0);
    expect(piecePositions(renderer, PieceType.Pawn, 'white')).toContainEqual(
      toWorld(LEVEL_B_PAWN, 'white'),
    );
  });

  // The Lift (pieceMotion.tsx) inside a rendered piece, and the Jolt round it
  const liftOf = (piece: ReactThreeTestInstance) => {
    let lift: Object3D | undefined;
    (piece.instance as unknown as Object3D).traverse((o) => {
      if (o.userData.lift && !lift) lift = o;
    });
    return lift!;
  };

  it('holds the played piece up until its move comes back, and carries it on from there', async () => {
    const onMove = vi.fn<(move: Move) => void>();
    const before = createTestBoard();
    const renderer = await ReactThreeTestRenderer.create(
      <Board onMove={onMove} board={before} currentTurn="white" playerColor="white" />,
    );
    const pawn = findPiece(renderer, PieceType.Pawn, 'white', LEVEL_B_PAWN);
    await press(pawn);
    const up: Coord = { x: 0, y: 1, z: 2 };
    await press(
      highlightedCells(renderer).find((c) => sameVec(c.props.position, toWorld(up, 'white')))!,
    );
    expect(onMove).toHaveBeenCalledTimes(1);
    // On its way to the server: still held up, though put down as a selection
    await renderer.update(
      <Board onMove={onMove} board={before} currentTurn="white" playerColor="white" disabled />,
    );
    await act(async () => renderer.advanceFrames(80, 0.01));
    expect(selectionRings(renderer)).toHaveLength(0);
    expect(liftOf(findPiece(renderer, PieceType.Pawn, 'white', LEVEL_B_PAWN)).position.y).toBe(
      PIECE_LIFT.selected,
    );
    // Back: it sets off from that height
    const after = createTestBoard();
    after.setPiece(up, after.getPiece(LEVEL_B_PAWN));
    after.setPiece(LEVEL_B_PAWN, null);
    await renderer.update(
      <Board
        onMove={onMove}
        board={after}
        currentTurn="black"
        playerColor="white"
        lastMove={{ move: { from: LEVEL_B_PAWN, to: up }, moveCount: 1, capturedPiece: null }}
      />,
    );
    const glide = root(renderer).findAll((n) => n.props.userData?.moveGlide === true)[0]
      .instance as unknown as Object3D;
    const [, fy] = toWorld(LEVEL_B_PAWN, 'white');
    const [, ty] = toWorld(up, 'white');
    expect(glide.position.y).toBeCloseTo(fy - ty + PIECE_LIFT.selected * PIECE_SCALE);
  });

  it('puts a played piece down again if its move is refused', async () => {
    const onMove = vi.fn<(move: Move) => void>();
    const board = createTestBoard();
    const at = (disabled: boolean) => (
      <Board
        onMove={onMove}
        board={board}
        currentTurn="white"
        playerColor="white"
        disabled={disabled}
      />
    );
    const renderer = await ReactThreeTestRenderer.create(at(false));
    await press(findPiece(renderer, PieceType.Pawn, 'white', LEVEL_B_PAWN));
    await press(highlightedCells(renderer)[0]);
    await renderer.update(at(true));
    await renderer.update(at(false));
    await act(async () => renderer.advanceFrames(80, 0.01));
    expect(liftOf(findPiece(renderer, PieceType.Pawn, 'white', LEVEL_B_PAWN)).position.y).toBe(0);
  });

  it('shakes a piece the player taps but cannot pick up', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Board board={createTestBoard()} currentTurn="white" playerColor="white" />,
    );
    const theirs = findPiece(renderer, PieceType.Pawn, 'black');
    const jolt = () => liftOf(theirs).parent!;
    await press(theirs);
    await act(async () => renderer.advanceFrames(4, 0.01));
    expect(jolt().position.length()).toBeGreaterThan(0);
    // Nothing else happens: nothing is picked up
    expect(selectionRings(renderer)).toHaveLength(0);
    await act(async () => renderer.advanceFrames(60, 0.01));
    expect(jolt().position.length()).toBe(0);
  });

  // A drag that starts over the cube turns the view (OrbitControls sees the
  // same pointer); it must not select, move, or drop the selection.
  it('ignores clicks that ended a drag or came from another button', async () => {
    const onMove = vi.fn<(move: Move) => void>();
    const renderer = await ReactThreeTestRenderer.create(
      <Board onMove={onMove} board={createTestBoard()} currentTurn="white" />,
    );
    const pawn = findPiece(renderer, PieceType.Pawn, 'white', LEVEL_B_PAWN);
    await press(pawn, { delta: 40 });
    await press(pawn, { button: 2 });
    expect(selectionRings(renderer)).toHaveLength(0);

    await press(pawn);
    expect(selectionRings(renderer)).toHaveLength(1);
    const dest = highlightedCells(renderer)[0];
    await press(dest, { delta: 40 });
    await press(dest, { button: 1 });
    expect(onMove).not.toHaveBeenCalled();

    const boardGroup = gridOf(renderer);
    await press(boardGroup, { delta: 40 });
    expect(selectionRings(renderer)).toHaveLength(1);

    // A few pixels of jitter still count as a click
    await press(dest, { delta: 4 });
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it('defaults a promotion to Queen and offers the promotion square once', async () => {
    const onMove = vi.fn<(move: Move) => void>();
    const from = PROMOTE_FROM;
    const to = PROMOTE_TO;

    const renderer = await ReactThreeTestRenderer.create(
      <Board onMove={onMove} board={promotionBoard()} currentTurn="white" />,
    );
    await press(findPiece(renderer, PieceType.Pawn, 'white'));

    // Five promotion moves target the same cell; it is highlighted once.
    const highlighted = highlightedCells(renderer);
    expect(highlighted).toHaveLength(1);
    expect(sameVec(highlighted[0].props.position, toWorld(to, 'white'))).toBe(true);

    await press(highlighted[0]);
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0][0]).toEqual({ from, to, promotion: PieceType.Queen });
  });

  it('hands the promotion choices to onChoosePromotion instead of picking for the player', async () => {
    const onMove = vi.fn<(move: Move) => void>();
    const onChoosePromotion = vi.fn<(choices: Move[]) => void>();
    const from = PROMOTE_FROM;
    const to = PROMOTE_TO;

    const renderer = await ReactThreeTestRenderer.create(
      <Board
        onMove={onMove}
        onChoosePromotion={onChoosePromotion}
        board={promotionBoard()}
        currentTurn="white"
      />,
    );
    await press(findPiece(renderer, PieceType.Pawn, 'white'));
    await press(highlightedCells(renderer)[0]);

    expect(onMove).not.toHaveBeenCalled();
    expect(onChoosePromotion).toHaveBeenCalledTimes(1);
    const choices = onChoosePromotion.mock.calls[0][0];
    expect(choices.map((m) => m.promotion)).toEqual([
      PieceType.Queen,
      PieceType.Rook,
      PieceType.Bishop,
      PieceType.Knight,
      PieceType.Unicorn,
    ]);
    expect(choices.map((m) => m.to)).toEqual(choices.map(() => to));
    expect(choices.map((m) => m.from)).toEqual(choices.map(() => from));
    // The selection is cleared either way
    expect(highlightedCells(renderer)).toHaveLength(0);
  });

  it("tells the checked king's body that he is in check", async () => {
    // Black's king at (0,0,0) in check from a white rook at (0,4,0)
    const board = new EngineBoard();
    board.setPiece({ x: 0, y: 0, z: 0 }, { type: PieceType.King, color: 'black' });
    board.setPiece({ x: 0, y: 4, z: 0 }, { type: PieceType.Rook, color: 'white' });
    await ReactThreeTestRenderer.create(<Board board={board} currentTurn="black" />);
    const inCheck = new Map(drawn.bodies.map((b) => [`${b.color} ${b.type}`, b.inCheck]));
    expect(inCheck.get('black King')).toBe(true);
    expect(inCheck.get('white Rook')).toBe(false);
  });

  // The viewing player's own army must read the same way for both colours:
  // pieces on their first level, pawns on the level next to it, both in the
  // two ranks nearest the camera (which looks down the +Z axis) and in the
  // same order left to right. The tower is walked round, not turned over, so
  // White's army stands on the bottom two levels and Black's on the top two.
  describe.each([
    { playerColor: 'white' as const, opponent: 'black' as const, first: 0, pawns: 1, theirs: 3 },
    { playerColor: 'black' as const, opponent: 'white' as const, first: 4, pawns: 3, theirs: 1 },
  ])('orientation for $playerColor', ({ playerColor, opponent, first, pawns, theirs }) => {
    // Heights of the levels' cell centres, and the depths of the ranks nearest the camera
    const levelY = (z: number) => toWorld({ x: 0, y: 0, z }, 'white')[1];
    const pitch =
      toWorld({ x: 1, y: 0, z: 0 }, 'white')[0] - toWorld({ x: 0, y: 0, z: 0 }, 'white')[0];
    const NEAREST = 2 * pitch;
    const SECOND_NEAREST = pitch;

    it("puts the player's pawns on the level next to their pieces, nearest two ranks", async () => {
      const renderer = await ReactThreeTestRenderer.create(
        <Board board={createTestBoard()} currentTurn="white" playerColor={playerColor} />,
      );
      const positions = piecePositions(renderer, PieceType.Pawn, playerColor);

      expect(positions).toHaveLength(10);
      expect(positions.map(([, y]) => y)).toEqual(Array(10).fill(levelY(pawns)));
      expect(new Set(positions.map(([, , z]) => z))).toEqual(new Set([NEAREST, SECOND_NEAREST]));
    });

    it("puts the player's king on their first level, nearest rank, in the middle", async () => {
      const renderer = await ReactThreeTestRenderer.create(
        <Board board={createTestBoard()} currentTurn="white" playerColor={playerColor} />,
      );
      expect(piecePositions(renderer, PieceType.King, playerColor)).toEqual([
        [0, levelY(first), NEAREST],
      ]);
    });

    // Black's army is White's inverted through the centre, files included, so
    // only a file-mirrored view shows both players their own piece ranks in
    // the same order. Without the mirror Black would read U B Q U B here.
    it("lays out the player's own piece ranks the same way for both colours", async () => {
      const renderer = await ReactThreeTestRenderer.create(
        <Board board={createTestBoard()} currentTurn="white" playerColor={playerColor} />,
      );
      expect(rowLeftToRight(renderer, playerColor, levelY(first), NEAREST)).toEqual([
        PieceType.Rook,
        PieceType.Knight,
        PieceType.King,
        PieceType.Knight,
        PieceType.Rook,
      ]);
      expect(rowLeftToRight(renderer, playerColor, levelY(first), SECOND_NEAREST)).toEqual([
        PieceType.Bishop,
        PieceType.Unicorn,
        PieceType.Queen,
        PieceType.Bishop,
        PieceType.Unicorn,
      ]);
    });

    it("puts the opponent's pawns on their own level, farthest two ranks", async () => {
      const renderer = await ReactThreeTestRenderer.create(
        <Board board={createTestBoard()} currentTurn="white" playerColor={playerColor} />,
      );
      const positions = piecePositions(renderer, PieceType.Pawn, opponent);

      expect(positions.map(([, y]) => y)).toEqual(Array(10).fill(levelY(theirs)));
      expect(new Set(positions.map(([, , z]) => z))).toEqual(new Set([-NEAREST, -SECOND_NEAREST]));
    });
  });

  it("shows spectators the board from White's side", async () => {
    const spectator = await ReactThreeTestRenderer.create(
      <Board board={createTestBoard()} currentTurn="white" playerColor={null} />,
    );
    const white = await ReactThreeTestRenderer.create(
      <Board board={createTestBoard()} currentTurn="white" playerColor="white" />,
    );
    expect(piecePositions(spectator, PieceType.King, 'white')).toEqual(
      piecePositions(white, PieceType.King, 'white'),
    );
  });

  describe('last move', () => {
    const FROM = { x: 2, y: 2, z: 2 };
    const TO = { x: 2, y: 3, z: 2 };

    // A lone white rook (plus kings) that just arrived on TO from FROM.
    const boardAfterMove = () => rookBoard(TO);

    // The position before that move: the rook still on FROM.
    function boardBeforeMove(withVictim = false) {
      const board = rookBoard(FROM);
      if (withVictim) board.setPiece(TO, { type: PieceType.Pawn, color: 'black' });
      return board;
    }

    const lastMove = (moveCount: number, capturedPiece: LastMoveInfo['capturedPiece'] = null) =>
      ({ move: { from: FROM, to: TO }, moveCount, capturedPiece }) as LastMoveInfo;

    function glideGroups(renderer: Renderer) {
      return root(renderer).findAll((node) => node.props.userData?.moveGlide === true);
    }

    // What the last-move marker and the capture effect were handed
    const marked = drawn.lastMoves;
    const captures = drawn.captures;
    const floorOf = (cell: Coord, orientation: Color = 'white') => {
      const [x, y, z] = toWorld(cell, orientation);
      return [x, y + FLOOR_Y, z];
    };

    it('marks the last move without animating it when mounted with history', async () => {
      marked.length = 0;
      const renderer = await ReactThreeTestRenderer.create(
        <Board board={boardAfterMove()} currentTurn="black" lastMove={lastMove(1)} />,
      );

      // The marker joins the two squares' floors
      expect(last(marked)!.from.floor).toEqual(floorOf(FROM));
      expect(last(marked)!.to.floor).toEqual(floorOf(TO));

      // Moves already played at mount are history: marked only, no glide,
      // and the piece rests exactly on its cell.
      expect(glideGroups(renderer)).toHaveLength(0);
      expect(piecePositions(renderer, PieceType.Rook, 'white')).toEqual([toWorld(TO, 'white')]);
    });

    it('skips the glide and the capture effect when the player prefers reduced motion', async () => {
      const matchMedia = vi
        .spyOn(window, 'matchMedia')
        .mockImplementation(
          (query: string) => ({ matches: query.includes('reduce') }) as MediaQueryList,
        );
      try {
        marked.length = 0;
        captures.length = 0;
        const renderer = await ReactThreeTestRenderer.create(
          <Board board={boardBeforeMove(true)} currentTurn="white" />,
        );
        await renderer.update(
          <Board
            board={boardAfterMove()}
            currentTurn="black"
            lastMove={lastMove(1, { type: PieceType.Pawn, color: 'black' })}
          />,
        );
        expect(glideGroups(renderer)).toHaveLength(0);
        expect(captures).toHaveLength(0);
        // The marker still says what moved
        expect(last(marked)!.to.floor).toEqual(floorOf(TO));
      } finally {
        matchMedia.mockRestore();
      }
    });

    it('carries a newly arrived move from its source cell, along its glide', async () => {
      const renderer = await ReactThreeTestRenderer.create(
        <Board board={boardBeforeMove()} currentTurn="white" />,
      );
      await renderer.update(
        <Board board={boardAfterMove()} currentTurn="black" lastMove={lastMove(1)} />,
      );

      const glides = glideGroups(renderer);
      expect(glides).toHaveLength(1);
      const group = glides[0].instance as unknown as {
        position: { x: number; y: number; z: number };
      };
      const [fx, fy, fz] = toWorld(FROM, 'white');
      const [tx, ty, tz] = toWorld(TO, 'white');
      // Before any frame the wrapper holds the full journey back to the source
      expect(group.position.x).toBeCloseTo(fx - tx);
      expect(group.position.y).toBeCloseTo(fy - ty);
      expect(group.position.z).toBeCloseTo(fz - tz);

      // Part way: where its glide puts it then, over the line between the
      // squares. Frame deltas are clamped, so simulate several small frames.
      const plan = planGlide(toWorld(FROM, 'white'), toWorld(TO, 'white'));
      await act(async () => {
        await renderer.advanceFrames(20, 0.01);
      });
      const [px, py, pz] = glidePose(plan, 200).offset;
      expect(group.position.x).toBeCloseTo(px);
      expect(group.position.y).toBeCloseTo(py);
      expect(group.position.z).toBeCloseTo(pz);

      // Once it has settled: home, resting position untouched
      await act(async () => {
        await renderer.advanceFrames(touchdownMs(plan) + 50 / 10, 0.01);
      });
      expect(group.position.x).toBe(0);
      expect(group.position.y).toBe(0);
      expect(group.position.z).toBe(0);
      expect(piecePositions(renderer, PieceType.Rook, 'white')).toEqual([toWorld(TO, 'white')]);
    });

    it('shows the check a live move gives, and the mate, only once the piece lands', async () => {
      // The rook's arrival on TO checks Black's king along the rank
      const KING = { x: 4, y: 3, z: 2 };
      const withKings = (b: EngineBoard) => {
        b.setPiece({ x: 4, y: 4, z: 4 }, null);
        b.setPiece(KING, { type: PieceType.King, color: 'black' });
        return b;
      };
      const kingBody = () =>
        last(drawn.bodies.filter((b) => b.type === PieceType.King && b.color === 'black'))!;
      const renderer = await ReactThreeTestRenderer.create(
        <Board board={withKings(boardBeforeMove())} currentTurn="white" />,
      );
      await renderer.update(
        <Board
          board={withKings(boardAfterMove())}
          currentTurn="black"
          lastMove={lastMove(1)}
          gameOver={{ result: 'checkmate', winner: 'white' }}
        />,
      );
      // Still gliding: no strike, no red king, no fall yet
      expect(drawn.checks).toHaveLength(0);
      expect(kingBody().inCheck).toBe(false);
      // (frames of 10 ms: just short of the moment it counts as landed, a
      // little before it comes to rest)
      const down =
        touchdownMs(planGlide(toWorld(FROM, 'white'), toWorld(TO, 'white'))) -
        MATE_TUNING.knockLeadMs;
      await act(async () => {
        await renderer.advanceFrames(Math.floor(down / 10) - 2, 0.01);
      });
      expect(drawn.checks).toHaveLength(0);
      expect(kingBody().inCheck).toBe(false);
      // Landed: the check, at mate
      await act(async () => {
        await renderer.advanceFrames(4, 0.01);
      });
      expect(last(drawn.checks)?.mated).toBe(true);
      expect(kingBody().inCheck).toBe(true);
    });

    it('times the last move’s mark by the glide of that move', async () => {
      const renderer = await ReactThreeTestRenderer.create(
        <Board board={boardBeforeMove()} currentTurn="white" />,
      );
      await renderer.update(
        <Board board={boardAfterMove()} currentTurn="black" lastMove={lastMove(1)} />,
      );
      expect(last(marked)).toMatchObject({
        fresh: true,
        glideMs: touchdownMs(planGlide(toWorld(FROM, 'white'), toWorld(TO, 'white'))),
      });
    });

    it('shows a check from history at once', async () => {
      const board = boardAfterMove();
      board.setPiece({ x: 4, y: 4, z: 4 }, null);
      board.setPiece({ x: 4, y: 3, z: 2 }, { type: PieceType.King, color: 'black' });
      await ReactThreeTestRenderer.create(
        <Board board={board} currentTurn="black" lastMove={lastMove(1)} />,
      );
      expect(drawn.checks.length).toBeGreaterThan(0);
    });

    it('hands a live capture to the capture effect, on the victim’s floor', async () => {
      const victim = { type: PieceType.Pawn, color: 'black' as const };
      const renderer = await ReactThreeTestRenderer.create(
        <Board board={boardBeforeMove(true)} currentTurn="white" />,
      );
      await renderer.update(
        <Board board={boardAfterMove()} currentTurn="black" lastMove={lastMove(1, victim)} />,
      );
      expect(last(captures)).toMatchObject({
        floor: floorOf(TO),
        victim,
        orientation: 'white',
      });
      // The victim is hit when the rook reaches it, before it lands
      const plan = planGlide(toWorld(FROM, 'white'), toWorld(TO, 'white'), { capture: true });
      expect(last(captures)).toMatchObject({
        hitMs: contactAtMs(plan),
        landMs: touchdownMs(plan),
        heading: plan.heading,
      });
      expect(last(captures)!.hitMs).toBeLessThan(last(captures)!.landMs);
      // A move without a capture has none
      captures.length = 0;
      await renderer.update(
        <Board board={boardAfterMove()} currentTurn="black" lastMove={lastMove(2)} />,
      );
      expect(captures).toHaveLength(0);
    });

    it("animates in black's mirrored frame for the black player", async () => {
      const renderer = await ReactThreeTestRenderer.create(
        <Board board={boardBeforeMove()} currentTurn="white" playerColor="black" />,
      );
      await renderer.update(
        <Board
          board={boardAfterMove()}
          currentTurn="black"
          playerColor="black"
          lastMove={lastMove(1)}
        />,
      );

      expect(last(marked)!.from.floor).toEqual(floorOf(FROM, 'black'));
      expect(last(marked)!.to.floor).toEqual(floorOf(TO, 'black'));

      const group = glideGroups(renderer)[0].instance as unknown as {
        position: { x: number; y: number; z: number };
      };
      const [fx, fy, fz] = toWorld(FROM, 'black');
      const [tx, ty, tz] = toWorld(TO, 'black');
      expect(group.position.x).toBeCloseTo(fx - tx);
      expect(group.position.y).toBeCloseTo(fy - ty);
      expect(group.position.z).toBeCloseTo(fz - tz);
    });
  });
});

const last = <T,>(list: T[]): T | undefined => list[list.length - 1];

// Drives Board's hover probe with real pointer events on the test canvas:
// `moveTo` points at a world position through the live camera.
async function pointerOn(props: Partial<BoardProps> = {}) {
  const { renderer, camera, canvas, scene, width, height } = await mountBoard(props);
  const fire = async (type: string, x = 0, y = 0) => {
    await act(async () => {
      await renderer.advanceFrames(1, 0.016);
      // The test renderer never draws, so world matrices are only as fresh as this
      scene.updateMatrixWorld(true);
      const event = new MouseEvent(type, { clientX: x, clientY: y });
      canvas.dispatchEvent(event);
    });
  };
  return {
    renderer,
    moveTo: async ([x, y, z]: [number, number, number]) => {
      const p = new Vector3(x, y, z).project(camera);
      await fire('pointermove', ((p.x + 1) / 2) * width, ((1 - p.y) / 2) * height);
    },
    leave: () => fire('pointerleave'),
  };
}

describe('Board and what it hands the scene', () => {
  const renderWith = (props: Partial<BoardProps> = {}) =>
    ReactThreeTestRenderer.create(
      <Board board={createTestBoard()} currentTurn="white" {...props} />,
    );
  const quietMarkers = (renderer: Renderer) =>
    root(renderer).findAll((node) => node.props.userData?.quiet);
  const focusSeen = () => drawn.grids.map((g) => g.focus);

  it('tells a destination marker when the pointer is over its floor', async () => {
    const pointer = await pointerOn();
    await press(findPiece(pointer.renderer, PieceType.Pawn, 'white', LEVEL_B_PAWN));
    expect(quietMarkers(pointer.renderer).map((m) => m.props.userData.hovered)).toEqual([
      false,
      false,
    ]);

    // The pawn's step forward, on its own level: aim at the middle of its floor
    const forward = { x: 0, y: 2, z: 1 };
    const [fx, fy, fz] = toWorld(forward, 'white');
    await pointer.moveTo([fx, fy + FLOOR_Y, fz]);
    const hovered = quietMarkers(pointer.renderer).filter((m) => m.props.userData.hovered);
    expect(hovered).toHaveLength(1);
    expect(hovered[0].props.position).toEqual([fx, fy + FLOOR_Y, fz]);

    await pointer.leave();
    expect(quietMarkers(pointer.renderer).some((m) => m.props.userData.hovered)).toBe(false);
  });

  it('steps back the destinations on levels the pointer is not on', async () => {
    const pointer = await pointerOn();
    await press(findPiece(pointer.renderer, PieceType.Pawn, 'white', LEVEL_B_PAWN));
    const [fx, fy, fz] = toWorld({ x: 0, y: 2, z: 1 }, 'white');
    const forward = [fx, fy + FLOOR_Y, fz];
    const dims = () =>
      quietMarkers(pointer.renderer).map((m) => ({
        onLevel: JSON.stringify(m.props.position) === JSON.stringify(forward),
        dim: m.props.userData.dim,
      }));
    // Holding the pawn steps no level back: its move up is as much in play
    expect(dims().map(({ dim }) => dim)).toEqual([false, false]);
    expect(drawn.bodies.every((b) => !b.focus)).toBe(true);

    // Pointing at the destination above: its level leads
    const above = quietMarkers(pointer.renderer).find(
      (m) => JSON.stringify(m.props.position) !== JSON.stringify(forward),
    )!;
    drawn.bodies.length = 0;
    await pointer.moveTo(above.props.position as [number, number, number]);
    expect(dims()).toEqual(
      expect.arrayContaining([
        { onLevel: true, dim: true },
        { onLevel: false, dim: false },
      ]),
    );
    // No piece stands on that level: every piece hazes but the one held
    const bodies = drawn.bodies.splice(0);
    // (the held pawn's props are unchanged at 0, so it is not even drawn again)
    expect(bodies.some((b) => b.selected && b.focus !== 0)).toBe(false);
    const others = bodies.filter((b) => !b.selected);
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((b) => b.focus === -1)).toBe(true);
  });

  it('scales every piece about its base, seated on its floor', async () => {
    const renderer = await renderWith();
    const piece = findPiece(renderer, PieceType.King, 'white');
    const inner = piece.children[0].instance as unknown as { scale: { x: number } };
    expect(inner.scale.x).toBe(PIECE_SCALE);
    expect(piece.children[0].props.position).toEqual([0, FLOOR_Y, 0]);
  });

  it('passes the level of the cell under the pointer as the hovered focus', async () => {
    const pointer = await pointerOn();

    // Onto the level-B pawn's body
    const [px, py, pz] = toWorld(LEVEL_B_PAWN, 'white');
    await pointer.moveTo([px, py + FLOOR_Y + 0.25, pz]);
    expect(last(focusSeen())).toEqual({ selected: null, hovered: 1 });

    // Selecting it keeps the hover (it is still under the pointer)
    await press(findPiece(pointer.renderer, PieceType.Pawn, 'white', LEVEL_B_PAWN));
    expect(last(focusSeen())).toEqual({ selected: 1, hovered: 1 });

    await pointer.leave();
    expect(last(focusSeen())).toEqual({ selected: 1, hovered: null });
  });

  it('passes the selected level as focus with the pointer off the board', async () => {
    const renderer = await renderWith();
    expect(last(focusSeen())).toEqual({ selected: null, hovered: null });
    await press(findPiece(renderer, PieceType.Pawn, 'white', LEVEL_B_PAWN));
    expect(last(focusSeen())).toEqual({ selected: 1, hovered: null });
  });

  it('remounts the selection marker when the selection moves straight to another piece', async () => {
    const renderer = await renderWith();
    await press(findPiece(renderer, PieceType.Pawn, 'white', { x: 0, y: 1, z: 1 }));
    expect(drawn.selectionMounts).toBe(1);
    await press(findPiece(renderer, PieceType.Pawn, 'white', { x: 1, y: 1, z: 1 }));
    // Its entrance plays again for the new piece
    expect(drawn.selectionMounts).toBe(2);
  });

  it('tells the check marker when the check is mate', async () => {
    const board = new EngineBoard();
    board.setPiece({ x: 0, y: 0, z: 0 }, { type: PieceType.King, color: 'black' });
    board.setPiece({ x: 0, y: 4, z: 0 }, { type: PieceType.Rook, color: 'white' });
    const renderer = await renderWith({ board, currentTurn: 'black' });
    expect(last(drawn.checks)!.mated).toBeUndefined();
    await renderer.update(
      <Board
        board={board}
        currentTurn="black"
        gameOver={{ result: 'checkmate', winner: 'white' }}
      />,
    );
    expect(last(drawn.checks)!.mated).toBe(true);
  });

  it('tells a piece body it is under the pointer', async () => {
    const hoveredBodies = (renderer: Renderer) =>
      root(renderer).findAll((node) => node.props.userData?.hoveredBody);
    const renderer = await renderWith();
    const pawn = findPiece(renderer, PieceType.Pawn, 'white', LEVEL_B_PAWN);
    await act(async () => pawn.props.onPointerOver({ stopPropagation: () => {} }));
    expect(hoveredBodies(renderer)).toHaveLength(1);
    await act(async () => pawn.props.onPointerOut());
    expect(hoveredBodies(renderer)).toHaveLength(0);
    // Not an opposing piece, which the player may not pick up
    const theirs = findPiece(renderer, PieceType.Pawn, 'black');
    await act(async () => theirs.props.onPointerOver({ stopPropagation: () => {} }));
    expect(hoveredBodies(renderer)).toHaveLength(0);
  });

  it('tells each piece body the level it stands on', async () => {
    await renderWith();
    // White's army starts on A and B, Black's on D and E
    expect(drawn.bodies.filter((b) => b.level === undefined)).toHaveLength(0);
    const kings = drawn.bodies.filter((b) => b.type === PieceType.King);
    expect([...new Set(kings.map((k) => `${k.color}-${k.level}`))].sort()).toEqual([
      'black-4',
      'white-0',
    ]);
  });

  it('stands each click box on its floor, a thin slab', async () => {
    const renderer = await renderWith();
    const { hitHeight } = layout;
    expect(hitHeight).toBeLessThan(0.2);
    const cell = root(renderer).findAll(
      (node) => node.type === 'Mesh' && node.props.userData?.zxy === 'Cc3',
    )[0];
    // The mesh stays at the cell's centre (where pieces and markers are
    // placed); its geometry is a thin slab on the floor
    expect(cell.props.position).toEqual(toWorld({ x: 2, y: 2, z: 2 }, 'white'));
    const geometry = (cell.instance as unknown as { geometry: BufferGeometry }).geometry;
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.y).toBeCloseTo(FLOOR_Y);
    expect(geometry.boundingBox!.max.y).toBeCloseTo(FLOOR_Y + hitHeight);
  });

  describe('last move', () => {
    const FROM = { x: 2, y: 2, z: 2 };
    const TO = { x: 2, y: 3, z: 2 };
    const seen = drawn.lastMoves;
    const mounts = drawn.lastMoveMounts;
    const info = (moveCount: number, from: Coord, to: Coord): LastMoveInfo => ({
      move: { from, to },
      moveCount,
      capturedPiece: null,
    });
    const view = (board: EngineBoard, lastMove: LastMoveInfo | undefined, turn: Color) => (
      <Board board={board} currentTurn={turn} lastMove={lastMove} />
    );

    it('is not fresh when replayed at mount, fresh for a live move, and remounts per move', async () => {
      const renderer = await ReactThreeTestRenderer.create(
        view(rookBoard(TO), info(4, FROM, TO), 'black'),
      );
      expect(last(seen)!.fresh).toBe(false);
      expect(mounts).toHaveLength(1);

      const next = { x: 2, y: 4, z: 2 };
      await renderer.update(view(rookBoard(next), info(5, TO, next), 'white'));
      expect(last(seen)!.fresh).toBe(true);
      expect(mounts).toHaveLength(2);

      // A re-render of the same move neither remounts it nor replays it
      await renderer.update(view(rookBoard(next), info(5, TO, next), 'white'));
      expect(mounts).toHaveLength(2);
    });
  });
});

// Tap assist, end to end through Board's handlers: the board seen through a
// fixed camera on an 800x600 canvas, and clicks carrying a pointer type and
// a position, as a browser sends them.
describe('Board tap assist', () => {
  const W = 800;
  const H = 600;
  async function tapBoard(props: Partial<BoardProps> = {}) {
    const { renderer, camera, scene } = await mountBoard(props);
    const cam = camera as PerspectiveCamera;
    cam.fov = 40;
    cam.aspect = W / H;
    cam.position.set(6.5, 5, 8.5).normalize().multiplyScalar(16);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    scene.updateMatrixWorld(true);
    const grid = gridOf(renderer);
    /** Screen pixel of a world point. */
    const pixel = ([x, y, z]: [number, number, number]) => {
      const p = new Vector3(x, y, z).project(cam);
      return [((p.x + 1) / 2) * W, ((1 - p.y) / 2) * H] as const;
    };
    const click = (x: number, y: number, pointerType = 'touch', type = 'click') => ({
      type,
      pointerType,
      button: 0,
      clientX: x,
      clientY: y,
    });
    return {
      renderer,
      pixel,
      /** A tap whose ray hits an empty square: the grid's own click. */
      onEmptySquare: (x: number, y: number, pointerType?: string) =>
        act(async () => {
          grid.props.onClick({
            stopPropagation: () => {},
            delta: 0,
            nativeEvent: click(x, y, pointerType),
          });
        }),
      /** A tap whose ray hits nothing on the board. */
      onNothing: (x: number, y: number, pointerType?: string, type?: string) =>
        act(async () => {
          grid.props.onPointerMissed(click(x, y, pointerType, type));
        }),
      /** A tap whose ray hits this piece. */
      onPiece: (node: ReactThreeTestInstance, x: number, y: number) =>
        act(async () => {
          node.props.onClick({ stopPropagation: () => {}, delta: 0, nativeEvent: click(x, y) });
        }),
    };
  }

  const destinationsOf = (renderer: Renderer) =>
    highlightedCells(renderer)
      .map((cell) => cell.props.userData.zxy as string)
      .sort();

  // Ba2's pawn (two moves) and a spot beside it, clear of its hit shape but
  // well within a finger's reach, and further from any other piece
  const beside = (pixel: (p: [number, number, number]) => readonly [number, number]) => {
    const [x, y] = pixel(toWorld(LEVEL_B_PAWN, 'white'));
    return [x - 22, y] as const;
  };

  // A rook on Aa1 that can take a pawn on Aa3, with both kings on the board
  const captureBoard = () => {
    const b = new EngineBoard();
    b.setPiece({ x: 0, y: 0, z: 0 }, { type: PieceType.Rook, color: 'white' });
    b.setPiece({ x: 4, y: 0, z: 0 }, { type: PieceType.King, color: 'white' });
    b.setPiece({ x: 0, y: 2, z: 0 }, { type: PieceType.Pawn, color: 'black' });
    b.setPiece({ x: 4, y: 4, z: 4 }, { type: PieceType.King, color: 'black' });
    return b;
  };

  it('plays a capture once for one tap, however many objects r3f hands the tap to', async () => {
    const onMove = vi.fn();
    const board = await tapBoard({ board: captureBoard(), onMove });
    await press(findPiece(board.renderer, PieceType.Rook, 'white'));
    const victim = findPiece(board.renderer, PieceType.Pawn, 'black');
    const cell = highlightedCells(board.renderer).find((c) => c.props.userData.zxy === 'Aa3')!;
    const grid = gridOf(board.renderer);
    const [x, y] = board.pixel(toWorld({ x: 0, y: 2, z: 0 }, 'white'));
    // One finger's tap on the pawn standing in its square: r3f hands the
    // click to the board's group once for each empty square the ray crosses
    // in front (where tap assist would find the capture too), then to the
    // pawn, and (were it not stopped) to the square behind it
    const tap = { type: 'click', pointerType: 'touch', button: 0, clientX: x, clientY: y };
    const at = { stopPropagation: () => {}, delta: 0, nativeEvent: tap };
    await act(async () => {
      grid.props.onClick(at);
      grid.props.onClick(at);
      victim.props.onClick(at);
      cell.props.onClick(at);
    });
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0][0].to).toEqual({ x: 0, y: 2, z: 0 });
  });

  it('plays a move once for two taps before the board has redrawn', async () => {
    const onMove = vi.fn();
    const board = await tapBoard({ board: captureBoard(), onMove });
    await press(findPiece(board.renderer, PieceType.Rook, 'white'));
    const cell = highlightedCells(board.renderer).find((c) => c.props.userData.zxy === 'Aa2')!;
    await act(async () => {
      cell.props.onClick(clickEvent());
      cell.props.onClick(clickEvent());
    });
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it('lets the empty squares act once, after the click has passed everything behind them', async () => {
    const board = await tapBoard();
    await press(findPiece(board.renderer, PieceType.Pawn, 'white', LEVEL_B_PAWN));
    const grid = gridOf(board.renderer);
    const mouse = {
      stopPropagation: () => {},
      delta: 0,
      nativeEvent: { type: 'click', button: 0 },
    };
    await act(async () => {
      grid.props.onClick(mouse);
      grid.props.onClick(mouse);
    });
    expect(highlightedCells(board.renderer)).toHaveLength(0);
  });

  it("gives a finger's tap beside a piece to that piece", async () => {
    const board = await tapBoard();
    const [x, y] = beside(board.pixel);
    await board.onEmptySquare(x, y);
    expect(destinationsOf(board.renderer)).toEqual(['Ba3', 'Ca2']);
  });

  it('leaves a mouse click beside a piece alone', async () => {
    const board = await tapBoard();
    const [x, y] = beside(board.pixel);
    await board.onEmptySquare(x, y, 'mouse');
    expect(highlightedCells(board.renderer)).toHaveLength(0);
    await board.onNothing(x, y, 'mouse');
    expect(highlightedCells(board.renderer)).toHaveLength(0);
  });

  it("never assists a long press's context menu", async () => {
    const board = await tapBoard();
    const [x, y] = beside(board.pixel);
    await board.onNothing(x, y, 'touch', 'contextmenu');
    expect(highlightedCells(board.renderer)).toHaveLength(0);
  });

  it('plays the move a tap in the gap beside a destination was meant for', async () => {
    const onMove = vi.fn();
    const board = await tapBoard({ onMove });
    await press(findPiece(board.renderer, PieceType.Pawn, 'white', LEVEL_B_PAWN));
    const [destination] = highlightedCells(board.renderer);
    const [x, y] = board.pixel(destination.props.position);
    await board.onNothing(x, y);
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0][0].to).toEqual(fromZXY(destination.props.userData.zxy));
  });

  it('puts the piece down when a tap is out of reach of everything', async () => {
    const board = await tapBoard();
    await press(findPiece(board.renderer, PieceType.Pawn, 'white', LEVEL_B_PAWN));
    await board.onNothing(4, 4);
    expect(highlightedCells(board.renderer)).toHaveLength(0);
  });

  it("gives a tap on the opponent's piece to the own piece it was meant for", async () => {
    const board = await tapBoard();
    const black = findPiece(board.renderer, PieceType.Pawn, 'black');
    const [x, y] = beside(board.pixel);
    await board.onPiece(black, x, y);
    expect(destinationsOf(board.renderer)).toEqual(['Ba3', 'Ca2']);
  });
});

describe('Board aims clicks where they were released', () => {
  it('has r3f raycast a whole-pixel click from its release, where the press was raycast', async () => {
    let get: (() => { events: { compute?: (e: unknown, s: unknown) => void } }) | null = null;
    const Grab = () => {
      get = useThree((s) => s.get) as unknown as typeof get;
      return null;
    };
    await ReactThreeTestRenderer.create(
      <>
        <Grab />
        <Board board={createTestBoard()} currentTurn="white" />
      </>,
    );
    const compute = get!().events.compute!;
    const state = {
      pointer: new Vector3(),
      raycaster: { setFromCamera: () => {} },
      camera: {},
      size: { width: 800, height: 600 },
    };
    compute({ type: 'pointerup', offsetX: 541.66, offsetY: 328.28 }, state);
    compute({ type: 'click', offsetX: 542, offsetY: 328 }, state);
    expect(state.pointer.x).toBeCloseTo((541.66 / 800) * 2 - 1, 9);
    expect(state.pointer.y).toBeCloseTo(-(328.28 / 600) * 2 + 1, 9);
  });
});
