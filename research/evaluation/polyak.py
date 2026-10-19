"""The average of an SPSA run's numbers over a stretch of its path (Polyak averaging): the end of a
run is one noisy point, the average of its later steps a steadier estimate. Several runs pool their
points (each from its own --from, or the one given).

usage: polyak.py run.traj [run2.traj ...] out.txt [--from PAIRS [PAIRS ...]] [--to PAIRS]
       (default: each run's second half)"""
import json, argparse
import numpy as np
from spsa64 import write_x

ap = argparse.ArgumentParser()
ap.add_argument('paths', nargs='+')
ap.add_argument('--from', dest='lo', type=int, nargs='+', default=None); ap.add_argument('--to', dest='hi', type=int, default=None)
a = ap.parse_args()
*trajs, out = a.paths
xs = []
for k, path in enumerate(trajs):
    rows = [json.loads(l) for l in open(path) if l.strip()]
    end = rows[-1]['pairs']
    lo = (a.lo[k] if len(a.lo) > 1 else a.lo[0]) if a.lo else end // 2
    hi = a.hi if a.hi is not None else end
    pts = [r['x'] for r in rows if lo <= r['pairs'] <= hi]
    print(f'{path}: {len(pts)} points from {lo} to {hi} pairs')
    xs += pts
write_x(out, np.array(xs).mean(0))
print(f'{out}: the mean of {len(xs)} points')
