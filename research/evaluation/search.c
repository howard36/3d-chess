// search.ts, ported. With keepTT = usePartial = 0 it searches exactly as the
// JS engine does with margin 0 (the pure engine: no level's noise).
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include "engine.h"
static int LMR_TABLE[64][64];
static void lmr_init(void){static int d=0; if(d) return; d=1; for(int i=1;i<64;i++) for(int j=1;j<64;j++) LMR_TABLE[i][j]=(int)(0.5+log(i)*log(j)/2.0);}

#define MAX_PLY 64
#define MOVES_PER_PLY 512
#define TT_BITS 18
#define TT_SIZE (1 << TT_BITS)
#define TT_MASK (TT_SIZE - 1)
#define EXACT 1
#define LOWER 2
#define UPPER 3
#define FIFTY_MOVE_PLIES 100

static const int ATTACKER_ORDER[8] = {0, 0, 3, 3, 2, 1, 4, 5};

struct Searcher {
  const EvalParams *ev;
  Pos *pos;
  int32_t ttCheck[TT_SIZE];
  int32_t ttMove[TT_SIZE];
  int16_t ttScore[TT_SIZE];
  int8_t ttDepth[TT_SIZE];
  uint8_t ttFlag[TT_SIZE];
  int32_t moves[MAX_PLY * MOVES_PER_PLY];
  int32_t order[MAX_PLY * MOVES_PER_PLY];
  int32_t killers[MAX_PLY * 2];
  int32_t history[16 * 125];
  long nodes;
  int stopped;
  long maxNodes;
  int qLimit;
  int canStop;
  int rootPly;
  int feat;
};

Searcher *searcher_new(const EvalParams *e) {
  Searcher *s = calloc(1, sizeof(Searcher));
  s->ev = e;
  return s;
}
void searcher_free(Searcher *s) { free(s); }

static inline int toTT(int s, int ply) { return s >= MATE_BOUND ? s + ply : s <= -MATE_BOUND ? s - ply : s; }
static inline int fromTT(int s, int ply) { return s >= MATE_BOUND ? s - ply : s <= -MATE_BOUND ? s + ply : s; }

static int staticOrder(const Searcher *s, int m) {
  int captured = moveCaptured(m);
  int v = captured ? 1000 + s->ev->value[captured & 7] - ATTACKER_ORDER[movePiece(m) & 7] : 0;
  if (movePromotion(m) == QUEEN) v += 900;
  return v;
}

static inline void checkTime(Searcher *s) {
  if (!s->canStop) return;
  if (s->nodes >= s->maxNodes) s->stopped = 1;
}

static int hasLegalMove(Searcher *s, int ply) {
  Pos *pos = s->pos;
  int base = ply * MOVES_PER_PLY;
  int end = pos_generate(pos, s->moves, base, 0);
  for (int i = base; i < end; i++) {
    int legal = pos_make(pos, s->moves[i]);
    pos_unmake(pos, s->moves[i]);
    if (legal) return 1;
  }
  return 0;
}

static int hasPieces(const Searcher *s) {
  const Pos *p = s->pos;
  for (int w = p->side << 2; w < (p->side << 2) + 4; w++) {
    uint32_t bits = p->occ[w];
    while (bits) {
      int c = ((w & 3) << 5) | __builtin_ctz(bits);
      bits &= bits - 1;
      int type = p->board[c] & 7;
      if (type != PAWN && type != KING) return 1;
    }
  }
  return 0;
}

static void scoreMoves(Searcher *s, int base, int end, int ttMove, int ply) {
  int k0 = s->killers[ply * 2], k1 = s->killers[ply * 2 + 1];
  const int *V = s->ev->value;
  for (int i = base; i < end; i++) {
    int m = s->moves[i];
    int v;
    if (m == ttMove)
      v = 1 << 30;
    else {
      int captured = moveCaptured(m), promo = movePromotion(m);
      if (captured || promo) {
        v = (1 << 28) + (captured ? V[captured & 7] * 16 - ATTACKER_ORDER[movePiece(m) & 7] : 0) +
            (promo == QUEEN ? 9000 : promo ? -1000 : 0);
      } else if (m == k0)
        v = (1 << 27) + 1;
      else if (m == k1)
        v = 1 << 27;
      else
        v = s->history[movePiece(m) * 125 + moveTo(m)];
    }
    s->order[i] = v;
  }
}

