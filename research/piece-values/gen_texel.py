"""Natural self-play games from the start (ten varied plies), dumping every quiet position
(not in check, the move played neither a capture nor a promotion) every other ply, with the
result: data for fitting the evaluation to outcomes."""
import argparse
from pv import *
ap = argparse.ArgumentParser()
ap.add_argument('--n', type=int); ap.add_argument('--nodes', type=int); ap.add_argument('--tag')
ap.add_argument('--feat', type=int, default=31); ap.add_argument('--offset', type=int, default=0)
ap.add_argument('--vals', default='100,320,295,245,140,980')
a = ap.parse_args()
jobs = [dict(id=i, board=START, side=0, nodes_w=a.nodes, nodes_b=a.nodes, vals_w=a.vals, vals_b=a.vals,
             rand_plies=10, rand_margin=40, seed=700000 + a.offset + i, record=0, keep=3, dump=2,
             feat_w=a.feat, feat_b=a.feat) for i in range(a.n)]
res, _ = run_jobs(jobs, workers=4, out_path=f'{a.tag}.raw', progress=False)
print('done', len(res))
