import { kpkWins } from './kpk';
import {
  BLACK,
  BLACK_SIDE,
  CELLS,
  KING,
  PAWN,
  Position,
  QUEEN,
  WEIGHTS,
  WHITE_SIDE,
  cellOf,
  movePromotion,
  moveTo,
} from './position';
import { Searcher } from './search';

const sq = (s: string) => cellOf('abcde'.indexOf(s[1]), Number(s[2]) - 1, 'ABCDE'.indexOf(s[0]));
const turn = (c: number) => CELLS - 1 - c;

const setup = (pieces: [string, number][], side: number) => {
  const pos = new Position(WEIGHTS.expert);
  for (const [s, p] of pieces) pos.board[sq(s)] = p;
  pos.reset(side);
  return pos;
};

/**
 * The same ending solved the slow way, with the engine's own moves: every
 * position reachable from White's king on `wk`, its pawn on `p` and Black's
 * king on `bk` (White to move), then backwards until nothing changes. A pawn
 * that promotes becomes a queen, which wins unless Black takes it or is
 * stalemated (as kpk.ts takes it).
 */
function reference(wk: number, p: number, bk: number) {
  type State = { wk: number; bk: number; p: number; black: boolean };
  const key = (s: State) => `${s.wk},${s.bk},${s.p},${s.black}`;
  const pos = new Position(WEIGHTS.expert);
  const buf = new Int32Array(256);
  // Black's replies to a promotion, apart from the moves still being walked
  const replies = new Int32Array(256);
  const nodes = new Map<string, { s: State; next: (string | boolean)[]; end: boolean | null }>();
  const todo: State[] = [{ wk, bk, p, black: false }];
  const load = (s: State) => {
    pos.board.fill(0);
    pos.board[s.wk] = KING;
    pos.board[s.bk] = KING | BLACK;
    pos.board[s.p] = PAWN;
    pos.reset(s.black ? BLACK_SIDE : WHITE_SIDE);
  };
  const afterPromotion = () => {
    const n = pos.generate(replies, 0);
    let legal = 0;
    let takes = false;
    const q = pos.board.indexOf(QUEEN);
    for (let i = 0; i < n; i++) {
      if (pos.make(replies[i])) {
        legal++;
        if (moveTo(replies[i]) === q) takes = true;
      }
      pos.unmake(replies[i]);
    }
    return legal === 0 ? pos.inCheck() : !takes;
  };
  while (todo.length) {
    const s = todo.pop()!;
    if (nodes.has(key(s))) continue;
    load(s);
    const node = { s, next: [] as (string | boolean)[], end: null as boolean | null };
    nodes.set(key(s), node);
    const n = pos.generate(buf, 0);
    let legal = 0;
    for (let i = 0; i < n; i++) {
      const m = buf[i];
      if (pos.make(m)) {
        legal++;
        const promo = movePromotion(m);
        if (promo === QUEEN) node.next.push(afterPromotion());
        else if (!promo) {
          const pawn = pos.board.indexOf(PAWN);
          if (pawn < 0) node.next.push(false);
          else {
            const t = {
              wk: pos.board.indexOf(KING),
              bk: pos.board.indexOf(KING | BLACK),
              p: pawn,
              black: !s.black,
            };
            node.next.push(key(t));
            todo.push(t);
          }
        }
      }
      pos.unmake(m);
    }
    if (legal === 0) node.end = s.black && pos.inCheck();
  }
  const win = new Map<string, boolean>();
  for (let changed = true; changed;) {
    changed = false;
    for (const [k, node] of nodes) {
      if (win.get(k)) continue;
      const wins = node.next.map((t) => (typeof t === 'boolean' ? t : !!win.get(t)));
      const w =
        node.end !== null
          ? node.end
          : node.s.black
            ? wins.length > 0 && wins.every(Boolean)
            : wins.some(Boolean);
      if (w) {
        win.set(k, true);
        changed = true;
      }
    }
  }
  return [...nodes.values()].map(({ s }) => ({ ...s, win: !!win.get(key(s)) }));
}

