import { Board as EngineBoard } from '../engine';
import { PieceType } from '../engine/pieces';
import { fromZXY } from '../engine/coords';
import type { LastMove } from '../game/history';

// (Preview) The double check from a game against the computer: Black to move,
// the knight's jump Cb3–Dd3 checking the king on Db4 and uncovering the
// bishop on Bb2. Loaded by GameCanvas with ?demo=doublecheck in development.

const W = 'white' as const;
const B = 'black' as const;
const P = PieceType;
const PIECES: [string, PieceType, 'white' | 'black'][] = [
  ['Ec2', P.Queen, W],
  ['Dd3', P.Knight, W],
  ['Ce2', P.Pawn, W],
  ['Cb2', P.Pawn, W],
  ...['Be1', 'Bd2', 'Bd1', 'Bc2', 'Bc1', 'Bb1', 'Ba2', 'Ba1'].map(
    (s) => [s, P.Pawn, W] as [string, PieceType, 'white'],
  ),
  ['Bb2', P.Bishop, W],
  ['Bd4', P.Rook, W],
  ['Bb4', P.King, W],
  ['Bd5', P.Unicorn, W],
  ['Ba5', P.Unicorn, W],
  ['Ee5', P.Rook, B],
  ['Ed5', P.Queen, B],
  ['Ea5', P.Rook, B],
  ['Ea4', P.Unicorn, B],
  ['Dc5', P.Unicorn, B],
  ['Ce3', P.Bishop, B],
  ['Db4', P.King, B],
  ...['Dd4', 'Dc4', 'Da5', 'Da4', 'Ce5', 'Cb4'].map(
    (s) => [s, P.Pawn, B] as [string, PieceType, 'black'],
  ),
];

export const doubleCheckDemo = (): { board: EngineBoard; lastMove: LastMove } | null => {
  if (!import.meta.env.DEV) return null;
  if (new URLSearchParams(window.location.search).get('demo') !== 'doublecheck') return null;
  const board = new EngineBoard();
  // eslint-disable-next-line no-restricted-properties -- a staged position for the preview, development only
  for (const [sq, type, color] of PIECES) board.setPiece(fromZXY(sq), { type, color });
  return {
    board,
    lastMove: {
      move: { from: fromZXY('Cb3'), to: fromZXY('Dd3') },
      moveCount: 1,
      capturedPiece: null,
    },
  };
};
