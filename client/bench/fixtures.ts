// Deterministic workloads for the client benchmarks: games played by seeded
// policies, positions built to stress one part of the rules engine, and the
// socket message logs the game screen derives its state from. Nothing here is
// random at run time: every fixture comes from a fixed seed, so two runs (and
// two machines) time the same work, and describeFixture() records what that
// work is (pieces, moves, check) next to the numbers.

import { Board, PieceType } from '../src/engine';
import type { Coord, Move, Piece } from '../src/engine';
import { toZXY } from '../src/engine/coords';
import { moveToMessage } from '../src/engine/protocol';
import type { GameState, MoveMade, MoveRecord, WebSocketMessage } from '../src/types/messages';

export type Side = 'white' | 'black';
export const other = (side: Side): Side => (side === 'white' ? 'black' : 'white');

/** Small, fast, seedable PRNG (mulberry32). */
export const seeded = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const VALUE: Record<PieceType, number> = {
  [PieceType.King]: 0,
  [PieceType.Queen]: 9,
  [PieceType.Rook]: 5,
  [PieceType.Bishop]: 3,
  [PieceType.Unicorn]: 3,
  [PieceType.Knight]: 3,
  [PieceType.Pawn]: 1,
};

export interface PlayedGame {
  name: string;
  records: MoveRecord[];
  /** positions[i] is the board after i moves. */
  positions: Board[];
  result: 'checkmate' | 'stalemate' | null;
}

const keyOf = (move: Move) => `${toZXY(move.from)}${toZXY(move.to)}${move.promotion ?? ''}`;

const record = (move: Move, by: Side): MoveRecord => {
  const { from, to, promotion } = moveToMessage(move);
  return promotion ? { by, from, to, promotion } : { by, from, to };
};

/**
 * A game between two copies of a policy, from the starting position, until
 * mate, stalemate or `maxPlies`.
 *
 * - `tactical`: plays mate in one when it sees it, takes the most valuable
 *   piece it can, promotes, avoids leaving the moved piece where it can be
 *   taken, likes to give check, otherwise moves at random: a game between
 *   two eager beginners, with captures, checks, promotions and a mate.
 * - `random`: any legal move, uniformly: aimless play, which trades most of
 *   the pieces off within a couple of hundred plies.
 */
export function playGame(
  policy: 'tactical' | 'random',
  seed: number,
  maxPlies: number,
): PlayedGame {
  const rand = seeded(seed);
  const positions = [Board.setupStartingPosition()];
  const records: MoveRecord[] = [];
  let side: Side = 'white';
  let result: PlayedGame['result'] = null;
  for (let ply = 0; ply < maxPlies; ply++) {
    const board = positions[positions.length - 1];
    // In a fixed order of their own, so the game depends only on which moves
    // are legal, never on the order the engine lists them in: an optimisation
    // that reorders move generation must not change the workload it is timed on
    const moves = board
      .generateAllLegalMoves(side)
      .sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
    if (moves.length === 0) {
      result = board.inCheck(side) ? 'checkmate' : 'stalemate';
      break;
    }
    let chosen = moves[Math.floor(rand() * moves.length)];
    if (policy === 'tactical') {
      let best = -Infinity;
      for (const move of moves) {
        const taken = board.getPiece(move.to);
        const mover = board.getPiece(move.from)!;
        const next = board.applyMove(move);
        let score = (taken ? VALUE[taken.type] * 10 : 0) + rand() * 3;
        if (move.promotion) score += VALUE[move.promotion] * 10;
        // Leaves the piece where the opponent can take it
        if (next.isSquareAttacked(move.to, other(side))) score -= VALUE[mover.type] * 8;
        if (next.inCheck(other(side))) {
          score += 4;
          if (next.generateAllLegalMoves(other(side)).length === 0) score += 1000;
        }
        if (score > best) [best, chosen] = [score, move];
      }
    }
    records.push(record(chosen, side));
    positions.push(board.applyMove(chosen));
    side = other(side);
  }
  if (result === null) {
    const board = positions[positions.length - 1];
    if (board.generateAllLegalMoves(side).length === 0) {
      result = board.inCheck(side) ? 'checkmate' : 'stalemate';
    }
  }
  return { name: `${policy} #${seed}`, records, positions, result };
}

/**
 * The endless game: both sides shuffle a knight out and back (Ab1-Aa3,
 * Ed5-Ee3, Aa3-Ab1, Ee3-Ed5, ...). The rules have no repetition or
 * fifty-move draw, so this is a legal game of any length: the adversarial
 * case for anything that replays the whole record.
 */
