// Driver: verification modes against the JS engine, and self-play games.
//
//   engine moves   < lines "n f t p f t p ..."     -> each position's move list
//   engine search NODES DEPTH < same lines         -> "move score depth nodes"
//   engine play    < job lines                     -> game results (see play())
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
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

static const int DEFAULT_VALUES[6] = {100, 320, 295, 245, 140, 980};  // evaluate.ts VALUE

static Pos gpos;

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
    EvalParams ev;
    eval_init(&ev, DEFAULT_VALUES);
    printf("%d %d %d %d\n", evaluate(&ev, &gpos, 1), evaluate(&ev, &gpos, 0), pos_in_check(&gpos, gpos.side),
           pos_repeated(&gpos, gpos.ply));
  }
}

static void mode_search(long nodes, int depth, int keep, int partial, int argc_feat) {
  static char line[1 << 16];
  EvalParams ev;
  eval_init(&ev, DEFAULT_VALUES);
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

// One job a line (the last three fields optional):
//   id board side randPlies randMargin seed nodesW nodesB valsW valsB record keepTT [dump featW featB]
// keepTT is a bitmask (1 White, 2 Black); feat* are F_* search improvements; dump
// prints every dump-th quiet position as "B id ply side score board".
// Output: "R id result plies reason material depthW depthB" (result for White: 1,
// 0.5, 0; material the final counts P N B R U Q per side, in hex) and, with
// record, "S id" then run-length tokens sig:quiet:count of each position.
static void mode_play(int resign, int maxPlies) {
  static char line[4096];
  static char board[256], valsW[64], valsB[64];
  while (fgets(line, sizeof line, stdin)) {
    long id, nodes[2];
    int side, randPlies, randMargin, record, keep, dump = 0, feat[2] = {0, 0};
    unsigned long seed;
    int nf = sscanf(line, "%ld %200s %d %d %d %lu %ld %ld %60s %60s %d %d %d %d %d", &id, board, &side, &randPlies, &randMargin,
                    &seed, &nodes[0], &nodes[1], valsW, valsB, &record, &keep, &dump, &feat[0], &feat[1]);
    if (nf < 12) {
      fprintf(stderr, "bad job: %s", line);
      exit(1);
    }
    rng_state = seed * 0x9E3779B97F4A7C15ull + 12345;
    for (int i = 0; i < 5; i++) rnd();
    int vw[6], vb[6];
    parse_values(valsW, vw);
    parse_values(valsB, vb);
    static EvalParams evs[2];
    eval_init(&evs[0], vw);
    eval_init(&evs[1], vb);
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
  else if (!strcmp(argv[1], "play"))
    mode_play(argc > 2 ? atoi(argv[2]) : 0, argc > 3 ? atoi(argv[3]) : 1000);
  else {
    fprintf(stderr, "unknown mode\n");
    return 1;
  }
  return 0;
}
