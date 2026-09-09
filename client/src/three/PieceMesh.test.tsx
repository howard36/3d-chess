import { describe, expect, it } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { ReactThreeTestInstance } from '@react-three/test-renderer/dist/declarations/src/types/public.js';
import type { BufferGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { PieceMesh } from './PieceMesh';
import { PieceType } from '../engine';
import { theme } from './theme';

type PieceColor = 'white' | 'black';

const TYPES = [
  PieceType.Pawn,
  PieceType.Rook,
  PieceType.Bishop,
  PieceType.Knight,
  PieceType.Unicorn,
  PieceType.Queen,
  PieceType.King,
];
const COLORS: PieceColor[] = ['white', 'black'];

const hex = (c: { getHexString(): string }) => `#${c.getHexString()}`;
const armyColor = (color: PieceColor) => (color === 'white' ? theme.whitePiece : theme.blackPiece);

async function render(type: PieceType, color: PieceColor, emissive?: string) {
  const renderer = await ReactThreeTestRenderer.create(
    <PieceMesh type={type} color={color} emissive={emissive} />,
  );
  const scene = renderer.scene as ReactThreeTestInstance;
  const materials = scene
    .findAllByType('MeshStandardMaterial')
    .map((node) => node.instance as unknown as MeshStandardMaterial);
  return {
    scene,
    meshes: scene.findAllByType('Mesh').map((node) => node.instance as unknown as Mesh),
    materials,
    // The bishop's mitre groove uses a darkened band; everything else is the
    // army colour.
    armyMaterials: materials.filter((m) => hex(m.color) === armyColor(color)),
  };
}

describe('PieceMesh', () => {
  it.each(TYPES.flatMap((type) => COLORS.map((color) => [type, color] as const)))(
    '%s %s: tagged outer group, geometry on every mesh, army colour, emissive wired',
    async (type, color) => {
      const { scene, meshes, materials, armyMaterials } = await render(type, color);

      // One outer group carrying the piece contract for Board/e2e lookups.
      expect(scene.children).toHaveLength(1);
      const outer = scene.children[0];
      expect(outer.type).toBe('Group');
      expect(outer.props.userData.piece).toEqual({ type, color });

      // At least one mesh, each with a real geometry (the snapshot this
      // replaces could only record `geometry="[object Object]"`).
      expect(meshes.length).toBeGreaterThanOrEqual(1);
      for (const mesh of meshes) {
        expect((mesh.geometry as BufferGeometry).isBufferGeometry).toBe(true);
      }

      // Army colour on the body; nothing painted in the other army's colour.
      expect(armyMaterials.length).toBeGreaterThanOrEqual(1);
      const other = armyColor(color === 'white' ? 'black' : 'white');
      for (const material of materials) {
        expect(hex(material.color)).not.toBe(other);
        expect(hex(material.emissive)).toBe('#000000');
      }

      // The emissive prop reaches the army material (the check/selection glow).
      const lit = await render(type, color, theme.check);
      expect(lit.armyMaterials.length).toBe(armyMaterials.length);
      for (const material of lit.armyMaterials) {
        expect(hex(material.emissive)).toBe(theme.check);
      }
      expect(lit.scene.children[0].props.userData.emissive).toBe(theme.check);
    },
  );

  it('turns the knight by an opposite yaw per colour; other pieces stay square', async () => {
    const innerYaw = async (type: PieceType, color: PieceColor) => {
      const { scene } = await render(type, color);
      const inner = scene.findAll((node) => node.type === 'Group' && node.props.rotation);
      expect(inner).toHaveLength(1);
      return (inner[0].instance as unknown as Group).rotation.y;
    };
    const white = await innerYaw(PieceType.Knight, 'white');
    const black = await innerYaw(PieceType.Knight, 'black');
    expect(white).not.toBe(0);
    expect(Math.sign(white)).toBe(-Math.sign(black));
    expect(Math.abs(white)).toBeCloseTo(Math.abs(black));
    expect(await innerYaw(PieceType.Rook, 'white')).toBe(0);
  });
});
