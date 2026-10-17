#include "engine.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>

int8_t CX[CELLS], CY[CELLS], CZ[CELLS];

#define ROOK_END 6
#define BISHOP_END 18
static int8_t SLIDER_OF[DIRS];
static int8_t RAY[CELLS * DIRS * 4];
static uint8_t RAY_LEN[CELLS * DIRS];
static int8_t KNIGHT_TO[CELLS * 24];
static uint8_t KNIGHT_LEN[CELLS];
static int8_t PAWN_FORWARD[2][CELLS], PAWN_UP[2][CELLS];
static int8_t PAWN_CAP[2][CELLS * 5];
static uint8_t PAWN_CAP_LEN[2][CELLS];
static int8_t PAWN_FROM[2][CELLS * 5];
static uint8_t PAWN_FROM_LEN[2][CELLS];
static int32_t ZOBRIST_LO[16 * CELLS], ZOBRIST_HI[16 * CELLS];
static int32_t SIDE_LO, SIDE_HI;

static int CENTRE[CELLS];
static uint8_t DIST[CELLS * CELLS];

static inline int cellOf(int x, int y, int z) { return z * 25 + x * 5 + y; }
static inline int inBoard(int x, int y, int z) {
  return x >= 0 && x < 5 && y >= 0 && y < 5 && z >= 0 && z < 5;
}

// [dz, dx, dy] as engine/pieces.ts
static const int QV[DIRS][3] = {
    {1, 0, 0},   {-1, 0, 0},  {0, 1, 0},   {0, -1, 0},  {0, 0, 1},   {0, 0, -1},  {1, 1, 0},
    {1, -1, 0},  {-1, 1, 0},  {-1, -1, 0}, {1, 0, 1},   {1, 0, -1},  {-1, 0, 1},  {-1, 0, -1},
    {0, 1, 1},   {0, 1, -1},  {0, -1, 1},  {0, -1, -1}, {1, 1, 1},   {1, 1, -1},  {1, -1, 1},
    {1, -1, -1}, {-1, 1, 1},  {-1, 1, -1}, {-1, -1, 1}, {-1, -1, -1}};

static int KNV[64][3];  // [dz, dx, dy]
static int nKNV = 0;

static uint32_t zSeed = 0x9e3779b9u;
static int32_t nextZ(void) {
  zSeed ^= zSeed << 13;
  zSeed ^= zSeed >> 17;
  zSeed ^= zSeed << 5;
  return (int32_t)zSeed;
}

