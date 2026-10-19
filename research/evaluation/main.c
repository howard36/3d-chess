// Driver: verification modes against the JS engine, and self-play games.
//
//   engine moves   < lines "n f t p f t p ..."     -> each position's move list
//   engine search NODES DEPTH < same lines         -> "move score depth nodes"
//   engine play    < job lines                     -> game results (see play())
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include "engine.h"

static int find_move(Pos *p, int from, int to, int promo) {
  int32_t moves[512];
  int n = pos_legal_moves(p, moves);
  for (int i = 0; i < n; i++)
    if (moveFrom(moves[i]) == from && moveTo(moves[i]) == to && movePromotion(moves[i]) == promo) return moves[i];
  return 0;
}

static int read_records(Pos *p, char *line) {
  pos_start(p);
  char *tok = strtok(line, " \t\n");
  if (!tok) return 0;
  int n = atoi(tok);
  for (int i = 0; i < n; i++) {
    int f = atoi(strtok(NULL, " \t\n"));
    int t = atoi(strtok(NULL, " \t\n"));
    int pr = atoi(strtok(NULL, " \t\n"));
    int m = find_move(p, f, t, pr);
    if (!m) {
      fprintf(stderr, "illegal record %d %d %d at %d\n", f, t, pr, i);
      exit(1);
    }
    pos_make(p, m);
  }
  return 1;
}

static const int DEFAULT_VALUES[6] = {100, 320, 295, 245, 140, 980};

static Pos gpos;
static void default_eval(EvalParams *e);

static void mode_moves(void) {
  static char line[1 << 16];
  int32_t out[1024];
  while (fgets(line, sizeof line, stdin)) {
    if (!read_records(&gpos, line)) continue;
    int n = pos_generate(&gpos, out, 0, 0);
    for (int i = 0; i < n; i++) printf("%d%c", out[i], i + 1 < n ? ' ' : '\n');
    if (!n) printf("\n");
    n = pos_generate(&gpos, out, 0, 1);
    printf("%d|", n);
    static EvalParams ev;
    default_eval(&ev);
    printf("%d %d %d %d\n", evaluate(&ev, &gpos, 1), evaluate(&ev, &gpos, 0), pos_in_check(&gpos, gpos.side),
           pos_repeated(&gpos, gpos.ply));
  }
}

static void mode_search(long nodes, int depth, int keep, int partial, int argc_feat) {
  static char line[1 << 16];
  static EvalParams ev;
  default_eval(&ev);
  Searcher *s = searcher_new(&ev);
  Limits lim = {depth, nodes, 64, keep, partial, argc_feat};
  while (fgets(line, sizeof line, stdin)) {
    if (!read_records(&gpos, line)) continue;
    Result r = searcher_search(s, &gpos, &lim);
    printf("%d %d %d %ld\n", r.move, r.score, r.depth, r.nodes);
    fflush(stdout);
  }
}

// --- Self-play ---------------------------------------------------------------

static uint64_t rng_state;
static uint32_t rnd(void) {
  rng_state ^= rng_state << 13;
  rng_state ^= rng_state >> 7;
  rng_state ^= rng_state << 17;
  return (uint32_t)(rng_state >> 11);
}

int searcher_root_scores(Searcher *s, Pos *pos, int depth, int *moves, int *scores);

static const char *LETTERS = ".PNBRUQK";

static void parse_board(Pos *p, const char *b, int side) {
  memset(p->board, 0, CELLS);
  for (int c = 0; c < CELLS; c++) {
    char ch = b[c];
    if (ch == '.') continue;
    int black = ch >= 'a' && ch <= 'z';
    char u = black ? ch - 32 : ch;
    const char *at = strchr(LETTERS, u);
    if (!at || u == '.') {
      fprintf(stderr, "bad board char %c\n", ch);
      exit(1);
    }
    p->board[c] = (int)(at - LETTERS) | (black ? BLACK : 0);
  }
  pos_reset(p, side, 0);
}

