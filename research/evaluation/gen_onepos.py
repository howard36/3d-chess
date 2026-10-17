"""Games of the game's own search (a fresh table each move, no added pruning) at a fixed number
of nodes a move, both sides one evaluation, each from eight plies chosen at random among the
near-best; from each game one quiet position (not in check, the move played there neither a
capture nor a promotion) chosen at random, with the game's result: independent positions for
fitting the evaluation to results. Writes <tag>.pos, lines "board side label", the label the
result for the side to move as the loss mode reads it (3000 a win, 0 a draw, -3000 a loss)."""
import argparse, random
from pv import run_jobs, START
ap = argparse.ArgumentParser()
ap.add_argument('--n', type=int, required=True); ap.add_argument('--nodes', type=int, default=20000)
ap.add_argument('--seed', type=int, required=True); ap.add_argument('--eval', default='100,320,295,245,140,980')
ap.add_argument('--tag', required=True); ap.add_argument('--workers', type=int, default=4)
a = ap.parse_args()
jobs = [dict(id=i, board=START, rand_plies=8, rand_margin=40, seed=a.seed + i, nodes_w=a.nodes, nodes_b=a.nodes,
             vals_w=a.eval, vals_b=a.eval, feat_w=0, feat_b=0, keep=0, dump=1) for i in range(a.n)]
res, _ = run_jobs(jobs, workers=a.workers, out_path=f'{a.tag}.raw', progress=False)
seen = {}
for line in open(f'{a.tag}.raw'):
    p = line.split()
    if p[0] == 'B': seen.setdefault(int(p[1]), []).append((p[5], int(p[3])))
rng = random.Random(a.seed)
n = 0
with open(f'{a.tag}.pos', 'w') as f:
    for gid in sorted(seen):
        if gid not in res: continue
        board, side = rng.choice(seen[gid])
        r = res[gid]['result'] if side == 0 else 1 - res[gid]['result']
        f.write(f'{board} {side} {3000 if r == 1 else -3000 if r == 0 else 0}\n'); n += 1
print(f'{n} positions from {len(res)} games', flush=True)
