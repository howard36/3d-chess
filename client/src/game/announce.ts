// What a screen reader hears when a move lands, worked out from the replayed
// game. The HUD shows the turn as light and form; this is the same news in
// words, one sentence per move: the move itself (the piece, where it went,
// what it took, what it became), then check or the result, then whose move
// it is now, relative to the player ("Your move", or the other side's name).

import { toZXY } from '../engine/coords';
import type { Piece } from '../engine';
import type { GameHistory, GameOver, Turn } from './history';

/** How a game ended, in a word or two: the turn pill's and the screen reader's. */
export const RESULT_NAME: Record<GameOver['result'], string> = {
  checkmate: 'Checkmate',
  stalemate: 'Stalemate',
  repetition: 'Repetition',
  'fifty-moves': '50-move rule',
};

/** How a draw came about, under the result card's "Draw". */
export const DRAW_BY: Record<Exclude<GameOver['result'], 'checkmate'>, string> = {
  stalemate: 'by stalemate',
  repetition: 'by repetition',
  'fifty-moves': 'by the 50-move rule',
};

const named = (side: Turn) => (side === 'white' ? 'White' : 'Black');
const lower = (piece: Piece) => piece.type.toLowerCase();

/** "White bishop Ad2 takes pawn on Dd5", "Black pawn Db2 to Ab1, promotes to queen". */
export function describeLastMove(history: GameHistory): string | null {
  const { lastMove, board } = history;
  if (!lastMove) return null;
  const { move, capturedPiece } = lastMove;
  const arrived = board.getPiece(move.to);
  if (!arrived) return null;
  const from = toZXY(move.from);
  const to = toZXY(move.to);
  const mover = move.promotion ? 'pawn' : lower(arrived);
  const where = capturedPiece ? `takes ${lower(capturedPiece)} on ${to}` : `to ${to}`;
  const promotes = move.promotion ? `, promotes to ${lower(arrived)}` : '';
  return `${named(arrived.color)} ${mover} ${from} ${where}${promotes}`;
}

/** Whose move it is, or how the game ended, for the player seated as `seat`. */
export function describeTurn(history: GameHistory, seat: Turn | null): string {
  const { gameOver, currentTurn, board, replayFailedAt } = history;
  if (gameOver?.result === 'checkmate') {
    const winner = gameOver.winner ?? (currentTurn === 'white' ? 'black' : 'white');
    const verdict = seat ? (winner === seat ? 'You win.' : 'You lose.') : `${named(winner)} wins.`;
    return `Checkmate. ${verdict}`;
  }
  if (gameOver) return `${RESULT_NAME[gameOver.result]}. Draw.`;
  const check = replayFailedAt === null && board.inCheck(currentTurn) ? 'Check. ' : '';
  return `${check}${currentTurn === seat ? 'Your move.' : `${named(currentTurn)} to move.`}`;
}

/** The whole announcement for the latest move: "White pawn Bb1 to Cb1. Black to move." */
export function announceLastMove(history: GameHistory, seat: Turn | null): string {
  const move = describeLastMove(history);
  const turn = describeTurn(history, seat);
  return move ? `${move}. ${turn}` : turn;
}
