"""Combining phases before normalizing to pawn = 1, two ways:
 shared: one set of values for every phase, each phase with its own intercept and scale
         (how strongly material shows in results there), each phase's games weighted equally;
 basket: per phase, every piece's log-odds worth as a share of N+B+R+U's, averaged over phases,
         then divided by the pawn's averaged share.
Bootstrap over games for the SDs."""
import sys
import numpy as np
from analysis import fit_logit, pooled, fmt
from an_phase2 import rows
T = 'PNBRUQ'
def fitw(D, y):
    return fit_logit(np.column_stack([np.ones(len(y)), D]), y, ridge=1e-3)[1:]
def basket(D, y, st):
    shares = []
    for s_ in sorted(set(st)):
        m = st == s_
        w = fitw(D[m], y[m])
        k = w[1] + w[2] + w[3] + w[4]
        sh = w / k
        if not (np.abs(D[m][:, 5]).sum() > 0): sh[5] = np.nan
        shares.append(sh)
    a = np.nanmean(np.array(shares), axis=0)
    return a / a[0]
for spec in sys.argv[1:]:
    D, y, st, g = rows(spec.split(','))
    groups = sorted(set(st))
    share = [1.0 / len(groups) if i in groups else 0.0 for i in range(4)]
    v, sd, k, a, _ = pooled(D, y, st, g, np.ones(len(y)), share, nboot=40)
    rng = np.random.default_rng(1)
    vb = basket(D, y, st)
    bs = []
    for _ in range(80):
        i = rng.integers(0, len(y), len(y))
        bs.append(basket(D[i], y[i], st[i]))
    print(f'== {spec} ({len(y)} games)')
    print('   shared:', fmt(v, sd))
    print('   basket:', fmt(vb, np.nanstd(np.array(bs), axis=0)))
