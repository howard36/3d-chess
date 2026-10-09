// A long game that the draw rules never end, for the browser bench
// (scripts/bench-browser.mjs): its moves played through the move box, and
// games of thousands of plies seeded for the reopen. The knight shuffle the
// bench played before (Ab1-Aa3, Ed5-Ee3 and back) stands the opening
// position a third time at ply 8, a draw by repetition since the draw rules
// came in, which ended the bench's game.
//
// Every move is quiet: no capture, no check, no promotion, never a position
// seen before in the game (so none stands three times), and a pawn steps
// forward every PAWN_EVERY plies (so a hundred plies never pass without
// one). The choice is fixed, so the game is the same on every run.
// Written out to longGame.json by `npx vite-node scripts/long-game.ts`;
// longGame.test.ts checks the file against the rules.

import { Board, PieceType } from '../src/engine';
import type { Move } from '../src/engine';
import { toZXY } from '../src/engine/coords';
import { positionHash } from '../src/engine/draws';

/** Plies between pawn moves, well inside the fifty-move rule's hundred. */
const PAWN_EVERY = 40;

/** The moves' text as the move box takes it (`Ab1-Aa3`). */
export const moveText = (m: Move) => `${toZXY(m.from)}-${toZXY(m.to)}`;

export function generateLongGame(plies: number): string[] {
  let board = Board.setupStartingPosition();
  let turn: 'white' | 'black' = 'white';
  const seen = new Set<number>([positionHash(board, turn)]);
  const out: string[] = [];
  let sincePawn = 0;
  for (let ply = 0; ply < plies; ply++) {
    const other: 'white' | 'black' = turn === 'white' ? 'black' : 'white';
    const all = board.generateAllLegalMoves(turn);
    const ok = (m: Move) => {
      if (board.getPiece(m.to) || m.promotion) return null;
      const next = board.applyMove(m);
      if (next.inCheck(other) || !next.hasLegalMove(other)) return null;
      const hash = positionHash(next, other);
      return seen.has(hash) ? null : { next, hash };
    };
    const isPawn = (m: Move) => board.getPiece(m.from)!.type === PieceType.Pawn;
    const wantPawn = sincePawn >= PAWN_EVERY;
    // A fixed order that still varies from ply to ply
    const rotated = all.map((_, i) => all[(i + ply * 7) % all.length]);
    const pick = (pred: (m: Move) => boolean) => {
      for (const m of rotated) {
        if (!pred(m)) continue;
        const r = ok(m);
        if (r) return { m, ...r };
      }
      return null;
    };
    const chosen = (wantPawn ? pick(isPawn) : pick((m) => !isPawn(m))) ?? pick(() => true);
    if (!chosen) throw new Error(`no quiet move at ply ${ply}`);
    sincePawn = isPawn(chosen.m) ? 0 : sincePawn + 1;
    if (sincePawn >= 95) throw new Error(`no pawn move by ply ${ply}`);
    seen.add(chosen.hash);
    out.push(moveText(chosen.m));
    board = chosen.next;
    turn = other;
  }
  return out;
}

/** How many plies the fixture holds: the bench's longest reopen, and room. */
export const LONG_GAME_PLIES = 2100;