static inline int pickNext(Searcher *s, int i, int end) {
  int32_t *order = s->order, *moves = s->moves;
  int bi = i, bs = order[i];
  for (int j = i + 1; j < end; j++)
    if (order[j] > bs) {
      bs = order[j];
      bi = j;
    }
  if (bi != i) {
    int m = moves[i];
    moves[i] = moves[bi];
    moves[bi] = m;
    order[bi] = order[i];
    order[i] = bs;
  }
  return moves[i];
}

static int quiesce(Searcher *s, int alpha, int beta, int ply, int qply) {
  Pos *pos = s->pos;
  s->nodes++;
  checkTime(s);
  if (s->stopped) return 0;
  int rough = evaluate(s->ev, pos, 0);
  if (rough - 150 >= beta) return rough;
  // with the further extensions the part beyond the rough evaluation is more than mobility
  int stand = rough + 150 <= alpha ? rough : s->ev->ext2 ? evaluate(s->ev, pos, 1) : rough + mobility_score(s->ev, pos);
  if (stand >= beta) return stand;
  if (ply >= MAX_PLY - 1 || qply >= s->qLimit) return stand;
  if (stand > alpha) alpha = stand;
  int best = stand;
  int base = ply * MOVES_PER_PLY;
  int end = pos_generate(pos, s->moves, base, 1);
  scoreMoves(s, base, end, 0, ply);
  for (int i = base; i < end; i++) {
    int m = pickNext(s, i, end);
    int captured = moveCaptured(m);
    if (!movePromotion(m) && stand + s->ev->value[captured & 7] + 200 <= alpha) continue;
    if ((s->feat & F_QSEE) && !movePromotion(m)) {
      int att = movePiece(m) & 7;
      int av = att == KING ? 100000 : s->ev->value[att];
      if (av > s->ev->value[captured & 7] + 50 && pos_attacked(pos, moveTo(m), pos->side ^ 1)) continue;
    }
    if (!pos_make(pos, m)) {
      pos_unmake(pos, m);
      continue;
    }
    int v = -quiesce(s, -beta, -alpha, ply + 1, qply + 1);
    pos_unmake(pos, m);
    if (s->stopped) return 0;
    if (v > best) {
      best = v;
      if (v > alpha) {
        alpha = v;
        if (v >= beta) break;
      }
    }
  }
  return best;
}

