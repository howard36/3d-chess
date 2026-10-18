"""Fitting piece values to game results.

logit P(White scores) = a + k * sum_t v_t * d_t, d_t = White's count less Black's
of type t; with v_P = 1, beta_t = k * v_t is fitted freely and v_t = beta_t / beta_P.
Draws count as half a point (fractional logistic regression).
"""
import json
import numpy as np

T = 'PNBRUQ'


def parse_raw(path):
    res, rec = {}, {}
    for line in open(path):
        p = line.split()
        if p[0] == 'R':
            res[int(p[1])] = dict(result=float(p[2]), plies=int(p[3]), reason=p[4], final=p[5])
        elif p[0] == 'S':
            rec[int(p[1])] = p[2:]
    return res, rec


def sig_diff(sig):
    w = [int(c, 16) for c in sig[:6]]
    b = [int(c, 16) for c in sig[6:12]]
    return np.array([w[i] - b[i] for i in range(6)], dtype=float)


def fit_logit(X, y, w=None, iters=50, ridge=1e-6):
    """IRLS for fractional logistic regression with an intercept (column 0 of X)."""
    n, p = X.shape
    if w is None:
        w = np.ones(n)
    beta = np.zeros(p)
    for _ in range(iters):
        z = X @ beta
        mu = 1 / (1 + np.exp(-z))
        W = w * mu * (1 - mu)
        g = X.T @ (w * (y - mu)) - ridge * beta
        H = (X * W[:, None]).T @ X + ridge * np.eye(p)
        step = np.linalg.solve(H, g)
        beta += step
        if np.max(np.abs(step)) < 1e-10:
            break
    return beta


def values_from_beta(beta):
    # beta = [intercept, P, N, B, R, U, Q]
    return beta[1:] / beta[1]


def fit_games(D, y, nboot=300, seed=0, groups=None, w=None):
    """D: n x 6 differences. Returns values, bootstrap SDs, k (logit per pawn), intercept."""
    X = np.hstack([np.ones((len(y), 1)), D])
    beta = fit_logit(X, y, w)
    v = values_from_beta(beta)
    rng = np.random.default_rng(seed)
    boots = []
    if groups is None:
        groups = np.arange(len(y))
    ug = np.unique(groups)
    idx_by_g = None
    if len(ug) != len(y):
        order = np.argsort(groups, kind='stable')
        gs = groups[order]
        starts = np.searchsorted(gs, ug)
        ends = np.append(starts[1:], len(gs))
        idx_by_g = [order[s:e] for s, e in zip(starts, ends)]
    for _ in range(nboot):
        pick = rng.integers(0, len(ug), len(ug))
        if idx_by_g is None:
            idx = pick
        else:
            idx = np.concatenate([idx_by_g[i] for i in pick])
        try:
            b = fit_logit(X[idx], y[idx], None if w is None else w[idx])
            boots.append(values_from_beta(b))
        except np.linalg.LinAlgError:
            pass
    boots = np.array(boots)
    return v, boots.std(axis=0), beta[1], beta[0], boots


def fmt(v, sd=None):
    s = '  '.join(f'{t}={v[i]:.2f}' + (f'±{sd[i]:.2f}' if sd is not None else '') for i, t in enumerate(T))
    return s


def start_imbalance(jobs, res):
    D, y = [], []
    for j in jobs:
        r = res.get(j['id'])
        if r is None:
            continue
        d = np.zeros(6)
        for t in j['wl']:
            d[T.index(t)] -= 1
        for t in j['bl']:
            d[T.index(t)] += 1
        yy = r['result']
        if j.get('side', 0) == 1:  # from the first mover's side: the intercept is the first move's worth
            d, yy = -d, 1 - yy
        D.append(d)
        y.append(yy)
    return np.array(D), np.array(y)


def snapshots(res, rec, quiet_only=True, min_ply=0, per_game_weight=False, max_ply=10**9):
    D, y, g, w, ply_of = [], [], [], [], []
    for gid, toks in rec.items():
        r = res[gid]
        ply = 0
        rows = []
        for tok in toks:
            sig, q, cnt = tok.split(':')
            q = int(q)
            cnt = int(cnt)
            if (q or not quiet_only):
                lo, hi = max(ply, min_ply), min(ply + cnt, max_ply)
                if hi > lo:
                    rows.append((sig, hi - lo, lo))
            ply += cnt
        tot = sum(c for _, c, _ in rows)
        for sig, c, lo in rows:
            D.append(sig_diff(sig))
            y.append(r['result'])
            g.append(gid)
            w.append(c / tot if per_game_weight else c)
            ply_of.append(lo)
    return np.array(D), np.array(y), np.array(g), np.array(w, dtype=float)


def imposed_snapshots(jobs, res, rec, bins):
    """Positions whose imbalance is still exactly the one imposed at the start, binned by
    the non-pawn pieces left (both sides). Returns {bin: (D, y, groups, w)}."""
    out = {b: ([], [], [], []) for b in range(len(bins) - 1)}
    for j in jobs:
        gid = j['id']
        if gid not in res or gid not in rec:
            continue
        d0 = np.zeros(6)
        for t in j['wl']:
            d0[T.index(t)] -= 1
        for t in j['bl']:
            d0[T.index(t)] += 1
        y = res[gid]['result']
        flipw = j.get('side', 0) == 1
        for tok in rec[gid]:
            sig, q, cnt = tok.split(':')
            if q != '1':
                continue
            d = sig_diff(sig)
            if not np.array_equal(d, d0):
                continue
            pieces = sum(int(c, 16) for c in sig[1:6]) + sum(int(c, 16) for c in sig[7:12])
            for b in range(len(bins) - 1):
                if bins[b] <= pieces < bins[b + 1]:
                    D, Y, G, W = out[b]
                    D.append(-d if flipw else d)
                    Y.append(1 - y if flipw else y)
                    G.append(gid)
                    W.append(int(cnt))
    return {b: tuple(np.array(x, dtype=float) for x in v) for b, v in out.items()}


