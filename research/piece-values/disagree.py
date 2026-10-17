"""Games whose imposed imbalance the two value sets read differently: whom did the result favour?"""
import sys, json, collections
import numpy as np
from an_budget import rows
old = np.array(json.loads(sys.argv[2])); new = np.array(json.loads(sys.argv[3]))
for spec in sys.argv[1].split(';'):
    D, y, b, g = rows(spec.split(','))
    so, sn = D @ old, D @ new
    n = 0; pts_new = 0.0; kinds = collections.Counter()
    for d, yy, a, c in zip(D, y, so, sn):
        if np.sign(round(a, 6)) == np.sign(round(c, 6)): continue
        # the side the new values call ahead (or, if they call it level, the side the old values call behind)
        fav_first = c > 1e-9 or (abs(c) < 1e-9 and a < -1e-9)
        pts_new += yy if fav_first else 1 - yy
        n += 1
        kinds[tuple(int(x) for x in d)] += 1
    if n:
        se = 0.5 / np.sqrt(n)
        print(f'{spec}: {n} games where the old and new values disagree on who is ahead; the side the new values favour scored {pts_new/n:.3f} (±{se:.3f})')
