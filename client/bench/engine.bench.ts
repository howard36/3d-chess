// The rules engine (client/src/engine), timed where the game calls it:
// selecting a piece, testing for check on every render, and testing for the
// end of the game after every move, over positions from real play and
// positions built to be as expensive as the rules allow.

import { bench, describe } from 'vitest';
import { Board, PieceType } from '../src/engine';
import type { Coord } from '../src/engine';
import { fromZXY, toZXY } from '../src/engine/coords';
import { moveFromMessage, moveToMessage } from '../src/engine/protocol';
import {
  EXPECTED,
  expectSame,
  other,
  positionTable,
  positions,
  sharedGames,
  inRounds,
} from './fixtures';
import type { Side } from './fixtures';
import { emit } from './report';

/** Keeps results alive so the JIT cannot drop the work. */
export let sink: unknown;

const list = positions();

const cellsOf = (board: Board, side: Side): Coord[] => {
  const out: Coord[] = [];
  for (let z = 0; z < 5; z++)
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++) {
        const p = board.getPiece({ x, y, z });
        if (p && p.color === side) out.push({ x, y, z });
      }
  return out;
};

/** The piece a player could click that costs the most to select: the most pseudo-legal moves. */
const heaviestPiece = (board: Board, side: Side) => {
  let best = { at: { x: 0, y: 0, z: 0 }, pseudo: -1 };
  for (const at of cellsOf(board, side)) {
    const pseudo = board.generatePotentialMoves(at).length;
    if (pseudo > best.pseudo) best = { at, pseudo };
  }
  const p = board.getPiece(best.at)!;
  const legal = board.generateLegalMoves(best.at).length;
  return { ...best, legal, label: `${p.type.toLowerCase()} ${toZXY(best.at)}` };
};

/** What GameScreen's replay asks after every move (history.ts gameOverAt). */
const gameOverAsTheAppDoes = (board: Board, side: Side) =>
  board.isCheckmate(side) ? 'checkmate' : board.isStalemate(side) ? 'stalemate' : null;

/** What-if: the same answer, stopping at the first legal move found. Not app code. */
const gameOverEarlyExit = (board: Board, side: Side) => {
  for (const at of cellsOf(board, side)) {
    for (const move of board.generatePotentialMoves(at)) {
      if (!board.applyMove(move).inCheck(side)) return null;
    }
  }
  return board.inCheck(side) ? 'checkmate' : 'stalemate';
};

const perft = (board: Board, side: Side, depth: number): number => {
  if (depth === 0) return 1;
  const moves = board.generateAllLegalMoves(side);
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const move of moves) nodes += perft(board.applyMove(move), other(side), depth - 1);
  return nodes;
};

const SELECT = 'E1 · Select a piece';
const CHECK = 'E2 · Check test';
const ALL = 'E3 · Every legal move of the side to move';
const OVER = 'E4 · Game-over test after a move';
const PRIMS = 'E5 · Board primitives';
const PERFT = 'E6 · Move-tree throughput (perft)';

const heaviest = new Map(list.map((p) => [p.name, heaviestPiece(p.board, p.side)]));
const opening = Board.setupStartingPosition();
const perftCounts = {
  opening1: perft(opening, 'white', 1),
  opening2: perft(opening, 'white', 2),
  middlegame2: perft(list[1].board, 'white', 2),
};
for (const [key, count] of Object.entries(perftCounts)) {
  expectSame(`perft ${key}`, count, EXPECTED.perft[key as keyof typeof perftCounts]);
}

