import { Board } from '../engine/board';
import { moveFromMessage } from '../engine/protocol';
import { SHORT_GAME } from '../game/shortGame';
import {
  ANALYSIS_NODES,
  RECHECK_NODES,
  analyseFrom,
  analysePosition,
  assessPosition,
  chooseMove,
  hardToSee,
  hardness,
  pickMove,
  recheckPosition,
  sacrifice,
  seeded,
  stylise,
  tension,
} from './choose';
import { DIFFICULTIES, ENGINE, LEVELS, isDifficulty, thinkTime } from './levels';
import { evaluate } from './evaluate';
import { NUMBERS } from './numbers';
import {
  BISHOP,
  BLACK,
  BLACK_SIDE,
  CZ,
  EXPERT_WEIGHTS,
  KING,
  KNIGHT,
  PAWN,
  Position,
  QUEEN,
  UNICORN,
  cellOf,
  moveFrom,
  movePiece,
  moveTo,
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
    expect(analysePosition(demo.slice(0, -1), { maxNodes: 4000 })).toMatchObject({
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

  it('searches a position again as deep as it is asked', () => {
    const lost = [...demo.slice(0, -1), { from: 'Cd2', to: 'Cc4' }];
    // The same search, but for how hard the move that led here was to see
    expect(recheckPosition(lost, 3, { maxNodes: 20000 })).toEqual({
      ...analysePosition(lost, { maxNodes: 20000 }),
      played: undefined,
    });
    expect(recheckPosition(demo, 3).best).toBeNull();
  });

  it('finds deeper a mate the review’s usual search runs out of positions before', () => {
    // A game's 65th move: White's queen on Ee5 and king on Cc4 mate in 4
    // whatever Black's king on Ad2 does, but the mate lies past what
    // ANALYSIS_NODES reaches (a move on, Ad2-Bd2, it is seen)
    const position = () => {
      const pos = new Position();
      pos.board[cellOf(4, 4, 4)] = QUEEN;
      pos.board[cellOf(2, 3, 2)] = KING;
      pos.board[cellOf(3, 1, 0)] = KING | BLACK;
      pos.reset(BLACK_SIDE);
      return pos;
    };
    const usual = analyseFrom(position(), { maxDepth: 40, timeMs: 1e6, maxNodes: ANALYSIS_NODES });
    expect(usual.mate).toBeUndefined();
    const again = analyseFrom(position(), { maxDepth: 9, timeMs: 1e6, maxNodes: RECHECK_NODES });
    expect(again.mate).toBe(-8);
  }, 20_000);

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

it('the levels grow stronger: knowing more, seeing more, steadier', () => {
  const [easy, medium, hard] = DIFFICULTIES.map((d) => LEVELS[d]);
  expect([easy.knows, medium.knows, hard.knows]).toEqual(['beginner', 'advanced', 'expert']);
  expect(easy.maxDepth).toBeLessThan(medium.maxDepth);
  // Hard on a budget of positions, the same on any device
  expect(hard.nodes).toBeGreaterThan(0);
  // Easy overlooks what Medium sees, and Medium what Hard sees
  expect(easy.sight!.miss).toBeGreaterThanOrEqual(medium.sight!.miss * 0.9);
  expect(medium.sight!.ease).toBeLessThan(hard.sight!.ease);
  expect(easy.sight!.ease).toBeLessThan(hard.sight!.ease);
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
  expect(LEVELS.hardFixed).toMatchObject({ ...ENGINE, nodes: 1_800_000 });
  // The expert plays Hard's search on the expert's numbers
  expect(LEVELS.expert).toMatchObject({ ...LEVELS.hardFixed, knows: 'expert' });
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

describe('how hard a move is to see', () => {
  /** The position after `records` and `next`, the move, and the move before it. */
  const play = (records: WireMove[], next: WireMove) => {
    const pos = Position.fromRecords(records);
    const prev = records.length
      ? Position.fromRecords(records.slice(0, -1)).findMove(records[records.length - 1])
      : 0;
    const move = pos.findMove(next);
    pos.make(move);
    return { pos, move, prev };
  };

  it('sees a pawn’s move or a short one on its own level at once, a knight changing level less', () => {
    const pos = Position.start();
    const moves = new Int32Array(512);
    const n = pos.generate(moves, 0);
    let knights = 0;
    for (let i = 0; i < n; i++) {
      const m = moves[i];
      if (pos.make(m)) {
        const h = hardness(pos, m, 0);
        const type = movePiece(m) & 7;
        const across = CZ[moveFrom(m)] !== CZ[moveTo(m)];
        if (type === PAWN) expect(h).toBe(0);
        if (type === KNIGHT && !across) expect(h).toBeLessThan(0.1);
        if (type === KNIGHT && across) {
          expect(h).toBeGreaterThanOrEqual(0.5);
          knights++;
        }
      }
      pos.unmake(m);
    }
    expect(knights).toBeGreaterThan(0);
  });

  it('always sees taking the piece that just moved', () => {
    // Black's queen takes back on Dd5
    const { pos, move, prev } = play(demo.slice(0, 5), demo[5]);
    expect(hardness(pos, move, prev)).toBe(0);
  });

  it('finds a sacrifice across levels hard to see', () => {
    // White's queen goes to Cc4, where Black's pawn takes it
    const { pos, move, prev } = play(demo.slice(0, 2), demo[2]);
    expect(sacrifice(pos, move)).toBe(true);
    expect(hardness(pos, move, prev)).toBeGreaterThan(0.8);
    // Black's rook, defended, takes back nothing at risk
    const rook = play(demo.slice(0, 6), demo[6]);
    expect(sacrifice(rook.pos, rook.move)).toBe(false);
  });

  it('calls a fight more tense than the start', () => {
    const start = tension(Position.start());
    expect(start).toBeGreaterThanOrEqual(0.4);
    expect(tension(Position.fromRecords(demo.slice(0, 5)))).toBeGreaterThan(start);
    expect(tension(Position.fromRecords(demo.slice(0, 5)))).toBeLessThanOrEqual(1.4);
  });
});

it('plays in a style of its own each game, the same all game', () => {
  const n = NUMBERS.advanced;
  expect(stylise(n, 0, 7)).toEqual({ ...n, pawnMg: [...n.pawnMg], pawnEg: [...n.pawnEg] });
  expect(stylise(n, 0.3, 7)).toEqual(stylise(n, 0.3, 7));
  expect(stylise(n, 0.3, 7)).not.toEqual(stylise(n, 0.3, 8));
  const styled = stylise(n, 0.3, 7);
  expect(styled.knight.mgCentre / n.knight.mgCentre).toBeGreaterThanOrEqual(0.7);
  expect(styled.knight.mgCentre / n.knight.mgCentre).toBeLessThanOrEqual(1.3);
  // A game's moves come from its own style
  const records = demo.slice(0, 4);
  const level = { style: 0.3, knows: 'advanced' as const };
  const a = chooseMove(records, 'medium', 3, { ...quick, level, game: 11 })!;
  const b = chooseMove(records, 'medium', 3, { ...quick, level, game: 11 })!;
  expect(b).toEqual(a);
});

it('overlooks the harder moves of a piece, the same all through a move', () => {
  const records = demo.slice(0, 4);
  const level = (ease: number) => ({
    maxDepth: 2,
    timeMs: 1e9,
    nodes: undefined,
    sight: { ease, miss: 1 },
  });
  const blind = chooseMove(records, 'hard', 9, { game: 5, level: level(0) })!;
  expect(chooseMove(records, 'hard', 9, { game: 5, level: level(0) })).toEqual(blind);
  expect(isLegal(records, blind.move)).toBe(true);
  // Moves overlooked are not searched: seeing everything, it looks at more
  const seeing = chooseMove(records, 'hard', 9, { game: 5, level: level(5) })!;
  expect(blind.nodes).toBeLessThan(seeing.nodes);
});
