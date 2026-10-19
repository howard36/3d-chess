import sys
import numpy as np
from analysis import *
from an_budget import rows
tags = sys.argv[1].split(',')
D, y, b, g = rows(tags)
w = np.ones(len(y))
counts = [float((b == i).sum()) for i in range(4)]
share = [c / sum(counts) for c in counts]
v, sd, k, a, boots = pooled(D, y, b, g, w, share, nboot=60)
print(f'free fit, all groups ({len(y)} games): {fmt(v, sd)}  pawn slope per group {np.round(k, 2)}')
r = boots / boots[:, [2]]
print('  ratios to the bishop: ' + '  '.join(f'{T[i]}={np.mean(r[:, i]):.3f}±{np.std(r[:, i]):.3f}' for i in (1, 3, 4, 5)))
