import { Board } from '../engine/board';
import { moveFromMessage } from '../engine/protocol';
import { SHORT_GAME } from '../game/shortGame';
import { analysePosition, assessPosition, chooseMove, hardToSee, pickMove, seeded } from './choose';
import { DIFFICULTIES, LEVELS, isDifficulty, thinkTime } from './levels';
import { evaluate } from './evaluate';
import {
  BISHOP,
  EXPERT_WEIGHTS,
  KING,
  KNIGHT,
  PAWN,
  Position,
  QUEEN,
  UNICORN,
  cellOf,
} from './position';
import type { WireMove } from './position';
import { MATE, Searcher } from './search';

const demo: WireMove[] = SHORT_GAME.map((m) => {
  const [from, to] = m.split('-');
  return { from, to };
});

/** Every level, quick: a few thousand positions a move. */
const quick = { maxNodes: 2000 };

const isLegal = (records: WireMove[], move: WireMove) => {
  let board = Board.setupStartingPosition();
  records.forEach((r, i) => {
    board = board.applyMove(moveFromMessage({ by: i % 2 ? 'black' : 'white', ...r }));
  });
  const color = records.length % 2 ? 'black' : 'white';
  const m = moveFromMessage({ by: color, ...move });
  return board
    .generateLegalMoves(m.from)
    .some((l) => l.to.x === m.to.x && l.to.y === m.to.y && l.to.z === m.to.z);
};

it('weighs up a position for the side to move', () => {
  // Even at the start; won for White a move before the demo's mate
  expect(Math.abs(assessPosition([], { maxNodes: 4000 }))).toBeLessThan(100);
  expect(assessPosition(demo.slice(0, -1), { maxNodes: 4000 })).toBeGreaterThan(MATE - 100);
});

/** A game of Easy's where White, to move, has one legal move. */
const FORCED = (
  'Bc2-Cc2 Eb5-Db3 Ad1-Ac3 Ee4-Be1 Ae1-Be1 Ec4-Dd3 Ae2-Db5 Ed5-Db5 Bd2-Cd2 Dd3-Cc4 Ac3-Cc4 ' +
  'Dd4-Cc4 Ba1-Ca1 Dd5-Dd4 Ac2-Ae4 Db3-Da1 Ab1-Cb2 Ed4-Cb2 Ab2-Cd4 Da1-Ec1 Ca1-Cb2 Dc4-Cd4 ' +
  'Ae4-Ad5 Cd4-Cd3 Ad2-Dd5 Ec5-Ed5 Bd1-Cd1 Eb4-Ed2 Dd5-Db3 Ed5-Ec5 Ad5-Dd5'
)
  .split(' ')
  .map((m) => ({ from: m.slice(0, 3), to: m.slice(4) }));

describe('a review’s look at a position', () => {
  it('gives the best move and its worth, the same each time', () => {
    const start = analysePosition([], { maxNodes: 4000 });
    expect(start.best).toBeTruthy();
    expect(isLegal([], start.best!)).toBe(true);
    expect(Math.abs(start.score)).toBeLessThan(100);
    expect(start.mate).toBeUndefined();
    expect(analysePosition([], { maxNodes: 4000 })).toEqual(start);
  });

  it('counts a forced mate in plies, for the side to move or against it', () => {
    expect(analysePosition(demo.slice(0, -1), { maxNodes: 4000 })).toEqual({
      best: demo[demo.length - 1],
      score: MATE - 1,
      mate: 1,
    });
    // A move short of that mate, Black is mated whatever it does
    const lost = analysePosition([...demo.slice(0, -1), { from: 'Cd2', to: 'Cc4' }], {
      maxNodes: 20000,
    });
    expect(lost.mate).toBe(-2);
    expect(lost.score).toBe(-MATE + 2);
  });

  it('has no move once mated', () => {
    expect(analysePosition(demo, { maxNodes: 4000 }).best).toBeNull();
  });

  it('looks past a forced move as past any other', () => {
    const forced = analysePosition(FORCED, { maxNodes: 20000 });
    expect(forced.best).toBeTruthy();
    expect(
      new Searcher(Position.fromRecords(FORCED)).search({
        maxDepth: 40,
        timeMs: 1e6,
        maxNodes: 20000,
        margin: 0,
      }).depth,
    ).toBe(1);
    expect(
      new Searcher(Position.fromRecords(FORCED)).search({
        maxDepth: 40,
        timeMs: 1e6,
        maxNodes: 20000,
        margin: 0,
        deepenForced: true,
      }).depth,
    ).toBeGreaterThan(1);
  });
});

