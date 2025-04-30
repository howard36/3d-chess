import { describe, it, expect } from 'vitest';
import Board from './Board';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { ReactThreeTestInstance } from '@react-three/test-renderer/dist/declarations/src/types/public.js';

function countMeshes(node: ReactThreeTestInstance): number {
  let count = node.type === 'Mesh' ? 1 : 0;
  if (node.children) {
    for (const child of node.children) {
      count += countMeshes(child as ReactThreeTestInstance);
    }
  }
  return count;
}

describe('Board', () => {
  it('renders 125 Box meshes', async () => {
    const renderer = await ReactThreeTestRenderer.create(<Board />);
    const meshCount = countMeshes(renderer.scene as ReactThreeTestInstance);
    expect(meshCount).toBe(125);
  });
});
