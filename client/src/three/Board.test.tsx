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
});