it('plays a legal move at every level, all game long', () => {
  for (const difficulty of DIFFICULTIES) {
    const records: WireMove[] = [];
    for (let ply = 0; ply < 12; ply++) {
      const choice = chooseMove(records, difficulty, ply * 7919 + 1, quick);
      expect(choice).not.toBeNull();
      expect(isLegal(records, choice!.move)).toBe(true);
      expect(choice!.ply).toBe(ply);
      records.push(choice!.move);
    }
  }
}, 30_000);

it('chooses the same move from the same seed, and varies with it', () => {
  const a = chooseMove([], 'medium', 42, quick);
  const b = chooseMove([], 'medium', 42, quick);
  expect(a!.move).toEqual(b!.move);
  // The opening is played freely: several first moves over a few seeds
  const firsts = new Set(
    Array.from({ length: 12 }, (_, i) => {
      const m = chooseMove([], 'hard', i + 1, quick)!.move;
      return `${m.from}-${m.to}`;
    }),
  );
  expect(firsts.size).toBeGreaterThan(1);
});

it('every level takes a mate in one', () => {
  for (const difficulty of DIFFICULTIES) {
    const choice = chooseMove(demo.slice(0, -1), difficulty, 3, quick);
    expect(choice!.move).toEqual(demo[demo.length - 1]);
    expect(choice!.score).toBe(MATE - 1);
  }
});

it('has no move once mated', () => {
  expect(chooseMove(demo, 'hard', 1, quick)).toBeNull();
});

it('says a recapture is obvious', () => {
  // White's bishop takes on Dd5 with check; Black takes back
  const before = demo.slice(0, 5);
  const choice = chooseMove(before, 'hard', 5, { maxNodes: 20_000 });
  expect(choice!.move.to).toBe('Dd5');
  expect(choice!.obvious).toBe(true);
  expect(choice!.forced).toBe(false);
});

it('the levels grow stronger: deeper, steadier, seeing more', () => {
  const [easy, medium, hard] = DIFFICULTIES.map((d) => LEVELS[d]);
  expect(easy.maxDepth).toBeLessThan(medium.maxDepth);
  expect(medium.maxDepth).toBeLessThan(hard.maxDepth);
  expect(easy.noise).toBeGreaterThan(medium.noise);
  expect(medium.noise).toBeGreaterThanOrEqual(hard.noise);
  expect(easy.blindness).toBeGreaterThan(medium.blindness);
  expect(hard.blindness).toBe(0);
  expect(isDifficulty('hard')).toBe(true);
  expect(isDifficulty('impossible')).toBe(false);
});

it('plays Hard on a budget of positions the same on any machine, and the expert by its own numbers', () => {
  const records = demo.slice(0, 6);
  const slow = { now: () => performance.now() / 100 };
  const fixed = { level: { nodes: 20_000 } };
  const a = chooseMove(records, 'hardFixed', 5, fixed)!;
  const b = chooseMove(records, 'hardFixed', 5, { ...fixed, ...slow })!;
  expect(b).toEqual(a);
  expect(LEVELS.hardFixed).toMatchObject({ ...LEVELS.hard, nodes: 1_800_000 });
  // The expert plays Hard's search on the expert's numbers
  expect(LEVELS.expert).toMatchObject({ ...LEVELS.hardFixed, expert: true });
  const start = Position.start();
  const expert = Position.start(EXPERT_WEIGHTS);
  expect(evaluate(expert)).not.toBe(evaluate(start));
  const choice = chooseMove(records, 'expert', 5, fixed)!;
  expect(isLegal(records, choice.move)).toBe(true);
  expect(choice.nodes).toBeLessThanOrEqual(20_000 + 1024);
}, 30_000);

