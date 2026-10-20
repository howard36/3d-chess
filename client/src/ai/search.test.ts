import { SHORT_GAME } from '../game/shortGame';
import { evaluate, forgetMobility, mobilityScore } from './evaluate';
import {
  BISHOP,
  BLACK,
  BLACK_SIDE,
  EXPERT_WEIGHTS,
  KING,
  KNIGHT,
  PAWN,
  Position,
  QUEEN,
  ROOK,
  UNICORN,
  WHITE_SIDE,
  cellOf,
} from './position';
import type { WireMove } from './position';
import { INF, MATE, Searcher } from './search';

const demo: WireMove[] = SHORT_GAME.map((m) => {
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
  // The rook on Ac3 looks straight up the c3 column at Black's queen (White's
  // pawn keeps the rook from being all that is left, which could never mate)
  const pos = setUp([
    [0, 0, 0, KING],
    [0, 1, 1, PAWN],
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

it('on a budget of positions, stops where the clock would at that speed, on any machine', () => {
  const pos = Position.fromRecords(demo.slice(0, 6));
  const limits = { maxDepth: 30, timeMs: 1800, margin: 16, nodes: 20_000 };
  const budgeted = new Searcher(pos).search({ ...limits, now: () => performance.now() * 1e6 });
  // The clock's own rules, with a clock that counts the positions searched
  const searcher = new Searcher(pos);
  const counted = () => (searcher as unknown as { nodes: number }).nodes;
  const clocked = searcher.search({
    ...limits,
    nodes: undefined,
    now: () => (counted() * limits.timeMs) / limits.nodes,
  });
  expect(budgeted).toEqual(clocked);
  // Past the budget by at most the stretch between looks at the clock
  expect(budgeted.nodes).toBeLessThanOrEqual(limits.nodes + 1024);
  const more = new Searcher(pos).search({ ...limits, nodes: 200_000 });
  expect(more.depth).toBeGreaterThan(budgeted.depth);
  // A few searches: seconds with coverage on a busy runner
}, 30_000);

it('the expert judges a position as its mirror image, with or without a king', () => {
  const pieces: [number, number, number, number][] = [
    [2, 0, 0, KING],
    [1, 1, 0, PAWN],
    [2, 1, 1, PAWN],
    [3, 1, 0, BISHOP],
    [1, 2, 1, QUEEN],
    [2, 4, 4, KING | BLACK],
    [2, 3, 4, PAWN | BLACK],
    [1, 2, 2, PAWN | BLACK],
    [0, 3, 3, ROOK | BLACK],
    [3, 2, 2, KNIGHT | BLACK],
  ];
  for (const kings of [2, 1]) {
    const here = kings === 2 ? pieces : pieces.filter(([, , , code]) => code !== (KING | BLACK));
    const pos = new Position(EXPERT_WEIGHTS);
    for (const [x, y, z, code] of here) pos.board[cellOf(x, y, z)] = code;
    pos.reset(WHITE_SIDE);
    // Turned through the centre of the cube, the colours swapped
    const mirror = new Position(EXPERT_WEIGHTS);
    for (const [x, y, z, code] of here) mirror.board[cellOf(4 - x, 4 - y, 4 - z)] = code ^ BLACK;
    mirror.reset(BLACK_SIDE);
    expect(Math.abs(evaluate(mirror) - evaluate(pos))).toBeLessThanOrEqual(1);
    // A pawn of each side attacks a piece, and the kings have their pawns beside them
    expect(evaluate(pos)).not.toBe(evaluate(setUp(here)));
  }
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

  it('scores the kings left alone as a draw, and takes the last piece to get there', () => {
    const bare = setUp([
      [4, 0, 0, KING],
      [3, 3, 3, KING | BLACK],
    ]);
    expect(new Searcher(bare).search({ maxDepth: 3, timeMs: 1e9, margin: 0 }).score).toBe(0);
    // A queen down, Black's king takes White's queen: a draw
    const pos = setUp(
      [
        [4, 0, 0, KING],
        [2, 2, 2, QUEEN],
        [3, 3, 3, KING | BLACK],
      ],
      BLACK_SIDE,
    );
    const result = new Searcher(pos).search({ maxDepth: 3, timeMs: 1e9, margin: INF });
    expect(Position.record(result.move)).toEqual({ from: 'Dd4', to: 'Cc3' });
    expect(result.score).toBe(0);
  });

  it('scores a lone rook, bishop, knight or unicorn against a bare king as a draw', () => {
    for (const piece of [ROOK, BISHOP, KNIGHT, UNICORN]) {
      const pos = setUp([
        [4, 0, 0, KING],
        [0, 4, 0, piece],
        [2, 2, 4, KING | BLACK],
      ]);
      expect(new Searcher(pos).search({ maxDepth: 3, timeMs: 1e9, margin: 0 }).score).toBe(0);
    }
  });

  it('takes a piece to leave material that can never mate', () => {
    // A rook and bishop down, Black's king takes the bishop: a lone rook can't mate
    const pos = setUp(
      [
        [4, 0, 0, KING],
        [2, 2, 2, BISHOP],
        [0, 4, 0, ROOK],
        [3, 3, 3, KING | BLACK],
      ],
      BLACK_SIDE,
    );
    const result = new Searcher(pos).search({ maxDepth: 3, timeMs: 1e9, margin: INF });
    expect(Position.record(result.move)).toEqual({ from: 'Dd4', to: 'Cc3' });
    expect(result.score).toBe(0);
    for (const s of result.scores.filter((s) => s.move !== result.move))
      expect(s.score).toBeLessThan(0);
  });

  it('scores dead material as a draw in the search of captures too', () => {
    // White's knight steps beside Black's king without checking it, and
    // Black's king takes it in the search of captures alone, leaving a lone rook
    const pos = setUp([
      [0, 0, 0, KING],
      [0, 1, 2, KNIGHT],
      [4, 0, 0, ROOK],
      [3, 3, 3, KING | BLACK],
    ]);
    const result = new Searcher(pos).search({ maxDepth: 1, timeMs: 1e9, margin: INF });
    const step = result.scores.find((s) => {
      const r = Position.record(s.move);
      return r.from === 'Ca2' && r.to === 'Cc3';
    });
    expect(step?.score).toBe(0);
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

it("keeps each board's mobility as its own, whichever side is to move", () => {
  // Each board's count worked out afresh (a new search before each look),
  // with the side to move and with the other side to move
  const pos = Position.fromRecords([]);
  const fresh: number[] = [];
  const turned: number[] = [];
  for (const m of demo) {
    forgetMobility();
    fresh.push(mobilityScore(pos));
    pos.makeNull();
    forgetMobility();
    turned.push(mobilityScore(pos));
    pos.unmakeNull();
    pos.make(pos.findMove(m));
  }
  // In one search, each board met again, either side to move, from the kept
  // counts: the second pass reads every board from the cache
  forgetMobility();
  for (let pass = 0; pass < 2; pass++) {
    const again = Position.fromRecords([]);
    demo.forEach((m, i) => {
      expect(mobilityScore(again)).toBe(fresh[i]);
      again.makeNull();
      expect(mobilityScore(again)).toBe(turned[i]);
      again.unmakeNull();
      again.make(again.findMove(m));
    });
  }
});

it('prunes a futile quiet move that gives no check without playing it', () => {
  // (the prune after make() finds the same moves, so only this count shows the
  // early one lost: here 17,618 moves made with it against 20,695 without, in
  // 15,345 nodes either way; a change to the search moves both, the gap stays)
  const make = vi.spyOn(Position.prototype, 'make');
  try {
    const pos = Position.fromRecords(demo.slice(0, 9));
    const { nodes } = new Searcher(pos).search({ maxDepth: 4, timeMs: 1e9, margin: 50 });
    expect(nodes).toBeGreaterThan(10_000);
    expect(make.mock.calls.length / nodes).toBeLessThan(1.25);
  } finally {
    make.mockRestore();
  }
});

it('searches a position the same whatever the thread searched before', async () => {
  const limits = { maxDepth: 4, timeMs: 1e9, margin: 50 };
  // B alone, in fresh copies of the modules: tables and mobility never used
  vi.resetModules();
  const clean = await import('./search');
  const cleanPosition = await import('./position');
  const alone = new clean.Searcher(cleanPosition.Position.fromRecords(demo.slice(0, 9))).search(
    limits,
  );
  // B after A, and then again, on this thread's tables (and after every
  // search above)
  new Searcher(Position.fromRecords(demo.slice(0, 6))).search(limits);
  const after = new Searcher(Position.fromRecords(demo.slice(0, 9))).search(limits);
  const twice = new Searcher(Position.fromRecords(demo.slice(0, 9))).search(limits);
  expect(after).toEqual(alone);
  expect(twice).toEqual(alone);
  expect(alone.nodes).toBeGreaterThan(10_000);
});
