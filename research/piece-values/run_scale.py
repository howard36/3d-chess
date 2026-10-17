"""Near-even trades of pieces for pawns, the design that pins down a piece's worth in pawns.

Four strata, equal games each: 0 endgames (1-5 pieces besides kings and pawns, pawns on both
sides), 1 late middlegame (6-11), 2 middlegame (12+), 3 the start (eight varied plies after).
Each imbalance is played twice from the same position with it swapped between the sides.
Candidates: pieces A against k pawns with |s0 * u(A) - k| <= tol; a share of plain pawn odds."""
import json, argparse, random, itertools, collections, sys
from pv import *
from quiet import is_quiet

U = {'N': 1.003, 'B': 1.0, 'R': 0.892, 'U': 0.422, 'Q': 3.597}
ap = argparse.ArgumentParser()
ap.add_argument('--n', type=int); ap.add_argument('--nodes', type=int); ap.add_argument('--tag')
ap.add_argument('--seed', type=int, default=101); ap.add_argument('--bases', default='pool.json')
ap.add_argument('--s0', type=float, default=2.75); ap.add_argument('--tol', type=float, default=0.6)
ap.add_argument('--odds', type=float, default=0.2); ap.add_argument('--workers', type=int, default=4)
ap.add_argument('--dry', action='store_true')
ap.add_argument('--values', default='{"P":100,"N":280,"B":275,"R":245,"U":130,"Q":1000}')
a = ap.parse_args()
v = vals(json.loads(a.values))
rng = random.Random(a.seed)
BINS = [0, 6, 12, 17, 40]
pool = collections.defaultdict(lambda: collections.defaultdict(list))
for bs in json.load(open(a.bases)):
    if bs['board'].count('P') == 0 or bs['board'].count('p') == 0:
        continue
    i = min(2, max(k for k in range(4) if BINS[k] <= bs['nonpawn']))
    pool[i][bs['key'] // 1000].append(bs)
pool[3][0] = [{'board': START, 'side': 0, 'key': 0}]

def candidates(board):
    pieces = sorted(ch for ch in board if ch in 'NBRUQ')
    pawns = board.count('P')
    out = []
    for size in (1, 2):
        for A in set(itertools.combinations(pieces, size)):
            val = a.s0 * sum(U[t] for t in A)
            for k in range(1, min(4, pawns) + 1):
                if abs(val - k) <= a.tol:
                    out.append((''.join(A), 'P' * k))
    return out

jobs = []
per = a.n // 2
strata = [0, 1, 2, 3]
pairs = []
while len(pairs) < per:
    st = strata[len(pairs) % 4]
    games = pool[st]
    base = rng.choice(games[rng.choice(sorted(games))])
    if rng.random() < a.odds:
        x, y = 'P', ''
    else:
        c = candidates(base['board'])
        if not c:
            continue
        x, y = rng.choice(c)
    if rng.random() < 0.5:
        x, y = y, x
    try:
        b1 = remove(base['board'], x, y, rng); b2 = remove(base['board'], y, x, rng)
    except ValueError:
        continue
    if st != 3 and not (is_quiet(b1, base['side']) and is_quiet(b2, base['side'])):
        continue
    pairs.append((st, base, (b1, x, y), (b2, y, x)))
rng.shuffle(pairs)
for st, base, g1, g2 in pairs:
    s = a.seed * 1000003 + len(jobs)
    for board, w, bb in (g1, g2):
        jobs.append(dict(id=len(jobs), board=board, side=base['side'], nodes_w=a.nodes, nodes_b=a.nodes,
                         vals_w=v, vals_b=v, rand_plies=8 if st == 3 else 0, rand_margin=40, seed=s, record=0,
                         keep=3, feat_w=31, feat_b=31, wl=w, bl=bb, base=base['key'], stratum=st))
with open(f'{a.tag}.jobs.json', 'w') as f:
    json.dump(jobs, f)
c = collections.Counter((j['stratum'], ''.join(sorted([j['wl'], j['bl']]))) for j in jobs[::2])
print(len(jobs), 'jobs;', sorted(collections.Counter(j['stratum'] for j in jobs).items()), flush=True)
print(c.most_common(30), flush=True)
if a.dry:
    sys.exit(0)
res, _ = run_jobs(jobs, workers=a.workers, out_path=f'{a.tag}.raw')
print('done', len(res), flush=True)
