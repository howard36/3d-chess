import { describe, it, expect } from 'vitest';
import Board from './Board';
import type { LastMoveInfo } from './Board';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { ReactThreeTestInstance } from '@react-three/test-renderer/dist/declarations/src/types/public.js';
import { PieceType } from '../engine';
import type { Coord, Move } from '../engine';
import { act } from 'react';
import { vi } from 'vitest';
import { Board as EngineBoard } from '../engine';
import { CELL_FLOOR_Y, SPACING, toWorld } from './layout';
import { MOVE_ANIMATION } from './motion';
import { theme } from './theme';

type Renderer = { scene: unknown };
type Color = 'white' | 'black';

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

// Simulate a pointer-down on a rendered node, inside act.
async function press(node: ReactThreeTestInstance) {
  await act(async () => {
    node.props.onPointerDown?.({ stopPropagation: () => {} } as React.PointerEvent<Element>);
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

// A white pawn on level B (z=1) of the starting position: it can step
// forward or up, so it has exactly two legal moves.
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

    // Click empty space (simulate group onPointerDown)
    await act(async () => {
      boardGroup.props.onPointerDown?.({} as React.PointerEvent<Element>);
    });
    expect(highlightedCells(renderer)).toHaveLength(0);
    expect(selectionRings(renderer)).toHaveLength(0);
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
    expect(selectionRings(renderer)[0].props.position).toEqual([fx, fy + CELL_FLOOR_Y, fz]);

    await press(findPiece(renderer, PieceType.Pawn, 'white', second));
    // Highlights still exist and now belong to the second pawn.
    const highlighted = highlightedCells(renderer);
    expect(highlighted).toHaveLength(2);
    expect(
      highlighted.some((c) => sameVec(c.props.position, toWorld({ x: 1, y: 2, z: 1 }, 'white'))),
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
    // its foot: PieceMesh seats the piece at the same CELL_FLOOR_Y offset.
    const piecePos = knight.props.position as [number, number, number];
    expect(rings[0].props.position).toEqual([piecePos[0], piecePos[1] + CELL_FLOOR_Y, piecePos[2]]);
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
    expect(rings[0].props.position).toEqual([pawnPos[0], pawnPos[1] + CELL_FLOOR_Y, pawnPos[2]]);
  });

  it('calls onMove with the from/to of the clicked destination and clears the selection', async () => {
    const onMove = vi.fn<(move: Move) => void>();
    const renderer = await ReactThreeTestRenderer.create(
      <Board onMove={onMove} board={createTestBoard()} currentTurn="white" />,
    );
    await press(findPiece(renderer, PieceType.Pawn, 'white', LEVEL_B_PAWN));

    const forward: Coord = { x: 0, y: 2, z: 1 };
    const dest = highlightedCells(renderer).find((c) =>
      sameVec(c.props.position, toWorld(forward, 'white')),
    )!;
    expect(dest).toBeDefined();
    await press(dest);

    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0][0]).toEqual({
      from: LEVEL_B_PAWN,
      to: forward,
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
  // back rank on the bottom slab, pawns on the slab above it, both occupying
  // the two layers nearest the camera (which looks down the +Z axis).
  describe.each([
    { playerColor: 'white' as const, opponent: 'black' as const },
    { playerColor: 'black' as const, opponent: 'white' as const },
  ])('orientation for $playerColor', ({ playerColor, opponent }) => {
    const BOTTOM = -2 * SPACING;
    const SECOND_FROM_BOTTOM = -SPACING;
    const NEAREST = 2 * SPACING;
    const SECOND_NEAREST = SPACING;

    it("puts the player's pawns on the second-from-bottom slab, nearest two layers", async () => {
      const renderer = await ReactThreeTestRenderer.create(
        <Board board={createTestBoard()} currentTurn="white" playerColor={playerColor} />,
      );
      const pawns = piecePositions(renderer, PieceType.Pawn, playerColor);

      expect(pawns).toHaveLength(10);
      expect(pawns.map(([, y]) => y)).toEqual(Array(10).fill(SECOND_FROM_BOTTOM));
      expect(new Set(pawns.map(([, , z]) => z))).toEqual(new Set([NEAREST, SECOND_NEAREST]));
    });

    it("puts the player's king on the bottom slab, nearest layer", async () => {
      const renderer = await ReactThreeTestRenderer.create(
        <Board board={createTestBoard()} currentTurn="white" playerColor={playerColor} />,
      );
      expect(piecePositions(renderer, PieceType.King, playerColor)).toEqual([[0, BOTTOM, NEAREST]]);
    });

    // Black's army is White's inverted through the centre, files included, so
    // only a file-mirrored view shows both players their own back ranks in the
    // same order. Without the mirror Black would read U B Q U B here.
    it("lays out the player's own back ranks the same way for both colours", async () => {
      const renderer = await ReactThreeTestRenderer.create(
        <Board board={createTestBoard()} currentTurn="white" playerColor={playerColor} />,
      );
      expect(rowLeftToRight(renderer, playerColor, BOTTOM, NEAREST)).toEqual([
        PieceType.Rook,
        PieceType.Knight,
        PieceType.King,
        PieceType.Knight,
        PieceType.Rook,
      ]);
      expect(rowLeftToRight(renderer, playerColor, BOTTOM, SECOND_NEAREST)).toEqual([
        PieceType.Bishop,
        PieceType.Unicorn,
        PieceType.Queen,
        PieceType.Bishop,
        PieceType.Unicorn,
      ]);
    });

    it("puts the opponent's pawns on the second-from-top slab, farthest two layers", async () => {
      const renderer = await ReactThreeTestRenderer.create(
        <Board board={createTestBoard()} currentTurn="white" playerColor={playerColor} />,
      );
      const pawns = piecePositions(renderer, PieceType.Pawn, opponent);

      expect(pawns.map(([, y]) => y)).toEqual(Array(10).fill(-SECOND_FROM_BOTTOM));
      expect(new Set(pawns.map(([, , z]) => z))).toEqual(new Set([-NEAREST, -SECOND_NEAREST]));
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

      // Teal fill, same strength on both cells
      const materialOf = (cell: ReactThreeTestInstance) =>
        (
          cell.instance as unknown as {
            material: { color: { getHexString(): string }; opacity: number };
          }
        ).material;
      expect(`#${materialOf(toCells[0]).color.getHexString()}`).toBe(theme.lastMoveFill);
      expect(materialOf(toCells[0]).opacity).toBe(theme.lastMoveFillOpacity);
      expect(materialOf(fromCells[0]).opacity).toBe(theme.lastMoveFillOpacity);

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
      const material = (
        cell.instance as unknown as {
          material: { color: { getHexString(): string }; opacity: number };
        }
      ).material;
      expect(`#${material.color.getHexString()}`).toBe(theme.highlightFill);
      expect(material.opacity).toBe(theme.highlightFillOpacity);
    });

    it('glides a newly arrived move from its source cell with a lift', async () => {
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

      // Half-way (150ms of 300ms): eased midpoint plus the full lift. Frame
      // deltas are clamped, so simulate several small frames.
      await act(async () => {
        await renderer.advanceFrames(5, 0.03);
      });
      expect(group.position.y).toBeCloseTo((fy - ty) / 2 + MOVE_ANIMATION.liftWorld);

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
      expect(ghosts[0].props.position).toEqual([tx, ty + CELL_FLOOR_Y, tz]);

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