static int negamax(Searcher *s, int depth, int alpha, int beta, int ply, int allowNull) {
  Pos *pos = s->pos;
  if (ply > 0 && pos_repeated(pos, s->rootPly)) return 0;
  int inCheck = pos_in_check(pos, pos->side);
  if (ply > 0 && pos_halfmoves(pos) >= FIFTY_MOVE_PLIES) return inCheck && !hasLegalMove(s, ply) ? -(MATE - ply) : 0;
  if (inCheck && ply < MAX_PLY - 8) depth++;
  if (depth <= 0) return quiesce(s, alpha, beta, ply, 0);
  s->nodes++;
  checkTime(s);
  if (s->stopped) return 0;
  if (ply >= MAX_PLY - 2) return evaluate(s->ev, pos, 1);

  int mateHere = MATE - ply;
  if (mateHere < beta) {
    beta = mateHere;
    if (alpha >= beta) return beta;
  }

  int pv = beta - alpha > 1;
  int slot = pos->hashLo & TT_MASK;
  int ttMove = 0;
  if (s->ttFlag[slot] && s->ttCheck[slot] == pos->hashHi) {
    ttMove = s->ttMove[slot];
    if (!pv && s->ttDepth[slot] >= depth) {
      int v = fromTT(s->ttScore[slot], ply);
      int flag = s->ttFlag[slot];
      if (flag == EXACT || (flag == LOWER && v >= beta) || (flag == UPPER && v <= alpha)) return v;
    }
  }

  int staticEval = inCheck ? -INF : evaluate(s->ev, pos, 1);
  if (!pv && !inCheck) {
    if (depth <= 2 && staticEval - 160 * depth >= beta && abs(beta) < MATE_BOUND) return staticEval;
    if ((s->feat & F_RFP) && depth <= 4 && staticEval - 120 * depth >= beta && abs(beta) < MATE_BOUND) return staticEval;
    if (allowNull && depth >= 3 && staticEval >= beta && hasPieces(s)) {
      int r = depth > 6 ? 3 : 2;
      pos_make_null(pos);
      int v = -negamax(s, depth - 1 - r, -beta, -beta + 1, ply + 1, 0);
      pos_unmake_null(pos);
      if (s->stopped) return 0;
      if (v >= beta) return v >= MATE_BOUND ? beta : v;
    }
  }

  int base = ply * MOVES_PER_PLY;
  int end = pos_generate(pos, s->moves, base, 0);
  scoreMoves(s, base, end, ttMove, ply);
  int best = -INF, bestMove = 0, legal = 0, seen = 0;
  int startAlpha = alpha;
  int futile = !pv && !inCheck && depth == 1 && staticEval + 220 <= alpha;
  if ((s->feat & F_FUT) && !pv && !inCheck && depth <= 3 && staticEval + 150 * depth <= alpha) futile = 1;
  static const int LMP_COUNT[4] = {0, 7, 12, 20};
  int lmp = (s->feat & F_LMP) && !pv && !inCheck && depth <= 3;
  int quietSeen = 0;
  for (int i = base; i < end; i++) {
    int m = pickNext(s, i, end);
    int quiet = !moveCaptured(m) && !movePromotion(m);
    if (!pos_make(pos, m)) {
      pos_unmake(pos, m);
      continue;
    }
    legal++;
    if (futile && quiet && seen > 0 && !pos_in_check(pos, pos->side)) {
      pos_unmake(pos, m);
      continue;
    }
    if (quiet) quietSeen++;
    if (lmp && quiet && seen > 0 && quietSeen > LMP_COUNT[depth] && !pos_in_check(pos, pos->side)) {
      pos_unmake(pos, m);
      continue;
    }
    seen++;
    int v;
    if (seen == 1) {
      v = -negamax(s, depth - 1, -beta, -alpha, ply + 1, 1);
    } else {
      int r = 0;
      if (s->feat & F_LMR) {
        if (depth >= 3 && seen > (pv ? 4 : 2) && quiet && !inCheck && !pos_in_check(pos, pos->side)) {
          r = LMR_TABLE[depth < 64 ? depth : 63][seen < 64 ? seen : 63];
          if (pv && r > 0) r--;
          if (r > depth - 2) r = depth - 2;
          if (r < 0) r = 0;
        }
      } else if (depth >= 3 && seen > 3 && quiet && !inCheck && !pos_in_check(pos, pos->side)) r = seen > 10 && depth >= 5 ? 2 : 1;
      v = -negamax(s, depth - 1 - r, -alpha - 1, -alpha, ply + 1, 1);
      if (v > alpha && r > 0) v = -negamax(s, depth - 1, -alpha - 1, -alpha, ply + 1, 1);
      if (v > alpha && v < beta) v = -negamax(s, depth - 1, -beta, -alpha, ply + 1, 1);
    }
    pos_unmake(pos, m);
    if (s->stopped) return 0;
    if (v > best) {
      best = v;
      bestMove = m;
      if (v > alpha) {
        alpha = v;
        if (v >= beta) {
          if (quiet) {
            int k = ply * 2;
            if (s->killers[k] != m) {
              s->killers[k + 1] = s->killers[k];
              s->killers[k] = m;
            }
            int h = movePiece(m) * 125 + moveTo(m);
            s->history[h] += depth * depth;
            if (s->history[h] > (1 << 20))
              for (int j = 0; j < 16 * 125; j++) s->history[j] >>= 1;
          }
          break;
        }
      }
    }
  }
  if (legal == 0) return inCheck ? -(MATE - ply) : 0;
  if (seen == 0) return inCheck ? -(MATE - ply) : staticEval;

  int flag = best >= beta ? LOWER : best > startAlpha ? EXACT : UPPER;
  if (s->ttFlag[slot] == 0 || s->ttCheck[slot] != pos->hashHi || depth >= s->ttDepth[slot]) {
    s->ttCheck[slot] = pos->hashHi;
    s->ttMove[slot] = bestMove;
    s->ttScore[slot] = toTT(best, ply);
    s->ttDepth[slot] = depth;
    s->ttFlag[slot] = flag;
  }
  return best;
}

// Stable insertion sort of root moves by key, descending
static void sortDesc(int *moves, int *keys, int n) {
  for (int i = 1; i < n; i++) {
    int m = moves[i], k = keys[i];
    int j = i - 1;
    while (j >= 0 && keys[j] < k) {
      moves[j + 1] = moves[j];
      keys[j + 1] = keys[j];
      j--;
    }
    moves[j + 1] = m;
    keys[j + 1] = k;
  }
}

