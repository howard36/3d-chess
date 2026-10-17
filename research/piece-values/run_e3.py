"""Removals from natural base positions, stratified by phase; each imbalance played twice
from the same base with the removals swapped between the sides."""
import json, argparse, random, itertools, math, collections
from design import *
from quiet import is_quiet
ap = argparse.ArgumentParser()
ap.add_argument('--n', type=int); ap.add_argument('--nodes', type=int); ap.add_argument('--tag')
ap.add_argument('--seed', type=int, default=3); ap.add_argument('--values', default=None)
ap.add_argument('--feat', type=int, default=31); ap.add_argument('--sigma', type=float, default=2.0)
ap.add_argument('--bases'); ap.add_argument('--strata', default='0.4,0.35,0.25')
ap.add_argument('--rand_plies', type=int, default=0); ap.add_argument('--skip', type=int, default=0)
a = ap.parse_args()
v = vals(json.loads(a.values) if a.values else CUR)
rng = random.Random(a.seed)
bases = json.load(open(a.bases))
BINS = [0, 6, 12, 17, 40]
by_bin = collections.defaultdict(lambda: collections.defaultdict(list))
for bs in bases:
    if bs['board'].count('P') == 0 or bs['board'].count('p') == 0:
        continue   # pawnless: lone pieces cannot mate, every imbalance draws
    i = max(k for k in range(4) if BINS[k] <= bs['nonpawn'])
    by_bin[min(i, 2)][bs['key'] // 1000].append(bs)   # by source game; the opening bin folds into 12-16
strata = [float(x) for x in a.strata.split(',')]
print({k: (len(x), sum(len(v) for v in x.values())) for k, x in by_bin.items()}, flush=True)

def subsets(pieces, maxn=3):
    out = set()
    for n in range(0, maxn + 1):
        for c in itertools.combinations(sorted(pieces), n):
            if c.count('P') <= 3: out.add(''.join(c))
    return sorted(out)

def pick(base):
    b = base['board']
    wp = [ch for ch in b if ch in 'PNBRUQ']
    sw = subsets(wp)
    for _ in range(200):
        x = rng.choice(sw); y = rng.choice(sw)
        lx, ly = list(x), list(y)
        for t in list(lx):
            if t in ly: lx.remove(t); ly.remove(t)
        if not lx and not ly: continue
        d = value(lx) - value(ly)
        if rng.random() < math.exp(-(d / a.sigma) ** 2):
            return ''.join(lx), ''.join(ly)
    return None

jobs = []
while len(jobs) < a.n:
    u = rng.random(); acc = 0
    for k, s in enumerate(strata):
        acc += s
        if u < acc: break
    base = rng.choice(by_bin[k][rng.choice(sorted(by_bin[k]))])
    pr = pick(base)
    if pr is None: continue
    wl, bl = pr
    try:
        b1 = remove(base['board'], wl, bl, rng); b2 = remove(base['board'], bl, wl, rng)
    except ValueError:
        continue
    # both starts must stay quiet: nothing hanging, no check
    if not (is_quiet(b1, base['side']) and is_quiet(b2, base['side'])):
        continue
    s = a.seed * 1000003 + len(jobs)
    for board, w, bb in ((b1, wl, bl), (b2, bl, wl)):
        jobs.append(dict(id=len(jobs), board=board, side=base['side'], nodes_w=a.nodes, nodes_b=a.nodes, vals_w=v, vals_b=v,
                         rand_plies=a.rand_plies, rand_margin=40, seed=s, record=1, keep=3, feat_w=a.feat, feat_b=a.feat,
                         wl=w, bl=bb, base=base['key'], stratum=k))
jobs = jobs[a.skip:]
with open(f'{a.tag}.jobs.json', 'w') as f: json.dump(jobs, f)
print(len(jobs), 'jobs', collections.Counter(j['stratum'] for j in jobs), flush=True)
res, rec = run_jobs(jobs, workers=4, out_path=f'{a.tag}.raw')
print('done', len(res), flush=True)
