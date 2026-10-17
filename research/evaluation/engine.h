// A C port of client/src/ai (position.ts, evaluate.ts, search.ts), for
// measuring piece values by self-play. Faithful to the JS move for move and
// node for node in "classic" mode; piece values are per engine instance.
#pragma once
#include <stdint.h>

enum { PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, UNICORN = 5, QUEEN = 6, KING = 7, BLACK = 8 };
#define CELLS 125
#define DIRS 26
#define WHITE_SIDE 0
#define BLACK_SIDE 1
#define MAX_GAME_PLIES 4096

extern int8_t CX[CELLS], CY[CELLS], CZ[CELLS];

static inline int moveFrom(int m) { return m & 127; }
static inline int moveTo(int m) { return (m >> 7) & 127; }
static inline int movePromotion(int m) { return (m >> 14) & 7; }
static inline int moveCaptured(int m) { return (m >> 17) & 15; }
static inline int movePiece(int m) { return (m >> 21) & 15; }

typedef struct {
  uint8_t board[CELLS];
  int side;
  int16_t king[2];
  uint32_t occ[8];
  int32_t hashLo, hashHi;
  int32_t history[(MAX_GAME_PLIES + 128) * 2];
  int16_t clocks[MAX_GAME_PLIES + 128];
  int ply;
} Pos;

void init_tables(void);
void pos_start(Pos *p);
void pos_reset(Pos *p, int side, int halfmoves);
int pos_generate(const Pos *p, int32_t *out, int start, int noisy);
int pos_make(Pos *p, int move);
void pos_unmake(Pos *p, int move);
void pos_make_null(Pos *p);
void pos_unmake_null(Pos *p);
int pos_attacked(const Pos *p, int target, int by);
int pos_in_check(const Pos *p, int side);
int pos_repeated(const Pos *p, int root);
int pos_mobility(const Pos *p, const int *weights);
double pos_mobility_d(const Pos *p, const double *weights);
int pos_legal_moves(Pos *p, int32_t *out);
static inline int pos_halfmoves(const Pos *p) { return p->clocks[p->ply]; }

typedef struct {
  int value[8];
  int16_t MG[16 * CELLS];
  int16_t EG[16 * CELLS];
  int mob[8];   // mobility weight per type
  int trop[8];  // pressure on the enemy king per type
  int bpair;    // the bishop pair
  // Extensions (research only; all zero is the game's evaluation): each king's table, and the
  // pressure on it, blended by its own danger rather than the game's phase: (1-a-b) phase +
  // a (the enemy's pieces, queen 4, others 1, out of 12) + b (the enemy has a queen); own pawns
  // next to the king, at that danger; passed pawns by progress (middlegame, endgame); a pawn
  // attacking an enemy piece (not a pawn or king).
  int ext;
  double xa, xb, xshield, xpass_mg, xpass_eg, xthreat;
  // Fractional weights (research; with ext): mobility and king pressure per type, bishop pair
  int frac;
  double dmob[8], dtrop[8], dbpair;
} EvalParams;

#define NTHETA 58
void eval_init(EvalParams *e, const int *values /* P N B R U Q, centipawns */);
// The evaluation from its 58 numbers (layout as eval_features) and the values
// the search orders and prunes by
void eval_init_theta(EvalParams *e, const double *theta, const int *values);
int evaluate(const EvalParams *e, const Pos *p, int full);
int mobility_score(const EvalParams *e, const Pos *p);

#define INF 32000
#define MATE 31000
#define MATE_BOUND (MATE - 512)

typedef struct Searcher Searcher;
#define F_LMP 1
#define F_LMR 2
#define F_FUT 4
#define F_QSEE 8
#define F_RFP 16

typedef struct {
  int maxDepth;
  long maxNodes;
  int quiescence;
  // Search improvements (0 = the JS engine exactly)
  int keepTT;      // keep the transposition table, history between searches
  int usePartial;  // use the best root move of an interrupted iteration
  int features;    // F_* search improvements
} Limits;

typedef struct {
  int move;
  int score;
  int depth;
  long nodes;
} Result;

Searcher *searcher_new(const EvalParams *e);
void searcher_free(Searcher *s);
Result searcher_search(Searcher *s, Pos *p, const Limits *lim);