void init_tables(void) {
  static int done = 0;
  if (done) return;
  done = 1;
  for (int c = 0; c < CELLS; c++) {
    CZ[c] = c / 25;
    CX[c] = (c / 5) % 5;
    CY[c] = c % 5;
  }
  for (int d = 0; d < DIRS; d++) SLIDER_OF[d] = d < ROOK_END ? ROOK : d < BISHOP_END ? BISHOP : UNICORN;
  // Knight vectors, deduplicated in first-seen order as the engine does
  int deltas[3] = {2, 1, 0};
  for (int a = 0; a < 3; a++)
    for (int b = 0; b < 3; b++)
      for (int cc = 0; cc < 3; cc++) {
        int dz = deltas[a], dx = deltas[b], dy = deltas[cc];
        int nz = (dz != 0) + (dx != 0) + (dy != 0);
        if (abs(dz) + abs(dx) + abs(dy) == 3 && nz == 2) {
          for (int sz = -1; sz <= 1; sz += 2)
            for (int sx = -1; sx <= 1; sx += 2)
              for (int sy = -1; sy <= 1; sy += 2) {
                int v[3] = {dz * sz, dx * sx, dy * sy};
                int dup = 0;
                for (int k = 0; k < nKNV; k++)
                  if (KNV[k][0] == v[0] && KNV[k][1] == v[1] && KNV[k][2] == v[2]) dup = 1;
                if (!dup) {
                  KNV[nKNV][0] = v[0];
                  KNV[nKNV][1] = v[1];
                  KNV[nKNV][2] = v[2];
                  nKNV++;
                }
              }
        }
      }
  for (int c = 0; c < CELLS; c++) {
    int x = CX[c], y = CY[c], z = CZ[c];
    for (int d = 0; d < DIRS; d++) {
      int dz = QV[d][0], dx = QV[d][1], dy = QV[d][2];
      int n = 0;
      while (n < 4 && inBoard(x + dx * (n + 1), y + dy * (n + 1), z + dz * (n + 1))) {
        RAY[(c * DIRS + d) * 4 + n] = cellOf(x + dx * (n + 1), y + dy * (n + 1), z + dz * (n + 1));
        n++;
      }
      RAY_LEN[c * DIRS + d] = n;
    }
    for (int k = 0; k < nKNV; k++) {
      // KNIGHT_DELTAS = [dx, dy, dz] from [dz, dx, dy]
      int dx = KNV[k][1], dy = KNV[k][2], dz = KNV[k][0];
      if (inBoard(x + dx, y + dy, z + dz)) KNIGHT_TO[c * 24 + KNIGHT_LEN[c]++] = cellOf(x + dx, y + dy, z + dz);
    }
    for (int side = 0; side < 2; side++) {
      int dir = side == WHITE_SIDE ? 1 : -1;
      PAWN_FORWARD[side][c] = inBoard(x, y + dir, z) ? cellOf(x, y + dir, z) : -1;
      PAWN_UP[side][c] = inBoard(x, y, z + dir) ? cellOf(x, y, z + dir) : -1;
      int caps[5][3] = {{0, dir, dir}, {-1, dir, 0}, {1, dir, 0}, {-1, 0, dir}, {1, 0, dir}};
      for (int i = 0; i < 5; i++) {
        int dx = caps[i][0], dy = caps[i][1], dz = caps[i][2];
        if (inBoard(x + dx, y + dy, z + dz)) PAWN_CAP[side][c * 5 + PAWN_CAP_LEN[side][c]++] = cellOf(x + dx, y + dy, z + dz);
        if (inBoard(x - dx, y - dy, z - dz))
          PAWN_FROM[side][c * 5 + PAWN_FROM_LEN[side][c]++] = cellOf(x - dx, y - dy, z - dz);
      }
    }
  }
  for (int i = 0; i < 16 * CELLS; i++) {
    ZOBRIST_LO[i] = nextZ();
    ZOBRIST_HI[i] = nextZ();
  }
  SIDE_LO = nextZ();
  SIDE_HI = nextZ();
  for (int c = 0; c < CELLS; c++) {
    CENTRE[c] = abs(CX[c] - 2) + abs(CY[c] - 2) + abs(CZ[c] - 2);
    for (int d = 0; d < CELLS; d++) {
      int a = abs(CX[c] - CX[d]), b = abs(CY[c] - CY[d]), e = abs(CZ[c] - CZ[d]);
      int m = a > b ? a : b;
      DIST[c * CELLS + d] = m > e ? m : e;
    }
  }
}

static inline int promotes(int cell, int side) {
  return side == WHITE_SIDE ? (CY[cell] == 4 && CZ[cell] == 4) : (CY[cell] == 0 && CZ[cell] == 0);
}

static inline int encode(int from, int to, int promo, int captured, int piece) {
  return from | (to << 7) | (promo << 14) | (captured << 17) | (piece << 21);
}

static const int PROMOTIONS[5] = {QUEEN, KNIGHT, ROOK, BISHOP, UNICORN};

static inline int pawnMove(int32_t *out, int n, int from, int to, int captured, int piece, int side) {
  if (!promotes(to, side)) {
    out[n] = encode(from, to, 0, captured, piece);
    return n + 1;
  }
  for (int i = 0; i < 5; i++) out[n++] = encode(from, to, PROMOTIONS[i], captured, piece);
  return n;
}

void pos_reset(Pos *p, int side, int halfmoves) {
  p->side = side;
  p->king[0] = -1;
  p->king[1] = -1;
  int32_t lo = side == BLACK_SIDE ? SIDE_LO : 0;
  int32_t hi = side == BLACK_SIDE ? SIDE_HI : 0;
  memset(p->occ, 0, sizeof p->occ);
  for (int c = 0; c < CELLS; c++) {
    int q = p->board[c];
    if (!q) continue;
    p->occ[((q >> 3) << 2) | (c >> 5)] |= 1u << (c & 31);
    lo ^= ZOBRIST_LO[q * CELLS + c];
    hi ^= ZOBRIST_HI[q * CELLS + c];
    if ((q & 7) == KING && p->king[q >> 3] < 0) p->king[q >> 3] = c;
  }
  p->hashLo = lo;
  p->hashHi = hi;
  p->ply = 0;
  p->history[0] = lo;
  p->history[1] = hi;
  p->clocks[0] = halfmoves;
}

