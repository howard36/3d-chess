import { Board } from '../engine/board';
import { moveFromMessage } from '../engine/protocol';
import { DEMO_GAME } from '../game/demo';
import { chooseMove, hardToSee, pickMove, seeded } from './choose';
import { DIFFICULTIES, LEVELS, isDifficulty, thinkTime } from './levels';
import { BISHOP, KING, KNIGHT, PAWN, QUEEN, UNICORN, cellOf } from './position';
import type { WireMove } from './position';
import { MATE } from './search';

const demo: WireMove[] = DEMO_GAME.map((m) => {
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
