"""Balanced self-play games dumping quiet positions every 10 plies."""
import json, argparse
from pv import *
ap = argparse.ArgumentParser()
ap.add_argument('--n', type=int); ap.add_argument('--nodes', type=int); ap.add_argument('--tag')
ap.add_argument('--values', default=None); ap.add_argument('--feat', type=int, default=31)
ap.add_argument("--dump", type=int, default=10); ap.add_argument("--offset", type=int, default=0)
a = ap.parse_args()
v = vals(json.loads(a.values) if a.values else CUR)
jobs = [dict(id=i, board=START, side=0, nodes_w=a.nodes, nodes_b=a.nodes, vals_w=v, vals_b=v, rand_plies=10,
             rand_margin=40, seed=900000 + i + a.offset, record=0, keep=3, dump=a.dump, feat_w=a.feat, feat_b=a.feat) for i in range(a.n)]
res, rec = run_jobs(jobs, workers=4, out_path=f'{a.tag}.raw')
print('done', len(res))