void pos_start(Pos *p) {
  memset(p->board, 0, CELLS);
  int first[5] = {ROOK, KNIGHT, KING, KNIGHT, ROOK};
  int second[5] = {BISHOP, UNICORN, QUEEN, BISHOP, UNICORN};
  for (int x = 0; x < 5; x++) {
#define PLACE(y, z, t)                                   \
  do {                                                   \
    p->board[cellOf(x, y, z)] = (t);                     \
    p->board[cellOf(4 - x, 4 - (y), 4 - (z))] = (t) | BLACK; \
  } while (0)
    PLACE(0, 0, first[x]);
    PLACE(1, 0, second[x]);
    PLACE(0, 1, PAWN);
    PLACE(1, 1, PAWN);
#undef PLACE
  }
  pos_reset(p, WHITE_SIDE, 0);
}

static inline void push(Pos *p, int clock) {
  int ply = ++p->ply;
  p->history[ply * 2] = p->hashLo;
  p->history[ply * 2 + 1] = p->hashHi;
  p->clocks[ply] = clock;
}

int pos_attacked(const Pos *p, int target, int by) {
  const uint8_t *board = p->board;
  int colour = by == BLACK_SIDE ? BLACK : 0;
  int rays = target * DIRS;
  for (int d = 0; d < DIRS; d++) {
    int len = RAY_LEN[rays + d];
    int base = (rays + d) * 4;
    for (int n = 0; n < len; n++) {
      int q = board[RAY[base + n]];
      if (!q) continue;
      if ((q & BLACK) == colour) {
        int t = q & 7;
        if (t == QUEEN || t == SLIDER_OF[d] || (n == 0 && t == KING)) return 1;
      }
      break;
    }
  }
  int kn = target * 24;
  for (int i = 0, len = KNIGHT_LEN[target]; i < len; i++)
    if (board[KNIGHT_TO[kn + i]] == (KNIGHT | colour)) return 1;
  const int8_t *from = PAWN_FROM[by];
  for (int i = 0, len = PAWN_FROM_LEN[by][target]; i < len; i++)
    if (board[from[target * 5 + i]] == (PAWN | colour)) return 1;
  return 0;
}

int pos_in_check(const Pos *p, int side) {
  int k = p->king[side];
  return k >= 0 && pos_attacked(p, k, side ^ 1);
}

int pos_generate(const Pos *p, int32_t *out, int start, int noisy) {
  const uint8_t *board = p->board;
  int side = p->side;
  int own = side == BLACK_SIDE ? BLACK : 0;
  int n = start;
  for (int w = side << 2; w < (side << 2) + 4; w++) {
    uint32_t bits = p->occ[w];
    while (bits) {
      int c = ((w & 3) << 5) | __builtin_ctz(bits);
      bits &= bits - 1;
      int pc = board[c];
      int type = pc & 7;
      if (type == PAWN) {
        int fwd = PAWN_FORWARD[side][c];
        if (fwd >= 0 && !board[fwd] && (!noisy || promotes(fwd, side))) n = pawnMove(out, n, c, fwd, 0, pc, side);
        int up = PAWN_UP[side][c];
        if (up >= 0 && !board[up] && (!noisy || promotes(up, side))) n = pawnMove(out, n, c, up, 0, pc, side);
        const int8_t *caps = PAWN_CAP[side];
        for (int i = 0, len = PAWN_CAP_LEN[side][c]; i < len; i++) {
          int to = caps[c * 5 + i];
          int q = board[to];
          if (q && (q & BLACK) != own) n = pawnMove(out, n, c, to, q, pc, side);
        }
        continue;
      }
      if (type == KNIGHT) {
        for (int i = 0, len = KNIGHT_LEN[c]; i < len; i++) {
          int to = KNIGHT_TO[c * 24 + i];
          int q = board[to];
          if (q ? (q & BLACK) != own : !noisy) out[n++] = encode(c, to, 0, q, pc);
        }
        continue;
      }
      int d0 = type == BISHOP ? ROOK_END : type == UNICORN ? BISHOP_END : 0;
      int d1 = type == ROOK ? ROOK_END : type == BISHOP ? BISHOP_END : DIRS;
      int reach = type == KING ? 1 : 4;
      for (int d = d0; d < d1; d++) {
        int len = RAY_LEN[c * DIRS + d];
        if (len > reach) len = reach;
        int base = (c * DIRS + d) * 4;
        for (int i = 0; i < len; i++) {
          int to = RAY[base + i];
          int q = board[to];
          if (!q) {
            if (!noisy) out[n++] = encode(c, to, 0, 0, pc);
            continue;
          }
          if ((q & BLACK) != own) out[n++] = encode(c, to, 0, q, pc);
          break;
        }
      }
    }
  }
  return n;
}