export function shuffleRecords(plies: number): MoveRecord[] {
  const cycle: MoveRecord[] = [
    { by: 'white', from: 'Ab1', to: 'Aa3' },
    { by: 'black', from: 'Ed5', to: 'Ee3' },
    { by: 'white', from: 'Aa3', to: 'Ab1' },
    { by: 'black', from: 'Ee3', to: 'Ed5' },
  ];
  return Array.from({ length: plies }, (_, i) => ({ ...cycle[i % 4] }));
}

// --- Positions built to stress the engine -----------------------------------

const piece = (type: PieceType, color: Side): Piece => ({ type, color });
const c = (x: number, y: number, z: number): Coord => ({ x, y, z });

const DIRECTIONS: Coord[] = [];
for (let dx = -1; dx <= 1; dx++)
  for (let dy = -1; dy <= 1; dy++)
    for (let dz = -1; dz <= 1; dz++) if (dx || dy || dz) DIRECTIONS.push(c(dx, dy, dz));

/**
 * White's king in the centre, a white piece on each of its 26 neighbours and
 * a black slider two steps out along every line, so every white piece is
 * pinned; one line is left open, so the king is in check. Every one of
 * White's many pseudo-legal moves must be tried and refuted: the most work
 * the legality filter can be given. (It is mate.)
 */
export function pinFortress(): Board {
  const board = new Board();
  const king = c(2, 2, 2);
  board.setPiece(king, piece(PieceType.King, 'white'));
  const blockers = [PieceType.Knight, PieceType.Bishop, PieceType.Rook, PieceType.Unicorn];
  DIRECTIONS.forEach((d, i) => {
    const axes = Math.abs(d.x) + Math.abs(d.y) + Math.abs(d.z);
    const pinner = axes === 1 ? PieceType.Rook : axes === 2 ? PieceType.Bishop : PieceType.Unicorn;
    const far = c(king.x + 2 * d.x, king.y + 2 * d.y, king.z + 2 * d.z);
    board.setPiece(far, piece(pinner, 'black'));
    // The line straight ahead (+rank) is left open: the check
    if (d.x === 0 && d.y === 1 && d.z === 0) return;
    const near = c(king.x + d.x, king.y + d.y, king.z + d.z);
    board.setPiece(near, piece(blockers[i % blockers.length], 'white'));
  });
  board.setPiece(c(4, 0, 1), piece(PieceType.King, 'black'));
  return board;
}

/**
 * Both sides after a run of promotions: a king, six queens and two unicorns
 * each, scattered (seeded) over an otherwise empty board with neither king
 * in check. The most pseudo-legal moves per side, each checked against as
 * many enemy sliders.
 */
export function queenStorm(seed = 7): Board {
  const rand = seeded(seed);
  for (;;) {
    const board = new Board();
    const free = (): Coord => {
      for (;;) {
        const at = c(Math.floor(rand() * 5), Math.floor(rand() * 5), Math.floor(rand() * 5));
        if (!board.getPiece(at)) return at;
      }
    };
    for (const color of ['white', 'black'] as const) {
      board.setPiece(free(), piece(PieceType.King, color));
      for (let i = 0; i < 6; i++) board.setPiece(free(), piece(PieceType.Queen, color));
      for (let i = 0; i < 2; i++) board.setPiece(free(), piece(PieceType.Unicorn, color));
    }
    if (!board.inCheck('white') && !board.inCheck('black')) return board;
  }
}

/**
 * White pawns one step from promotion on both approaches (rank 5 of level D
 * and rank 4 of level E), with black rooks on three of the five promotion
 * squares: every pawn move and capture fans out into five promotion choices.
 */
export function promotionRush(): Board {
  const board = new Board();
  for (let x = 0; x < 5; x++) {
    board.setPiece(c(x, 4, 3), piece(PieceType.Pawn, 'white'));
    board.setPiece(c(x, 3, 4), piece(PieceType.Pawn, 'white'));
  }
  for (const x of [0, 2, 4]) board.setPiece(c(x, 4, 4), piece(PieceType.Rook, 'black'));
  board.setPiece(c(0, 0, 0), piece(PieceType.King, 'white'));
  board.setPiece(c(4, 0, 0), piece(PieceType.King, 'black'));
  return board;
}

/**
 * 100 of the 125 cells filled (seeded) with a mix of both armies, neither
 * king in check: rays stop after a step or two, but check detection has
 * the most enemy pieces to ask.
 */