static void signature(const Pos *p, char *out) {
  int cnt[2][8] = {{0}};
  for (int c = 0; c < CELLS; c++) {
    int q = p->board[c];
    if (q) cnt[q >> 3][q & 7]++;
  }
  // P N B R U Q for White then Black, one hex digit each
  int k = 0;
  for (int side = 0; side < 2; side++)
    for (int t = 1; t <= 6; t++) out[k++] = "0123456789abcdef"[cnt[side][t] > 15 ? 15 : cnt[side][t]];
  out[k] = 0;
}

static void parse_values(const char *s, int *v) {
  if (sscanf(s, "%d,%d,%d,%d,%d,%d", &v[0], &v[1], &v[2], &v[3], &v[4], &v[5]) != 6) {
    fprintf(stderr, "bad values %s\n", s);
    exit(1);
  }
}

// "100,320,..." the game's evaluation at those piece values; "@file" a whole
// evaluation: 58 numbers (eval_features' layout) then the 6 values to order by
static void init_eval_spec(EvalParams *e, const char *s) {
  if (s[0] != '@') {
    int v[6];
    parse_values(s, v);
    eval_init(e, v);
    return;
  }
  FILE *f = fopen(s + 1, "r");
  if (!f) { fprintf(stderr, "no file %s\n", s + 1); exit(1); }
  double th[NTHETA];
  int v[6];
  for (int i = 0; i < NTHETA; i++) if (fscanf(f, "%lf", &th[i]) != 1) { fprintf(stderr, "short %s\n", s + 1); exit(1); }
  for (int i = 0; i < 6; i++) if (fscanf(f, "%d", &v[i]) != 1) { fprintf(stderr, "short %s\n", s + 1); exit(1); }
  double x[25];
  int nx = 0;
  while (nx < 25 && fscanf(f, "%lf", &x[nx]) == 1) nx++;
  fclose(f);
  eval_init_theta(e, th, v);
  if (nx >= 6) {
    e->ext = 1;
    e->xa = x[0]; e->xb = x[1]; e->xshield = x[2]; e->xpass_mg = x[3]; e->xpass_eg = x[4]; e->xthreat = x[5];
  }
  if (nx == 25 || nx == 14) {   // and the further extensions, after the fractional weights or without them
    const double *y = x + (nx == 25 ? 17 : 6);
    e->ext2 = 1;
    e->ythreat = y[0]; e->ykzone = y[1]; e->ytempo = y[2]; e->yprot = y[3];
    e->ychain = y[4]; e->yiso = y[5]; e->ykq = y[6]; e->yspare = y[7];
  }
  if (nx == 17 || nx == 25) {   // fractional mobility N B R U Q, king pressure N B R U Q, bishop pair
    e->frac = 1;
    for (int t = 0; t < 5; t++) { e->dmob[KNIGHT + t] = x[6 + t]; e->dtrop[KNIGHT + t] = x[11 + t]; }
    e->dbpair = x[16];
  } else if (nx != 0 && nx != 6 && nx != 14) { fprintf(stderr, "extensions need 6, 14, 17 or 25 numbers: %s\n", s + 1); exit(1); }
}

// The evaluation the moves and search modes use: the game's, or the one PV_EVAL names
static void default_eval(EvalParams *e) {
  const char *s = getenv("PV_EVAL");
  if (s && *s) init_eval_spec(e, s);
  else eval_init(e, DEFAULT_VALUES);
}