BINS = [0, 6, 12, 17, 40]


def collect(tags, bins=BINS):
    """Imposed-imbalance snapshot rows from several runs: d, y, bin, game key, weight
    (each game counts once per bin)."""
    rows = []
    for tag in tags:
        jobs = json.load(open(f'{tag}.jobs.json'))
        res, rec = parse_raw(f'{tag}.raw')
        out = imposed_snapshots(jobs, res, rec, bins)
        for b, (D, y, g, w) in out.items():
            if len(y) == 0:
                continue
            tot = {}
            for gi, wi in zip(g, w):
                tot[gi] = tot.get(gi, 0) + wi
            for di, yi, gi, wi in zip(D, y, g, w):
                rows.append((di, yi, b, f'{tag}:{int(gi)}', wi / tot[gi]))
    D = np.array([r[0] for r in rows])
    y = np.array([r[1] for r in rows])
    b = np.array([r[2] for r in rows])
    g = np.array([r[3] for r in rows])
    w = np.array([r[4] for r in rows])
    return D, y, b, g, w


def fit_pooled(D, y, b, w, nb, v0=None):
    """Shared values v (pawn 1), a scale k_b and intercept a_b per phase bin."""
    from scipy.optimize import minimize

    def unpack(x):
        v = np.concatenate([[1.0], x[:5]])
        return v, x[5:5 + nb], x[5 + nb:5 + 2 * nb]

    def f(x):
        v, k, a = unpack(x)
        s = D @ v
        eta = a[b] + k[b] * s
        p = 1 / (1 + np.exp(-eta))
        p = np.clip(p, 1e-9, 1 - 1e-9)
        ll = w * (y * np.log(p) + (1 - y) * np.log(1 - p))
        # gradient
        r = w * (y - p)
        gk = np.array([np.sum(r[b == i] * s[b == i]) for i in range(nb)])
        ga = np.array([np.sum(r[b == i]) for i in range(nb)])
        gv = D.T @ (r * k[b])
        return -ll.sum(), -np.concatenate([gv[1:], gk, ga])

    x0 = np.concatenate([np.array(v0 if v0 is not None else [3, 3, 2.5, 1.4, 10.0]), np.full(nb, 0.5), np.zeros(nb)])
    r = minimize(f, x0, jac=True, method='L-BFGS-B')
    return unpack(r.x)


def pooled(D, y, b, g, w, share, nboot=100, seed=0):
    """Fit with each bin's total weight set to its natural share; bootstrap by game."""
    nb = len(share)
    ww = w.copy()
    for i in range(nb):
        m = b == i
        if m.any():
            ww[m] = w[m] * share[i] / w[m].sum()
    ww *= len(set(g)) / ww.sum()
    v, k, a = fit_pooled(D, y, b, ww, nb)
    rng = np.random.default_rng(seed)
    ug, inv = np.unique(g, return_inverse=True)
    idx_by = [[] for _ in ug]
    for i, gi in enumerate(inv):
        idx_by[gi].append(i)
    boots = []
    for _ in range(nboot):
        pick = rng.integers(0, len(ug), len(ug))
        idx = np.concatenate([idx_by[p] for p in pick])
        vb, _, _ = fit_pooled(D[idx], y[idx], b[idx], ww[idx], nb, v0=v[1:])
        boots.append(vb)
    boots = np.array(boots)
    return v, boots.std(axis=0), k, a, boots


def game_rows(tag, bin_of=None):
    """One row per game: the imposed imbalance (first mover's view), result, bin, key."""
    jobs = json.load(open(f'{tag}.jobs.json'))
    res, _ = parse_raw(f'{tag}.raw')
    D, y, b, g = [], [], [], []
    from legal import illegal
    for j in jobs:
        r = res.get(j['id'])
        if r is None:
            continue
        if 'stratum' in j and (illegal(j['board'], j['side']) or 'P' not in j['board'] or 'p' not in j['board']):
            continue
        d = np.zeros(6)
        for t in j['wl']:
            d[T.index(t)] -= 1
        for t in j['bl']:
            d[T.index(t)] += 1
        yy = r['result']
        if j.get('side', 0) == 1:
            d, yy = -d, 1 - yy
        D.append(d)
        y.append(yy)
        b.append(bin_of(j) if bin_of else j.get('stratum', 0))
        g.append(f"{tag}:{j['id']}")
    return np.array(D), np.array(y), np.array(b), np.array(g)


def fit_scale(D, y, u, nboot=200, seed=0, groups=None):
    """With the pieces' ratios fixed (u, pawn excluded), fit logit = a + kP*dP + kX*(u . d_pieces):
    the pieces' worth in pawns is then s * u with s = kX / kP. Returns s and its bootstrap SD."""
    X = np.column_stack([np.ones(len(y)), D[:, 0], D[:, 1:] @ np.asarray(u)])
    beta = fit_logit(X, y)
    s = beta[2] / beta[1]
    rng = np.random.default_rng(seed)
    boots = []
    n = len(y)
    for _ in range(nboot):
        idx = rng.integers(0, n, n)
        b = fit_logit(X[idx], y[idx])
        boots.append(b[2] / b[1])
    return s, np.std(boots), beta
