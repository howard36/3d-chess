import { describe, expect, it } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { ReactThreeTestInstance } from '@react-three/test-renderer/dist/declarations/src/types/public.js';
import { MeshStandardMaterial } from 'three';
import type { BufferGeometry, Mesh } from 'three';
import { PieceType } from '../../engine/pieces';
import { ChessPiece } from './ChessPiece';
import { triangleCount } from './mesh';
import { pieceSet } from './set';

const meshes = async (element: React.ReactElement) => {
  const renderer = await ReactThreeTestRenderer.create(element);
  return (renderer.scene as ReactThreeTestInstance)
    .findAllByType('Mesh')
    .map((node) => node.instance as unknown as Mesh);
};

const ivory = new MeshStandardMaterial({ color: '#eeeeee' });
const walnut = new MeshStandardMaterial({ color: '#553311' });
const level = new MeshStandardMaterial({ color: '#3377ff' });

describe('ChessPiece', () => {
  it('draws a piece in one mesh when only the body is painted', async () => {
    const [mesh, ...rest] = await meshes(
      <ChessPiece type={PieceType.Bishop} parts={{ body: ivory }} />,
    );
    expect(rest).toHaveLength(0);
    expect(mesh.material).toBe(ivory);
    const set = pieceSet();
    const parts = [set.Bishop.body, set.Bishop.collar, set.Bishop.accent!, set.Bishop.foot];
    expect(triangleCount(mesh.geometry as BufferGeometry)).toBe(
      parts.reduce((n, g) => n + triangleCount(g), 0),
    );
  });

  it('draws one mesh per material, parts without their own taking the body', async () => {
    const drawn = await meshes(
      <ChessPiece type={PieceType.King} parts={{ body: ivory, accent: walnut, foot: level }} />,
    );
    expect(drawn.map((m) => m.material)).toEqual([ivory, walnut, level]);
    expect(drawn[1].geometry).toBe(pieceSet().King.accent);
    expect(drawn[2].geometry).toBe(pieceSet().King.foot);
  });

  it('skips a material for a part the piece does not have', async () => {
    const drawn = await meshes(
      <ChessPiece type={PieceType.Pawn} parts={{ body: ivory, accent: walnut }} />,
    );
    expect(drawn.map((m) => m.material)).toEqual([ivory]);
  });

  it('takes JSX materials, and another set', async () => {
    const low = pieceSet('low');
    const drawn = await meshes(
      <ChessPiece
        type={PieceType.Knight}
        set={low}
        parts={{ body: <meshStandardMaterial color="#ffffff" />, collar: walnut }}
      />,
    );
    expect(drawn).toHaveLength(2);
    expect((drawn[0].material as MeshStandardMaterial).isMeshStandardMaterial).toBe(true);
    expect(drawn[1].geometry).toBe(low.Knight.collar);
  });
});
