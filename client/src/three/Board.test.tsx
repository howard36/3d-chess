import { describe, it, expect } from 'vitest';
import Board from './Board';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { ReactThreeTestInstance } from '@react-three/test-renderer/dist/declarations/src/types/public.js';
import * as THREE from 'three';

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
  if (
    node.type === 'Box' &&
    (node.props['material-color'] === '#ffe066' || node.props['materialColor'] === '#ffe066')
  ) {
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

  it('clicks a piece and highlights destination cubes', async () => {
    const renderer = await ReactThreeTestRenderer.create(<Board />);
    // Find a piece mesh (first one)
    const piece = renderer.scene.children.find(
      (child) => child.type === 'Mesh' && child.props.userData?.piece !== undefined,
    ) as ReactThreeTestInstance;
    expect(piece).toBeDefined();
    // Simulate pointer down
    piece.props.onPointerDown?.({} as any);
    // Re-render
    renderer.update(<Board />);
    // Count highlighted cubes
    const highlightCount = countHighlightedCubes(renderer.scene as ReactThreeTestInstance);
    expect(highlightCount).toBeGreaterThan(0);
  });
});