export function crowded(seed = 11): Board {
  const rand = seeded(seed);
  const kinds = [
    PieceType.Pawn,
    PieceType.Pawn,
    PieceType.Pawn,
    PieceType.Knight,
    PieceType.Bishop,
    PieceType.Unicorn,
    PieceType.Rook,
    PieceType.Queen,
  ];
  for (;;) {
    const board = new Board();
    const cells = Array.from({ length: 125 }, (_, i) =>
      c(i % 5, Math.floor(i / 5) % 5, Math.floor(i / 25)),
    );
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    board.setPiece(cells[0], piece(PieceType.King, 'white'));
    board.setPiece(cells[1], piece(PieceType.King, 'black'));
    for (let i = 2; i < 100; i++) {
      board.setPiece(
        cells[i],
        piece(kinds[Math.floor(rand() * kinds.length)], i % 2 ? 'white' : 'black'),
      );
    }
    if (!board.inCheck('white') && !board.inCheck('black')) return board;
  }
}

/**
 * Black's lone king stalemated in the far corner (Ee5) by White's queen on
 * Ce4 and king on Ec5 (found by searching every queen placement).
 */
export function cornerStalemate(): Board {
  const board = new Board();
  board.setPiece(c(4, 4, 4), piece(PieceType.King, 'black'));
  board.setPiece(c(4, 3, 2), piece(PieceType.Queen, 'white'));
  board.setPiece(c(2, 4, 4), piece(PieceType.King, 'white'));
  return board;
}

// --- Message logs ------------------------------------------------------------

export const moveMade = (r: MoveRecord): MoveMade => ({ type: 'move_made', ...r });

/** What the creator's socket holds after a game played live without a reconnect. */
export function liveLog(records: MoveRecord[]): WebSocketMessage[] {
  return [
    { type: 'game_created', gameId: 'BENCH1', color: 'white' },
    { type: 'game_start', color: 'white' },
    { type: 'presence', color: 'black', online: true },
    ...records.map(moveMade),
  ];
}

/** What a reloaded page holds: the rejoin's snapshot of the whole record. */
export function rejoinLog(records: MoveRecord[]): WebSocketMessage[] {
  const state: GameState = { type: 'game_state', color: 'white', started: true, moves: records };
  return [state, { type: 'presence', color: 'black', online: true }];
}

/**
 * A game played over a bad connection: a reconnect (a fresh snapshot of the
 * record so far) every `every` moves, each followed by presence traffic.
 */
export function reconnectingLog(records: MoveRecord[], every: number): WebSocketMessage[] {
  const log: WebSocketMessage[] = [
    { type: 'game_created', gameId: 'BENCH1', color: 'white' },
    { type: 'game_start', color: 'white' },
  ];
  records.forEach((r, i) => {
    if (i > 0 && i % every === 0) {
      log.push({ type: 'game_state', color: 'white', started: true, moves: records.slice(0, i) });
      log.push({ type: 'presence', color: 'black', online: true });
    }
    log.push(moveMade(r));
  });
  return log;
}

/**
 * A live game against an opponent on a flaky phone: `flaps` offline/online
 * presence pairs spread through the game (no reconnect of our own, so no
 * snapshot to stop the scan early), and a server error now and then.
 */
export function flappingLog(records: MoveRecord[], flaps: number): WebSocketMessage[] {
  const log = liveLog([]);
  const perMove = Math.ceil(flaps / Math.max(records.length, 1));
  let left = flaps;
  records.forEach((r, i) => {
    log.push(moveMade(r));
    for (let k = 0; k < perMove && left > 0; k++, left--) {
      log.push({ type: 'presence', color: 'black', online: false });
      log.push({ type: 'presence', color: 'black', online: true });
    }
    if (i % 50 === 25) log.push({ type: 'error', code: 'wrong_turn', message: 'Not your turn' });
  });
  return log;
}

// --- Descriptions ---------------------------------------------------------------

export interface FixtureDescription {
  fixture: string;
  pieces: number;
  sideToMove: Side;
  pseudoLegal: number;
  legal: number;
  inCheck: boolean;
  outcome: string;
}

/** What a position asks of the engine for `side` to move. */
export function describeFixture(fixture: string, board: Board, side: Side): FixtureDescription {
  let pieces = 0;
  let pseudoLegal = 0;
  for (let z = 0; z < 5; z++)
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++) {
        const p = board.getPiece(c(x, y, z));
        if (!p) continue;
        pieces++;
        if (p.color === side) pseudoLegal += board.generatePotentialMoves(c(x, y, z)).length;
      }
  const legal = board.generateAllLegalMoves(side).length;
  const inCheck = board.inCheck(side);
  const outcome = legal > 0 ? 'in play' : inCheck ? 'checkmate' : 'stalemate';
  return { fixture, pieces, sideToMove: side, pseudoLegal, legal, inCheck, outcome };
}

