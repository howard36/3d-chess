"""Five piece values from a whole evaluation by projection: the material-only model (pawn 1, a
logistic scale) fitted by squared error to the evaluation's own verdict, its score scaled to fit the
results (K), on the same positions, the three phases weighted equally as in engine removal. With
--results, the same model fitted to the results themselves: what the positions' material says.
Errors are bootstrap standard deviations over positions.

usage: distill.py [--results] ev_a.txt ev_b.txt ...   (engine evdump output:
       eval label dP dN dB dR dU dQ phase, from lines "board side label")"""
import sys
import numpy as np
from scipy.optimize import least_squares

LN = np.log(10) / 400
sig = lambda z: 1 / (1 + np.exp(-z))
rng = np.random.default_rng(2)

def load(path):
    a = np.loadtxt(path)
    phase = np.maximum(a[:, 8], 0).astype(int)   # pawns only: with the fewest pieces
    w = np.array([1 / np.mean(phase == b) for b in range(3)])[phase]
    return a[:, 0], a[:, 1] / 6000 + 0.5, a[:, 2:8], np.sqrt(w / w.mean())

def fit_values(D, t, sw):
    # t ~ sigmoid(s * (dP + vN dN + vB dB + vR dR + vU dU + vQ dQ))
    res = lambda p: sw * (sig(p[0] * (D @ np.concatenate([[1], p[1:]]))) - t)
    return least_squares(res, [0.8, 3, 3, 2.5, 1.2, 9]).x

def report(label, D, t, sw, boots):
    x = fit_values(D, t, sw)
    idx = [rng.integers(0, len(t), len(t)) for _ in range(boots)]
    sd = np.array([fit_values(D[i], t[i], sw[i]) for i in idx]).std(0)
    print(f'{label:24s} ' + ' '.join(f'{k} {x[j]:.2f} ± {sd[j]:.2f}' for j, k in enumerate('NBRUQ', 1)), flush=True)

paths = [p for p in sys.argv[1:] if not p.startswith('--')]
for path in paths:
    e, y, D, sw = load(path)
    K = least_squares(lambda k: sw * (sig(k[0] * LN * e) - y), [0.7]).x[0]
    report(f'{path} (K {K:.3f})', D, sig(K * LN * e), sw, 20)
if '--results' in sys.argv:
    e, y, D, sw = load(paths[0])
    report('results, material only', D, y, sw, 100)