int pos_make(Pos *p, int move) {
  uint8_t *board = p->board;
  int from = moveFrom(move), to = moveTo(move), piece = movePiece(move), captured = moveCaptured(move),
      promo = movePromotion(move);
  int side = p->side;
  int placed = promo ? promo | (piece & BLACK) : piece;
  int32_t lo = p->hashLo ^ ZOBRIST_LO[piece * CELLS + from] ^ ZOBRIST_LO[placed * CELLS + to];
  int32_t hi = p->hashHi ^ ZOBRIST_HI[piece * CELLS + from] ^ ZOBRIST_HI[placed * CELLS + to];
  if (captured) {
    lo ^= ZOBRIST_LO[captured * CELLS + to];
    hi ^= ZOBRIST_HI[captured * CELLS + to];
    if ((captured & 7) == KING) p->king[captured >> 3] = -1;
  }
  board[from] = 0;
  board[to] = placed;
  p->occ[(side << 2) | (from >> 5)] ^= 1u << (from & 31);
  p->occ[(side << 2) | (to >> 5)] ^= 1u << (to & 31);
  if (captured) p->occ[((side ^ 1) << 2) | (to >> 5)] ^= 1u << (to & 31);
  if ((piece & 7) == KING) p->king[side] = to;
  p->side = side ^ 1;
  p->hashLo = lo ^ SIDE_LO;
  p->hashHi = hi ^ SIDE_HI;
  push(p, captured || (piece & 7) == PAWN ? 0 : p->clocks[p->ply] + 1);
  int k = p->king[side];
  return k < 0 || !pos_attacked(p, k, side ^ 1);
}

void pos_unmake(Pos *p, int move) {
  uint8_t *board = p->board;
  int from = moveFrom(move), to = moveTo(move), piece = movePiece(move), captured = moveCaptured(move);
  int side = (p->side ^= 1);
  board[from] = piece;
  board[to] = captured;
  p->occ[(side << 2) | (from >> 5)] ^= 1u << (from & 31);
  p->occ[(side << 2) | (to >> 5)] ^= 1u << (to & 31);
  if (captured) p->occ[((side ^ 1) << 2) | (to >> 5)] ^= 1u << (to & 31);
  if ((piece & 7) == KING) p->king[p->side] = from;
  if (captured && (captured & 7) == KING) p->king[captured >> 3] = to;
  p->ply--;
  p->hashLo = p->history[p->ply * 2];
  p->hashHi = p->history[p->ply * 2 + 1];
}

void pos_make_null(Pos *p) {
  p->side ^= 1;
  p->hashLo ^= SIDE_LO;
  p->hashHi ^= SIDE_HI;
  push(p, 0);
}

void pos_unmake_null(Pos *p) {
  p->side ^= 1;
  p->ply--;
  p->hashLo = p->history[p->ply * 2];
  p->hashHi = p->history[p->ply * 2 + 1];
}

