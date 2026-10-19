"""Fit the evaluation's numbers to game results (Texel tuning).

P(White scores) = sigmoid(K * eval / 100), eval = theta . f + offset (White's view, quiet positions
from self-play). K is fitted for the current numbers and then held; theta is fitted by log-loss
with a light pull towards the current numbers. Games are split 80/20; the held-out loss says
whether the fit generalises. Prints the fitted numbers, rounded."""
import sys, json
import numpy as np
from scipy.optimize import minimize

NAMES = ([f'P mg {i}' for i in range(9)] + [f'P eg {i}' for i in range(9)] + ['P file c', 'P file b/d'] +
         [f'{p} {k}' for p in 'NBU' for k in ('mg0', 'mg/c', 'home', 'eg0', 'eg/c')] +
         [f'{p} {k}' for p in 'RQ' for k in ('mg0', 'mg/c', 'eg0', 'eg/c')] +
         ['K mg/out', 'K mg/file', 'K eg0', 'K eg/c'] + [f'mob {p}' for p in 'NBRUQ'] +
         [f'trop {p}' for p in 'NBRUQ'] + ['bishop pair'])
OLD = np.array([100, 100, 106, 114, 124, 136, 152, 175, 100, 100, 100, 110, 124, 142, 166, 200, 250, 100, 6, 3,
                348, -8, -14, 338, -6, 311, -4, -14, 305, -3, 152, -3, -8, 148, -2, 251, -1, 249, -1, 986, -2, 990, -3,
                -14, -4, 24, -8, 2, 2, 2, 2, 1, 3, 2, 1, 2, 6, 20], float)

def load(raws):
    F, off, y, g = [], [], [], []
    for raw in raws:
        res = {}
        pos = []
        for line in open(raw):
            p = line.split()
            if p[0] == 'R': res[p[1]] = float(p[2])
            elif p[0] == 'B': pos.append((p[1], p[5], p[3]))
        feat = np.loadtxt(raw + '.feat')
        for (gid, board, side), row in zip(pos, feat):
            if gid not in res: continue
            F.append(row[:58]); off.append(row[58]); y.append(res[gid]); g.append(f'{raw}:{gid}')
    return np.array(F), np.array(off), np.array(y), np.array(g)

def loss(theta, F, off, y, K):
    e = F @ theta + off
    p = np.clip(1 / (1 + np.exp(-K * e / 100)), 1e-9, 1 - 1e-9)
    return -np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))

if __name__ == '__main__':
    raws = sys.argv[1].split(',')
    lam = float(sys.argv[2]) if len(sys.argv) > 2 else 1e-6
    F, off, y, g = load(raws)
    ug = np.unique(g)
    rng = np.random.default_rng(0)
    test_games = set(rng.choice(ug, len(ug) // 5, replace=False))
    te = np.array([x in test_games for x in g]); tr = ~te
    print(f'{len(y)} positions from {len(ug)} games; training {tr.sum()}, held out {te.sum()}')
    Ks = np.linspace(0.2, 2.0, 91)
    K = Ks[np.argmin([loss(OLD, F[tr], off[tr], y[tr], k) for k in Ks])]
    print(f'K = {K:.2f}; current numbers: training loss {loss(OLD, F[tr], off[tr], y[tr], K):.5f}, held out {loss(OLD, F[te], off[te], y[te], K):.5f}')
    scale = np.maximum(np.abs(OLD), 10.0)
    def obj(th):
        e = F[tr] @ th + off[tr]
        p = np.clip(1 / (1 + np.exp(-K * e / 100)), 1e-9, 1 - 1e-9)
        l = -np.mean(y[tr] * np.log(p) + (1 - y[tr]) * np.log(1 - p))
        grad = -(F[tr].T @ ((y[tr] - p) * K / 100)) / len(p)
        r = (th - OLD) / scale
        return l + lam * np.sum(r * r), grad + 2 * lam * r / scale
    th = minimize(obj, OLD.copy(), jac=True, method='L-BFGS-B').x
    print(f'tuned: training loss {loss(th, F[tr], off[tr], y[tr], K):.5f}, held out {loss(th, F[te], off[te], y[te], K):.5f}')
    for n, o, t in zip(NAMES, OLD, th):
        print(f'   {n:>12}: {o:7.1f} -> {t:7.1f}')
    json.dump({'K': K, 'theta': [round(float(x), 2) for x in th]}, open(f'texel_{lam:g}.json', 'w'))
