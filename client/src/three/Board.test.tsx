import React from 'react';
import { describe, it, expect } from 'vitest';
import BoardView from './Board';
import type { BoardProps, LastMoveInfo } from './Board';
import { DesignContext } from './designs/context';
import testDesign from './designs/testDesign';
import { knightArcHeight } from './movePath';
import type { KnightMoves } from './movePath';
import { useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import type { BufferGeometry, Camera, Scene } from 'three';
import type {
  Design,
  GridProps,
  LastMoveMarkerProps,
  LevelFocus,
  MarkerProps,
  MoveFxProps,
  PieceBodyProps,
} from './designs/types';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { ReactThreeTestInstance } from '@react-three/test-renderer/dist/declarations/src/types/public.js';
import { PieceType } from '../engine';
import type { Coord, Move } from '../engine';
import { act } from 'react';
import { vi } from 'vitest';
import { Board as EngineBoard } from '../engine';
import { theme } from './theme';

type Renderer = { scene: unknown };
type Color = 'white' | 'black';

/** The board as these tests draw it: in the light test design, unless given another. */
const Board = ({ design = testDesign, ...props }: BoardProps & { design?: Design }) => (
  <DesignContext.Provider value={design}>
    <BoardView {...props} />
  </DesignContext.Provider>
);

// Where the test design's layout (the compact tower Zenith is built on) puts
// a cell's centre and its floor
const { layout } = testDesign;
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
  const matches = (renderer.scene as ReactThreeTestInstance).findAll(
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
  return (renderer.scene as ReactThreeTestInstance).findAll(
    (node) => node.type === 'Mesh' && node.props.userData?.highlight === true,
  );
}

function selectionRings(renderer: Renderer): ReactThreeTestInstance[] {
  return (renderer.scene as ReactThreeTestInstance).findAll(
    (node) => node.props.userData?.selectionRing === true,
  );
}

// World positions of every piece of a given type/colour currently rendered.
function piecePositions(
  renderer: Renderer,
  type: PieceType,
  color: Color,
): [number, number, number][] {
  return (renderer.scene as ReactThreeTestInstance)
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
  return (renderer.scene as ReactThreeTestInstance)
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

describe('Board', () => {
  it('renders 125 cube meshes', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Board board={createTestBoard()} currentTurn="white" />,
    );
    // Count only cubes by userData.cube === true
    const cubeCount = (renderer.scene as ReactThreeTestInstance).findAll(
      (node) => node.type === 'Mesh' && node.props.userData?.cube === true,
    ).length;
    expect(cubeCount).toBe(125);
  });

  it('draws only filled cells and keeps the rest as invisible raycast targets', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Board board={createTestBoard()} currentTurn="white" />,
    );
    type CellMesh = { visible: boolean; geometry: unknown; material: unknown };
    const cells = () =>
      (renderer.scene as ReactThreeTestInstance)
        .findAll((node) => node.type === 'Mesh' && node.props.userData?.cube === true)
        .map((node) => node.instance as unknown as CellMesh);

    // Nothing to draw yet: no cell is visible, they all share one geometry and
    // one material, and none has opted out of raycasting (a click on any of
    // them must still reach the board group to clear a selection).
    const idle = cells();
    expect(idle).toHaveLength(125);
    expect(idle.every((cell) => cell.visible === false)).toBe(true);
    expect(new Set(idle.map((cell) => cell.geometry)).size).toBe(1);
    expect(new Set(idle.map((cell) => cell.material)).size).toBe(1);
    expect(idle.some((cell) => Object.prototype.hasOwnProperty.call(cell, 'raycast'))).toBe(false);

    // Selecting a piece draws exactly its destination cells.
    await press(findPiece(renderer, PieceType.Pawn, 'white', LEVEL_B_PAWN));
    const drawn = cells().filter((cell) => cell.visible);
    expect(drawn).toHaveLength(2);
    expect(
      highlightedCells(renderer).map((c) => (c.instance as unknown as CellMesh).visible),
    ).toEqual([true, true]);
  });

  it('renders 40 piece meshes', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Board board={createTestBoard()} currentTurn="white" />,
    );
    const pieceCount = (renderer.scene as ReactThreeTestInstance).findAll(
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
    const boardGroup = (renderer.scene as ReactThreeTestInstance)
      .children[0] as ReactThreeTestInstance;

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
    const boardGroup = (renderer.scene as ReactThreeTestInstance)
      .children[0] as ReactThreeTestInstance;

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
    // A white rook with a single black pawn to capture one cell up the ranks.
    const board = new EngineBoard();
    board.setPiece({ x: 2, y: 2, z: 2 }, { type: PieceType.Rook, color: 'white' });
    board.setPiece({ x: 2, y: 3, z: 2 }, { type: PieceType.Pawn, color: 'black' });
    board.setPiece({ x: 0, y: 0, z: 0 }, { type: PieceType.King, color: 'white' });
    board.setPiece({ x: 4, y: 4, z: 4 }, { type: PieceType.King, color: 'black' });

    const renderer = await ReactThreeTestRenderer.create(
      <Board board={board} currentTurn="white" />,
    );
    const pawn = findPiece(renderer, PieceType.Pawn, 'black');
    await press(findPiece(renderer, PieceType.Rook, 'white'));

    const rings = (renderer.scene as ReactThreeTestInstance).findAll(
      (node) => node.props.userData?.captureRing === true,
    );
    expect(rings).toHaveLength(1);
    // At the base of the piece it marks, not the cell centre — otherwise the
    // ring cuts through the piece at a height that varies with its silhouette.
    const pawnPos = pawn.props.position as [number, number, number];
    expect(rings[0].props.position).toEqual([pawnPos[0], pawnPos[1] + FLOOR_Y, pawnPos[2]]);
  });

  it('captures when the capturable piece itself is clicked, not just its cell', async () => {
    const board = new EngineBoard();
    board.setPiece({ x: 2, y: 2, z: 2 }, { type: PieceType.Rook, color: 'white' });
    board.setPiece({ x: 2, y: 3, z: 2 }, { type: PieceType.Pawn, color: 'black' });
    board.setPiece({ x: 0, y: 0, z: 0 }, { type: PieceType.King, color: 'white' });
    board.setPiece({ x: 4, y: 4, z: 4 }, { type: PieceType.King, color: 'black' });
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

    const boardGroup = (renderer.scene as ReactThreeTestInstance)
      .children[0] as ReactThreeTestInstance;
    await press(boardGroup, { delta: 40 });
    expect(selectionRings(renderer)).toHaveLength(1);

    // A few pixels of jitter still count as a click
    await press(dest, { delta: 4 });
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it('defaults a promotion to Queen and offers the promotion square once', async () => {
    const onMove = vi.fn<(move: Move) => void>();
    const board = new EngineBoard();
    const from: Coord = { x: 2, y: 3, z: 4 };
    const to: Coord = { x: 2, y: 4, z: 4 }; // rank 5 on level E: White's promotion square
    board.setPiece(from, { type: PieceType.Pawn, color: 'white' });
    board.setPiece({ x: 0, y: 0, z: 0 }, { type: PieceType.King, color: 'white' });
    board.setPiece({ x: 4, y: 0, z: 0 }, { type: PieceType.King, color: 'black' });

    const renderer = await ReactThreeTestRenderer.create(
      <Board onMove={onMove} board={board} currentTurn="white" />,
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
    const board = new EngineBoard();
    const from: Coord = { x: 2, y: 3, z: 4 };
    const to: Coord = { x: 2, y: 4, z: 4 };
    board.setPiece(from, { type: PieceType.Pawn, color: 'white' });
    board.setPiece({ x: 0, y: 0, z: 0 }, { type: PieceType.King, color: 'white' });
    board.setPiece({ x: 4, y: 0, z: 0 }, { type: PieceType.King, color: 'black' });

    const renderer = await ReactThreeTestRenderer.create(
      <Board
        onMove={onMove}
        onChoosePromotion={onChoosePromotion}
        board={board}
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

  it('renders king with the check glow when in check', async () => {
    // Set up a board with black king in check from a white rook
    const board = new EngineBoard();
    // Place black king at (0,0,0), white rook at (0,4,0)
    board.setPiece({ x: 0, y: 0, z: 0 }, { type: PieceType.King, color: 'black' });
    board.setPiece({ x: 0, y: 4, z: 0 }, { type: PieceType.Rook, color: 'white' });
    // Render board for black's turn (king in check)
    const renderer = await ReactThreeTestRenderer.create(
      <Board board={board} currentTurn="black" />,
    );
    const king = findPiece(renderer, PieceType.King, 'black');
    expect(king.props.userData.emissive).toBe(theme.check);
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
    function boardAfterMove() {
      const board = new EngineBoard();
      board.setPiece(TO, { type: PieceType.Rook, color: 'white' });
      board.setPiece({ x: 0, y: 0, z: 0 }, { type: PieceType.King, color: 'white' });
      board.setPiece({ x: 4, y: 4, z: 4 }, { type: PieceType.King, color: 'black' });
      return board;
    }

    // The position before that move: the rook still on FROM.
    function boardBeforeMove(withVictim = false) {
      const board = new EngineBoard();
      board.setPiece(FROM, { type: PieceType.Rook, color: 'white' });
      if (withVictim) board.setPiece(TO, { type: PieceType.Pawn, color: 'black' });
      board.setPiece({ x: 0, y: 0, z: 0 }, { type: PieceType.King, color: 'white' });
      board.setPiece({ x: 4, y: 4, z: 4 }, { type: PieceType.King, color: 'black' });
      return board;
    }

    const lastMove = (moveCount: number, capturedPiece: LastMoveInfo['capturedPiece'] = null) =>
      ({ move: { from: FROM, to: TO }, moveCount, capturedPiece }) as LastMoveInfo;

    function findCells(renderer: Renderer, flag: 'lastMoveFrom' | 'lastMoveTo') {
      return (renderer.scene as ReactThreeTestInstance).findAll(
        (node) => node.type === 'Mesh' && node.props.userData?.[flag] === true,
      );
    }

    function glideGroups(renderer: Renderer) {
      return (renderer.scene as ReactThreeTestInstance).findAll(
        (node) => node.props.userData?.moveGlide === true,
      );
    }

    it('fills the from and to cells without animating when mounted with history', async () => {
      const renderer = await ReactThreeTestRenderer.create(
        <Board board={boardAfterMove()} currentTurn="black" lastMove={lastMove(1)} />,
      );

      const fromCells = findCells(renderer, 'lastMoveFrom');
      const toCells = findCells(renderer, 'lastMoveTo');
      expect(fromCells).toHaveLength(1);
      expect(toCells).toHaveLength(1);
      expect(fromCells[0].props.position).toEqual(toWorld(FROM, 'white'));
      expect(toCells[0].props.position).toEqual(toWorld(TO, 'white'));

      // The design's last-move fill, on both cells
      const materialOf = (cell: ReactThreeTestInstance) =>
        (cell.instance as unknown as { material: unknown }).material;
      expect(materialOf(toCells[0])).toBe(testDesign.cellFills.lastMove);
      expect(materialOf(fromCells[0])).toBe(testDesign.cellFills.lastMove);

      // Moves already played at mount are history: highlight only, no glide,
      // and the piece rests exactly on its cell.
      expect(glideGroups(renderer)).toHaveLength(0);
      expect(piecePositions(renderer, PieceType.Rook, 'white')).toEqual([toWorld(TO, 'white')]);
    });

    it('lets a legal-destination fill win over the last-move fill', async () => {
      // Black pawn above the rook: reachable, and sitting on the last move's
      // destination cell so the two fills compete.
      const board = boardAfterMove();
      const above = { x: 2, y: 4, z: 2 };
      board.setPiece(above, { type: PieceType.Pawn, color: 'black' });
      const renderer = await ReactThreeTestRenderer.create(
        <Board
          board={board}
          currentTurn="white"
          lastMove={{ move: { from: FROM, to: above }, moveCount: 1, capturedPiece: null }}
        />,
      );

      await press(findPiece(renderer, PieceType.Rook, 'white'));

      const cell = (renderer.scene as ReactThreeTestInstance)
        .findAll((node) => node.type === 'Mesh' && node.props.userData?.cube === true)
        .find(
          (node) => JSON.stringify(node.props.position) === JSON.stringify(toWorld(above, 'white')),
        )!;
      expect(cell.props.userData.highlight).toBe(true);
      expect(cell.props.userData.lastMoveTo).toBe(false);
      const material = (cell.instance as unknown as { material: unknown }).material;
      expect(material).toBe(testDesign.cellFills.destination);
    });

    it('skips the glide and the fade when the player prefers reduced motion', async () => {
      const matchMedia = vi
        .spyOn(window, 'matchMedia')
        .mockImplementation(
          (query: string) => ({ matches: query.includes('reduce') }) as MediaQueryList,
        );
      try {
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
        expect(
          (renderer.scene as ReactThreeTestInstance).findAll(
            (node) => node.props.userData?.ghostPiece === true,
          ),
        ).toHaveLength(0);
        // The highlight still says what moved
        expect(findCells(renderer, 'lastMoveTo')).toHaveLength(1);
      } finally {
        matchMedia.mockRestore();
      }
    });

    it('glides a newly arrived move from its source cell in a straight line', async () => {
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

      // Half-way (150ms of 300ms): the eased midpoint of the straight line,
      // not lifted. Frame deltas are clamped, so simulate several small frames.
      await act(async () => {
        await renderer.advanceFrames(5, 0.03);
      });
      expect(group.position.x).toBeCloseTo((fx - tx) / 2);
      expect(group.position.y).toBeCloseTo((fy - ty) / 2);
      expect(group.position.z).toBeCloseTo((fz - tz) / 2);

      // Past the duration: snapped home, resting position untouched
      await act(async () => {
        await renderer.advanceFrames(6, 0.03);
      });
      expect(group.position.x).toBe(0);
      expect(group.position.y).toBe(0);
      expect(group.position.z).toBe(0);
      expect(piecePositions(renderer, PieceType.Rook, 'white')).toEqual([toWorld(TO, 'white')]);
    });

    it('fades a captured piece out and removes it when done', async () => {
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

      const ghosts = (renderer.scene as ReactThreeTestInstance).findAll(
        (node) => node.props.userData?.ghostPiece === true,
      );
      expect(ghosts).toHaveLength(1);
      const [tx, ty, tz] = toWorld(TO, 'white');
      expect(ghosts[0].props.position).toEqual([tx, ty + FLOOR_Y, tz]);

      await act(async () => {
        await renderer.advanceFrames(11, 0.03);
      });
      expect(
        (renderer.scene as ReactThreeTestInstance).findAll(
          (node) => node.props.userData?.ghostPiece === true,
        ),
      ).toHaveLength(0);
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

      expect(findCells(renderer, 'lastMoveFrom')[0].props.position).toEqual(toWorld(FROM, 'black'));
      expect(findCells(renderer, 'lastMoveTo')[0].props.position).toEqual(toWorld(TO, 'black'));

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
async function pointerOn(design: Design, props: Partial<BoardProps> = {}) {
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
      <Board design={design} board={createTestBoard()} currentTurn="white" {...props} />
    </>,
  );
  const { camera, gl, scene } = three!;
  const canvas = gl.domElement;
  const rect = { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 };
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(rect as DOMRect);
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
      await fire('pointermove', ((p.x + 1) / 2) * rect.width, ((1 - p.y) / 2) * rect.height);
    },
    leave: () => fire('pointerleave'),
  };
}

describe('Board with a clarity-kit design', () => {
  // A design without cell volumes, tracking the pointer over destinations,
  // with shorter pieces. Its markers record what Board hands them.
  const Quiet = ({ floor, hovered }: MarkerProps) => (
    <group userData={{ quiet: true, hovered: hovered === true }} position={floor} />
  );
  const clarity: Design = {
    ...testDesign,
    id: 'clarity-test',
    cellFills: { destination: null, lastMove: null },
    hoverDestinations: true,
    pieceScale: 0.8,
    markers: { ...testDesign.markers, Quiet },
  };
  const renderWith = (design: Design, props: Partial<BoardProps> = {}) =>
    ReactThreeTestRenderer.create(
      <Board design={design} board={createTestBoard()} currentTurn="white" {...props} />,
    );
  const quietMarkers = (renderer: Renderer) =>
    (renderer.scene as ReactThreeTestInstance).findAll((node) => node.props.userData?.quiet);

  it('draws no fill for a null cell fill, yet keeps the destination clickable', async () => {
    const onMove = vi.fn();
    const renderer = await renderWith(clarity, { onMove });
    await press(findPiece(renderer, PieceType.Pawn, 'white', LEVEL_B_PAWN));
    const highlighted = highlightedCells(renderer);
    expect(highlighted).toHaveLength(2);
    for (const cell of highlighted) {
      expect((cell.instance as unknown as { visible: boolean }).visible).toBe(false);
    }
    await press(highlighted[0]);
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it('tells a destination marker when the pointer is over its floor', async () => {
    const pointer = await pointerOn(clarity);
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

  it('leaves a design without hover tracking alone', async () => {
    const renderer = await renderWith(testDesign);
    await press(findPiece(renderer, PieceType.Pawn, 'white', LEVEL_B_PAWN));
    for (const cell of highlightedCells(renderer)) {
      expect(cell.props.onPointerOver).toBeUndefined();
    }
  });

  it('scales every piece about its base by the design’s piece scale, and not at all at 1', async () => {
    const innerScales = async (design: Design) => {
      const renderer = await renderWith(design);
      const piece = findPiece(renderer, PieceType.King, 'white');
      const inner = piece.children[0].instance as unknown as { scale: { x: number } };
      const position = piece.children[0].props.position;
      return { scale: inner.scale.x, position };
    };
    expect(await innerScales(clarity)).toEqual({ scale: 0.8, position: [0, FLOOR_Y, 0] });
    expect((await innerScales({ ...testDesign, pieceScale: 1 })).scale).toBe(1);
  });

  it('reports the cell under the pointer, and its level as the hovered focus', async () => {
    const onHoverCell = vi.fn();
    const focusSeen: (LevelFocus | undefined)[] = [];
    const Grid = ({ focus }: GridProps) => {
      focusSeen.push(focus);
      return null;
    };
    const design: Design = { ...clarity, Grid, hud: { ...clarity.hud, readout: true } };
    const pointer = await pointerOn(design, { onHoverCell });

    // Onto the level-B pawn's body
    const [px, py, pz] = toWorld(LEVEL_B_PAWN, 'white');
    await pointer.moveTo([px, py + FLOOR_Y + 0.25, pz]);
    expect(onHoverCell).toHaveBeenLastCalledWith({
      zxy: 'Ba2',
      piece: { type: PieceType.Pawn, color: 'white' },
    });
    expect(last(focusSeen)).toEqual({ selected: null, hovered: 1 });

    // Selecting it keeps the hover (it is still under the pointer)
    await press(findPiece(pointer.renderer, PieceType.Pawn, 'white', LEVEL_B_PAWN));
    expect(last(focusSeen)).toEqual({ selected: 1, hovered: 1 });

    await pointer.leave();
    expect(onHoverCell).toHaveBeenLastCalledWith(null);
    expect(last(focusSeen)).toEqual({ selected: 1, hovered: null });
  });

  it('passes the selected level as focus even without hover tracking', async () => {
    const focusSeen: (LevelFocus | undefined)[] = [];
    const Grid = ({ focus }: GridProps) => {
      focusSeen.push(focus);
      return null;
    };
    const renderer = await renderWith({ ...testDesign, Grid });
    expect(last(focusSeen)).toEqual({ selected: null, hovered: null });
    await press(findPiece(renderer, PieceType.Pawn, 'white', LEVEL_B_PAWN));
    expect(last(focusSeen)).toEqual({ selected: 1, hovered: null });
  });

  it('remounts the selection marker when the selection moves straight to another piece', async () => {
    let mounts = 0;
    const Selection = ({ floor }: MarkerProps) => {
      React.useEffect(() => {
        mounts++;
      }, []);
      return <group userData={{ selection: true }} position={floor} />;
    };
    const renderer = await renderWith({
      ...testDesign,
      markers: { ...testDesign.markers, Selection },
    });
    await press(findPiece(renderer, PieceType.Pawn, 'white', { x: 0, y: 1, z: 1 }));
    expect(mounts).toBe(1);
    await press(findPiece(renderer, PieceType.Pawn, 'white', { x: 1, y: 1, z: 1 }));
    // Its entrance plays again for the new piece
    expect(mounts).toBe(2);
  });

  it('tells the check marker when the check is mate', async () => {
    const seen: (boolean | undefined)[] = [];
    const Check = ({ mated }: MarkerProps) => {
      seen.push(mated);
      return null;
    };
    const board = new EngineBoard();
    board.setPiece({ x: 0, y: 0, z: 0 }, { type: PieceType.King, color: 'black' });
    board.setPiece({ x: 0, y: 4, z: 0 }, { type: PieceType.Rook, color: 'white' });
    const design = { ...testDesign, markers: { ...testDesign.markers, Check } };
    const renderer = await renderWith(design, { board, currentTurn: 'black' });
    expect(last(seen)).toBeUndefined();
    await renderer.update(
      <Board
        design={design}
        board={board}
        currentTurn="black"
        gameOver={{ result: 'checkmate', winner: 'white' }}
      />,
    );
    expect(last(seen)).toBe(true);
  });

  it('tells a piece body it is under the pointer for any hover lift, heights or `true`', async () => {
    const hoveredBodies = (renderer: Renderer) =>
      (renderer.scene as ReactThreeTestInstance).findAll(
        (node) => node.props.userData?.hoveredBody,
      );
    const PieceBody = ({ hovered }: PieceBodyProps) => (
      <group userData={{ hoveredBody: hovered === true }} />
    );
    for (const hoverLift of [true, { hover: 0.05, selected: 0.16 }] as const) {
      const renderer = await renderWith({ ...testDesign, PieceBody, hoverLift });
      const pawn = findPiece(renderer, PieceType.Pawn, 'white', LEVEL_B_PAWN);
      await act(async () => pawn.props.onPointerOver({ stopPropagation: () => {} }));
      expect(hoveredBodies(renderer).filter((b) => b.props.userData.hoveredBody)).toHaveLength(1);
      await act(async () => pawn.props.onPointerOut());
      expect(hoveredBodies(renderer).some((b) => b.props.userData.hoveredBody)).toBe(false);
    }
  });

  it('tells each piece body the level it stands on', async () => {
    const levels = new Map<string, number | undefined>();
    const PieceBody = ({ type, color, level }: PieceBodyProps) => {
      levels.set(`${color}-${type}-${level}`, level);
      return null;
    };
    await renderWith({ ...testDesign, PieceBody });
    // White's army starts on A and B, Black's on D and E
    expect([...levels.values()].filter((l) => l === undefined)).toHaveLength(0);
    const kings = [...levels.keys()].filter((k) => k.includes('King'));
    expect(kings.sort()).toEqual(['black-King-4', 'white-King-0']);
  });

  it('sinks the click boxes onto the floor for a layout with a hitHeight', async () => {
    const renderer = await renderWith({
      ...testDesign,
      layout: { ...testDesign.layout, hitHeight: 0.1 },
    });
    const cell = (renderer.scene as ReactThreeTestInstance).findAll(
      (node) => node.type === 'Mesh' && node.props.userData?.zxy === 'Cc3',
    )[0];
    // The mesh stays at the cell's centre (where pieces and markers are
    // placed); its geometry is a thin slab on the floor
    expect(cell.props.position).toEqual(toWorld({ x: 2, y: 2, z: 2 }, 'white'));
    const geometry = (cell.instance as unknown as { geometry: BufferGeometry }).geometry;
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.y).toBeCloseTo(FLOOR_Y);
    expect(geometry.boundingBox!.max.y).toBeCloseTo(FLOOR_Y + 0.1);
  });

  describe('last move', () => {
    const FROM = { x: 2, y: 2, z: 2 };
    const TO = { x: 2, y: 3, z: 2 };
    const mounts: string[] = [];
    const seen: LastMoveMarkerProps[] = [];
    const LastMove = (props: LastMoveMarkerProps) => {
      seen.push(props);
      React.useEffect(() => {
        mounts.push(JSON.stringify(props.to.floor));
        // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
      }, []);
      return null;
    };
    const design: Design = { ...testDesign, markers: { ...testDesign.markers, LastMove } };
    const boardWith = (at: Coord) => {
      const board = new EngineBoard();
      board.setPiece(at, { type: PieceType.Rook, color: 'white' });
      board.setPiece({ x: 0, y: 0, z: 0 }, { type: PieceType.King, color: 'white' });
      board.setPiece({ x: 4, y: 4, z: 4 }, { type: PieceType.King, color: 'black' });
      return board;
    };
    const info = (moveCount: number, from: Coord, to: Coord): LastMoveInfo => ({
      move: { from, to },
      moveCount,
      capturedPiece: null,
    });
    const view = (board: EngineBoard, lastMove: LastMoveInfo | undefined, turn: Color) => (
      <Board design={design} board={board} currentTurn={turn} lastMove={lastMove} />
    );

    it('hands the last move and its effects a knight’s arc only when knights arc', async () => {
      const fxSeen: MoveFxProps[] = [];
      const MoveFx = (props: MoveFxProps) => {
        fxSeen.push(props);
        return null;
      };
      const knightBoard = (at: Coord, type = PieceType.Knight) => {
        const board = new EngineBoard();
        board.setPiece(at, { type, color: 'white' });
        board.setPiece({ x: 0, y: 0, z: 0 }, { type: PieceType.King, color: 'white' });
        board.setPiece({ x: 4, y: 4, z: 4 }, { type: PieceType.King, color: 'black' });
        return board;
      };
      const jump = { x: 3, y: 4, z: 2 };
      const arcFor = async (
        knightMoves: KnightMoves | undefined,
        type = PieceType.Knight,
        promotion?: PieceType,
      ) => {
        seen.length = 0;
        fxSeen.length = 0;
        // The player's setting, as the design reads it (none: the design has no such setting)
        const d: Design = {
          ...design,
          MoveFx,
          knightMoves: knightMoves ? () => knightMoves : undefined,
        };
        const at = (board: EngineBoard, lastMove?: LastMoveInfo) => (
          <Board
            design={d}
            board={board}
            currentTurn={lastMove ? 'black' : 'white'}
            lastMove={lastMove}
          />
        );
        const renderer = await ReactThreeTestRenderer.create(at(knightBoard(FROM, type)));
        const move: LastMoveInfo = {
          move: { from: FROM, to: jump, ...(promotion ? { promotion } : {}) },
          moveCount: 1,
          capturedPiece: null,
        };
        await renderer.update(at(knightBoard(jump, type), move));
        const glide = (renderer.scene as ReactThreeTestInstance).findAll(
          (node) => node.props.userData?.moveGlide === true,
        )[0].instance as unknown as { position: { y: number } };
        // Half-way through the glide (both squares are on one level): the arc's peak
        await act(async () => {
          await renderer.advanceFrames(5, 0.03);
        });
        expect(last(fxSeen)!.arc).toBe(last(seen)!.arc);
        return { arc: last(seen)!.arc, glideArc: Math.round(glide.position.y * 1e3) / 1e3 };
      };
      const height = knightArcHeight(layout);
      // 0.6 of the cell pitch (1 in the compact tower)
      expect(height).toBeCloseTo(0.6);
      expect(await arcFor('arc')).toEqual({ arc: height, glideArc: height });
      // Straight is the default, with or without the setting
      expect(await arcFor('straight')).toEqual({ arc: 0, glideArc: 0 });
      expect(await arcFor(undefined)).toEqual({ arc: 0, glideArc: 0 });
      // Only a knight arcs: not a rook, nor a pawn that promotes to a knight
      expect((await arcFor('arc', PieceType.Rook)).arc).toBe(0);
      expect((await arcFor('arc', PieceType.Knight, PieceType.Knight)).arc).toBe(0);
    });

    it('is not fresh when replayed at mount, fresh for a live move, and remounts per move', async () => {
      mounts.length = 0;
      seen.length = 0;
      const renderer = await ReactThreeTestRenderer.create(
        view(boardWith(TO), info(4, FROM, TO), 'black'),
      );
      expect(last(seen)!.fresh).toBe(false);
      expect(mounts).toHaveLength(1);

      const next = { x: 2, y: 4, z: 2 };
      await renderer.update(view(boardWith(next), info(5, TO, next), 'white'));
      expect(last(seen)!.fresh).toBe(true);
      expect(mounts).toHaveLength(2);

      // A re-render of the same move neither remounts it nor replays it
      await renderer.update(view(boardWith(next), info(5, TO, next), 'white'));
      expect(mounts).toHaveLength(2);
    });
  });
});