/** The first square holding `side`'s piece of `type`, as a coordinate. */
export function find(board: Board, side: Side, type: PieceType): Coord {
  for (let z = 0; z < 5; z++)
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++) {
        const p = board.getPiece(c(x, y, z));
        if (p && p.color === side && p.type === type) return c(x, y, z);
      }
  throw new Error(`no ${side} ${type}`);
}

/** The piece of `side` with the most legal moves (what a player clicks when the board is busiest). */
export function busiestPiece(board: Board, side: Side): { at: Coord; name: string; moves: number } {
  let best = { at: c(0, 0, 0), name: '', moves: -1 };
  for (let z = 0; z < 5; z++)
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++) {
        const p = board.getPiece(c(x, y, z));
        if (!p || p.color !== side) continue;
        const moves = board.generateLegalMoves(c(x, y, z)).length;
        if (moves > best.moves)
          best = { at: c(x, y, z), name: `${p.type} ${toZXY(c(x, y, z))}`, moves };
      }
  return best;
}

/** Is this run a quick smoke run (fewer samples)? */
export const QUICK = process.env.BENCH_QUICK === '1';

/**
 * How long each case samples, by what one call costs. Sized so the medians
 * are stable on a noisy VM while the whole client tier stays quick enough to
 * rerun on every change: a microsecond case gets thousands of samples in
 * 300 ms, a 5 ms one about 60, and nothing gets fewer than its minimum.
 * BENCH_QUICK=1 takes a handful of samples of everything: a check that the
 * suite runs, too few to compare.
 */
/**
 * A full collection before each case, when Node was started with
 * --expose-gc (vitest.bench.config.ts): every case then starts from the same
 * clean heap, whatever the cases before it allocated. Without it the
 * allocation-heavy cases (a replay clones a board per move) swing by tens of
 * percent between otherwise identical runs, with the garbage collector's state.
 */
const setup = () => (globalThis as { gc?: () => void }).gc?.();

/**
 * bench/run.mjs runs the client benches in several rounds (inRounds) and
 * reports each case's median over them; each round samples its share of the
 * time budget, so the total stays the same.
 */
export const ROUNDS = Math.max(1, Number(process.env.BENCH_ROUNDS) || 1);

/**
 * Registers a file's cases once per round: all of them, then all of them
 * again, so each case's rounds are the length of a pass apart, and a hiccup
 * of the machine spoils one round. bench/run.mjs merges the rounds.
 */
export const inRounds = (register: (sample: typeof SAMPLE) => void) => {
  for (let round = 0; round < ROUNDS; round++) register(round === 0 ? SAMPLE : WARM);
};
const share = <T extends { time: number; iterations: number }>(o: T): T => ({
  ...o,
  time: Math.round(o.time / ROUNDS),
  iterations: Math.max(1, Math.round(o.iterations / ROUNDS)),
});

const BUDGET = QUICK
  ? {
      normal: { time: 40, iterations: 3, warmupTime: 10, warmupIterations: 1, setup },
      heavy: { time: 0, iterations: 2, warmupTime: 0, warmupIterations: 1, setup },
      heaviest: { time: 0, iterations: 1, warmupTime: 0, warmupIterations: 0, setup },
    }
  : {
      // under ~20 ms a call
      normal: { time: 300, iterations: 20, warmupTime: 50, warmupIterations: 5, setup },
      // ~20-400 ms a call
      heavy: { time: 800, iterations: 6, warmupTime: 0, warmupIterations: 1, setup },
      // around a second a call
      heaviest: { time: 0, iterations: 3, warmupTime: 0, warmupIterations: 1, setup },
    };

export const SAMPLE = {
  normal: share(BUDGET.normal),
  heavy: share(BUDGET.heavy),
  heaviest: share(BUDGET.heaviest),
};

/** Later rounds run in the same, already compiled process: one call settles a case. */
const warm = <T extends object>(o: T) => ({ ...o, warmupTime: 0, warmupIterations: 1 });
const WARM = {
  normal: warm(SAMPLE.normal),
  heavy: warm(SAMPLE.heavy),
  heaviest: warm(SAMPLE.heaviest),
};

// --- The catalogue the engine benches run over -----------------------------------

export interface Position {
  name: string;
  /** Where it comes from and why it is here. */
  about: string;
  board: Board;
  side: Side;
}

let games: { decisive: PlayedGame; casual: PlayedGame } | null = null;

