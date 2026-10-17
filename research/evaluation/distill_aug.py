"""The five-value model (pawn 1, a logistic scale) matched to a whole evaluation's verdict on
positions from games and on copies of them with one random piece taken off (engine augment: both
quiet by the evaluation's own capture search, so no piece hangs unseen). The verdict is the
evaluation's score through its own logistic scale, fitted to the games' results; phases weighted
equally; errors are bootstrap standard deviations.

usage: distill_aug.py aug_a.txt ...   (engine augment output)"""
import sys
import numpy as np
from scipy.optimize import least_squares

LN = np.log(10) / 400
sig = lambda z: 1 / (1 + np.exp(-z))
rng = np.random.default_rng(3)

def weights(phase):
    w = np.array([1 / max(np.mean(phase == b), 1e-9) for b in range(3)])[phase]
    return np.sqrt(w / w.mean())

def fit_values(D, t, sw):
    res = lambda p: sw * (sig(p[0] * (D @ np.concatenate([[1], p[1:]]))) - t)
    return least_squares(res, [0.8, 3, 3, 2.5, 1.2, 9]).x

for path in sys.argv[1:]:
    a = np.loadtxt(path)
    e, lab, D, phase, kind = a[:, 0], a[:, 1], a[:, 2:8], np.maximum(a[:, 8], 0).astype(int), a[:, 9]
    nat = kind == 0
    sw0 = weights(phase[nat])
    K = least_squares(lambda k: sw0 * (sig(k[0] * LN * e[nat]) - (lab[nat] / 6000 + 0.5)), [0.7]).x[0]
    t = sig(K * LN * e)
    print(f'{path} (K {K:.3f})')
    for name, m in [('positions from games', nat), ('with the copies', np.ones(len(e), bool)), ('copies alone', ~nat)]:
        D_, t_, sw = D[m], t[m], weights(phase[m])
        x = fit_values(D_, t_, sw)
        sd = np.array([fit_values(D_[i], t_[i], sw[i]) for i in (rng.integers(0, m.sum(), m.sum()) for _ in range(20))]).std(0)
        print(f'   {name:22s} ({m.sum():6d}) ' + ' '.join(f'{k} {x[j]:.2f} ± {sd[j]:.2f}' for j, k in enumerate('NBRUQ', 1)), flush=True)
