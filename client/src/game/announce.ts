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
  resignation: 'Resignation',
  agreement: 'Draw agreed',
};

/** The results with a winner: a mate, or a resignation. */
export type DecisiveResult = 'checkmate' | 'resignation';
export const isDecisive = (result: GameOver['result']): result is DecisiveResult =>
  result === 'checkmate' || result === 'resignation';

/** How a draw came about, under the result card's "Draw". */
export const DRAW_BY: Record<Exclude<GameOver['result'], DecisiveResult>, string> = {
  stalemate: 'by stalemate',
  repetition: 'by repetition',
  'fifty-moves': 'by the 50-move rule',
  agreement: 'by agreement',
};

const named = (side: Turn) => (side === 'white' ? 'White' : 'Black');
const other = (side: Turn): Turn => (side === 'white' ? 'black' : 'white');

/**
 * A finished game's result in a few words, for the player seated as `seat`:
 * how it ended ("Checkmate", "White resigned", "Draw agreed") and the verdict
 * ("you win", "you lose", "draw"; none where the first words say it).
 */
export function resultWords(
  gameOver: GameOver,
  seat: Turn,
): { how: string; verdict: string | null } {
  const { result, winner } = gameOver;
  if (result === 'agreement') return { how: RESULT_NAME.agreement, verdict: null };
  if (!isDecisive(result) || !winner) return { how: RESULT_NAME[result], verdict: 'draw' };
  const how = result === 'resignation' ? `${named(other(winner))} resigned` : RESULT_NAME[result];
  return { how, verdict: winner === seat ? 'you win' : 'you lose' };
}
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
  if (gameOver && isDecisive(gameOver.result)) {
    const winner = gameOver.winner ?? other(currentTurn);
    const verdict = seat ? (winner === seat ? 'You win.' : 'You lose.') : `${named(winner)} wins.`;
    const how =
      gameOver.result === 'resignation' ? `${named(other(winner))} resigned` : 'Checkmate';
    return `${how}. ${verdict}`;
  }
  if (gameOver?.result === 'agreement') return 'Draw agreed.';
  if (gameOver) return `${RESULT_NAME[gameOver.result]}. Draw.`;
  const check = replayFailedAt === null && board.inCheck(currentTurn) ? 'Check. ' : '';
  return `${check}${currentTurn === seat ? 'Your move.' : `${named(currentTurn)} to move.`}`;
}

/**
 * The whole announcement for the latest move: "White pawn Bb1 to Cb1. Black
 * to move." A game the players ended (a resignation, an agreed draw) is
 * announced with the result alone: its last move was said as it landed.
 */
export function announceLastMove(history: GameHistory, seat: Turn | null): string {
  const result = history.gameOver?.result;
  if (result === 'resignation' || result === 'agreement') return describeTurn(history, seat);
  const move = describeLastMove(history);
  const turn = describeTurn(history, seat);
  return move ? `${move}. ${turn}` : turn;
}
