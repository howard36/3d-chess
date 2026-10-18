"""Games whose imposed imbalance two value sets read differently: the score of the side the
new set puts ahead (quiet starts only)."""
import sys, json
import numpy as np
from an_phase2 import rows
old = np.array(json.loads(sys.argv[2])); new = np.array(json.loads(sys.argv[3]))
for spec in sys.argv[1].split(';'):
    D, y, st, g = rows(spec.split(','))
    so, sn = D @ old, D @ new
    pts, n = 0.0, 0
    for yy, a, c in zip(y, so, sn):
        if np.sign(round(a, 6)) == np.sign(round(c, 6)): continue
        fav = c > 1e-9 or (abs(c) < 1e-9 and a < -1e-9)
        pts += yy if fav else 1 - yy; n += 1
    if n: print(f'{spec}: {n} games read differently; the side the new set puts ahead scored {pts/n:.3f} (±{0.5/np.sqrt(n):.3f})')
