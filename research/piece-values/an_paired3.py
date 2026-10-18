"""The same targeted games at several budgets: the exchange rate (a bishop in pawns, ratios fixed,
phases equal) on exactly the games every budget finished, and the paired differences."""
import sys
import numpy as np
from an_phase2 import rows, fit
tags = sys.argv[1].split(',')
R = {t: rows([t]) for t in tags}
keys = None
for t in tags:
    k = set(x.split(':')[1] for x in R[t][3])
    keys = k if keys is None else keys & k
keys = sorted(keys, key=int)
pairs = np.array([int(k) // 2 for k in keys]); up = np.unique(pairs)
idx = {t: np.array([{x.split(':')[1]: i for i, x in enumerate(R[t][3])}[k] for k in keys]) for t in tags}
def S(t, sel):
    D, y, st, g = R[t]; i = idx[t][sel]
    groups = np.unique(st[i]); w = np.ones(len(i))
    for s_ in groups:
        m = st[i] == s_; w[m] = len(i) / len(groups) / m.sum()
    return fit(D[i], y[i], st[i], w, groups)[0]
allsel = np.arange(len(keys))
base = {t: S(t, allsel) for t in tags}
rng = np.random.default_rng(5); boots = []
for _ in range(120):
    pick = rng.choice(up, len(up)); sel = np.concatenate([np.where(pairs == p)[0] for p in pick])
    boots.append([S(t, sel) for t in tags])
boots = np.array(boots)
rsd = lambda a: (np.percentile(a, 75) - np.percentile(a, 25)) / 1.349   # robust: a few resamples leave a phase too thin to fit
print(f'{len(keys)} identical games: ' + '  '.join(f'{t} {base[t]:.2f}±{rsd(boots[:, i]):.2f}' for i, t in enumerate(tags)))
for i in range(1, len(tags)):
    d = boots[:, i] - boots[:, i - 1]
    print(f'   {tags[i]} less {tags[i-1]}: {base[tags[i]] - base[tags[i-1]]:+.2f} ± {rsd(d):.2f}')
