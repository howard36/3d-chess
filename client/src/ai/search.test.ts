import { DEMO_GAME } from '../game/demo';
import { evaluate } from './evaluate';
import {
  BLACK,
  BLACK_SIDE,
  KING,
  KNIGHT,
  PAWN,
  Position,
  QUEEN,
  ROOK,
  WHITE_SIDE,
  cellOf,
} from './position';
import type { WireMove } from './position';
import { INF, MATE, Searcher } from './search';

const demo: WireMove[] = DEMO_GAME.map((m) => {
  const [from, to] = m.split('-');
  return { from, to };
});

/** A position from pieces: [x, y, z, code]. */
const setUp = (pieces: [number, number, number, number][], side = WHITE_SIDE) => {
  const pos = new Position();
  for (const [x, y, z, code] of pieces) pos.board[cellOf(x, y, z)] = code;
  pos.reset(side);
  return pos;
};

const deep = { maxDepth: 30, timeMs: 1e9, margin: 0 };

it('finds a mate in one, and scores it as one', () => {
  // The demo's last move mates
  const pos = Position.fromRecords(demo.slice(0, -1));
  const result = new Searcher(pos).search({ ...deep, maxDepth: 3 });
  expect(Position.record(result.move)).toEqual(demo[demo.length - 1]);
  expect(result.score).toBe(MATE - 1);
});

it('says when there is no move: mated, or stalemated', () => {
  const mated = Position.fromRecords(demo);
  expect(new Searcher(mated).search(deep)).toMatchObject({ move: 0, score: -MATE });
  // Black's king alone in its corner, every square round it covered by the
  // king on Cd4 and the queen on Ec4, neither of which checks it
  const stalemated = setUp(
    [
      [3, 3, 2, KING],
      [2, 3, 4, QUEEN],
      [4, 4, 4, KING | BLACK],
    ],
    BLACK_SIDE,
  );
  expect(stalemated.inCheck()).toBe(false);
  expect(new Searcher(stalemated).search(deep)).toMatchObject({ move: 0, score: 0 });
});

it('takes a queen left hanging, and keeps its own out of reach', () => {
  // The rook on Ac3 looks straight up the c3 column at Black's queen
  const pos = setUp([
    [0, 0, 0, KING],
    [2, 2, 0, ROOK],
    [2, 2, 2, QUEEN | BLACK],
    [4, 4, 4, KING | BLACK],
  ]);
  const take = new Searcher(pos).search({ ...deep, maxDepth: 2 });
  expect(Position.record(take.move)).toEqual({ from: 'Ac3', to: 'Cc3' });
  expect(take.score).toBeGreaterThan(200);
  // Black to move instead: the queen steps off the column, or takes the rook
  pos.reset(BLACK_SIDE);
  const flee = new Searcher(pos).search({ ...deep, maxDepth: 3 });
  pos.make(flee.move);
  expect(pos.board[cellOf(2, 2, 0)] === ROOK && pos.attacked(pos.king[1], WHITE_SIDE)).toBe(false);
  expect(flee.score).toBeGreaterThan(-200);
});

it('mates with king and queen against the bare king', () => {
  const pos = setUp([
    [0, 0, 0, KING],
    [2, 2, 2, QUEEN],
    [4, 4, 4, KING | BLACK],
  ]);
  let ply = 0;
  for (; ply < 60; ply++) {
    const r = new Searcher(pos).search({ ...deep, maxNodes: 20_000 });
    if (!r.move) break;
    pos.make(r.move);
  }
  expect(pos.inCheck()).toBe(true);
  expect(ply).toBeLessThan(30);
});

it('scores every move near the best exactly, and only those', () => {
  const pos = Position.start();
  const result = new Searcher(pos).search({ maxDepth: 2, timeMs: 1e9, margin: 30 });
  expect(result.scores).toHaveLength(Position.start().legalMoves(new Int32Array(256)));
  expect(result.candidates[0].move).toBe(result.move);
  for (const c of result.candidates) expect(c.score).toBeGreaterThanOrEqual(result.score - 30);
  // With no margin only the best; with every move, all of them
  expect(new Searcher(pos).search({ ...deep, maxDepth: 2 }).candidates).toHaveLength(1);
  const all = new Searcher(pos).search({ maxDepth: 1, timeMs: 1e9, margin: INF });
  expect(all.candidates).toHaveLength(all.scores.length);
});

it('stops on the clock or a node budget, never before one full iteration', () => {
  let t = 0;
  const pos = Position.start();
  const timed = new Searcher(pos).search({
    maxDepth: 30,
    timeMs: 50,
    margin: 0,
    now: () => (t += 1),
  });
  expect(timed.depth).toBeGreaterThanOrEqual(1);
  expect(timed.depth).toBeLessThan(30);
  const budget = new Searcher(pos).search({ maxDepth: 30, timeMs: 1e9, margin: 0, maxNodes: 1 });
  expect(budget.depth).toBe(1);
  expect(budget.move).not.toBe(0);
});

