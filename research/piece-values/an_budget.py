"""One scale per budget: pieces' worth = s * u (u fixed ratios, bishop 1); per-group
intercepts and pawn slopes. Groups: from the start, and each phase stratum."""
import sys
import numpy as np
from scipy.optimize import minimize
from analysis import *
u = np.array([0.98, 1.0, 0.89, 0.43, 3.55])

def rows(tags):
    parts = []
    for t in tags:
        strat = t.startswith(('e3', 'e5'))
        D, y, b, g = game_rows(t, bin_of=None if strat else (lambda j: 3))
        parts.append((D, y, b, g))
    return [np.concatenate([p[i] for p in parts]) for i in range(4)]

def fit(D, y, b, ngroups=4):
    P = D[:, 0]; X = D[:, 1:] @ u
    def f(x):
        s = x[0]; a = x[1:1 + ngroups]; k = x[1 + ngroups:]
        eta = a[b] + k[b] * (P + s * X)
        p = np.clip(1 / (1 + np.exp(-eta)), 1e-9, 1 - 1e-9)
        return -np.sum(y * np.log(p) + (1 - y) * np.log(1 - p))
    x0 = np.concatenate([[3.0], np.zeros(ngroups), np.full(ngroups, 0.5)])
    r = minimize(f, x0, method='L-BFGS-B')
    return r.x[0], r.x[1 + ngroups:]

def boot(D, y, b, g, n=200, seed=0):
    s, k = fit(D, y, b)
    rng = np.random.default_rng(seed)
    ug, inv = np.unique(g, return_inverse=True)
    by = [[] for _ in ug]
    for i, gi in enumerate(inv): by[gi].append(i)
    ss = []
    for _ in range(n):
        idx = np.concatenate([by[p] for p in rng.integers(0, len(ug), len(ug))])
        ss.append(fit(D[idx], y[idx], b[idx])[0])
    return s, np.std(ss), k

if __name__ == "__main__":
  for spec in sys.argv[1:]:
      tags = spec.split(',')
      D, y, b, g = rows(tags)
      s, sd, k = boot(D, y, b, g, n=100)
      print(f'{spec:>22} ({len(y)} games): bishop = {s:.2f} ± {sd:.2f} pawns -> ' +
            '  '.join(f'{t}={s*x:.2f}' for t, x in zip('NBRUQ', u)) + f'   pawn slope per group {np.round(k, 2)}')
