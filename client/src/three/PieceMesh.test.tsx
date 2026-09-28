import { describe, expect, it } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { ReactThreeTestInstance } from '@react-three/test-renderer/dist/declarations/src/types/public.js';
import type { Group } from 'three';
import { PieceMesh } from './PieceMesh';
import type { PieceMeshProps } from './PieceMesh';
import { PieceType } from '../engine';
import { DesignContext } from './designs/context';
import testDesign from './designs/testDesign';
import type { Design, PieceBodyProps } from './designs/types';

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

// The body the design draws records what PieceMesh tells it
const bodies: PieceBodyProps[] = [];
const PieceBody = (props: PieceBodyProps) => {
  bodies.push(props);
  return <mesh />;
};
const design: Design = { ...testDesign, PieceBody };

async function render(props: PieceMeshProps) {
  const renderer = await ReactThreeTestRenderer.create(
    <DesignContext.Provider value={design}>
      <PieceMesh {...props} />
    </DesignContext.Provider>,
  );
  return renderer.scene as ReactThreeTestInstance;
}

describe('PieceMesh', () => {
  it.each(TYPES.flatMap((type) => COLORS.map((color) => [type, color] as const)))(
    '%s %s: one tagged outer group, with the design’s body told what it is',
    async (type, color) => {
      bodies.length = 0;
      const scene = await render({ type, color, level: 2, inCheck: true });

      // One outer group carrying the piece contract for Board/e2e lookups
      expect(scene.children).toHaveLength(1);
      const outer = scene.children[0];
      expect(outer.type).toBe('Group');
      expect(outer.props.userData.piece).toEqual({ type, color });

      expect(bodies[bodies.length - 1]).toMatchObject({
        type,
        color,
        level: 2,
        inCheck: true,
        selected: false,
        hovered: false,
      });
    },
  );

  it('turns the knight by an opposite yaw per colour; other pieces stay square', async () => {
    const innerYaw = async (type: PieceType, color: PieceColor) => {
      const scene = await render({ type, color });
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
