"""The game's own search (faithful port: fresh table each move, no extra pruning) with the new
values against the old, at equal nodes; each opening played twice with colours swapped."""
import sys, math, collections
from pv import *
nodes = int(sys.argv[1]); n = int(sys.argv[2]); new = sys.argv[3]; old = sys.argv[4]; tag = sys.argv[5]
jobs = []
for i in range(n):
    a_white = i % 2 == 0
    jobs.append(dict(id=i, board=START, rand_plies=8, rand_margin=40, seed=77000 + i // 2, keep=0,
                     nodes_w=nodes, nodes_b=nodes, vals_w=new if a_white else old, vals_b=old if a_white else new,
                     feat_w=0, feat_b=0))
res, _ = run_jobs(jobs, workers=4, out_path=f'{tag}.raw', progress=False)
sc = [r['result'] if i % 2 == 0 else 1 - r['result'] for i, r in res.items()]
m, se = score_stats(sc)
elo = -400 * math.log10(1 / m - 1)
print(f'new values vs old at {nodes} nodes, faithful search: {m:.3f} ± {se:.3f} ({elo:+.0f} Elo) over {len(sc)} games',
      dict(collections.Counter(r['reason'] for r in res.values())))
