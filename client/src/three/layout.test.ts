import { describe, it, expect } from 'vitest';
import { CELLS, GRID_SIZE, SPACING, toWorld } from './layout';
import type { Orientation } from './layout';
import { fromZXY, toZXY } from '../engine/coords';
import type { Coord } from '../engine/coords';
import { Board } from '../engine/board';
import { PieceType } from '../engine/pieces';

describe('CELLS', () => {
  it('covers every cell of the grid exactly once', () => {
    expect(CELLS).toHaveLength(GRID_SIZE ** 3);
    expect(new Set(CELLS.map(toZXY)).size).toBe(GRID_SIZE ** 3);
  });
});

describe('toWorld', () => {
  const MAX = ((GRID_SIZE - 1) / 2) * SPACING; // 2.2

  it("puts White's home corner at bottom-left-nearest", () => {
    // Aa1: file a, rank 1, level A
    expect(toWorld({ x: 0, y: 0, z: 0 }, 'white')).toEqual([-MAX, -MAX, MAX]);
    // Ee5: file e, rank 5, level E
    expect(toWorld({ x: 4, y: 4, z: 4 }, 'white')).toEqual([MAX, MAX, -MAX]);
  });

  it('stacks the levels upward and runs the ranks away from the camera', () => {
    for (const orientation of ['white', 'black'] as const) {
      const own = (v: number) => (orientation === 'white' ? v : GRID_SIZE - 1 - v);
      const heights = [0, 1, 2, 3, 4].map(
        (z) => toWorld({ x: 2, y: 2, z: own(z) }, orientation)[1],
      );
      const depths = [0, 1, 2, 3, 4].map((y) => toWorld({ x: 2, y: own(y), z: 2 }, orientation)[2]);
      // Levels rise from the viewer's first; ranks recede from the viewer's first
      expect(heights).toEqual([...heights].sort((a, b) => a - b));
      expect(depths).toEqual([...depths].sort((a, b) => b - a));
      expect(new Set(heights).size).toBe(GRID_SIZE);
      expect(new Set(depths).size).toBe(GRID_SIZE);
    }
  });

  it("puts Black's home corner at bottom-left-nearest", () => {
    // Ee5 is Black's equivalent of White's Aa1
    expect(toWorld({ x: 4, y: 4, z: 4 }, 'black')).toEqual([-MAX, -MAX, MAX]);
    expect(toWorld({ x: 0, y: 0, z: 0 }, 'black')).toEqual([MAX, MAX, -MAX]);
  });

  it("renders Black's view as the inversion of White's, files included", () => {
    for (const cell of CELLS) {
      const inverted = {
        x: GRID_SIZE - 1 - cell.x,
        y: GRID_SIZE - 1 - cell.y,
        z: GRID_SIZE - 1 - cell.z,
      };
      expect(toWorld(cell, 'black')).toEqual(toWorld(inverted, 'white'));
    }
  });

  it('maps the grid onto the same set of world positions for both players', () => {
    const positions = (orientation: 'white' | 'black') =>
      new Set(CELLS.map((c) => toWorld(c, orientation).join(',')));
    expect(positions('black')).toEqual(positions('white'));
  });

  // The starting position used to be the classic 5×5×5 set-up, drawn with
  // ranks up the screen and levels into depth. Both the setup and this
  // mapping have since exchanged rank and level, so the two changes cancel:
  // the board looks exactly as it did, with only the labels telling the axes
  // apart.
  const previousToWorld = ({ x, y, z }: Coord, orientation: Orientation) => {
    const HALF = (GRID_SIZE - 1) / 2;
    const flip = (v: number) => (orientation === 'white' ? v : GRID_SIZE - 1 - v);
    return [(flip(x) - HALF) * SPACING, (flip(y) - HALF) * SPACING, (HALF - flip(z)) * SPACING];
  };
  // The previous set-up, as [level, rank, files a-e]; upper case is White
  const PREVIOUS_SETUP: [string, string, string][] = [
    ['A', '1', 'RNKNR'],
    ['A', '2', 'PPPPP'],
    ['B', '1', 'BUQBU'],
    ['B', '2', 'PPPPP'],
    ['D', '4', 'ppppp'],
    ['D', '5', 'ubqub'],
    ['E', '4', 'ppppp'],
    ['E', '5', 'rnknr'],
  ];
  const LETTER: Record<PieceType, string> = {
    [PieceType.King]: 'k',
    [PieceType.Queen]: 'q',
    [PieceType.Rook]: 'r',
    [PieceType.Bishop]: 'b',
    [PieceType.Knight]: 'n',
    [PieceType.Unicorn]: 'u',
    [PieceType.Pawn]: 'p',
  };

  it('draws every starting piece where the previous setup and mapping drew it', () => {
    for (const orientation of ['white', 'black'] as const) {
      const before = new Map<string, string>();
      for (const [level, rank, row] of PREVIOUS_SETUP) {
        [...row].forEach((letter, x) => {
          const cell = fromZXY(`${level}${'abcde'[x]}${rank}`);
          before.set(previousToWorld(cell, orientation).join(','), letter);
        });
      }
      const start = Board.setupStartingPosition();
      const now = new Map<string, string>();
      for (const cell of CELLS) {
        const piece = start.getPiece(cell);
        if (!piece) continue;
        const letter = LETTER[piece.type];
        now.set(
          toWorld(cell, orientation).join(','),
          piece.color === 'white' ? letter.toUpperCase() : letter,
        );
      }
      expect(now.size).toBe(40);
      expect(now).toEqual(before);
    }
  });

  it('lists the cells in the world order the lattice has always drawn them in', () => {
    const previousCells = Array.from({ length: GRID_SIZE ** 3 }, (_, i) => ({
      x: i % GRID_SIZE,
      y: Math.floor(i / GRID_SIZE) % GRID_SIZE,
      z: Math.floor(i / GRID_SIZE ** 2),
    }));
    expect(CELLS.map((c) => toWorld(c, 'white'))).toEqual(
      previousCells.map((c) => previousToWorld(c, 'white')),
    );
  });

  it("puts White's pawns on the level above its pieces, in the same two ranks", () => {
    const start = Board.setupStartingPosition();
    const typeAt = (zxy: string) => start.getPiece(fromZXY(zxy))?.type;
    expect([typeAt('Ac1'), typeAt('Bc1'), typeAt('Ac2')]).toEqual([
      PieceType.King,
      PieceType.Pawn,
      PieceType.Queen,
    ]);
    // The pawn Bc1 stands right above the king Ac1; the queen Ac2 right behind it
    const [kx, ky, kz] = toWorld(fromZXY('Ac1'), 'white');
    const [px, py, pz] = toWorld(fromZXY('Bc1'), 'white');
    const [qx, qy, qz] = toWorld(fromZXY('Ac2'), 'white');
    expect([px, pz]).toEqual([kx, kz]);
    expect(py - ky).toBeCloseTo(SPACING);
    expect([qx, qy]).toEqual([kx, ky]);
    expect(kz - qz).toBeCloseTo(SPACING);
  });
});
