"""Chosen imbalances from the start, each played twice (colours swapped by mirroring)."""
import json, argparse, random
from design import *
ap = argparse.ArgumentParser()
ap.add_argument('--pairs'); ap.add_argument('--reps', type=int); ap.add_argument('--nodes', type=int)
ap.add_argument('--tag'); ap.add_argument('--seed', type=int, default=9); ap.add_argument('--values', default=None)
ap.add_argument('--feat', type=int, default=31)
a = ap.parse_args()
v = vals(json.loads(a.values) if a.values else CUR)
rng = random.Random(a.seed)
pairs = [p.split(':') for p in a.pairs.split(',')]
jobs = []
for r in range(a.reps):
    for wl, bl in pairs:
        b = remove(START, wl, bl, rng)
        for k, (board, w, bb) in enumerate(((b, wl, bl), (flip(b), bl, wl))):
            jobs.append(dict(id=len(jobs), board=board, side=k, nodes_w=a.nodes, nodes_b=a.nodes, vals_w=v, vals_b=v,
                             rand_plies=8, rand_margin=40, seed=a.seed * 1000003 + len(jobs), record=1, keep=3,
                             feat_w=a.feat, feat_b=a.feat, wl=w, bl=bb))
rng.shuffle(jobs)
for i, j in enumerate(jobs): j['id'] = i
with open(f'{a.tag}.jobs.json', 'w') as f: json.dump(jobs, f)
print(len(jobs), 'jobs', flush=True)
res, rec = run_jobs(jobs, workers=4, out_path=f'{a.tag}.raw')
print('done', len(res), flush=True)