it('calls a long move across levels, or a knight changing level, hard to see', () => {
  const move = (from: number, to: number, piece: number) => from | (to << 7) | (piece << 21);
  // A knight's jump on its own level, and to the next
  expect(hardToSee(move(cellOf(0, 0, 0), cellOf(1, 2, 0), KNIGHT))).toBe(false);
  expect(hardToSee(move(cellOf(0, 0, 0), cellOf(1, 0, 2), KNIGHT))).toBe(true);
  // A unicorn's short step, and its long line
  expect(hardToSee(move(cellOf(0, 0, 0), cellOf(1, 1, 1), UNICORN))).toBe(false);
  expect(hardToSee(move(cellOf(0, 0, 0), cellOf(3, 3, 3), UNICORN))).toBe(true);
  // A bishop along its own level, however far
  expect(hardToSee(move(cellOf(0, 0, 0), cellOf(4, 4, 0), BISHOP))).toBe(false);
  expect(hardToSee(move(cellOf(0, 0, 0), cellOf(0, 3, 3), QUEEN))).toBe(true);
  // Pawns and kings are always seen
  expect(hardToSee(move(cellOf(0, 0, 0), cellOf(0, 0, 1), PAWN))).toBe(false);
  expect(hardToSee(move(cellOf(0, 0, 0), cellOf(1, 1, 1), KING))).toBe(false);
});

describe('pickMove', () => {
  const moves = [
    { move: 1, score: 100 },
    { move: 2, score: 90 },
    { move: 3, score: -40 },
  ];

  it('picks the best without temperature, or alone in the margin', () => {
    expect(pickMove(moves, 50, 0, 0.99).move).toBe(1);
    expect(pickMove(moves, 5, 20, 0.99).move).toBe(1);
  });

  it('picks the second-best now and then, never what falls outside the margin', () => {
    const random = seeded(9);
    const picked = new Map<number, number>();
    for (let i = 0; i < 2000; i++) {
      const m = pickMove(moves, 50, 10, random()).move;
      picked.set(m, (picked.get(m) ?? 0) + 1);
    }
    expect(picked.get(3)).toBeUndefined();
    // exp(-1): about a quarter of the picks
    expect(picked.get(2)! / 2000).toBeGreaterThan(0.18);
    expect(picked.get(2)! / 2000).toBeLessThan(0.36);
  });

  it('always takes a mate, and never walks into one while there is another move', () => {
    expect(
      pickMove(
        [
          { move: 1, score: 50 },
          { move: 2, score: MATE - 3 },
        ],
        500,
        500,
        0,
      ).move,
    ).toBe(2);
    const pool = [
      { move: 1, score: 0 },
      { move: 2, score: -MATE + 2 },
    ];
    for (const u of [0, 0.5, 0.999]) expect(pickMove(pool, INF_MARGIN, 1e6, u).move).toBe(1);
  });
});

const INF_MARGIN = 1e9;

it('thinks briefly over forced and obvious moves, briskly in the opening, longer when it matters', () => {
  const feel = { forced: false, obvious: false, ply: 20 };
  expect(thinkTime('hard', { ...feel, forced: true }, 0.5)).toBeLessThan(700);
  expect(thinkTime('hard', { ...feel, obvious: true }, 0.5)).toBeLessThan(1000);
  expect(thinkTime('hard', { ...feel, ply: 2 }, 0.5)).toBeLessThan(thinkTime('hard', feel, 0.5));
  expect(thinkTime('easy', feel, 0.5)).toBeLessThan(thinkTime('hard', feel, 0.5));
  for (const d of DIFFICULTIES)
    for (const u of [0, 0.999]) {
      const ms = thinkTime(d, feel, u);
      expect(ms).toBeGreaterThan(400);
      expect(ms).toBeLessThan(3500);
    }
});