#define REPETITIONS 3
int pos_repeated(const Pos *p, int root) {
  int32_t lo = p->hashLo, hi = p->hashHi;
  int oldest = p->ply - p->clocks[p->ply];
  if (oldest < 0) oldest = 0;
  int before = 0;
  for (int q = p->ply - 2; q >= oldest; q -= 2) {
    if (p->history[q * 2] != lo || p->history[q * 2 + 1] != hi) continue;
    if (q > root || ++before >= REPETITIONS - 1) return 1;
  }
  return 0;
}

int pos_mobility(const Pos *p, const int *weights) {
  const uint8_t *board = p->board;
  int score = 0;
  for (int word = 0; word < 8; word++) {
    uint32_t bits = p->occ[word];
    while (bits) {
      int c = ((word & 3) << 5) | __builtin_ctz(bits);
      bits &= bits - 1;
      int pc = board[c];
      int type = pc & 7;
      int w = weights[type];
      if (!w) continue;
      int own = pc & BLACK;
      int count = 0;
      if (type == KNIGHT) {
        for (int i = 0, len = KNIGHT_LEN[c]; i < len; i++) {
          int q = board[KNIGHT_TO[c * 24 + i]];
          if (!q || (q & BLACK) != own) count++;
        }
      } else {
        int d0 = type == BISHOP ? ROOK_END : type == UNICORN ? BISHOP_END : 0;
        int d1 = type == ROOK ? ROOK_END : type == BISHOP ? BISHOP_END : DIRS;
        for (int d = d0; d < d1; d++) {
          int len = RAY_LEN[c * DIRS + d];
          int base = (c * DIRS + d) * 4;
          for (int i = 0; i < len; i++) {
            int q = board[RAY[base + i]];
            if (!q) {
              count++;
              continue;
            }
            if ((q & BLACK) != own) count++;
            break;
          }
        }
      }
      score += own ? -w * count : w * count;
    }
  }
  return score;
}

int pos_legal_moves(Pos *p, int32_t *out) {
  int32_t scratch[512];
  int end = pos_generate(p, scratch, 0, 0);
  int n = 0;
  for (int i = 0; i < end; i++) {
    int m = scratch[i];
    if (pos_make(p, m)) out[n++] = m;
    pos_unmake(p, m);
  }
  return n;
}

// --- Evaluation --------------------------------------------------------------

static const int PHASE[8] = {0, 0, 1, 1, 1, 1, 4, 0};
#define PHASE_MAX 24
static const int PAWN_STEP_MG[9] = {0, 0, 6, 14, 24, 36, 52, 75, 0};
static const int PAWN_STEP_EG[9] = {0, 0, 10, 24, 42, 66, 100, 150, 0};
static const int MOBILITY_WEIGHT[8] = {0, 0, 2, 2, 2, 2, 1, 0};
static const int TROPISM_WEIGHT[8] = {0, 0, 3, 2, 1, 2, 6, 0};

static inline double jsround(double x) {
  double f = floor(x);
  return (x - f >= 0.5) ? f + 1 : f;
}

void eval_init_theta(EvalParams *e, const double *th, const int *v) {
  init_tables();
  memset(e, 0, sizeof *e);
  e->value[PAWN] = v[0];
  e->value[KNIGHT] = v[1];
  e->value[BISHOP] = v[2];
  e->value[ROOK] = v[3];
  e->value[UNICORN] = v[4];
  e->value[QUEEN] = v[5];
  e->value[KING] = 0;
  for (int c = 0; c < CELLS; c++) {
    int cen = CENTRE[c];
    int x = CX[c], y = CY[c], z = CZ[c];
    int out = y + z;
    int mc = CELLS - 1 - c;
#define SET(type, mg, eg)                                    \
  do {                                                       \
    int m_ = (int)jsround(mg), e_ = (int)jsround(eg);        \
    e->MG[(type) * CELLS + c] = m_;                          \
    e->EG[(type) * CELLS + c] = e_;                          \
    e->MG[((type) | BLACK) * CELLS + mc] = -m_;              \
    e->EG[((type) | BLACK) * CELLS + mc] = -e_;              \
  } while (0)
    double file = x == 2 ? th[18] : (x == 1 || x == 3) ? th[19] : 0;
    SET(PAWN, th[out] + file, th[9 + out]);
    int home = y == 0 && z == 0;
    SET(KNIGHT, th[20] + th[21] * cen + th[22] * home, th[23] + th[24] * cen);
    SET(BISHOP, th[25] + th[26] * cen + th[27] * home, th[28] + th[29] * cen);
    SET(UNICORN, th[30] + th[31] * cen + th[32] * (y <= 1 && z == 0), th[33] + th[34] * cen);
    SET(ROOK, th[35] + th[36] * cen, th[37] + th[38] * cen);
    SET(QUEEN, th[39] + th[40] * cen, th[41] + th[42] * cen);
    SET(KING, th[43] * out + th[44] * abs(x - 2), th[45] + th[46] * cen);
#undef SET
  }
  e->mob[KNIGHT] = (int)jsround(th[47]);
  e->mob[BISHOP] = (int)jsround(th[48]);
  e->mob[ROOK] = (int)jsround(th[49]);
  e->mob[UNICORN] = (int)jsround(th[50]);
  e->mob[QUEEN] = (int)jsround(th[51]);
  e->trop[KNIGHT] = (int)jsround(th[52]);
  e->trop[BISHOP] = (int)jsround(th[53]);
  e->trop[ROOK] = (int)jsround(th[54]);
  e->trop[UNICORN] = (int)jsround(th[55]);
  e->trop[QUEEN] = (int)jsround(th[56]);
  e->bpair = (int)jsround(th[57]);
}

