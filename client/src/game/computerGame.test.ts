import {
  answer,
  computerMove,
  computerToMove,
  fallbackMove,
  isOver,
  startGame,
} from './computerGame';
import type { ComputerGame } from './computerGame';
import { DEMO_GAME } from './demo';
import type { MoveRecord } from '../types/messages';

const game = (over: Partial<ComputerGame> = {}): ComputerGame => ({
  id: 'abc',
  color: 'white',
  difficulty: 'medium',
  started: true,
  moves: [],
  ...over,
});

const records = (moves: readonly string[]): MoveRecord[] =>
  moves.map((m, i) => {
    const [from, to] = m.split('-');
    return { by: i % 2 ? 'black' : 'white', from, to };
  });

it('answers a rejoin with the game, and a look with both seats taken', () => {
  const g = game({ started: false });
  expect(answer(g, 'abc', { type: 'rejoin_game', gameId: 'abc', color: 'white' })).toEqual({
    game: g,
    replies: [{ type: 'game_state', color: 'white', started: false, moves: [] }],
  });
  expect(answer(g, 'abc', { type: 'look_game', gameId: 'abc' }).replies).toEqual([
    { type: 'game_info', gameId: 'abc', seats: ['white', 'black'] },
  ]);
  expect(answer(g, 'abc', { type: 'join_game', gameId: 'abc' }).replies[0]).toMatchObject({
    code: 'game_full',
  });
});

it('knows no game it does not hold', () => {
  for (const g of [null, game({ id: 'other' })]) {
    expect(answer(g, 'abc', { type: 'look_game', gameId: 'abc' }).replies).toEqual([
      { type: 'error', code: 'invalid_game', message: 'No such game' },
    ]);
  }
  expect(answer(null, 'abc', { type: 'move', from: 'Bc2', to: 'Cc2' }).replies[0]).toMatchObject({
    code: 'invalid_game',
  });
});

it('records the player’s legal move and echoes it', () => {
  const g = game();
  const result = answer(g, 'abc', { type: 'move', from: 'Bc2', to: 'Cc2' });
  expect(result.replies).toEqual([{ type: 'move_made', by: 'white', from: 'Bc2', to: 'Cc2' }]);
  expect(result.game!.moves).toEqual([{ by: 'white', from: 'Bc2', to: 'Cc2' }]);
  // The game it was given is left as it was
  expect(g.moves).toEqual([]);
});

it('refuses a move out of turn, before the start, illegal, or unreadable', () => {
  const move = { type: 'move', from: 'Bc2', to: 'Cc2' } as const;
  expect(answer(game({ started: false }), 'abc', move).replies[0]).toMatchObject({
    code: 'game_not_started',
  });
  expect(answer(game({ color: 'black' }), 'abc', move).replies[0]).toMatchObject({
    code: 'wrong_turn',
  });
  for (const bad of [
    { type: 'move', from: 'Bc2', to: 'Ec2' },
    { type: 'move', from: 'Dc4', to: 'Cc4' },
    { type: 'move', from: 'Zz9', to: 'Cc2' },
  ] as const) {
    const result = answer(game(), 'abc', bad);
    expect(result.replies[0]).toMatchObject({ code: 'invalid_move' });
    expect(result.game!.moves).toEqual([]);
  }
  expect(answer(game(), 'abc', { type: 'create_game' }).replies[0]).toMatchObject({
    code: 'invalid_message',
  });
});

it('keeps a promotion with the move, and refuses a pawn reaching its last square without one', () => {
  // White's pawn on Dd4 can take on Ed5, rank 5 of level E
  const g = game({
    moves: records(['Bd2-Bd3', 'Dc4-Cc4', 'Bd3-Cd3', 'Eb4-Cd4', 'Cd3-Dd4', 'Ec4-Dc3']),
  });
  const bare = answer(g, 'abc', { type: 'move', from: 'Dd4', to: 'Ed5' });
  expect(bare.replies[0]).toMatchObject({ code: 'invalid_move' });
  const promoted = answer(g, 'abc', { type: 'move', from: 'Dd4', to: 'Ed5', promotion: 'N' });
  expect(promoted.replies).toEqual([
    { type: 'move_made', by: 'white', from: 'Dd4', to: 'Ed5', promotion: 'N' },
  ]);
  // The computer's promotion is kept the same way (here it plays White)
  const vsBlack = game({ color: 'black', moves: g.moves });
  expect(computerMove(vsBlack, { from: 'Dd4', to: 'Ed5' }).replies).toEqual([]);
  expect(computerMove(vsBlack, { from: 'Dd4', to: 'Ed5', promotion: 'Q' }).replies).toEqual([
    { type: 'move_made', by: 'white', from: 'Dd4', to: 'Ed5', promotion: 'Q' },
  ]);
});

it('the computer sits down, then moves only on its turn and only legally', () => {
  const g = game({ started: false });
  expect(computerToMove(g)).toBe(false);
  const started = startGame(g);
  expect(started.replies).toEqual([{ type: 'game_start', color: 'white' }]);
  expect(startGame(started.game!).replies).toEqual([]);
  // White's move: not the computer's
  expect(computerToMove(started.game)).toBe(false);
  expect(computerMove(started.game!, { from: 'Dc4', to: 'Cc4' }).replies).toEqual([]);
  const after = answer(started.game, 'abc', { type: 'move', from: 'Bc2', to: 'Cc2' }).game!;
  expect(computerToMove(after)).toBe(true);
  // A stale or wrong answer changes nothing
  expect(computerMove(after, { from: 'Dc4', to: 'Ac4' }).replies).toEqual([]);
  const played = computerMove(after, { from: 'Dc4', to: 'Cc4' });
  expect(played.replies).toEqual([{ type: 'move_made', by: 'black', from: 'Dc4', to: 'Cc4' }]);
  expect(computerToMove(played.game)).toBe(false);
  expect(computerToMove(null)).toBe(false);
});

it('has a legal move ready should the computer’s search fail', () => {
  const g = game({ color: 'white', moves: records(['Bc2-Cc2']) });
  const move = fallbackMove(g);
  expect(move).not.toBeNull();
  expect(computerMove(g, move!).replies).toHaveLength(1);
});

it('sees a game over: mate, or a record it cannot play', () => {
  const mated = game({ color: 'black', moves: records(DEMO_GAME) });
  expect(isOver(mated)).toBe(true);
  expect(computerToMove(mated)).toBe(false);
  expect(fallbackMove(mated)).toBeNull();
  const broken = game({ moves: records(['Ca3-Cb3']) }); // no piece on Ca3
  expect(isOver(broken)).toBe(true);
  expect(fallbackMove(broken)).toBeNull();
  expect(answer(broken, 'abc', { type: 'move', from: 'Dc4', to: 'Cc4' }).replies[0]).toMatchObject({
    code: 'wrong_turn',
  });
});

it('stops at a draw: the computer plays no further', () => {
  const shuffle = ['Ab1-Cc1', 'Ed5-Cc5', 'Cc1-Ab1', 'Cc5-Ed5'];
  const drawn = game({ color: 'black', moves: records([...shuffle, ...shuffle]) });
  expect(isOver(drawn)).toBe(true);
  expect(computerToMove(drawn)).toBe(false);
  expect(computerMove(drawn, { from: 'Ab1', to: 'Cc1' }).replies).toEqual([]);
});
