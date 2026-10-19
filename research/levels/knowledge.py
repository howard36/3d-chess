"""What a beginner and an advanced player know (client/src/ai/numbers.ts): a subset of the 58
evaluation numbers, the rest left at nothing, fitted so that the evaluation matches the expert's
as closely as that knowledge allows, by squared error in expected score (logistic, 400 cp a
factor of ten), over positions from self-play. A simpler evaluation that still agrees with the
expert's wherever it can, rather than the expert's with numbers struck out (both are reported).

usage (research/evaluation's engine and positions, lines "board side label"):
  ../evaluation/engine features < positions.lab > feat.txt
  ../evaluation/engine evdump @../evaluation/round3_final.txt < positions.lab > exp.txt
  python3 knowledge.py positions.lab feat.txt exp.txt
The positions used were research/evaluation's 75,235 training positions for fit_search.py: quiet
positions from self-play, and one move away from them.
"""
import os
import sys

import numpy as np
from scipy.optimize import least_squares

lab_path, feat_path, exp_path = sys.argv[1:4]
F = np.loadtxt(feat_path)
E = np.loadtxt(exp_path)
with open(lab_path) as f:
    lab = [line.split() for line in f]
side = np.array([int(l[1]) for l in lab])
f, off, hand = F[:, :58], F[:, 58], F[:, 59]
sgn = np.where(side == 0, 1, -1)
expert = E[:, 0] * sgn - 20 * sgn  # White's view, the move's bonus taken out
evaluation = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'evaluation')


def numbers(name):
    with open(os.path.join(evaluation, name)) as f:
        return np.array([float(x) for x in f.read().split()[:58]])


handset = numbers('handset.txt')
r3 = numbers('round3_final.txt')

# The model is linear: eval = theta . f + offset (the lead term at the levels' values)
chk = f @ handset + off
print('linear model vs hand-set eval: max |diff|', np.abs(chk - hand).max().round(1), 'mean', np.abs(chk - hand).mean().round(2))

K = np.log(10) / 400
sig = lambda x: 1 / (1 + np.exp(-K * x))


def report(name, pred):
    d = pred - expert
    pe = sig(pred) - sig(expert)
    print(f'{name:28s} rms cp {np.sqrt(np.mean(np.clip(d, -1000, 1000) ** 2)):6.1f}  median |cp| {np.median(np.abs(d)):5.1f}  '
          f'rms expected score {np.sqrt(np.mean(pe ** 2)):.4f}  corr {np.corrcoef(pred, expert)[0, 1]:.4f}')


report('hand-set (levels today)', f @ handset + off)
report('expert numbers, no extras', f @ r3 + off)


def fit(name, cols, start, fixed=None, lo=None, hi=None):
    """cols: list of feature combinations (each a dict index->weight) for each free parameter."""
    A = np.zeros((len(f), len(cols)))
    for k, c in enumerate(cols):
        for j, w in c.items():
            A[:, k] += w * f[:, j]
    base = off.copy()
    if fixed is not None:
        base += f @ fixed
    res = lambda p: sig(A @ p + base) - sig(expert)
    lo = np.full(len(cols), -np.inf) if lo is None else lo
    hi = np.full(len(cols), np.inf) if hi is None else hi
    sol = least_squares(res, np.clip(start, lo + 1e-6, hi - 1e-6), x_scale='jac', bounds=(lo, hi))
    pred = A @ sol.x + base
    report(name, pred)
    # zeroing instead of fitting: the expert's own numbers on the same columns
    return sol.x, pred


PAWN = list(range(1, 8))
N, B, U, R, Q, KG = 20, 25, 30, 35, 39, 43

# Beginner: material (one worth per piece, middlegame and endgame alike), pawns worth more as they
# advance (a straight line), knights, bishops and unicorns off their home squares, the king at home
beg_cols = [
    {**{p: 1 for p in PAWN}, **{9 + p: 1 for p in PAWN}},  # pawn base
    {**{p: p - 1 for p in PAWN}, **{9 + p: p - 1 for p in PAWN}},  # pawn per step
]
for b in (N, B, U):
    beg_cols += [{b: 1, b + 3: 1}, {b + 2: 1}]
for b in (R, Q):
    beg_cols += [{b: 1, b + 2: 1}]
beg_cols += [{KG: 1}]
beg_start = np.array([100, 10, 330, -10, 300, -10, 140, -5, 240, 960, -10.0])
blo = np.full(11, -np.inf); bhi = np.full(11, np.inf)
for k in (3, 5, 7): bhi[k] = 0
bhi[10] = -4
beg, beg_pred = fit('beginner (11 numbers)', beg_cols, beg_start, lo=blo, hi=bhi)

# The same knowledge by zeroing the expert's other numbers
z = r3.copy()
keep = set(range(18)) | {N, N + 2, N + 3, B, B + 2, B + 3, U, U + 2, U + 3, R, R + 2, Q, Q + 2, KG, KG + 2}
for j in range(58):
    if j not in keep:
        z[j] = 0
report('beginner by zeroing', f @ z + off)

# Advanced: everything but mobility and the bishop pair (and the expert's four extra terms)
adv_cols = [{p: 1} for p in PAWN] + [{9 + p: 1} for p in PAWN] + [{18: 1}, {19: 1}]
for b in (N, B, U):
    adv_cols += [{b + i: 1} for i in range(5)]
for b in (R, Q):
    adv_cols += [{b + i: 1} for i in range(4)]
adv_cols += [{KG: 1}, {KG + 1: 1}, {KG + 3: 1}]
adv_cols += [{52 + i: 1} for i in range(5)]
adv_start = np.concatenate([r3[1:8], r3[10:17], r3[18:20], r3[20:35], r3[35:43], [r3[43], r3[44], r3[46]], r3[52:57]])
alo = np.full(47, -np.inf); ahi = np.full(47, np.inf)
for b in (16, 21, 26): ahi[b + 2] = 0   # home
ahi[39] = -4                              # king out
alo[42:47] = 0                            # king pressure
adv, adv_pred = fit('advanced (47 numbers)', adv_cols, adv_start, lo=alo, hi=ahi)
z = r3.copy()
z[47:52] = 0
z[57] = 0
report('advanced by zeroing', f @ z + off)

np.set_printoptions(suppress=True, linewidth=200, precision=1)
print('beginner', beg)
print('advanced', adv)