// The game's evaluation (evaluate.ts) at piece values v
void eval_init(EvalParams *e, const int *v) {
  double th[NTHETA];
  for (int i = 0; i < 9; i++) {
    th[i] = v[0] + PAWN_STEP_MG[i];
    th[9 + i] = v[0] + PAWN_STEP_EG[i];
  }
  th[18] = 6; th[19] = 3;
  double rest[] = {v[1] + 28, -8, -14, v[1] + 18, -6, v[2] + 16, -4, -14, v[2] + 10, -3,
                   v[4] + 12, -3, -8, v[4] + 8, -2, v[3] + 6, -1, v[3] + 4, -1, v[5] + 6, -2, v[5] + 10, -3,
                   -14, -4, 24, -8, 2, 2, 2, 2, 1, 3, 2, 1, 2, 6, 20};
  for (int i = 0; i < 38; i++) th[20 + i] = rest[i];
  eval_init_theta(e, th, v);
}

static inline int toward50(int score, int halfmoves) {
  if (halfmoves <= 0) return score;
  int h = halfmoves < 100 ? halfmoves : 100;
  return (int)jsround((double)(score * (400 - h)) / 400.0);
}

int mobility_score(const EvalParams *e, const Pos *p) {
  int m = pos_mobility(p, e->mob);
  return toward50(p->side == WHITE_SIDE ? m : -m, pos_halfmoves(p));
}

int evaluate(const EvalParams *e, const Pos *p, int full) {
  const uint8_t *board = p->board;
  int mg = 0, eg = 0, phase = 0;
  int pieces[2] = {0, 0}, material[2] = {0, 0}, bishops[2] = {0, 0};
  int tropism = 0;
  int wk = p->king[0], bk = p->king[1];
  for (int word = 0; word < 8; word++) {
    uint32_t bits = p->occ[word];
    while (bits) {
      int c = ((word & 3) << 5) | __builtin_ctz(bits);
      bits &= bits - 1;
      int pc = board[c];
      mg += e->MG[pc * CELLS + c];
      eg += e->EG[pc * CELLS + c];
      int type = pc & 7;
      int side = pc >> 3;
      phase += PHASE[type];
      material[side] += e->value[type];
      if (type != PAWN && type != KING) {
        pieces[side] += e->value[type];
        if (type == BISHOP) bishops[side]++;
        int enemyKing = side == WHITE_SIDE ? bk : wk;
        if (enemyKing >= 0) {
          int near = 4 - DIST[c * CELLS + enemyKing];
          if (near > 0) tropism += (side == WHITE_SIDE ? 1 : -1) * near * e->trop[type];
        }
      }
    }
  }
  if (phase > PHASE_MAX) phase = PHASE_MAX;
  mg += tropism;
  if (bishops[0] >= 2) mg += e->bpair;
  if (bishops[1] >= 2) mg -= e->bpair;
  int score = (int)jsround((double)(mg * phase + eg * (PHASE_MAX - phase)) / PHASE_MAX);
  int lead = material[0] - material[1];
  if (abs(lead) >= 150) {
    int strong = lead > 0 ? 0 : 1;
    int sign = lead > 0 ? 1 : -1;
    int total = material[0] + material[1];
    int t = total < 7800 ? total : 7800;
    score += sign * (int)jsround((double)(abs(lead) * (7800 - t)) / 7800.0 / 6.0);
    int weakKing = p->king[strong ^ 1];
    int strongKing = p->king[strong];
    if (pieces[strong ^ 1] <= 300 && weakKing >= 0 && strongKing >= 0)
      score += sign * (12 * CENTRE[weakKing] + 10 * (4 - DIST[weakKing * CELLS + strongKing]));
  }
  int relative = p->side == WHITE_SIDE ? score : -score;
  int scaled = toward50(relative, pos_halfmoves(p));
  return full ? scaled + mobility_score(e, p) : scaled;
}

