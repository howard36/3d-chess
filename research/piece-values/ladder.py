"""Strength matches at equal or unequal budgets: side A (nodes, features, keepTT) against side B,
each opening played twice with colours swapped. Prints A's score and Elo."""
import math, collections, argparse
from pv import *
ap = argparse.ArgumentParser()
ap.add_argument('--a', required=True, help='nodes,feat,keep for A')
ap.add_argument('--b', required=True, help='nodes,feat,keep for B')
ap.add_argument('--n', type=int, required=True); ap.add_argument('--tag', required=True)
ap.add_argument('--seed', type=int, default=88000)
a = ap.parse_args()
A = [int(x) for x in a.a.split(',')]; B = [int(x) for x in a.b.split(',')]
v = vals(CUR)
jobs = []
for i in range(a.n):
    aw = i % 2 == 0
    W, Bk = (A, B) if aw else (B, A)
    jobs.append(dict(id=i, board=START, rand_plies=8, rand_margin=40, seed=a.seed + i // 2,
                     nodes_w=W[0], nodes_b=Bk[0], vals_w=v, vals_b=v, feat_w=W[1], feat_b=Bk[1],
                     keep=(W[2] & 1) | ((Bk[2] & 1) << 1)))
res, _ = run_jobs(jobs, workers=4, out_path=f'{a.tag}.raw', progress=False)
sc = [r['result'] if i % 2 == 0 else 1 - r['result'] for i, r in res.items()]
m, se = score_stats(sc)
elo = -400 * math.log10(1 / m - 1) if 0 < m < 1 else float('nan')
print(f'A {a.a} vs B {a.b}: A scores {m:.3f} ± {se:.3f} ({elo:+.0f} Elo) over {len(sc)}',
      dict(collections.Counter(r['reason'] for r in res.values())), flush=True)
