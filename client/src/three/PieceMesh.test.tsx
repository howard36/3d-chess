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

  it('turns a knight to the yaw the board gives it; other pieces stay square', async () => {
    const innerYaw = async (type: PieceType, facing: number) => {
      const scene = await render({ type, color: 'white', facing });
      const inner = scene.findAll((node) => node.type === 'Group' && node.props.rotation);
      expect(inner).toHaveLength(1);
      return (inner[0].instance as unknown as Group).rotation.y;
    };
    expect(await innerYaw(PieceType.Knight, 1.1)).toBeCloseTo(1.1);
    expect(await innerYaw(PieceType.Knight, -1.1)).toBeCloseTo(-1.1);
    expect(await innerYaw(PieceType.Rook, 1.1)).toBe(0);
  });
});
