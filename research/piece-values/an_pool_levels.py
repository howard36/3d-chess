"""One shared set from several strength levels pooled (all designs, quiet starts, phases equal)."""
import sys
import numpy as np
from an_phase2 import rows
from analysis import pooled, fmt
for spec in sys.argv[1:]:
    tags = []
    for t in spec.split(','):
        try: open(f'{t}.raw').close(); tags.append(t)
        except FileNotFoundError: pass
    D, y, st, g = rows(tags)
    groups = sorted(set(st)); share = [1.0 / len(groups) if i in groups else 0 for i in range(4)]
    v, sd, k, a, _ = pooled(D, y, st, g, np.ones(len(y)), share, nboot=60)
    print(f'{"+".join(tags)} ({len(y)} games): {fmt(v, sd)}')
