"""Shared piece ratios, one scale per budget; and the paired 20k/80k difference with its SD."""
import numpy as np
from scipy.optimize import minimize
from an_budget import rows
budgets = {'5k': ['e1b', 'e1c'], '20k': ['e2', 'eq', 'e3', 'e3b'], '80k': ['e4a', 'e5', 'e5b']}
data = []
for bi, (name, tags) in enumerate(budgets.items()):
    D, y, b, g = rows(tags)
    data.append((D, y, b + 4 * bi, g))
D = np.concatenate([d[0] for d in data]); y = np.concatenate([d[1] for d in data])
grp = np.concatenate([d[2] for d in data]); g = np.concatenate([d[3] for d in data])
bud = grp // 4
NG = 12
def unpack(x):
    r = np.concatenate([x[:1], [1.0], x[1:4]])   # N, B=1, R, U, Q relative to B
    s = x[4:7]; a = x[7:7 + NG]; k = x[7 + NG:]
    return r, s, a, k
def f(x, D, y, grp, bud):
    r, s, a, k = unpack(x)
    eta = a[grp] + k[grp] * (D[:, 0] + s[bud] * (D[:, 1:] @ r))
    p = np.clip(1 / (1 + np.exp(-eta)), 1e-9, 1 - 1e-9)
    return -np.sum(y * np.log(p) + (1 - y) * np.log(1 - p))
x0 = np.concatenate([[1.0, 0.89, 0.42, 3.6], [3.0, 3.0, 3.0], np.zeros(NG), np.full(NG, 0.5)])
def fit(idx):
    return minimize(f, x0, args=(D[idx], y[idx], grp[idx], bud[idx]), method='L-BFGS-B').x
allidx = np.arange(len(y))
x = fit(allidx)
r, s, _, _ = unpack(x)
rng = np.random.default_rng(1)
ug, inv = np.unique(g, return_inverse=True)
by = [[] for _ in ug]
for i, gi in enumerate(inv): by[gi].append(i)
bs = []
for _ in range(100):
    idx = np.concatenate([by[p] for p in rng.integers(0, len(ug), len(ug))])
    xb = fit(idx); rb, sb, _, _ = unpack(xb); bs.append(np.concatenate([rb, sb]))
bs = np.array(bs); sd = bs.std(axis=0)
print('shared ratios to the bishop: ' + '  '.join(f'{t}={r[i]:.3f}±{sd[i]:.3f}' for i, t in enumerate('NBRUQ') if t != 'B'))
for i, name in enumerate(budgets):
    print(f'{name:>4}: bishop = {s[i]:.2f} ± {sd[5 + i]:.2f} pawns -> ' + '  '.join(f'{t}={s[i]*r[j]:.2f}' for j, t in enumerate('NBRUQ')))
d = bs[:, 7] - bs[:, 6]
print(f'80k less 20k: {s[2]-s[1]:+.2f} ± {d.std():.2f}')
