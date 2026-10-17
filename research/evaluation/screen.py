"""A candidate evaluation against another at equal nodes, the game's own search (fresh table each
move, no extra pruning); each opening played twice with colours swapped."""
import sys, math, collections, argparse
from pv import run_jobs, START, score_stats
ap = argparse.ArgumentParser()
ap.add_argument('--nodes', type=int); ap.add_argument('--n', type=int); ap.add_argument('--new'); ap.add_argument('--old')
ap.add_argument('--tag'); ap.add_argument('--nodes-new', type=int, default=0, help='the candidate\'s own budget (default --nodes), for matches at equal time'); ap.add_argument('--workers', type=int, default=4); ap.add_argument('--seed', type=int, default=99000)
a = ap.parse_args()
jobs = []
nn = a.nodes_new or a.nodes
for i in range(a.n):
    a_white = i % 2 == 0
    jobs.append(dict(id=i, board=START, rand_plies=8, rand_margin=40, seed=a.seed + i // 2, keep=0,
                     nodes_w=nn if a_white else a.nodes, nodes_b=a.nodes if a_white else nn, vals_w=a.new if a_white else a.old,
                     vals_b=a.old if a_white else a.new, feat_w=0, feat_b=0))
res, _ = run_jobs(jobs, workers=a.workers, out_path=f'{a.tag}.raw', progress=False)
sc = [r['result'] if i % 2 == 0 else 1 - r['result'] for i, r in res.items()]
m, se = score_stats(sc)
elo = -400 * math.log10(1 / m - 1) if 0 < m < 1 else float('nan')
print(f'{a.new} vs {a.old} at {a.nodes} nodes' + (f' (the candidate {nn})' if nn != a.nodes else '') + ': {m:.3f} ± {se:.3f} ({elo:+.0f} Elo) over {len(sc)} games',
      dict(collections.Counter(r['reason'] for r in res.values())), flush=True)