// One job a line:
//   id board side randPlies randMargin seed nodesW nodesB valsW valsB record keepTT
// Output: "R id result plies reason" (result for White: 1, 0.5, 0) and, with
// record, "S id" then run-length tokens sig:quiet:count of each position.
static void mode_play(int resign, int maxPlies) {
  static char line[4096];
  static char board[256], valsW[256], valsB[256];
  while (fgets(line, sizeof line, stdin)) {
    long id, nodes[2];
    int side, randPlies, randMargin, record, keep, dump = 0, feat[2] = {0, 0};
    unsigned long seed;
    int nf = sscanf(line, "%ld %200s %d %d %d %lu %ld %ld %250s %250s %d %d %d %d %d", &id, board, &side, &randPlies, &randMargin,
                    &seed, &nodes[0], &nodes[1], valsW, valsB, &record, &keep, &dump, &feat[0], &feat[1]);
    if (nf < 12) {
      fprintf(stderr, "bad job: %s", line);
      exit(1);
    }
    rng_state = seed * 0x9E3779B97F4A7C15ull + 12345;
    for (int i = 0; i < 5; i++) rnd();
    static EvalParams evs[2];
    init_eval_spec(&evs[0], valsW);
    init_eval_spec(&evs[1], valsB);
    static Searcher *ss[2];
    if (!ss[0]) {
      ss[0] = searcher_new(&evs[0]);
      ss[1] = searcher_new(&evs[1]);
    }
    // fresh searchers per game (clear tables)
    searcher_free(ss[0]);
    searcher_free(ss[1]);
    ss[0] = searcher_new(&evs[0]);
    ss[1] = searcher_new(&evs[1]);
    Pos *p = &gpos;
    parse_board(p, board, side);
    double result = 0.5;
    const char *reason = "maxply";
    int resignCount[2] = {0, 0};
    long depthSum[2] = {0, 0}, depthN[2] = {0, 0};
    int lastScore[2] = {0, 0};
    // run-length record
    static char rec[1 << 20];
    int recLen = 0;
    char prevSig[16] = "";
    int prevQuiet = -1, runCount = 0;
    int plies = 0;
    int32_t legal[512];
    for (;;) {
      int nlegal = pos_legal_moves(p, legal);
      int inCheck = pos_in_check(p, p->side);
      if (nlegal == 0) {
        if (inCheck) {
          result = p->side == WHITE_SIDE ? 0 : 1;
          reason = "mate";
        } else {
          result = 0.5;
          reason = "stalemate";
        }
        break;
      }
      if (pos_halfmoves(p) >= 100) {
        result = 0.5;
        reason = "fifty";
        break;
      }
      if (pos_repeated(p, p->ply)) {
        result = 0.5;
        reason = "repetition";
        break;
      }
      if (plies >= maxPlies) {
        result = 0.5;
        reason = "maxply";
        break;
      }
      int me = p->side;
      int move;
      int score = 0;
      if (plies < randPlies) {
        int ms[512], sc[512];
        int n = searcher_root_scores(ss[me], p, 2, ms, sc);
        int best = -INF;
        for (int i = 0; i < n; i++)
          if (sc[i] > best) best = sc[i];
        int pool[512], np = 0;
        for (int i = 0; i < n; i++)
          if (sc[i] >= best - randMargin) pool[np++] = ms[i];
        move = pool[rnd() % np];
      } else {
        int kme = (keep >> me) & 1;
        Limits lim = {64, nodes[me], 64, kme, kme, feat[me]};
        Result r = searcher_search(ss[me], p, &lim);
        depthSum[me] += r.depth;
        depthN[me]++;
        move = r.move;
        score = r.score;
      }
      if (record) {
        char sig[16];
        signature(p, sig);
        int quiet = !inCheck && !moveCaptured(move) && !movePromotion(move) && plies >= randPlies;
        if (runCount > 0 && quiet == prevQuiet && strcmp(sig, prevSig) == 0)
          runCount++;
        else {
          if (runCount > 0) recLen += sprintf(rec + recLen, " %s:%d:%d", prevSig, prevQuiet, runCount);
          strcpy(prevSig, sig);
          prevQuiet = quiet;
          runCount = 1;
        }
      }
      // Resign adjudication: 8 plies in a row (4 each side) agreeing that
      // one side stands `resign` cp or more ahead
      if (resign > 0 && plies >= randPlies) {
        int ws = me == WHITE_SIDE ? score : -score;
        int verdict = ws >= resign ? 1 : ws <= -resign ? -1 : 0;
        if (verdict != 0 && verdict == lastScore[0]) resignCount[0]++;
        else resignCount[0] = verdict != 0;
        lastScore[0] = verdict;
        if (resignCount[0] >= 8) {
          result = verdict > 0 ? 1 : 0;
          reason = "adjudicated";
          break;
        }
      }
      if (dump > 0 && plies >= randPlies && plies % dump == 0 && !inCheck && !moveCaptured(move) && !movePromotion(move)) {
        char bs[CELLS + 1];
        for (int c = 0; c < CELLS; c++) {
          int q = p->board[c];
          char ch = LETTERS[q & 7];
          bs[c] = (q & BLACK) ? ch + 32 : ch;
        }
        bs[CELLS] = 0;
        printf("B %ld %d %d %d %s\n", id, plies, p->side, score, bs);
      }
      pos_make(p, move);
      plies++;
    }
    if (record && runCount > 0) recLen += sprintf(rec + recLen, " %s:%d:%d", prevSig, prevQuiet, runCount);
    char fsig[16];
    signature(p, fsig);
    printf("R %ld %g %d %s %s %.2f %.2f\n", id, result, plies, reason, fsig, depthN[0] ? (double)depthSum[0] / depthN[0] : 0,
           depthN[1] ? (double)depthSum[1] / depthN[1] : 0);
    if (record) printf("S %ld%s\n", id, rec);
    fflush(stdout);
  }
}

