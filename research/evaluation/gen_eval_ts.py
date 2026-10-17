"""Write client/src/ai/evaluate.ts from a numbers file (58 numbers, 6 values, 6 extension terms),
rounded as the game will hold them, and the same rounded numbers as an @file for the C engine, so
the two can be checked node for node.

usage: gen_eval_ts.py numbers.txt out_evaluate.ts out_numbers.txt"""
import sys
from evalnums import order_values

n = [float(v) for v in open(sys.argv[1]).read().split()]
th, x = n[:58], (n[64:70] if len(n) >= 70 else [0.0] * 6)

def r1(v):   # one decimal
    v = round(v, 1)
    return 0.0 if v == 0 else v
th = [r1(v) for v in th]
for i in range(47, 58): th[i] = float(round(th[i]))   # the engine rounds these to whole numbers
for i in (0, 8, 9, 17): th[i] = 0.0   # no pawn stands at progress 0 or 8
x = [round(x[0], 2), round(x[1], 2), r1(x[2]), 0.0, 0.0, r1(x[5])]
vals = order_values(th)

def f(v):
    s = f'{v:.1f}' if v != int(v) else str(int(v))
    return s
def term(v, name):   # "+ v * name", written as a TS expression piece
    if v == 0: return ''
    return f' - {f(-v)} * {name}' if v < 0 else f' + {f(v)} * {name}'

with open(sys.argv[3], 'w') as fo:
    fo.write(' '.join(f(v) for v in th) + ' ' + ' '.join(map(str, vals)) + ' ' + ' '.join(f(v) if i not in (0, 1) else f'{v:.2f}' for i, v in enumerate(x)) + '\n')