Result searcher_search(Searcher *s, Pos *pos, const Limits *lim) {
  s->pos = pos;
  s->nodes = 0;
  s->stopped = 0;
  s->canStop = 0;
  s->rootPly = pos->ply;
  s->maxNodes = lim->maxNodes > 0 ? lim->maxNodes : 0x7fffffffffffL;
  s->qLimit = lim->quiescence > 0 ? lim->quiescence : 64;
  s->feat = lim->features;
  lmr_init();
  memset(s->killers, 0, sizeof s->killers);
  if (!lim->keepTT) {
    memset(s->history, 0, sizeof s->history);
    memset(s->ttFlag, 0, sizeof s->ttFlag);
  } else {
    for (int j = 0; j < 16 * 125; j++) s->history[j] >>= 3;
  }

  int root[512], keys[512];
  int nroot = 0;
  int end = pos_generate(pos, s->moves, 0, 0);
  for (int i = 0; i < end; i++) {
    int m = s->moves[i];
    if (pos_make(pos, m)) root[nroot++] = m;
    pos_unmake(pos, m);
  }
  Result res = {0, pos_in_check(pos, pos->side) ? -MATE : 0, 0, 0};
  if (nroot == 0) return res;
  int rootScore[512];
  for (int i = 0; i < nroot; i++) keys[i] = staticOrder(s, root[i]);
  sortDesc(root, keys, nroot);
  for (int i = 0; i < nroot; i++) rootScore[i] = -INF;

  for (int depth = 1; depth <= lim->maxDepth; depth++) {
    int best = -INF, bestMove = 0;
    int scores[512];
    int searched = 0;
    for (int i = 0; i < nroot; i++) {
      int m = root[i];
      pos_make(pos, m);
      int v;
      int floor = best;  // margin 0
      if (i == 0 || floor <= -INF) {
        v = -negamax(s, depth - 1, -INF, INF, 1, 1);
      } else {
        v = -negamax(s, depth - 1, -floor - 1, -floor, 1, 1);
        if (v > floor && !s->stopped) v = -negamax(s, depth - 1, -INF, -floor, 1, 1);
      }
      pos_unmake(pos, m);
      if (s->stopped) break;
      scores[i] = v;
      searched = i + 1;
      if (v > best) {
        best = v;
        bestMove = m;
      }
    }
    if (s->stopped && depth > 1) {
      // The JS engine drops an interrupted iteration; optionally keep a new
      // best move found in it (its score proven above the old best's line)
      if (lim->usePartial && searched > 0 && bestMove && bestMove != res.move && best > -INF) {
        // Only trust it if the first move (last iteration's best) was searched
        // and a different move beat it with an exact score
        res.move = bestMove;
        res.score = best;
      }
      break;
    }
    for (int i = 0; i < searched; i++) rootScore[i] = scores[i];
    res.move = bestMove;
    res.score = best;
    res.depth = depth;
    for (int i = 0; i < nroot; i++) keys[i] = rootScore[i];
    sortDesc(root, keys, nroot);
    for (int i = 0; i < nroot; i++) rootScore[i] = keys[i];
    s->canStop = 1;
    if (nroot == 1) break;
    if (abs(best) >= MATE_BOUND && depth >= MATE - abs(best)) break;
    if (s->nodes >= s->maxNodes) break;
  }
  res.nodes = s->nodes;
  return res;
}

// Each legal root move's score from a fixed-depth search below it (full
// window), for choosing an opening move at random among the near-best.
int searcher_root_scores(Searcher *s, Pos *pos, int depth, int *moves, int *scores) {
  s->pos = pos;
  s->nodes = 0;
  s->stopped = 0;
  s->canStop = 0;
  s->rootPly = pos->ply;
  s->maxNodes = 0x7fffffffffffL;
  s->qLimit = 64;
  memset(s->killers, 0, sizeof s->killers);
  int n = 0;
  int end = pos_generate(pos, s->moves, 0, 0);
  int list[512];
  for (int i = 0; i < end; i++) list[i] = s->moves[i];
  for (int i = 0; i < end; i++) {
    int m = list[i];
    if (pos_make(pos, m)) {
      moves[n] = m;
      scores[n] = -negamax(s, depth - 1, -INF, INF, 1, 1);
      n++;
    }
    pos_unmake(pos, m);
  }
  return n;
}

// The quiescence search's score from the side to move's view, full window: what the
// captures available settle the position at (analysis only)
int searcher_qscore(Searcher *s, Pos *pos) {
  s->pos = pos;
  s->nodes = 0;
  s->stopped = 0;
  s->canStop = 0;
  s->rootPly = pos->ply;
  s->maxNodes = 0x7fffffffffffL;
  s->qLimit = 64;
  s->feat = 0;
  memset(s->killers, 0, sizeof s->killers);
  return quiesce(s, -INF, INF, 0, 0);
}
