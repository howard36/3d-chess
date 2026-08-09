import { describe, it, expect } from 'vitest';
import Board from './Board';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { ReactThreeTestInstance } from '@react-three/test-renderer/dist/declarations/src/types/public.js';
import { PieceType } from '../engine';
import { act } from 'react';
import { vi } from 'vitest';
import { Board as EngineBoard } from '../engine';
import { SPACING } from './layout';

// Helper to create a fresh board
function createTestBoard() {
  return EngineBoard.setupStartingPosition();
}

// World positions of every piece of a given type/colour currently rendered.
function piecePositions(
  renderer: { scene: unknown },
  type: PieceType,
  color: 'white' | 'black',
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
  renderer: { scene: unknown },
  color: 'white' | 'black',
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
      (node) => (node.type === 'Mesh' || node.type === 'Group') && node.props.userData?.piece !== undefined,
    ).length;
    expect(pieceCount).toBe(40);
  });

  it('clicks a pawn and highlights destination cubes', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Board board={createTestBoard()} currentTurn="white" />,
    );
    const boardGroup = (renderer.scene as ReactThreeTestInstance)
      .children[0] as ReactThreeTestInstance;
    const pawn = boardGroup.children.find(
      (child) => (child.type === 'Mesh' || child.type === 'Group') && child.props.userData?.piece?.type === PieceType.Pawn,
    ) as ReactThreeTestInstance;
    expect(pawn).toBeDefined();

    // Simulate pointer down inside act
    await act(async () => {
      pawn.props.onPointerDown?.({ stopPropagation: () => {} } as React.PointerEvent<Element>);
    });

    // Now count highlighted cubes using findAll
    const highlightCount = (renderer.scene as ReactThreeTestInstance).findAll(
      (node) => node.type === 'Mesh' && node.props.userData?.highlight === true,
    ).length;
    expect(highlightCount).toBeGreaterThan(0);
  });

  it('unselects a piece when clicking empty space after selecting', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Board board={createTestBoard()} currentTurn="white" />,
    );
    const boardGroup = (renderer.scene as ReactThreeTestInstance)
      .children[0] as ReactThreeTestInstance;
    const pawn = boardGroup.children.find(
      (child) => (child.type === 'Mesh' || child.type === 'Group') && child.props.userData?.piece?.type === PieceType.Pawn,
    ) as ReactThreeTestInstance;
    expect(pawn).toBeDefined();

    // Select the pawn
    await act(async () => {
      pawn.props.onPointerDown?.({ stopPropagation: () => {} } as React.PointerEvent<Element>);
    });
    // There should be highlights
    let highlightCount = (renderer.scene as ReactThreeTestInstance).findAll(
      (node) => node.type === 'Mesh' && node.props.userData?.highlight === true,
    ).length;
    expect(highlightCount).toBeGreaterThan(0);

    // Click empty space (simulate group onPointerDown)
    await act(async () => {
      boardGroup.props.onPointerDown?.({} as React.PointerEvent<Element>);
    });
    // Highlights should be gone
    highlightCount = (renderer.scene as ReactThreeTestInstance).findAll(
      (node) => node.type === 'Mesh' && node.props.userData?.highlight === true,
    ).length;
    expect(highlightCount).toBe(0);
  });

  it('does not unselect when clicking another piece (selection moves)', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Board board={createTestBoard()} currentTurn="white" />,
    );
    const boardGroup = (renderer.scene as ReactThreeTestInstance)
      .children[0] as ReactThreeTestInstance;
    const pawns = boardGroup.children.filter(
      (child) => (child.type === 'Mesh' || child.type === 'Group') && child.props.userData?.piece?.type === PieceType.Pawn,
    ) as ReactThreeTestInstance[];
    expect(pawns.length).toBeGreaterThan(1);

    // Select the first pawn
    await act(async () => {
      pawns[0].props.onPointerDown?.({ stopPropagation: () => {} } as React.PointerEvent<Element>);
    });
    let highlightCount = (renderer.scene as ReactThreeTestInstance).findAll(
      (node) => node.type === 'Mesh' && node.props.userData?.highlight === true,
    ).length;
    expect(highlightCount).toBeGreaterThan(0);

    // Select the second pawn
    await act(async () => {
      pawns[1].props.onPointerDown?.({ stopPropagation: () => {} } as React.PointerEvent<Element>);
    });
    // Highlights should still exist (selection moved, not cleared)
    highlightCount = (renderer.scene as ReactThreeTestInstance).findAll(
      (node) => node.type === 'Mesh' && node.props.userData?.highlight === true,
    ).length;
    expect(highlightCount).toBeGreaterThan(0);
  });

  it('calls onMove when a move is made and reconciles with moves prop', async () => {
    const onMove = vi.fn();
    // Track moves for reconciliation
    const board = createTestBoard();
    const renderer = await ReactThreeTestRenderer.create(
      <Board onMove={onMove} board={board} currentTurn="white" />,
    );
    // Find a pawn
    const boardGroup = (renderer.scene as ReactThreeTestInstance)
      .children[0] as ReactThreeTestInstance;
    const pawn = boardGroup.children.find(
      (child) => (child.type === 'Mesh' || child.type === 'Group') && child.props.userData?.piece?.type === PieceType.Pawn,
    ) as ReactThreeTestInstance;
    // Select pawn
    await act(async () => {
      pawn.props.onPointerDown?.({ stopPropagation: () => {} } as React.PointerEvent<Element>);
    });
    // Find a highlighted destination
    const dest = (renderer.scene as ReactThreeTestInstance).findAll(
      (node) => node.type === 'Mesh' && node.props.userData?.highlight === true,
    )[0];
    // Move pawn (local move)
    await act(async () => {
      dest.props.onPointerDown?.({ stopPropagation: () => {} } as React.PointerEvent<Element>);
    });
    // onMove should be called
    expect(onMove).toHaveBeenCalledTimes(1);
    // Board no longer reconciles with moves prop; parent is responsible
  });

  it('renders king with emissive red when in check', async () => {
    // Set up a board with black king in check from a white rook
    const board = new EngineBoard();
    // Clear board
    for (let z = 0; z < 5; z++)
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) board.setPiece({ x, y, z }, null);
    // Place black king at (0,0,0), white rook at (0,4,0)
    board.setPiece({ x: 0, y: 0, z: 0 }, { type: PieceType.King, color: 'black' });
    board.setPiece({ x: 0, y: 4, z: 0 }, { type: PieceType.Rook, color: 'white' });
    // Render board for black's turn (king in check)
    const renderer = await ReactThreeTestRenderer.create(
      <Board board={board} currentTurn="black" />,
    );
    // Find the king mesh
    const kingMesh = (renderer.scene as ReactThreeTestInstance).find(
      (node) =>
        (node.type === 'Mesh' || node.type === 'Group') &&
        node.props.userData?.piece?.type === PieceType.King &&
        node.props.userData?.piece?.color === 'black',
    );
    expect(kingMesh).toBeDefined();
    // Emissive should be included in userData of the king mesh
    const emissive = kingMesh.props.userData.emissive;
    expect(emissive === '#ff2222' || emissive === 0xff2222).toBe(true);
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

    it('puts the player\'s pawns on the second-from-bottom slab, nearest two layers', async () => {
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
      expect(piecePositions(renderer, PieceType.King, playerColor)).toEqual([
        [0, BOTTOM, NEAREST],
      ]);
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
      expect(new Set(pawns.map(([, , z]) => z))).toEqual(
        new Set([-NEAREST, -SECOND_NEAREST]),
      );
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
});