pm = ', '.join(f(th[i]) for i in range(1, 8))
pe = ', '.join(f(th[9 + i]) for i in range(1, 8))
ts = f'''// How the computer judges a position, in centipawns for the side to move.
//
// Material and position together, in tables per piece and cell: a piece's
// worth at the middle of the cube, less a little for each step out from it
// (and, for the knights, bishops and unicorns, for staying home), pawns by how
// far along they are. Each blends a middlegame and an endgame table by the
// game's phase; the king alone blends by its own danger: the enemy's pieces
// and whether it still has its queen. On top: room to move, pressure on the
// enemy king, the bishop pair, pawns by their own king, pieces a pawn
// attacks, and, a side ahead, trading down and driving the bare king to a
// corner. The numbers were tuned for playing strength by self-play
// (research/evaluation/, ARCHITECTURE.md "Playing the computer").

import {{
  BISHOP,
  BLACK,
  CELLS,
  CX,
  CY,
  CZ,
  KING,
  KNIGHT,
  PAWN,
  PAWN_CAP,
  PAWN_CAP_LEN,
  QUEEN,
  ROOK,
  UNICORN,
  WHITE_SIDE,
}} from './position';
import type {{ Position }} from './position';

/** What the search orders captures by and counts the material lead in. */
export const VALUE = new Int16Array(8);
VALUE[PAWN] = {vals[0]};
VALUE[KNIGHT] = {vals[1]};
VALUE[BISHOP] = {vals[2]};
VALUE[ROOK] = {vals[3]};
VALUE[UNICORN] = {vals[4]};
VALUE[QUEEN] = {vals[5]};
VALUE[KING] = 0;

/** Each piece's weight in the game's phase: the opening's 24 down to the endgame's 0. */
const PHASE = [0, 0, 1, 1, 1, 1, 4, 0];
const PHASE_MAX = 24;

/** From the middle of the cube (0) to a corner (6), in steps along the axes. */
const CENTRE = new Int8Array(CELLS);
/** Chebyshev distance between two cells. */
export const DIST = new Uint8Array(CELLS * CELLS);
for (let c = 0; c < CELLS; c++) {{
  CENTRE[c] = Math.abs(CX[c] - 2) + Math.abs(CY[c] - 2) + Math.abs(CZ[c] - 2);
  for (let d = 0; d < CELLS; d++)
    DIST[c * CELLS + d] = Math.max(
      Math.abs(CX[c] - CX[d]),
      Math.abs(CY[c] - CY[d]),
      Math.abs(CZ[c] - CZ[d]),
    );
}}

/** A pawn's worth by how far along it is (rank + level, 1..7; it starts at 1 or 2). */
const PAWN_MG = [0, {pm}, 0];
const PAWN_EG = [0, {pe}, 0];

// Piece-square tables, material included, from White's side: middlegame and
// endgame, per piece code and cell. Black's are White's turned through the
// centre of the cube.
const MG = new Int16Array(16 * CELLS);
const EG = new Int16Array(16 * CELLS);
const mirror = (c: number) => CELLS - 1 - c; // (x, y, z) -> (4 - x, 4 - y, 4 - z)
for (let c = 0; c < CELLS; c++) {{
  const centre = CENTRE[c];
  const x = CX[c];
  const y = CY[c];
  const z = CZ[c];
  // White's home is rank 1 and level A: how far out a piece has come
  const out = y + z;
  const set = (type: number, mg: number, eg: number) => {{
    const m = Math.round(mg);
    const e = Math.round(eg);
    MG[type * CELLS + c] = m;
    EG[type * CELLS + c] = e;
    MG[(type | BLACK) * CELLS + mirror(c)] = -m;
    EG[(type | BLACK) * CELLS + mirror(c)] = -e;
  }};
  const file = x === 2 ? {f(th[18])} : x === 1 || x === 3 ? {f(th[19])} : 0;
  set(PAWN, PAWN_MG[out] + file, PAWN_EG[out]);
  // Developed: off the home rank and level (the unicorns: off the first two ranks of level A)
  const home = y === 0 && z === 0 ? 1 : 0;
  const unicornHome = y <= 1 && z === 0 ? 1 : 0;
  set(KNIGHT, {f(th[20])}{term(th[21], 'centre')}{term(th[22], 'home')}, {f(th[23])}{term(th[24], 'centre')});
  set(BISHOP, {f(th[25])}{term(th[26], 'centre')}{term(th[27], 'home')}, {f(th[28])}{term(th[29], 'centre')});
  set(UNICORN, {f(th[30])}{term(th[31], 'centre')}{term(th[32], 'unicornHome')}, {f(th[33])}{term(th[34], 'centre')});
  set(ROOK, {f(th[35])}{term(th[36], 'centre')}, {f(th[37])}{term(th[38], 'centre')});
  set(QUEEN, {f(th[39])}{term(th[40], 'centre')}, {f(th[41])}{term(th[42], 'centre')});
  // Home and behind its pawns while there is an attack to fear; to the middle after
  set(KING, {f(th[43])} * out{term(th[44], 'Math.abs(x - 2)')}, {f(th[45])}{term(th[46], 'centre')});
}}

/** Positional terms beyond the tables, weighted per piece type. */
const MOBILITY_WEIGHT = [0, 0, {', '.join(f(th[i]) for i in (47, 48, 49, 50, 51))}, 0];
/** How much a piece near the enemy king threatens it. */
const TROPISM_WEIGHT = [0, 0, {', '.join(f(th[i]) for i in (52, 53, 54, 55, 56))}, 0];
const BISHOP_PAIR = {f(th[57])};
/** The king's danger: shares of the game's phase, the enemy's force and the enemy's queen. */
const DANGER_FORCE = {x[0]:.2f};
const DANGER_QUEEN = {x[1]:.2f};
/** Each own pawn beside the king, at the king's danger. */
const SHIELD = {f(x[2])};
/** Each enemy piece (not a pawn or the king) a pawn attacks. */
const PAWN_THREAT = {f(x[5])};

/** Per side and cell, the cells a pawn there captures on, as four 32-cell words. */
const CAPTURES = new Int32Array(2 * CELLS * 4);
for (let side = 0; side < 2; side++) {{
  for (let c = 0; c < CELLS; c++) {{
    for (let k = 0; k < PAWN_CAP_LEN[side][c]; k++) {{
      const t = PAWN_CAP[side][c * 5 + k];
      CAPTURES[(side * CELLS + c) * 4 + (t >> 5)] |= 1 << (t & 31);
    }}
  }}
}}

/** How many of the cells in one 32-cell word of the board (from `base`) hold an enemy piece other than a pawn or the king. */
const pieceHits = (board: Uint8Array, w: number, base: number) => {{
  let n = 0;
  let bits = w;
  while (bits !== 0) {{
    const low = bits & -bits;
    bits ^= low;
    const t = (board[base | (31 - Math.clz32(low))] & 7);
    if (t !== PAWN && t !== KING) n++;
  }}
  return n;
}};

/** A king's danger, 0 to 24, from the game's phase and the enemy's pieces and queen. */
const danger = (phase: number, enemyForce: number, enemyQueens: number) => {{
  const f = enemyForce < 12 ? enemyForce : 12;
  const w =
    (1 - DANGER_FORCE - DANGER_QUEEN) * phase +
    2 * DANGER_FORCE * f +
    24 * DANGER_QUEEN * (enemyQueens > 0 ? 1 : 0);
  return w < 0 ? 0 : w > 24 ? 24 : w;
}};

/**
 * The position for the side to move, in centipawns (positive: better for
 * them); without the pieces' mobility unless `full`.
 */
export function evaluate(pos: Position, full = true): number {{
  const board = pos.board;
  let mg = 0;
  let eg = 0;
  let phase = 0;
  // Per side (w, b): material without pawns and kings, and with them; bishops;
  // the pieces bar pawns and kings at their phase weight; queens; pressure on
  // the enemy king; the king's tables; pawns beside the king; enemy pieces its
  // pawns attack
  let piecesW = 0;
  let piecesB = 0;
  let materialW = 0;
  let materialB = 0;
  let bishopsW = 0;
  let bishopsB = 0;
  let forceW = 0;
  let forceB = 0;
  let queensW = 0;
  let queensB = 0;
  let tropismW = 0;
  let tropismB = 0;
  let kingMgW = 0;
  let kingMgB = 0;
  let kingEgW = 0;
  let kingEgB = 0;
  let shieldW = 0;
  let shieldB = 0;
  let threatsW = 0;
  let threatsB = 0;
  const wk = pos.king[0];
  const bk = pos.king[1];
  const occ = pos.occ;
  for (let word = 0; word < 8; word++) {{
    let bits = occ[word];
    while (bits !== 0) {{
      const low = bits & -bits;
      bits ^= low;
      const c = ((word & 3) << 5) | (31 - Math.clz32(low));
      const p = board[c];
      const type = p & 7;
      phase += PHASE[type];
      if (p < BLACK) {{
        materialW += VALUE[type];
        if (type === PAWN) {{
          mg += MG[p * CELLS + c];
          eg += EG[p * CELLS + c];
          if (wk >= 0 && DIST[c * CELLS + wk] === 1) shieldW++;
          // Black's pieces it attacks
          const m = c * 4;
          const a0 = CAPTURES[m] & occ[4];
          const a1 = CAPTURES[m + 1] & occ[5];
          const a2 = CAPTURES[m + 2] & occ[6];
          const a3 = CAPTURES[m + 3] & occ[7];
          if ((a0 | a1 | a2 | a3) !== 0)
            threatsW +=
              pieceHits(board, a0, 0) + pieceHits(board, a1, 32) + pieceHits(board, a2, 64) + pieceHits(board, a3, 96);
        }} else if (type === KING) {{
          kingMgW = MG[p * CELLS + c];
          kingEgW = EG[p * CELLS + c];
        }} else {{
          mg += MG[p * CELLS + c];
          eg += EG[p * CELLS + c];
          piecesW += VALUE[type];
          forceW += PHASE[type];
          if (type === QUEEN) queensW++;
          else if (type === BISHOP) bishopsW++;
          if (bk >= 0) {{
            const near = 4 - DIST[c * CELLS + bk];
            if (near > 0) tropismW += near * TROPISM_WEIGHT[type];
          }}
        }}
      }} else {{
        materialB += VALUE[type];
        if (type === PAWN) {{
          mg += MG[p * CELLS + c];
          eg += EG[p * CELLS + c];
          if (bk >= 0 && DIST[c * CELLS + bk] === 1) shieldB++;
          // White's pieces it attacks
          const m = (CELLS + c) * 4;
          const a0 = CAPTURES[m] & occ[0];
          const a1 = CAPTURES[m + 1] & occ[1];
          const a2 = CAPTURES[m + 2] & occ[2];
          const a3 = CAPTURES[m + 3] & occ[3];
          if ((a0 | a1 | a2 | a3) !== 0)
            threatsB +=
              pieceHits(board, a0, 0) + pieceHits(board, a1, 32) + pieceHits(board, a2, 64) + pieceHits(board, a3, 96);
        }} else if (type === KING) {{
          kingMgB = MG[p * CELLS + c];
          kingEgB = EG[p * CELLS + c];
        }} else {{
          mg += MG[p * CELLS + c];
          eg += EG[p * CELLS + c];
          piecesB += VALUE[type];
          forceB += PHASE[type];
          if (type === QUEEN) queensB++;
          else if (type === BISHOP) bishopsB++;
          if (wk >= 0) {{
            const near = 4 - DIST[c * CELLS + wk];
            if (near > 0) tropismB += near * TROPISM_WEIGHT[type];
          }}
        }}
      }}
    }}
  }}
  if (phase > PHASE_MAX) phase = PHASE_MAX;

  // Two bishops cover both colours of the cube
  if (bishopsW >= 2) mg += BISHOP_PAIR;
  if (bishopsB >= 2) mg -= BISHOP_PAIR;

  // Each king's danger, in 24ths, from the enemy's pieces and queen: its
  // tables, and the pressure on it, blend by that rather than by the phase
  const dangerW = danger(phase, forceB, queensB);
  const dangerB = danger(phase, forceW, queensW);
  let sum = mg * phase + eg * (PHASE_MAX - phase);
  sum += kingMgW * dangerW + kingEgW * (24 - dangerW) + kingMgB * dangerB + kingEgB * (24 - dangerB);
  sum += tropismW * dangerB - tropismB * dangerW;
  // Pawns beside their king, while it is in danger
  if (wk >= 0) sum += SHIELD * shieldW * dangerW;
  if (bk >= 0) sum += -1 * SHIELD * shieldB * dangerB;
  // Pieces a pawn attacks
  sum += PAWN_THREAT * 24 * threatsW;
  sum += -1 * PAWN_THREAT * 24 * threatsB;
  let score = Math.round(sum / PHASE_MAX);

  // Ahead on material: trade down (each trade makes the lead count for more),
  // and with the enemy short of pieces, drive the king to a corner and bring
  // our own up to help
  const lead = materialW - materialB;
  if (Math.abs(lead) >= 150) {{
    const strong = lead > 0 ? 0 : 1;
    const sign = lead > 0 ? 1 : -1;
    const total = materialW + materialB;
    score += sign * Math.round((Math.abs(lead) * (7800 - Math.min(total, 7800))) / 7800 / 6);
    const weakKing = pos.king[strong ^ 1];
    const strongKing = pos.king[strong];
    if ((strong ? piecesW : piecesB) <= 300 && weakKing >= 0 && strongKing >= 0) {{
      score += sign * (12 * CENTRE[weakKing] + 10 * (4 - DIST[weakKing * CELLS + strongKing]));
    }}
  }}

  const relative = pos.side === WHITE_SIDE ? score : -score;
  const scaled = toward50(relative, pos.halfmoves);
  return full ? scaled + mobilityScore(pos) : scaled;
}}

/**
 * A lead counts for less as the fifty moves run out (a quarter less at the
 * last ply), so a side ahead makes progress, a capture or a pawn move, rather
 * than drift towards the draw.
 */
const toward50 = (score: number, halfmoves: number) =>
  halfmoves <= 0 ? score : Math.round((score * (400 - Math.min(halfmoves, 100))) / 400);

/**
 * What the pieces' room to move adds to evaluate(pos, false), for the side
 * to move: evaluate(pos) is the two together. Half the evaluation's cost,
 * so the quiescence search leaves it out where it cannot matter (LAZY).
 */
export const mobilityScore = (pos: Position) => {{
  const m = pos.mobility(MOBILITY_WEIGHT);
  return toward50(pos.side === WHITE_SIDE ? m : -m, pos.halfmoves);
}};

/** The most mobility is taken to swing a position by. */
export const LAZY = 150;
'''
open(sys.argv[2], 'w').write(ts)
print('wrote', sys.argv[2], sys.argv[3], 'values', vals, 'ext', x)