// --- Decomposition (analysis only) ---------------------------------------------
// For each piece on the board, what the evaluation credits it with beyond its
// constant, from its own side's view: out[side][type][0] count, [1] table bonus
// (middlegame and endgame tables blended by the phase, the bishop pair shared
// between the bishops), [2] mobility, [3] pressure on the enemy king (blended).
static int piece_mobility(const Pos *p, int c) {
  const uint8_t *board = p->board;
  int pc = board[c], type = pc & 7, own = pc & BLACK, count = 0;
  if (type == KNIGHT) {
    for (int i = 0, len = KNIGHT_LEN[c]; i < len; i++) {
      int q = board[KNIGHT_TO[c * 24 + i]];
      if (!q || (q & BLACK) != own) count++;
    }
    return count;
  }
  int d0 = type == BISHOP ? ROOK_END : type == UNICORN ? BISHOP_END : 0;
  int d1 = type == ROOK ? ROOK_END : type == BISHOP ? BISHOP_END : DIRS;
  for (int d = d0; d < d1; d++) {
    int len = RAY_LEN[c * DIRS + d], base = (c * DIRS + d) * 4;
    for (int i = 0; i < len; i++) {
      int q = board[RAY[base + i]];
      if (!q) { count++; continue; }
      if ((q & BLACK) != own) count++;
      break;
    }
  }
  return count;
}

int eval_decompose(const EvalParams *e, const Pos *p, double out[2][8][4]) {
  int phase = 0, bishops[2] = {0, 0};
  for (int c = 0; c < CELLS; c++) {
    int q = p->board[c];
    if (q) { phase += PHASE[q & 7]; if ((q & 7) == BISHOP) bishops[q >> 3]++; }
  }
  if (phase > PHASE_MAX) phase = PHASE_MAX;
  double fm = phase / (double)PHASE_MAX, fe = 1 - fm;
  for (int c = 0; c < CELLS; c++) {
    int q = p->board[c];
    if (!q) continue;
    int type = q & 7, side = q >> 3, sign = side ? -1 : 1;
    double mg = sign * e->MG[q * CELLS + c] - e->value[type];
    double eg = sign * e->EG[q * CELLS + c] - e->value[type];
    double table = fm * mg + fe * eg;
    if (type == BISHOP && bishops[side] >= 2) table += fm * 20.0 / bishops[side];
    out[side][type][0] += 1;
    out[side][type][1] += table;
    if (MOBILITY_WEIGHT[type]) out[side][type][2] += MOBILITY_WEIGHT[type] * piece_mobility(p, c);
    if (type != PAWN && type != KING) {
      int ek = p->king[side ^ 1];
      if (ek >= 0) {
        int near = 4 - DIST[c * CELLS + ek];
        if (near > 0) out[side][type][3] += fm * near * TROPISM_WEIGHT[type];
      }
    }
  }
  return phase;
}

