"""The average of an SPSA run's numbers over a stretch of its path (Polyak averaging): the end of a
run is one noisy point, the average of its later steps a steadier estimate.

usage: polyak.py run.traj out.txt [--from PAIRS] [--to PAIRS]   (default: the second half)"""
import json, argparse
import numpy as np
from spsa64 import write_x

ap = argparse.ArgumentParser()
ap.add_argument('traj'); ap.add_argument('out')
ap.add_argument('--from', dest='lo', type=int, default=None); ap.add_argument('--to', dest='hi', type=int, default=None)
a = ap.parse_args()
rows = [json.loads(l) for l in open(a.traj) if l.strip()]
end = rows[-1]['pairs']
lo = a.lo if a.lo is not None else end // 2
hi = a.hi if a.hi is not None else end
xs = np.array([r['x'] for r in rows if lo <= r['pairs'] <= hi])
write_x(a.out, xs.mean(0))
print(f'{a.out}: the mean of {len(xs)} points from {lo} to {hi} pairs')
