"""Each piece's worth in log-odds of winning (pawn included, nothing divided), fitted per phase:
logit P(first mover scores) = a + sum_t w_t * d_t. Bootstrap SDs over games."""
import sys
import numpy as np
from analysis import fit_logit
from an_phase2 import rows, NAMES
T = 'PNBRUQ'
def fitw(D, y):
    X = np.column_stack([np.ones(len(y)), D])
    return fit_logit(X, y, ridge=1e-3)[1:]
for spec in sys.argv[1:]:
    D, y, st, g = rows(spec.split(','))
    print(f'== {spec} ({len(y)} games): worth in log-odds per piece')
    rng = np.random.default_rng(0)
    for s_ in sorted(set(st)):
        m = np.where(st == s_)[0]
        w = fitw(D[m], y[m])
        bs = np.array([fitw(D[i], y[i]) for i in (rng.choice(m, len(m)) for _ in range(150))])
        sd = bs.std(axis=0)
        present = np.abs(D[m]).sum(axis=0) > 0
        print(f'  {NAMES[s_]:>15} ({len(m):4d}): ' + '  '.join(
            (f'{t}={w[i]:.3f}±{sd[i]:.3f}' if present[i] else f'{t}=  --  ') for i, t in enumerate(T)))