/** FNV-1a over a game's records: changes if any move of the game does. */
export const fingerprint = (records: MoveRecord[]) => {
  let h = 0x811c9dc5;
  for (const ch of records.map((r) => `${r.from}${r.to}${r.promotion ?? ''}`).join(',')) {
    h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
};

/**
 * What the seeded games must come out as. The policies only see which moves
 * are legal, so these hold however the engine is optimised; if they change,
 * the engine's rules did (or a fixture was changed on purpose: update them).
 */
export const EXPECTED = {
  decisive: { plies: 98, result: 'checkmate', fingerprint: '911fac19' },
  casual: { plies: 200, result: null, fingerprint: 'd7e796d5' },
  perft: { opening1: 61, opening2: 3615, middlegame2: 4952 },
} as const;

/** Throws, naming what differs, unless `actual` matches the expected value. */
export function expectSame(what: string, actual: unknown, expected: unknown) {
  if (actual === expected) return;
  throw new Error(
    `Benchmark fixture check failed: ${what} is ${String(actual)}, expected ${String(expected)}. ` +
      'The rules engine now plays the seeded games differently, so these benchmarks would time ' +
      'different work than before. If you changed the engine, its rules changed: run `npm run ' +
      'test`. If you changed a fixture on purpose, update EXPECTED in client/bench/fixtures.ts.',
  );
}

/**
 * The two played games the benches share: `decisive`, a 98-ply tactical game
 * that ends in mate (23 captures), and `casual`, 200 plies of random moves
 * (three promotions). Both are checked against EXPECTED.
 */
export function sharedGames() {
  if (games) return games;
  games = { decisive: playGame('tactical', 2, 400), casual: playGame('random', 1, 200) };
  for (const key of ['decisive', 'casual'] as const) {
    const game = games[key];
    const want = EXPECTED[key];
    expectSame(`the ${key} game's length`, game.records.length, want.plies);
    expectSame(`the ${key} game's result`, game.result, want.result);
    expectSame(`the ${key} game's fingerprint`, fingerprint(game.records), want.fingerprint);
  }
  return games;
}

export function positions(): Position[] {
  const { decisive, casual } = sharedGames();
  return [
    {
      name: 'opening',
      about: 'The starting position (every game begins here).',
      board: Board.setupStartingPosition(),
      side: 'white',
    },
    {
      name: 'middlegame',
      about: 'Ply 40 of the decisive game.',
      board: decisive.positions[40],
      side: 'white',
    },
    {
      name: 'late middlegame',
      about: 'Ply 90 of the decisive game: White in check.',
      board: decisive.positions[90],
      side: 'white',
    },
    {
      name: 'endgame',
      about: 'Ply 200 of the casual (random-move) game.',
      board: casual.positions[200],
      side: 'white',
    },
    {
      name: 'checkmate',
      about: 'The final position of the decisive game: White is mated.',
      board: decisive.positions[decisive.positions.length - 1],
      side: 'white',
    },
    {
      name: 'stalemate',
      about: "Synthetic: Black's lone king stalemated in the corner.",
      board: cornerStalemate(),
      side: 'black',
    },
    {
      name: 'pin fortress ⚠',
      about: 'Adversarial: 25 pinned pieces round a checked king; every move refuted (mate).',
      board: pinFortress(),
      side: 'white',
    },
    {
      name: 'queen storm ⚠',
      about: 'Adversarial: six queens and two unicorns a side on an open board.',
      board: queenStorm(),
      side: 'white',
    },
    {
      name: 'promotion rush ⚠',
      about: 'Adversarial: ten pawns one step from promotion; each move fans out five ways.',
      board: promotionRush(),
      side: 'white',
    },
    {
      name: 'crowded ⚠',
      about: 'Adversarial: 100 of 125 cells filled.',
      board: crowded(),
      side: 'white',
    },
  ];
}

/** The fixture table for a list of positions. */
export function positionTable(list: Position[]) {
  return {
    title: 'Positions',
    intro:
      'Each engine case runs over these positions. Pseudo-legal moves are what the move generator ' +
      'produces before the legality filter, each of which is played out and checked for check.',
    columns: ['Position', 'Pieces', 'To move', 'Pseudo-legal', 'Legal', 'In check', 'Source'],
    align: ['l', 'r', 'l', 'r', 'r', 'l', 'l'] as ('l' | 'r')[],
    rows: list.map((p) => {
      const d = describeFixture(p.name, p.board, p.side);
      return [
        p.name,
        String(d.pieces),
        p.side,
        String(d.pseudoLegal),
        String(d.legal),
        d.inCheck ? 'yes' : 'no',
        p.about,
      ];
    }),
  };
}
