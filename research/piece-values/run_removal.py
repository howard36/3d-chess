"""Random-removal games, each imbalance played twice with colours swapped."""
import json, argparse, random
from design import *
ap = argparse.ArgumentParser()
ap.add_argument('--n', type=int); ap.add_argument('--nodes', type=int); ap.add_argument('--tag')
ap.add_argument('--seed', type=int, default=1); ap.add_argument('--values', default=None)
ap.add_argument('--feat', type=int, default=31); ap.add_argument('--sigma', type=float, default=2.0)
ap.add_argument('--bases', default=None, help='json list of base boards (white to move)')
ap.add_argument('--dump', type=int, default=0); ap.add_argument('--rand_plies', type=int, default=8)
a = ap.parse_args()
values = json.loads(a.values) if a.values else CUR
v = vals(values)
rng = random.Random(a.seed)
bases = json.load(open(a.bases)) if a.bases else None
jobs = []
for i in range(a.n // 2):
    wl, bl = sample_pair(rng, a.sigma)
    if bases:
        base = rng.choice(bases)
        # skip removals the base cannot supply
        try:
            b = remove(base['board'], wl, bl, rng)
        except ValueError:
            continue
        side = base['side']
    else:
        b = remove(START, wl, bl, rng); side = 0
    for k, (board, w, bb) in enumerate(((b, wl, bl), (flip(b), bl, wl))):
        jobs.append(dict(id=len(jobs), board=board, side=side if k == 0 else 1 - side, nodes_w=a.nodes, nodes_b=a.nodes,
                         vals_w=v, vals_b=v, rand_plies=a.rand_plies, rand_margin=40, seed=a.seed * 1000003 + len(jobs),
                         record=1, keep=3, dump=a.dump, feat_w=a.feat, feat_b=a.feat, wl=w, bl=bb))
with open(f'{a.tag}.jobs.json', 'w') as f: json.dump(jobs, f)
print(len(jobs), 'jobs', flush=True)
res, rec = run_jobs(jobs, workers=4, out_path=f'{a.tag}.raw')
print('done', len(res), flush=True)
