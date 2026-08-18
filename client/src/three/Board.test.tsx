import { describe, it, expect } from 'vitest';
import Board from './Board';
import type { LastMoveInfo } from './Board';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { ReactThreeTestInstance } from '@react-three/test-renderer/dist/declarations/src/types/public.js';
import { PieceType } from '../engine';
import { act } from 'react';
import { vi } from 'vitest';
import { Board as EngineBoard } from '../engine';
import { CELL_FLOOR_Y, SPACING, toWorld } from './layout';
import { theme } from './theme';

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

  it('ignores piece clicks while disabled', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Board board={createTestBoard()} currentTurn="white" disabled />,
    );
    const boardGroup = (renderer.scene as ReactThreeTestInstance)
      .children[0] as ReactThreeTestInstance;
    const pawn = boardGroup.children.find(
      (child) =>
        (child.type === 'Mesh' || child.type === 'Group') &&
        child.props.userData?.piece?.type === PieceType.Pawn,
    ) as ReactThreeTestInstance;
    expect(pawn).toBeDefined();

    await act(async () => {
      pawn.props.onPointerDown?.({ stopPropagation: () => {} } as React.PointerEvent<Element>);
    });

    const highlightCount = (renderer.scene as ReactThreeTestInstance).findAll(
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

  it('draws the selection ring on the floor the selected piece stands on', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Board board={createTestBoard()} currentTurn="white" />,
    );
    const boardGroup = (renderer.scene as ReactThreeTestInstance)
      .children[0] as ReactThreeTestInstance;
    const knight = boardGroup.children.find(
      (child) => (child.type === 'Mesh' || child.type === 'Group') && child.props.userData?.piece?.type === PieceType.Knight,
    ) as ReactThreeTestInstance;
    expect(knight).toBeDefined();

    await act(async () => {
      knight.props.onPointerDown?.({ stopPropagation: () => {} } as React.PointerEvent<Element>);
    });

    const rings = (renderer.scene as ReactThreeTestInstance).findAll(
      (node) => node.props.userData?.selectionRing === true,
    );
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
    const boardGroup = (renderer.scene as ReactThreeTestInstance)
      .children[0] as ReactThreeTestInstance;
    const rook = boardGroup.children.find(
      (child) => (child.type === 'Mesh' || child.type === 'Group') && child.props.userData?.piece?.type === PieceType.Rook,
    ) as ReactThreeTestInstance;
    const pawn = boardGroup.children.find(
      (child) => (child.type === 'Mesh' || child.type === 'Group') && child.props.userData?.piece?.type === PieceType.Pawn,
    ) as ReactThreeTestInstance;
    expect(rook).toBeDefined();
    expect(pawn).toBeDefined();

    await act(async () => {
      rook.props.onPointerDown?.({ stopPropagation: () => {} } as React.PointerEvent<Element>);
    });

    const rings = (renderer.scene as ReactThreeTestInstance).findAll(
      (node) => node.props.userData?.captureRing === true,
    );
    expect(rings).toHaveLength(1);
    // At the base of the piece it marks, not the cell centre — otherwise the
    // ring cuts through the piece at a height that varies with its silhouette.
    const pawnPos = pawn.props.position as [number, number, number];
    expect(rings[0].props.position).toEqual([pawnPos[0], pawnPos[1] + CELL_FLOOR_Y, pawnPos[2]]);
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

    function findCells(renderer: { scene: unknown }, flag: 'lastMoveFrom' | 'lastMoveTo') {
      return (renderer.scene as ReactThreeTestInstance).findAll(
        (node) => node.type === 'Mesh' && node.props.userData?.[flag] === true,
      );
    }

    function glideGroups(renderer: { scene: unknown }) {
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
        (cell.instance as unknown as { material: { color: { getHexString(): string }; opacity: number } })
          .material;
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

      const rook = (renderer.scene as ReactThreeTestInstance).find(
        (node) =>
          (node.type === 'Mesh' || node.type === 'Group') &&
          node.props.userData?.piece?.type === PieceType.Rook,
      );
      await act(async () => {
        rook.props.onPointerDown?.({ stopPropagation: () => {} } as React.PointerEvent<Element>);
      });

      const cell = (renderer.scene as ReactThreeTestInstance)
        .findAll((node) => node.type === 'Mesh' && node.props.userData?.cube === true)
        .find(
          (node) =>
            JSON.stringify(node.props.position) === JSON.stringify(toWorld(above, 'white')),
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
      expect(group.position.y).toBeCloseTo((fy - ty) / 2 + 0.2 * SPACING);

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

      expect(findCells(renderer, 'lastMoveFrom')[0].props.position).toEqual(
        toWorld(FROM, 'black'),
      );
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