int eval_decompose(const EvalParams *e, const Pos *p, double out[2][8][4]);
// decomp < lines "board side": per position, the phase and, per side and type,
// count table mobility pressure
static void mode_decomp(void) {
  static char line[4096], board[256];
  EvalParams ev;
  eval_init(&ev, DEFAULT_VALUES);
  while (fgets(line, sizeof line, stdin)) {
    int side;
    if (sscanf(line, "%200s %d", board, &side) != 2) continue;
    parse_board(&gpos, board, side);
    double out[2][8][4] = {{{0}}};
    int phase = eval_decompose(&ev, &gpos, out);
    printf("%d", phase);
    for (int s = 0; s < 2; s++)
      for (int t = 1; t <= 6; t++) printf(" %g %g %g %g", out[s][t][0], out[s][t][1], out[s][t][2], out[s][t][3]);
    printf("\n");
  }
}

void eval_worth(const EvalParams *e, const Pos *p, double out[8][2]);
// worth <spec> < lines "board side": each piece's average worth to that evaluation, in pawns
// (the pawn's own average worth), by phase (pieces besides kings and pawns: 1-5, 6-11, 12+)
// and the three phases weighted equally
static void mode_worth(const char *spec) {
  static char line[4096], board[256];
  static EvalParams ev;
  init_eval_spec(&ev, spec);
  double agg[3][8][2] = {{{0}}};
  while (fgets(line, sizeof line, stdin)) {
    int side;
    if (sscanf(line, "%200s %d", board, &side) != 2) continue;
    int n = 0;
    for (const char *ch = board; *ch; ch++) if (strchr("NBRUQnbruq", *ch)) n++;
    if (n == 0) continue;
    int b = n <= 5 ? 0 : n <= 11 ? 1 : 2;
    parse_board(&gpos, board, side);
    double out[8][2] = {{0}};
    eval_worth(&ev, &gpos, out);
    for (int t = 0; t < 8; t++) { agg[b][t][0] += out[t][0]; agg[b][t][1] += out[t][1]; }
  }
  static const char *NM = "?PNBRUQK";
  double mean[8] = {0};
  for (int b = 0; b < 3; b++) {
    double pawn = agg[b][PAWN][1] / agg[b][PAWN][0];
    printf("phase %d: pawn %.1f cp;", b, pawn);
    for (int t = KNIGHT; t <= QUEEN; t++) {
      double w = agg[b][t][1] / agg[b][t][0] / pawn;
      mean[t] += w / 3;
      printf(" %c %.2f", NM[t], w);
    }
    printf("\n");
  }
  printf("all:");
  for (int t = KNIGHT; t <= QUEEN; t++) printf(" %c %.2f", NM[t], mean[t]);
  printf("\n");
}

