"""Tune the evaluation on <raw> positions for several regularisation strengths, pick the one with
the lowest held-out loss, and write it as an evaluation file for the bots (58 numbers, then the
values the search orders by: pawn 100, each piece the mean of its middlegame and endgame base)."""
import sys
import numpy as np
from scipy.optimize import minimize
from texel import load, loss, OLD, NAMES
raws = sys.argv[1].split(','); out = sys.argv[2]
FIX = [int(x) for x in sys.argv[3].split(',')] if len(sys.argv) > 3 else []   # numbers held at their current values
F, off, y, g = load(raws)
ug = np.unique(g); rng = np.random.default_rng(0)
test = set(rng.choice(ug, len(ug) // 5, replace=False))
te = np.array([x in test for x in g]); tr = ~te
Ks = np.linspace(0.1, 1.5, 141)
K = Ks[np.argmin([loss(OLD, F[tr], off[tr], y[tr], k) for k in Ks])]
base_te = loss(OLD, F[te], off[te], y[te], K)
print(f'{len(y)} positions, {len(ug)} games; K {K:.3f}; current evaluation held-out loss {base_te:.5f}')
scale = np.maximum(np.abs(OLD), 10.0)
def fit(lam):
    def obj(th):
        e = F[tr] @ th + off[tr]
        p = np.clip(1 / (1 + np.exp(-K * e / 100)), 1e-9, 1 - 1e-9)
        l = -np.mean(y[tr] * np.log(p) + (1 - y[tr]) * np.log(1 - p))
        grad = -(F[tr].T @ ((y[tr] - p) * K / 100)) / len(p)
        r = (th - OLD) / scale
        return l + lam * np.sum(r * r), grad + 2 * lam * r / scale
    bounds = [(o, o) if i in FIX else (None, None) for i, o in enumerate(OLD)]
    return minimize(obj, OLD.copy(), jac=True, method='L-BFGS-B', bounds=bounds, options={'maxiter': 5000}).x
best = None
for lam in (1e-3, 3e-4, 1e-4, 3e-5, 1e-5, 3e-6):
    th = fit(lam)
    l = loss(th, F[te], off[te], y[te], K)
    print(f'  lambda {lam:g}: held-out loss {l:.5f} ({l - base_te:+.5f})')
    if best is None or l < best[0]: best = (l, lam, th)
l, lam, th = best
print(f'chosen lambda {lam:g}')
for n, o, t in zip(NAMES, OLD, th): print(f'   {n:>12}: {o:7.1f} -> {t:7.1f}')
vals = [100] + [round((th[b] + th[b + 3]) / 2) for b in (20, 25)] + [round((th[35] + th[37]) / 2), round((th[30] + th[33]) / 2), round((th[39] + th[41]) / 2)]
with open(out, 'w') as f:
    f.write(' '.join(f'{x:.2f}' for x in th) + ' ' + ' '.join(map(str, vals)) + '\n')
print('wrote', out, 'ordering values', vals)
