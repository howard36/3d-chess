// A game against the computer, played without the server: this stands in
// for it, answering the messages the game screen sends as the server would,
// so the screen derives everything from its log exactly as for a game
// between two people (ARCHITECTURE.md, "Event-sourced client state"). The game is
// kept in the browser (lib/computerGames.ts) and comes back on a reload.

import { Board } from '../engine';
import { moveFromMessage, moveToMessage } from '../engine/protocol';
import { deriveHistory } from './history';
import type { Difficulty } from '../ai/levels';
import type {
  Color,
  DrawOffer,
  Ending,
  Error as ServerError,
  GameState,
  MoveRecord,
  WebSocketMessage,
} from '../types/messages';

export interface ComputerGame {
  id: string;
  /** The player's side; the computer has the other. */
  color: Color;
  difficulty: Difficulty;
  /** The computer has taken its seat (a beat after the game was made). */
  started: boolean;
  moves: MoveRecord[];
  /** The player resigned, or the computer accepted a draw. */
  ending?: Ending;
  /** The player's latest draw offer (the computer never offers one). */
  drawOffer?: DrawOffer;
}

/**
 * The computer accepts a draw only when it stands this badly or worse, in
 * centipawns for its own side: about a minor piece and a half down, or
 * facing a winning attack.
 */
export const ACCEPTS_DRAW_AT = -150;

export interface Answer {
  /** The game after the message (the same object if it did not change). */
  game: ComputerGame | null;
  /** What the server would have sent back. */
  replies: WebSocketMessage[];
}

const other = (c: Color): Color => (c === 'white' ? 'black' : 'white');

/** The side to move after `moves`. */
const turnAfter = (moves: readonly MoveRecord[]): Color =>
  moves.length % 2 === 0 ? 'white' : 'black';

/** The position after `moves`, or null if one of them cannot be played. */
const replay = (moves: readonly MoveRecord[]): Board | null => {
  let board = Board.setupStartingPosition();
  try {
    for (const m of moves) board = board.applyMove(moveFromMessage(m));
  } catch {
    return null;
  }
  return board;
};

/** Whether `record` is a legal move for the side to move on `board`. */
const isLegal = (board: Board, record: MoveRecord): boolean => {
  let move;
  try {
    move = moveFromMessage(record);
  } catch {
    return false;
  }
  const piece = board.getPiece(move.from);
  if (!piece || piece.color !== record.by) return false;
  return board
    .generateLegalMoves(move.from)
    .some(
      (m) =>
        m.to.x === move.to.x &&
        m.to.y === move.to.y &&
        m.to.z === move.to.z &&
        m.promotion === move.promotion,
    );
};

/** The game as a rejoin's answer gives it. */
export const snapshot = (game: ComputerGame): GameState => {
  const state: GameState = {
    type: 'game_state',
    color: game.color,
    started: game.started,
    moves: game.moves,
  };
  if (game.ending) state.ending = game.ending;
  if (game.drawOffer) state.drawOffer = game.drawOffer;
  return state;
};

/** Whether the game has ended (mated, drawn, resigned), or cannot go on. */
export function isOver(game: ComputerGame): boolean {
  if (game.ending) return true;
  // By the game's own rules (history.ts): mate, stalemate, a repetition or
  // the fifty moves, or a record that cannot be played on
  const history = deriveHistory([
    { type: 'game_state', color: game.color, started: true, moves: game.moves },
  ]);
  return history.gameOver !== null || history.replayFailedAt !== null;
}

/** The player's draw offer, if it stands: made since the last move, and not yet answered. */
export const standingOffer = (game: ComputerGame | null): DrawOffer | null => {
  const offer = game?.drawOffer;
  return offer && offer.ply === game.moves.length && !offer.declined && !game.ending ? offer : null;
};

/** Whether it is the computer's move in a game under way. */
export function computerToMove(game: ComputerGame | null): game is ComputerGame {
  return !!game && game.started && turnAfter(game.moves) !== game.color && !isOver(game);
}

const error = (code: ServerError['code'], message: string): WebSocketMessage => ({
  type: 'error',
  code,
  message,
});

/**
 * The server's answer to `msg` from the player of `game` (null: no such game
 * is stored under the page's id).
 */