int eval_features(const EvalParams *e, const Pos *p, double *f, double *offset);
// features < lines "board side": the evaluation's features (see engine.c), the lead term,
// and evaluate() from White's view, for fitting the evaluation to results
static void mode_features(void) {
  static char line[4096], board[256];
  EvalParams ev;
  eval_init(&ev, DEFAULT_VALUES);
  double f[64], off;
  while (fgets(line, sizeof line, stdin)) {
    int side;
    if (sscanf(line, "%200s %d", board, &side) != 2) continue;
    parse_board(&gpos, board, side);
    eval_features(&ev, &gpos, f, &off);
    int e = evaluate(&ev, &gpos, 1);
    if (gpos.side == BLACK_SIDE) e = -e;
    for (int j = 0; j < 58; j++) printf("%g ", f[j]);
    printf("%g %d\n", off, e);
  }
}

int searcher_qscore(Searcher *s, Pos *pos);
// quiet < lines "board side": static evaluation and quiescence score, side to move's view
static void mode_quiet(void) {
  static char line[4096], board[256];
  EvalParams ev;
  eval_init(&ev, DEFAULT_VALUES);
  Searcher *s = searcher_new(&ev);
  while (fgets(line, sizeof line, stdin)) {
    int side;
    if (sscanf(line, "%200s %d", board, &side) != 2) continue;
    parse_board(&gpos, board, side);
    int st = evaluate(&ev, &gpos, 1);
    int q = searcher_qscore(s, &gpos);
    printf("%d %d %d\n", st, q, pos_in_check(&gpos, gpos.side));
    fflush(stdout);
  }
}

// --- Fitting the evaluation to deeper searches (research) -----------------------

static void board_string(const Pos *p, char *bs) {
  for (int c = 0; c < CELLS; c++) {
    int q = p->board[c];
    char ch = LETTERS[q & 7];
    bs[c] = (q & BLACK) ? ch + 32 : ch;
  }
  bs[CELLS] = 0;
}

static int is_quiet(const EvalParams *ev, Searcher *s, Pos *p) {
  if (pos_in_check(p, p->side)) return 0;
  return abs(evaluate(ev, p, 1) - searcher_qscore(s, p)) <= 50;
}

// sample <seed> < lines "board side": each quiet position, and the position after one random
// legal move from it if that is quiet too (not in check, and the capture-only search within 50
// of the static evaluation), as lines "board side"
static void mode_sample(unsigned long seed) {
  static char line[4096], board[256], bs[CELLS + 1];
  rng_state = seed * 0x9E3779B97F4A7C15ull + 12345;
  for (int i = 0; i < 5; i++) rnd();
  static EvalParams ev;
  eval_init(&ev, DEFAULT_VALUES);
  Searcher *s = searcher_new(&ev);
  int32_t legal[512];
  while (fgets(line, sizeof line, stdin)) {
    int side;
    if (sscanf(line, "%200s %d", board, &side) != 2) continue;
    parse_board(&gpos, board, side);
    if (pos_legal_moves(&gpos, legal) == 0) continue;
    if (is_quiet(&ev, s, &gpos)) printf("%s %d\n", board, side);
    int n = pos_legal_moves(&gpos, legal);
    pos_make(&gpos, legal[rnd() % n]);
    if (pos_legal_moves(&gpos, legal) > 0 && is_quiet(&ev, s, &gpos)) {
      board_string(&gpos, bs);
      printf("%s %d\n", bs, gpos.side);
    }
    fflush(stdout);
  }
}

// label <nodes> <feat> < lines "board side": the score of a search from each position (side to
// move), the game's evaluation, a fresh table each search
static void mode_label(long nodes, int feat) {
  static char line[4096], board[256];
  static EvalParams ev;
  eval_init(&ev, DEFAULT_VALUES);
  Searcher *s = searcher_new(&ev);
  Limits lim = {64, nodes, 64, 0, feat ? 1 : 0, feat};
  while (fgets(line, sizeof line, stdin)) {
    int side;
    if (sscanf(line, "%200s %d", board, &side) != 2) continue;
    parse_board(&gpos, board, side);
    Result r = searcher_search(s, &gpos, &lim);
    printf("%s %d %d\n", board, side, r.score);
    fflush(stdout);
  }
}

