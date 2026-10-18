"""Candidate value sets compared phase by phase: per-game log-loss with each phase's own intercept
and scale fitted (lower is better; shown relative to the best candidate in the phase, in
millinats), and the share of decisive games won by the side the set puts ahead (a level count
scores half)."""
import sys, json
import numpy as np
from analysis import fit_logit
from an_phase2 import rows, NAMES
def loss(D, y, v):
    s = D @ v
    b = fit_logit(np.column_stack([np.ones(len(y)), s]), y)
    p = np.clip(1 / (1 + np.exp(-(b[0] + b[1] * s))), 1e-9, 1 - 1e-9)
    return -np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))
def concord(D, y, v):
    s = D @ v; m = (y != 0.5) & (np.abs(D).sum(axis=1) > 0)
    return np.mean(np.where(np.abs(s[m]) < 1e-9, 0.5, (s[m] > 0) == (y[m] == 1)))
cands = {k: np.array([1.0] + v) for k, v in json.loads(sys.argv[2]).items()}
D, y, st, g = rows(sys.argv[1].split(','))
print(f'{len(y)} games:', sys.argv[1])
rows_out = {}
for s_ in sorted(set(st)) + ['all']:
    m = st == s_ if s_ != 'all' else np.ones(len(y), bool)
    L = {k: loss(D[m], y[m], v) for k, v in cands.items()}
    best = min(L.values())
    name = NAMES[s_] if s_ != 'all' else 'all phases'
    print(f'  {name:>15} ({m.sum():4d}): ' + '  '.join(f'{k} {1000*(L[k]-best):5.1f}/{concord(D[m], y[m], v):.3f}' for k, v in cands.items()))
