"""The evaluation's numbers: the game's current ones (layout as engine.c's eval_features), their
names, the ones no position can use, a sensible change for each (SPSA's perturbation), the values
the search orders captures and counts the lead by, and evaluation files built from them.

An evaluation file (the engine's @file): 58 numbers, the 6 values (P N B R U Q), then optionally
6 extension terms (king danger by the enemy's force and queen, pawns by the king, passed pawns
middlegame and endgame, pawn threats) and 11 fractional weights (mobility N B R U Q, king pressure
N B R U Q, bishop pair) that replace the whole-number ones."""
import numpy as np

NAMES = ([f'P mg {i}' for i in range(9)] + [f'P eg {i}' for i in range(9)] + ['P file c', 'P file b/d'] +
         [f'{p} {k}' for p in 'NBU' for k in ('mg0', 'mg/c', 'home', 'eg0', 'eg/c')] +
         [f'{p} {k}' for p in 'RQ' for k in ('mg0', 'mg/c', 'eg0', 'eg/c')] +
         ['K mg/out', 'K mg/file', 'K eg0', 'K eg/c'] + [f'mob {p}' for p in 'NBRUQ'] +
         [f'trop {p}' for p in 'NBRUQ'] + ['bishop pair'])
NAMES_X = ['x force', 'x queen', 'x shield', 'x pass mg', 'x pass eg', 'x threat']
OLD = np.array([100, 100, 106, 114, 124, 136, 152, 175, 100, 100, 100, 110, 124, 142, 166, 200, 250, 100, 6, 3,
                348, -8, -14, 338, -6, 311, -4, -14, 305, -3, 152, -3, -8, 148, -2, 251, -1, 249, -1, 986, -2, 990, -3,
                -14, -4, 24, -8, 2, 2, 2, 2, 1, 3, 2, 1, 2, 6, 20], float)
VAL0 = np.array([100, 320, 295, 245, 140, 980])

# A pawn at progress 0 or 8 (it cannot stand there) and the king's endgame constant (both sides
# always have one) can never change a game
FIXED = {0, 8, 9, 17, 45}
C = np.zeros(58)
C[1:8] = 8; C[10:17] = 10; C[18] = 3; C[19] = 3
for b in (20, 25, 30):   # N B U: mg0 mg/c home eg0 eg/c
    base = 12 if b == 30 else 16
    C[b] = base; C[b + 1] = 1.5; C[b + 2] = 5; C[b + 3] = base; C[b + 4] = 1.5
for b, base in ((35, 16), (39, 40)):   # R Q: mg0 mg/c eg0 eg/c
    C[b] = base; C[b + 1] = 1.5; C[b + 2] = base; C[b + 3] = 1.5
C[43] = 4; C[44] = 2; C[46] = 2
C[47:52] = 1; C[52:57] = 1; C[57] = 8

BASES = {1: (20, 23), 2: (25, 28), 3: (35, 37), 4: (30, 33), 5: (39, 41)}   # N B R U Q: mg0, eg0

def order_values(th):
    """The current values, each piece's moved by the mean change of its middlegame and endgame base."""
    v = VAL0.astype(float).copy()
    for i, (m, e) in BASES.items():
        v[i] += ((th[m] - OLD[m]) + (th[e] - OLD[e])) / 2
    return [int(round(x)) for x in v]

# Each piece's numbers: its tables, mobility, king pressure, value index
SLOTS = {'N': range(20, 25), 'B': range(25, 30), 'U': range(30, 35), 'R': range(35, 39), 'Q': range(39, 43)}
MOB = {'N': 47, 'B': 48, 'R': 49, 'U': 50, 'Q': 51}
TROP = {'N': 52, 'B': 53, 'R': 54, 'U': 55, 'Q': 56}
VIDX = {'N': 1, 'B': 2, 'R': 3, 'U': 4, 'Q': 5}

def scaled(k, th=OLD):
    """The evaluation with every term of each piece (its tables, constant included, its mobility,
    its pressure on the enemy king, the bishop pair for the bishop, its value for ordering and the
    lead) multiplied by k[piece]; as an evaluation file's numbers."""
    th = np.array(th, float).copy()
    v = VAL0.astype(float).copy()
    mob = np.zeros(5); trop = np.zeros(5)
    for j, p in enumerate('NBRUQ'):
        for i in SLOTS[p]: th[i] *= k[p]
        v[VIDX[p]] *= k[p]
        mob[j] = OLD[MOB[p]] * k[p]; trop[j] = OLD[TROP[p]] * k[p]
    bpair = OLD[57] * k['B']
    return list(th) + [int(round(x)) for x in v] + [0] * 6 + list(mob) + list(trop) + [bpair]

def write_numbers(path, nums):
    with open(path, 'w') as f:
        f.write(' '.join(f'{x:.4f}' if isinstance(x, float) else str(x) for x in nums) + '\n')