static void eval_from_numbers(EvalParams *e, const double *x, int n) {
  int v[6];
  for (int i = 0; i < 6; i++) v[i] = (int)x[NTHETA + i];
  eval_init_theta(e, x, v);
  if (n >= NTHETA + 12) {
    e->ext = 1;
    e->xa = x[64]; e->xb = x[65]; e->xshield = x[66]; e->xpass_mg = x[67]; e->xpass_eg = x[68]; e->xthreat = x[69];
  }
  if (n >= NTHETA + 23) {
    e->frac = 1;
    for (int t = 0; t < 5; t++) { e->dmob[KNIGHT + t] = x[70 + t]; e->dtrop[KNIGHT + t] = x[75 + t]; }
    e->dbpair = x[80];
  }
}

// loss <file of "board side label"> < lines of evaluation numbers (as an @file): per line, the
// summed squared difference in expected score (logistic, 400 cp a factor of ten) between the
// evaluation and the labels, and the number of positions
static void mode_loss(const char *path) {
  FILE *f = fopen(path, "r");
  if (!f) { fprintf(stderr, "no file %s\n", path); exit(1); }
  static char line[1 << 14], board[256];
  int cap = 1 << 16, n = 0;
  char *boards = malloc((size_t)cap * CELLS);
  int *sides = malloc(sizeof(int) * cap);
  double *target = malloc(sizeof(double) * cap);
  int lab;
  while (fgets(line, sizeof line, f)) {
    int side;
    if (sscanf(line, "%200s %d %d", board, &side, &lab) != 3) continue;
    if (n == cap) {
      cap *= 2;
      boards = realloc(boards, (size_t)cap * CELLS);
      sides = realloc(sides, sizeof(int) * cap);
      target = realloc(target, sizeof(double) * cap);
    }
    memcpy(boards + (size_t)n * CELLS, board, CELLS);
    sides[n] = side;
    if (lab > 3000) lab = 3000;
    if (lab < -3000) lab = -3000;
    target[n] = 1 / (1 + pow(10, -lab / 400.0));
    n++;
  }
  fclose(f);
  static EvalParams ev;
  char bs[CELLS + 1];
  bs[CELLS] = 0;
  // the evaluation's scale against the labels' (LOSS_K; 1 for search scores)
  double lossK = getenv("LOSS_K") ? atof(getenv("LOSS_K")) : 1.0;
  while (fgets(line, sizeof line, stdin)) {
    double x[96];
    int k = 0;
    char *q = line, *end;
    while (k < 96) {
      double d = strtod(q, &end);
      if (end == q) break;
      x[k++] = d;
      q = end;
    }
    if (k < NTHETA + 6) { printf("nan 0\n"); fflush(stdout); continue; }
    eval_from_numbers(&ev, x, k);
    double sum = 0;
    for (int i = 0; i < n; i++) {
      memcpy(bs, boards + (size_t)i * CELLS, CELLS);
      parse_board(&gpos, bs, sides[i]);
      int e = evaluate(&ev, &gpos, 1);
      double d = 1 / (1 + pow(10, -lossK * e / 400.0)) - target[i];
      sum += d * d;
    }
    printf("%.10f %d\n", sum, n);
    fflush(stdout);
  }
}