it('does not see a hidden move, so walks into it', () => {
  // White's knight on Bc3 attacks Black's queen on Dd3 with a jump across
  // levels. Seeing it, Black knows a pawn move loses the queen; blind to the
  // jump, it thinks the queen safe
  const pos = setUp(
    [
      [0, 0, 0, KING],
      [2, 2, 1, KNIGHT],
      [3, 2, 3, QUEEN | BLACK],
      [4, 4, 4, KING | BLACK],
      [4, 4, 3, PAWN | BLACK],
    ],
    BLACK_SIDE,
  );
  const pawnMove = (r: { scores: { move: number; score: number }[] }) =>
    r.scores.find((s) => Position.record(s.move).from === 'De5')!.score;
  const all = { maxDepth: 2, timeMs: 1e9, margin: INF };
  const seeing = new Searcher(pos).search(all);
  const blind = new Searcher(pos).search({
    ...all,
    hidden: (m) => (m & 127) === cellOf(2, 2, 1),
  });
  expect(pawnMove(blind) - pawnMove(seeing)).toBeGreaterThan(600);
});

it('judges the start as even, and a piece up as winning', () => {
  const start = Position.start();
  expect(Math.abs(evaluate(start))).toBeLessThan(30);
  const up = Position.start();
  up.board[cellOf(2, 3, 4)] = 0; // Black's queen gone
  up.reset(WHITE_SIDE);
  expect(evaluate(up)).toBeGreaterThan(800);
  up.reset(BLACK_SIDE);
  expect(evaluate(up)).toBeLessThan(-800);
});

describe('the draws', () => {
  // White's king and queen against the bare king: the kings shuffle, White's
  // between Aa1 and Ab1, Black's between Ee5 and Ed5
  const kq = () =>
    setUp([
      [0, 0, 0, KING],
      [2, 4, 0, QUEEN],
      [4, 4, 4, KING | BLACK],
    ]);
  const play = (pos: Position, moves: string[]) => {
    for (const m of moves) {
      const [from, to] = m.split('-');
      const move = pos.findMove({ from, to });
      expect(move).not.toBe(0);
      pos.make(move);
    }
  };
  const cycle = ['Aa1-Ab1', 'Ee5-Ed5', 'Ab1-Aa1', 'Ed5-Ee5'];

  it('the side losing takes a third repetition, and scores it as a draw', () => {
    const pos = kq();
    // The start has stood twice; Black's king back to Ee5 makes the third time
    play(pos, [...cycle, ...cycle.slice(0, 3)]);
    const result = new Searcher(pos).search({ maxDepth: 3, timeMs: 1e9, margin: INF });
    expect(Position.record(result.move)).toEqual({ from: 'Ed5', to: 'Ee5' });
    expect(result.score).toBe(0);
    // Any other move leaves Black a queen down
    for (const s of result.scores.filter((s) => s.move !== result.move))
      expect(s.score).toBeLessThan(-500);
  });

  it('the side ahead avoids a third repetition', () => {
    // The same shuffle with Black a queen up: now Black's king back to Ee5
    // would throw the win away
    const pos = setUp([
      [0, 0, 0, KING],
      [2, 0, 4, QUEEN | BLACK],
      [4, 4, 4, KING | BLACK],
    ]);
    play(pos, [...cycle, ...cycle.slice(0, 3)]);
    const result = new Searcher(pos).search({ maxDepth: 3, timeMs: 1e9, margin: INF });
    const back = result.scores.find((s) => Position.record(s.move).to === 'Ee5')!;
    expect(back.score).toBe(0);
    expect(result.move).not.toBe(back.move);
    expect(result.score).toBeGreaterThan(500);
  });

  it('draws at fifty moves each with no capture or pawn move, but a mate stands', () => {
    const pos = kq();
    pos.reset(WHITE_SIDE, 99);
    // Every move is the hundredth: nothing White does can win now
    const late = new Searcher(pos).search({ maxDepth: 3, timeMs: 1e9, margin: INF });
    expect(late.score).toBe(0);
    // ...while with time left, the queen's lead tells
    pos.reset(WHITE_SIDE, 0);
    expect(new Searcher(pos).search({ maxDepth: 3, timeMs: 1e9, margin: 0 }).score).toBeGreaterThan(
      500,
    );
    // The demo's mating move, played as the hundredth ply, still mates
    const mate = Position.fromRecords(demo.slice(0, -1));
    mate.reset(WHITE_SIDE, 99);
    const result = new Searcher(mate).search({ ...deep, maxDepth: 2 });
    expect(Position.record(result.move)).toEqual(demo[demo.length - 1]);
    expect(result.score).toBe(MATE - 1);
  });

  it('values a lead a little less as the fifty moves run out', () => {
    const pos = kq();
    const fresh = evaluate(pos);
    pos.reset(WHITE_SIDE, 80);
    const late = evaluate(pos);
    expect(late).toBeLessThan(fresh);
    expect(late).toBeGreaterThan(fresh * 0.7);
  });
});