// --- Features for fitting the evaluation (analysis only) -------------------------
// The evaluation is linear in its numbers but for the material lead term; for a
// position, f[j] is how much number j contributes per unit (White's view), and
// *offset the lead term (at the current values). evaluate(), White's view, with no
// moves towards the fifty, equals sum(theta_j * f_j) + offset up to rounding.
// Layout: 0-8 pawn mg by progress, 9-17 pawn eg, 18 pawn centre file, 19 pawn next
// file; per piece N(20) B(25) U(30): mg0 mg/centre home eg0 eg/centre; R(35) Q(39):
// mg0 mg/centre eg0 eg/centre; K(43): mg/progress mg/file eg0 eg/centre; mobility
// N B R U Q (47-51); king pressure N B R U Q (52-56); bishop pair (57).
#define NFEAT 58
int eval_features(const EvalParams *e, const Pos *p, double *f, double *offset) {
  int phase = 0, bishops[2] = {0, 0}, material[2] = {0, 0}, pieces[2] = {0, 0};
  for (int j = 0; j < NFEAT; j++) f[j] = 0;
  for (int c = 0; c < CELLS; c++) {
    int q = p->board[c];
    if (!q) continue;
    int t = q & 7, s = q >> 3;
    phase += PHASE[t];
    if (t == BISHOP) bishops[s]++;
    material[s] += e->value[t];
    if (t != PAWN && t != KING) pieces[s] += e->value[t];
  }
  if (phase > PHASE_MAX) phase = PHASE_MAX;
  double fm = phase / (double)PHASE_MAX, fe = 1 - fm;
  static const int MOBI[8] = {-1, -1, 47, 48, 49, 50, 51, -1};
  static const int TROI[8] = {-1, -1, 52, 53, 54, 55, 56, -1};
  for (int c = 0; c < CELLS; c++) {
    int q = p->board[c];
    if (!q) continue;
    int t = q & 7, s = q >> 3;
    double sg = s ? -1 : 1;
    int w = s ? CELLS - 1 - c : c;   // the cell from its own side's view
    int x = CX[w], y = CY[w], z = CZ[w], out = y + z, cen = CENTRE[w];
    switch (t) {
      case PAWN:
        f[out] += sg * fm;
        f[9 + out] += sg * fe;
        if (x == 2) f[18] += sg * fm;
        else if (x == 1 || x == 3) f[19] += sg * fm;
        break;
      case KNIGHT: case BISHOP: case UNICORN: {
        int b = t == KNIGHT ? 20 : t == BISHOP ? 25 : 30;
        int home = t == UNICORN ? (y <= 1 && z == 0) : (y == 0 && z == 0);
        f[b] += sg * fm; f[b + 1] += sg * fm * cen; f[b + 2] += sg * fm * home;
        f[b + 3] += sg * fe; f[b + 4] += sg * fe * cen;
        break;
      }
      case ROOK: case QUEEN: {
        int b = t == ROOK ? 35 : 39;
        f[b] += sg * fm; f[b + 1] += sg * fm * cen; f[b + 2] += sg * fe; f[b + 3] += sg * fe * cen;
        break;
      }
      case KING:
        f[43] += sg * fm * out; f[44] += sg * fm * abs(x - 2); f[45] += sg * fe; f[46] += sg * fe * cen;
        break;
    }
    if (MOBI[t] >= 0) f[MOBI[t]] += sg * piece_mobility(p, c);
    if (TROI[t] >= 0) {
      int ek = p->king[s ^ 1];
      if (ek >= 0) {
        int near = 4 - DIST[c * CELLS + ek];
        if (near > 0) f[TROI[t]] += sg * fm * near;
      }
    }
  }
  f[57] = fm * ((bishops[0] >= 2) - (bishops[1] >= 2));
  double off = 0;
  int lead = material[0] - material[1];
  if (abs(lead) >= 150) {
    int strong = lead > 0 ? 0 : 1, sign = lead > 0 ? 1 : -1;
    int total = material[0] + material[1], tt = total < 7800 ? total : 7800;
    off += sign * jsround((double)(abs(lead) * (7800 - tt)) / 7800.0 / 6.0);
    int wk = p->king[strong ^ 1], sk = p->king[strong];
    if (pieces[strong ^ 1] <= 300 && wk >= 0 && sk >= 0) off += sign * (12 * CENTRE[wk] + 10 * (4 - DIST[wk * CELLS + sk]));
  }
  *offset = off;
  return phase;
}
