import { describe, it, expect } from 'vitest';
import Board from './Board';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { ReactThreeTestInstance } from '@react-three/test-renderer/dist/declarations/src/types/public.js';
import * as THREE from 'three';
import { PieceType } from '../engine';
import { act } from 'react';

function countMeshes(node: ReactThreeTestInstance): number {
  let count = node.type === 'Mesh' ? 1 : 0;
  if (node.children) {
    for (const child of node.children) {
      count += countMeshes(child as ReactThreeTestInstance);
    }
  }
  return count;
}

function countPieceMeshes(node: ReactThreeTestInstance): number {
  let count = 0;

  // Check if the instance is a Mesh and has our custom userData prop
  // Note: The test renderer might expose userData via props
  if (node.type === 'Mesh' && node.props.userData?.piece !== undefined) {
    count = 1;
  }

  for (const child of node.children) {
    count += countPieceMeshes(child as ReactThreeTestInstance);
  }

  return count;
}

function countHighlightedCubes(node: ReactThreeTestInstance): number {
  let count = 0;
  // Count highlighted cube meshes via userData flag
  if (node.props.userData?.highlight === true) {
    count = 1;
  }
  for (const child of node.children) {
    count += countHighlightedCubes(child as ReactThreeTestInstance);
  }
  return count;
}

describe('Board', () => {
  it('renders 125 Box meshes', async () => {
    const renderer = await ReactThreeTestRenderer.create(<Board />);
    const meshCount = countMeshes(renderer.scene as ReactThreeTestInstance);
    expect(meshCount).toBe(125 + 40); // 125 cubes + 40 pieces
  });

  it('renders 40 piece meshes', async () => {
    const renderer = await ReactThreeTestRenderer.create(<Board />);
    const pieceCount = countPieceMeshes(renderer.scene as ReactThreeTestInstance);
    expect(pieceCount).toBe(40);
  });

  it('clicks a pawn and highlights destination cubes', async () => {
    const renderer = await ReactThreeTestRenderer.create(<Board />);
    const boardGroup = (renderer.scene as ReactThreeTestInstance)
      .children[0] as ReactThreeTestInstance;
    const pawn = boardGroup.children.find(
      (child) => child.type === 'Mesh' && child.props.userData?.piece?.type === PieceType.Pawn,
    ) as ReactThreeTestInstance;
    expect(pawn).toBeDefined();

    // Simulate pointer down inside act
    await act(async () => {
      pawn.props.onPointerDown?.({} as any);
    });

    // Now count highlighted cubes
    const highlightCount = countHighlightedCubes(renderer.scene as ReactThreeTestInstance);
    expect(highlightCount).toBeGreaterThan(0);
  });
});
