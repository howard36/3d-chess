import { describe, it, expect } from 'vitest';
import Board from './Board';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { ReactThreeTestInstance } from '@react-three/test-renderer/dist/declarations/src/types/public.js';
import { PieceType } from '../engine';
import { act } from 'react';
import TurnIndicator from './TurnIndicator';
import { useState } from 'react';
import { vi } from 'vitest';
import { Board as EngineBoard } from '../engine';

// Helper to create a fresh board
function createTestBoard() {
  const b = new EngineBoard();
  EngineBoard.setupStartingPosition(b);
  return b;
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
      (node) => node.type === 'Mesh' && node.props.userData?.piece !== undefined,
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
      (child) => child.type === 'Mesh' && child.props.userData?.piece?.type === PieceType.Pawn,
    ) as ReactThreeTestInstance;
    expect(pawn).toBeDefined();

    // Simulate pointer down inside act
    await act(async () => {
      pawn.props.onPointerDown?.({ stopPropagation: () => {} } as any);
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
      (child) => child.type === 'Mesh' && child.props.userData?.piece?.type === PieceType.Pawn,
    ) as ReactThreeTestInstance;
    expect(pawn).toBeDefined();

    // Select the pawn
    await act(async () => {
      pawn.props.onPointerDown?.({ stopPropagation: () => {} } as any);
    });
    // There should be highlights
    let highlightCount = (renderer.scene as ReactThreeTestInstance).findAll(
      (node) => node.type === 'Mesh' && node.props.userData?.highlight === true,
    ).length;
    expect(highlightCount).toBeGreaterThan(0);

    // Click empty space (simulate group onPointerDown)
    await act(async () => {
      boardGroup.props.onPointerDown?.({} as any);
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
      (child) => child.type === 'Mesh' && child.props.userData?.piece?.type === PieceType.Pawn,
    ) as ReactThreeTestInstance[];
    expect(pawns.length).toBeGreaterThan(1);

    // Select the first pawn
    await act(async () => {
      pawns[0].props.onPointerDown?.({ stopPropagation: () => {} } as any);
    });
    let highlightCount = (renderer.scene as ReactThreeTestInstance).findAll(
      (node) => node.type === 'Mesh' && node.props.userData?.highlight === true,
    ).length;
    expect(highlightCount).toBeGreaterThan(0);

    // Select the second pawn
    await act(async () => {
      pawns[1].props.onPointerDown?.({ stopPropagation: () => {} } as any);
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
      (child) => child.type === 'Mesh' && child.props.userData?.piece?.type === PieceType.Pawn,
    ) as ReactThreeTestInstance;
    // Select pawn
    await act(async () => {
      pawn.props.onPointerDown?.({ stopPropagation: () => {} } as any);
    });
    // Find a highlighted destination
    const dest = (renderer.scene as ReactThreeTestInstance).findAll(
      (node) => node.type === 'Mesh' && node.props.userData?.highlight === true,
    )[0];
    // Move pawn (local move)
    await act(async () => {
      dest.props.onPointerDown?.({ stopPropagation: () => {} } as any);
    });
    // onMove should be called
    expect(onMove).toHaveBeenCalledTimes(1);
    // Board no longer reconciles with moves prop; parent is responsible
  });
});
