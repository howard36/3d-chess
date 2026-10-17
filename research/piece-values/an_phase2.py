"""Per phase: a bishop's worth in pawns (s) with the pieces' ratios fixed, logit = a + k*(dP + s*u.d);
and a pooled s with each phase weighted equally. Strata: 0 endgame (1-5 pieces, pawns), 1 late
middlegame (6-11), 2 middlegame (12+), 3 from the start."""
import sys, json
import numpy as np
from scipy.optimize import minimize
from analysis import parse_raw, T
from legal import illegal
U = np.array([1.003, 1.0, 0.892, 0.422, 3.597])
NAMES = ['endgame 1-5', 'late mid 6-11', 'middlegame 12+', 'from the start']
QUIET_ONLY = True
_gaps = {}
def gaps_of(tag):
    if tag not in _gaps:
        try: _gaps[tag] = json.load(open(f'{tag}.qgap.json'))
        except FileNotFoundError: _gaps[tag] = {}
    return _gaps[tag]

def rows(tags):
    D, y, st, g = [], [], [], []
    for tag in tags:
        jobs = json.load(open(f'{tag}.jobs.json'))
        res, _ = parse_raw(f'{tag}.raw')
        for j in jobs:
            r = res.get(j['id'])
            if r is None: continue
            if 'stratum' in j and j.get('stratum') != 3 and (illegal(j['board'], j['side']) or 'P' not in j['board'] or 'p' not in j['board']):
                continue
            if illegal(j['board'], j['side']): continue
            if QUIET_ONLY and gaps_of(tag).get(str(j['id']), 0) > 100: continue   # removal left a piece hanging or a check
            d = np.zeros(6)
            for t in j['wl']: d[T.index(t)] -= 1
            for t in j['bl']: d[T.index(t)] += 1
            yy = r['result']
            if j.get('side', 0) == 1: d, yy = -d, 1 - yy
            D.append(d); y.append(yy); st.append(j.get('stratum', 3)); g.append(f'{tag}:{j["id"]}')
    return np.array(D), np.array(y), np.array(st), np.array(g)

def fit(D, y, st, w, groups):
    P = D[:, 0]; X = D[:, 1:] @ U
    G = len(groups); gi = np.searchsorted(groups, st)
    def f(x):
        s = x[0]; a = x[1:1 + G]; k = x[1 + G:]
        eta = a[gi] + k[gi] * (P + s * X)
        p = np.clip(1 / (1 + np.exp(-eta)), 1e-9, 1 - 1e-9)
        return -np.sum(w * (y * np.log(p) + (1 - y) * np.log(1 - p)))
    x0 = np.concatenate([[2.8], np.zeros(G), np.full(G, 0.6)])
    r = minimize(f, x0, method='L-BFGS-B')
    return r.x[0], r.x[1 + G:]

def boot(D, y, st, g, nb=150, seed=0):
    groups = np.unique(st)
    w = np.ones(len(y))
    for s_ in groups:   # equal weight per phase
        m = st == s_; w[m] = len(y) / len(groups) / m.sum()
    s, k = fit(D, y, st, w, groups)
    rng = np.random.default_rng(seed)
    ug, inv = np.unique(g, return_inverse=True)
    by = [[] for _ in ug]
    for i, gi in enumerate(inv): by[gi].append(i)
    bs = []
    for _ in range(nb):
        idx = np.concatenate([by[p] for p in rng.integers(0, len(ug), len(ug))])
        bs.append(fit(D[idx], y[idx], st[idx], w[idx], groups)[0])
    return s, np.std(bs), k

if __name__ == '__main__':
    for spec in sys.argv[1:]:
        D, y, st, g = rows(spec.split(','))
        print(f'== {spec}: {len(y)} games')
        for s_ in sorted(set(st)):
            m = st == s_
            if m.sum() < 60: continue
            s, sd, k = boot(D[m], y[m], st[m], g[m], nb=100)
            print(f'   {NAMES[s_]:>15} ({m.sum():4d} games): bishop = {s:.2f} ± {sd:.2f} pawns  (pawn slope {k[0]:.2f})')
        s, sd, k = boot(D, y, st, g, nb=100)
        print(f'   {"all, equal":>15}: bishop = {s:.2f} ± {sd:.2f} pawns  slopes {np.round(k, 2)}')