// removal <spec> < lines "board side": what the evaluation (static, mobility included, White's
// view) says each piece is worth, as the drop when it alone is taken off the board, from its own
// side's view; per piece type and phase (pieces besides kings and pawns: 1-5, 6-11, 12+), in
// pawns (the same drop for a pawn), and the phases weighted equally
static void mode_removal(const char *spec) {
  static char line[4096], board[256], b2[256];
  static EvalParams ev;
  init_eval_spec(&ev, spec);
  double sum[3][8] = {{0}}, cnt[3][8] = {{0}};
  while (fgets(line, sizeof line, stdin)) {
    int side;
    if (sscanf(line, "%200s %d", board, &side) != 2) continue;
    int n = 0;
    for (const char *ch = board; *ch; ch++) if (strchr("NBRUQnbruq", *ch)) n++;
    if (n == 0) continue;
    int bucket = n <= 5 ? 0 : n <= 11 ? 1 : 2;
    parse_board(&gpos, board, side);
    int e0 = evaluate(&ev, &gpos, 1);
    double base = side == 0 ? e0 : -e0;
    for (int c = 0; c < CELLS; c++) {
      char ch = board[c];
      if (ch == '.' || ch == 'K' || ch == 'k') continue;
      int black = ch >= 'a' && ch <= 'z';
      int t = (int)(strchr(LETTERS, black ? ch - 32 : ch) - LETTERS);
      memcpy(b2, board, CELLS + 1);
      b2[c] = '.';
      parse_board(&gpos, b2, side);
      int e1 = evaluate(&ev, &gpos, 1);
      double without = side == 0 ? e1 : -e1;
      sum[bucket][t] += (black ? -1 : 1) * (base - without);
      cnt[bucket][t] += 1;
    }
  }
  static const char *NM = "?PNBRUQK";
  if (getenv("RAW")) {   // the mean drop in centipawns, per phase: P N B R U Q
    for (int b = 0; b < 3; b++) {
      printf("raw %d", b);
      for (int t = PAWN; t <= QUEEN; t++) printf(" %.4f", sum[b][t] / cnt[b][t]);
      printf("\n");
    }
    return;
  }
  double mean[8] = {0};
  for (int b = 0; b < 3; b++) {
    double pawn = sum[b][PAWN] / cnt[b][PAWN];
    printf("phase %d: pawn %.1f cp;", b, pawn);
    for (int t = KNIGHT; t <= QUEEN; t++) {
      double w = sum[b][t] / cnt[b][t] / pawn;
      mean[t] += w / 3;
      printf(" %c %.2f", NM[t], w);
    }
    printf("\n");
  }
  printf("all:");
  for (int t = KNIGHT; t <= QUEEN; t++) printf(" %c %.2f", NM[t], mean[t]);
  printf("\n");
}


// evdump <spec> < lines "board side label": the static evaluation (side to move's view, as the loss
// takes it), the label, the material difference P N B R U Q (side to move's less the other's), and
// the phase (pieces besides kings and pawns: 1-5, 6-11, 12+, as 0 1 2; none, -1)
static void mode_evdump(const char *spec) {
  static char line[4096], board[256];
  static EvalParams ev;
  init_eval_spec(&ev, spec);
  while (fgets(line, sizeof line, stdin)) {
    int side, lab = 0;
    if (sscanf(line, "%200s %d %d", board, &side, &lab) < 2) continue;
    parse_board(&gpos, board, side);
    int e = evaluate(&ev, &gpos, 1);
    int d[8] = {0}, n = 0;
    for (int c = 0; c < CELLS; c++) {
      char ch = board[c];
      if (ch == '.') continue;
      int black = ch >= 'a' && ch <= 'z';
      int t = (int)(strchr(LETTERS, black ? ch - 32 : ch) - LETTERS);
      d[t] += (black == side) ? 1 : -1;
      if (t >= KNIGHT && t <= QUEEN) n++;
    }
    int bucket = n == 0 ? -1 : n <= 5 ? 0 : n <= 11 ? 1 : 2;
    printf("%d %d %d %d %d %d %d %d %d\n", e, lab, d[1], d[2], d[3], d[4], d[5], d[6], bucket);
  }
}

// a row as evdump writes it: the evaluation (side to move's view), a label, the material difference
// P N B R U Q (side to move's less the other's), the phase (pieces besides kings and pawns: 1-5,
// 6-11, 12+, as 0 1 2; none, -1)
static void print_row(int e, int lab, const char *board, int side, int kind) {
  int d[8] = {0}, n = 0;
  for (int c = 0; c < CELLS; c++) {
    char ch = board[c];
    if (ch == '.') continue;
    int black = ch >= 'a' && ch <= 'z';
    int t = (int)(strchr(LETTERS, black ? ch - 32 : ch) - LETTERS);
    d[t] += (black == side) ? 1 : -1;
    if (t >= KNIGHT && t <= QUEEN) n++;
  }
  int bucket = n == 0 ? -1 : n <= 5 ? 0 : n <= 11 ? 1 : 2;
  printf("%d %d %d %d %d %d %d %d %d %d\n", e, lab, d[1], d[2], d[3], d[4], d[5], d[6], bucket, kind);
}