it('solves king and pawn against king as the engine’s own moves do, for either side’s pawn', () => {
  // A game's review marked 95. De5 a blunder here, as a pawn up: it draws
  const states = reference(sq('Cd4'), sq('De4'), sq('Ee4'));
  expect(states.length).toBeGreaterThan(50_000);
  let wins = 0;
  for (const s of states) {
    expect(kpkWins(s.p, WHITE_SIDE, s.wk, s.bk, !s.black)).toBe(s.win);
    // Black's pawn: the same position turned through the centre of the cube
    expect(kpkWins(turn(s.p), BLACK_SIDE, turn(s.wk), turn(s.bk), !s.black)).toBe(s.win);
    if (s.win) wins++;
  }
  // Both answers come up, many times
  expect(wins).toBeGreaterThan(10_000);
  expect(states.length - wins).toBeGreaterThan(5_000);
}, 60_000);

it('calls the reported position a draw, and a win with the defending king elsewhere', () => {
  expect(kpkWins(sq('De4'), WHITE_SIDE, sq('Cd4'), sq('Ee4'), true)).toBe(false);
  expect(kpkWins(sq('De4'), WHITE_SIDE, sq('Cd4'), sq('Aa1'), true)).toBe(true);
  expect(kpkWins(sq('De4'), WHITE_SIDE, sq('Cd4'), sq('Ee3'), true)).toBe(true);
});

it('finds the lone pawn only in king and pawn against king', () => {
  expect(Position.start().lonePawn()).toBe(-1);
  expect(
    setup(
      [
        ['Cd4', KING],
        ['De4', PAWN],
        ['Ee4', KING | BLACK],
      ],
      WHITE_SIDE,
    ).lonePawn(),
  ).toBe(sq('De4'));
  expect(
    setup(
      [
        ['Cd4', KING],
        ['Bb2', PAWN | BLACK],
        ['Ee4', KING | BLACK],
      ],
      WHITE_SIDE,
    ).lonePawn(),
  ).toBe(sq('Bb2'));
  // A pawn each, or a piece besides: not this ending
  expect(
    setup(
      [
        ['Cd4', KING],
        ['De4', PAWN],
        ['Bb2', PAWN | BLACK],
        ['Ee4', KING | BLACK],
      ],
      WHITE_SIDE,
    ).lonePawn(),
  ).toBe(-1);
  expect(
    setup(
      [
        ['Cd4', KING],
        ['De4', PAWN],
        ['Aa1', QUEEN],
        ['Ee4', KING | BLACK],
      ],
      WHITE_SIDE,
    ).lonePawn(),
  ).toBe(-1);
});

it('scores a drawn ending a draw with `endgames`, and a won one as a win', () => {
  const limits = { maxDepth: 40, timeMs: 1e9, maxNodes: 60_000, margin: 0, quiescence: 64 };
  const drawn = () =>
    setup(
      [
        ['Cd4', KING],
        ['De4', PAWN],
        ['Ee4', KING | BLACK],
      ],
      WHITE_SIDE,
    );
  // Without it, the search sees a pawn up however deep it looks
  expect(new Searcher(drawn()).search(limits).score).toBeGreaterThan(200);
  expect(new Searcher(drawn()).search({ ...limits, endgames: true }).score).toBe(0);
  // Black's pawn, Black to move: the same
  const turned = setup(
    [
      [turn(sq('Cd4')), KING | BLACK],
      [turn(sq('De4')), PAWN | BLACK],
      [turn(sq('Ee4')), KING],
    ].map(([c, p]) => [nameOf(c as number), p as number] as [string, number]),
    BLACK_SIDE,
  );
  expect(new Searcher(turned).search({ ...limits, endgames: true }).score).toBe(0);
  const won = setup(
    [
      ['Cd4', KING],
      ['De4', PAWN],
      ['Aa1', KING | BLACK],
    ],
    WHITE_SIDE,
  );
  expect(new Searcher(won).search({ ...limits, endgames: true }).score).toBeGreaterThan(700);
});

function nameOf(c: number): string {
  const z = Math.floor(c / 25);
  const x = Math.floor((c % 25) / 5);
  const y = c % 5;
  return 'ABCDE'[z] + 'abcde'[x] + (y + 1);
}