emit('engine', {
  tables: [positionTable(list)],
  intros: {
    [SELECT]:
      'A click on one of your pieces runs `generateLegalMoves` for it (`three/Board.tsx`) before the ' +
      'destinations light up. Each case selects the piece with the most pseudo-legal moves in the ' +
      'position: the slowest click the player can make there.',
    [CHECK]:
      '`inCheck` runs at least three times per game-screen render (the HUD pill for the side to move, ' +
      'and `Board.tsx` for each king), plus once per move announcement: every render pays it, whatever ' +
      'caused the render.',
    [ALL]:
      '`generateAllLegalMoves`: every pseudo-legal move played out on a cloned board and tested for ' +
      'check. The core cost of the end-of-game test below.',
    [OVER]:
      'After every move the replay asks whether the side to move is mated or stalemated ' +
      '(`gameOverAt` in `game/history.ts`: `isCheckmate` then `isStalemate`). In a live position that ' +
      'generates every legal move of the side to move. The *what-if* rows (not app code) answer the ' +
      'same question stopping at the first legal move, for comparison.',
    [PRIMS]: 'The building blocks every replay step and every legality test is made of.',
    [PERFT]:
      'Counts the legal move tree from a position (the classic move-generator benchmark). No feature ' +
      'of the app searches ahead, so this is a throughput reference, and its node counts are a ' +
      'checksum that the engine did the same work in every run.',
  },
  facts: {
    'perft(1) opening': perftCounts.opening1,
    'perft(2) opening': perftCounts.opening2,
    'perft(2) middlegame': perftCounts.middlegame2,
  },
});

inRounds(({ normal, heavy }) => {
  describe(SELECT, () => {
    for (const p of list) {
      const h = heaviest.get(p.name)!;
      bench(
        `${p.name}: ${h.label} (${h.pseudo} pseudo-legal → ${h.legal} legal)`,
        () => {
          sink = p.board.generateLegalMoves(h.at);
        },
        normal,
      );
    }
  });

  describe(CHECK, () => {
    for (const p of list) {
      bench(
        `${p.name}: ${p.side} king`,
        () => {
          sink = p.board.inCheck(p.side);
        },
        normal,
      );
    }
  });

  describe(ALL, () => {
    for (const p of list) {
      bench(
        p.name,
        () => {
          sink = p.board.generateAllLegalMoves(p.side);
        },
        normal,
      );
    }
  });

  describe(OVER, () => {
    for (const p of list) {
      bench(
        p.name,
        () => {
          sink = gameOverAsTheAppDoes(p.board, p.side);
        },
        normal,
      );
    }
    for (const name of ['opening', 'middlegame', 'queen storm ⚠', 'crowded ⚠']) {
      const p = list.find((q) => q.name === name)!;
      bench(
        `what-if, early exit: ${p.name}`,
        () => {
          sink = gameOverEarlyExit(p.board, p.side);
        },
        normal,
      );
    }
  });

  describe(PRIMS, () => {
    const kingsOnly = new Board();
    kingsOnly.setPiece({ x: 0, y: 0, z: 0 }, { type: PieceType.King, color: 'black' });
    kingsOnly.setPiece({ x: 4, y: 4, z: 4 }, { type: PieceType.King, color: 'white' });
    const first = moveFromMessage({ by: 'white', from: 'Bb1', to: 'Cb1' });
    const { records } = sharedGames().decisive;
    const cells = Array.from({ length: 125 }, (_, i) => ({
      x: i % 5,
      y: Math.floor(i / 5) % 5,
      z: Math.floor(i / 25),
    }));
    bench(
      'setupStartingPosition',
      () => {
        sink = Board.setupStartingPosition();
      },
      normal,
    );
    bench(
      'clone (opening)',
      () => {
        sink = opening.clone();
      },
      normal,
    );
    bench(
      'applyMove Bb1-Cb1 (opening; clones)',
      () => {
        sink = opening.applyMove(first);
      },
      normal,
    );
    bench(
      'findKing, worst case (king on the last cell scanned)',
      () => {
        sink = kingsOnly.findKing('white');
      },
      normal,
    );
    bench(
      'toZXY + fromZXY, all 125 cells',
      () => {
        for (const cell of cells) sink = fromZXY(toZXY(cell));
      },
      normal,
    );
    bench(
      `wire ⇄ engine move, ${records.length} records`,
      () => {
        for (const r of records) sink = moveToMessage(moveFromMessage(r));
      },
      normal,
    );
  });

  describe(PERFT, () => {
    bench(
      `opening, depth 1 (${perftCounts.opening1} nodes)`,
      () => {
        sink = perft(opening, 'white', 1);
      },
      normal,
    );
    bench(
      `opening, depth 2 (${perftCounts.opening2} nodes)`,
      () => {
        sink = perft(opening, 'white', 2);
      },
      heavy,
    );
    bench(
      `middlegame, depth 2 (${perftCounts.middlegame2} nodes)`,
      () => {
        sink = perft(list[1].board, 'white', 2);
      },
      heavy,
    );
  });
});
