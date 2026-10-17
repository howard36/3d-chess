"""How well each value set's material difference predicts the result in natural positions
(quiet positions sampled every 4 plies from self-play games that began level)."""
import sys, json, collections
import numpy as np
T = 'PNBRUQ'
def load(path):
    res = {}; pos = []
    for line in open(path):
        p = line.split()
        if p[0] == 'R': res[p[1]] = float(p[2])
        elif p[0] == 'B': pos.append((p[1], p[5]))
    rows = []
    for gid, b in pos:
        c = collections.Counter(b)
        d = np.array([c[t] - c[t.lower()] for t in T], float)
        pieces = sum(c[t] + c[t.lower()] for t in 'NBRUQ')
        rows.append((d, res[gid], gid, pieces))
    return rows
def evaluate(rows, v):
    v = np.array(v, float)
    agree = tot = 0
    by_phase = collections.defaultdict(lambda: [0, 0])
    for d, y, gid, pieces in rows:
        s = d @ v
        if y == 0.5 or not d.any(): continue
        ok = 0.5 if abs(s) < 1e-9 else float((s > 0) == (y == 1))
        agree += ok; tot += 1
        ph = 0 if pieces < 6 else 1 if pieces < 12 else 2
        by_phase[ph][0] += ok; by_phase[ph][1] += 1
    return agree / tot, tot, {k: round(a / b, 3) for k, (a, b) in sorted(by_phase.items())}
if __name__ == '__main__':
    rows = load(sys.argv[1])
    sets = json.loads(sys.argv[2])
    for name, v in sets.items():
        acc, n, ph = evaluate(rows, v)
        print(f'{name:>12}: the side ahead wins {acc:.3f} of decisive games ({n} positions); by phase {ph}')