export function answer(game: ComputerGame | null, gameId: string, msg: WebSocketMessage): Answer {
  const none = (replies: WebSocketMessage[]): Answer => ({ game, replies });
  if (msg.type === 'look_game' || msg.type === 'rejoin_game' || msg.type === 'join_game') {
    if (!game || game.id !== gameId) return none([error('invalid_game', 'No such game')]);
    if (msg.type === 'look_game')
      return none([{ type: 'game_info', gameId, seats: ['white', 'black'] }]);
    if (msg.type === 'join_game') return none([error('game_full', 'Game is full')]);
    return none([snapshot(game)]);
  }
  const playing =
    msg.type === 'move' ||
    msg.type === 'resign' ||
    msg.type === 'offer_draw' ||
    msg.type === 'accept_draw' ||
    msg.type === 'decline_draw';
  if (!playing) return none([error('invalid_message', 'Not available against the computer')]);
  // As the server: a game under way, not ended by the players
  if (!game) return none([error('invalid_game', 'No such game')]);
  if (!game.started) return none([error('game_not_started', 'The game has not started')]);
  if (game.ending) return none([error('game_over', 'The game is over')]);
  if (msg.type === 'resign') {
    const ending: Ending = { result: 'resignation', winner: other(game.color) };
    return { game: { ...game, ending }, replies: [{ type: 'game_ended', ...ending }] };
  }
  if (msg.type === 'offer_draw') {
    const ply = game.moves.length;
    if (game.drawOffer?.ply === ply)
      return none([error('invalid_draw', 'A draw was already offered this move')]);
    const drawOffer: DrawOffer = { by: game.color, ply };
    return { game: { ...game, drawOffer }, replies: [{ type: 'draw_offered', ...drawOffer }] };
  }
  // The computer never offers a draw, so there is none for the player to answer
  if (msg.type === 'accept_draw' || msg.type === 'decline_draw')
    return none([error('invalid_draw', 'No draw offer to answer')]);
  const by = turnAfter(game.moves);
  if (by !== game.color) return none([error('wrong_turn', 'Not your turn')]);
  const record: MoveRecord = { by, from: msg.from, to: msg.to };
  if (msg.promotion) record.promotion = msg.promotion;
  const board = replay(game.moves);
  if (!board || !isLegal(board, record)) return none([error('invalid_move', 'Illegal move')]);
  return {
    game: { ...game, moves: [...game.moves, record] },
    replies: [{ type: 'move_made', ...record }],
  };
}

/**
 * The computer answers the player's standing draw offer, having weighed up
 * the position (`score`, in centipawns for the side to move; null if it
 * could not): it accepts only when it stands clearly worse (ACCEPTS_DRAW_AT).
 * Nothing happens if no offer stands (the player moved, or resigned, meanwhile).
 */
export function answerDrawOffer(game: ComputerGame, score: number | null): Answer {
  const offer = standingOffer(game);
  if (!offer) return { game, replies: [] };
  const computer = other(game.color);
  const own = score === null ? null : turnAfter(game.moves) === computer ? score : -score;
  if (own !== null && own <= ACCEPTS_DRAW_AT) {
    const ending: Ending = { result: 'agreement' };
    return { game: { ...game, ending }, replies: [{ type: 'game_ended', ...ending }] };
  }
  const drawOffer: DrawOffer = { ...offer, declined: true };
  return {
    game: { ...game, drawOffer },
    replies: [{ type: 'draw_declined', by: computer, ply: offer.ply }],
  };
}

/** The computer takes its seat: the game begins. */
export function startGame(game: ComputerGame): Answer {
  if (game.started) return { game, replies: [] };
  return { game: { ...game, started: true }, replies: [{ type: 'game_start', color: game.color }] };
}

/**
 * The computer plays `move` (without its side), if it is its move and the
 * move is legal; otherwise nothing happens (a stale answer from its search).
 */
export function computerMove(
  game: ComputerGame,
  move: Pick<MoveRecord, 'from' | 'to' | 'promotion'>,
): Answer {
  if (!computerToMove(game)) return { game, replies: [] };
  const record: MoveRecord = { by: other(game.color), from: move.from, to: move.to };
  if (move.promotion) record.promotion = move.promotion;
  const board = replay(game.moves);
  if (!board || !isLegal(board, record)) return { game, replies: [] };
  return {
    game: { ...game, moves: [...game.moves, record] },
    replies: [{ type: 'move_made', ...record }],
  };
}

/** A legal move for the computer, should its search fail to answer. */
export function fallbackMove(
  game: ComputerGame,
): Pick<MoveRecord, 'from' | 'to' | 'promotion'> | null {
  const board = replay(game.moves);
  if (!board) return null;
  const moves = board.generateAllLegalMoves(turnAfter(game.moves));
  if (moves.length === 0) return null;
  const { from, to, promotion } = moveToMessage(moves[0]);
  return promotion ? { from, to, promotion } : { from, to };
}