// augment <spec> <seed> <per> < lines "board side label": each position that is quiet by the
// evaluation's own capture search (not in check, the capture-only search within 50 of the static
// evaluation), and up to <per> copies of it with one piece besides the kings taken off at random,
// each still legal (the side not to move not in check) and quiet, so that no copy leaves a piece
// hanging the evaluation cannot see; rows as evdump with a last column, 0 the position and 1 a copy
// (whose label is 9999: none)
static void mode_augment(const char *spec, unsigned long seed, int per) {
  static char line[4096], board[256], b2[256];
  static EvalParams ev;
  init_eval_spec(&ev, spec);
  Searcher *s = searcher_new(&ev);
  rng_state = seed * 0x9E3779B97F4A7C15ull + 777;
  for (int i = 0; i < 5; i++) rnd();
  int32_t legal[512];
  int cells[CELLS];
  while (fgets(line, sizeof line, stdin)) {
    int side, lab = 0;
    if (sscanf(line, "%200s %d %d", board, &side, &lab) < 2) continue;
    parse_board(&gpos, board, side);
    if (pos_legal_moves(&gpos, legal) == 0 || !is_quiet(&ev, s, &gpos)) continue;
    print_row(evaluate(&ev, &gpos, 1), lab, board, side, 0);
    int n = 0;
    for (int c = 0; c < CELLS; c++) if (board[c] != '.' && board[c] != 'K' && board[c] != 'k') cells[n++] = c;
    for (int i = n - 1; i > 0; i--) { int j = (int)(rnd() % (unsigned)(i + 1)), t = cells[i]; cells[i] = cells[j]; cells[j] = t; }
    int made = 0;
    for (int i = 0; i < n && made < per; i++) {
      memcpy(b2, board, CELLS + 1);
      b2[cells[i]] = '.';
      parse_board(&gpos, b2, side);
      if (pos_in_check(&gpos, side ^ 1) || pos_legal_moves(&gpos, legal) == 0 || !is_quiet(&ev, s, &gpos)) continue;
      print_row(evaluate(&ev, &gpos, 1), 9999, b2, side, 1);
      made++;
    }
  }
}

int main(int argc, char **argv) {
  init_tables();
  if (argc < 2) {
    fprintf(stderr, "usage\n");
    return 1;
  }
  if (!strcmp(argv[1], "moves")) mode_moves();
  else if (!strcmp(argv[1], "search"))
    mode_search(atol(argv[2]), atoi(argv[3]), argc > 4 ? atoi(argv[4]) : 0, argc > 5 ? atoi(argv[5]) : 0,
                argc > 6 ? atoi(argv[6]) : 0);
  else if (!strcmp(argv[1], "quiet"))
    mode_quiet();
  else if (!strcmp(argv[1], "features"))
    mode_features();
  else if (!strcmp(argv[1], "augment"))
    mode_augment(argv[2], strtoul(argv[3], 0, 10), atoi(argv[4]));
  else if (!strcmp(argv[1], "evdump"))
    mode_evdump(argv[2]);
  else if (!strcmp(argv[1], "removal"))
    mode_removal(argv[2]);
  else if (!strcmp(argv[1], "sample"))
    mode_sample(strtoul(argv[2], 0, 10));
  else if (!strcmp(argv[1], "label"))
    mode_label(atol(argv[2]), atoi(argv[3]));
  else if (!strcmp(argv[1], "loss"))
    mode_loss(argv[2]);
  else if (!strcmp(argv[1], "worth"))
    mode_worth(argv[2]);
  else if (!strcmp(argv[1], "decomp"))
    mode_decomp();
  else if (!strcmp(argv[1], "play"))
    mode_play(argc > 2 ? atoi(argv[2]) : 0, argc > 3 ? atoi(argv[3]) : 1000);
  else {
    fprintf(stderr, "unknown mode\n");
    return 1;
  }
  return 0;
}
