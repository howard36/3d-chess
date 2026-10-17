"""SPSA on the engine's five piece constants (pawn fixed at 100) for playing strength.

Each step: a random sign vector D; theta+ = theta + c*D plays theta- = theta - c*D twice from one
random opening (colours swapped), the game's own search (no added pruning, fresh table each
move) at a fixed number of positions; theta moves by eta * c * (pair score of theta+ less 1) * D.
Steps run in batches (one opening each) on 4 workers. Writes the trajectory to <tag>.traj."""
import json, argparse, random, time
import numpy as np
from pv import run_jobs, START

ap = argparse.ArgumentParser()
ap.add_argument('--tag', default='spsa'); ap.add_argument('--nodes', type=int, default=20000)
ap.add_argument('--start', default='320,295,245,140,980'); ap.add_argument('--pairs', type=int, default=6000)
ap.add_argument('--batch', type=int, default=8); ap.add_argument('--eta', type=float, default=0.02)
ap.add_argument('--c', default='16,16,16,12,40'); ap.add_argument('--seed', type=int, default=5150)
ap.add_argument('--feat', type=int, default=0); ap.add_argument('--keep', type=int, default=0)
a = ap.parse_args()
theta = np.array([float(x) for x in a.start.split(',')])
c0 = np.array([float(x) for x in a.c.split(',')])
rng = random.Random(a.seed)
traj = open(f'{a.tag}.traj', 'a')
done = 0
t0 = time.time()
k = 0
while done < a.pairs:
    k += 1
    # gains decay slowly, as in Fishtest's SPSA
    ck = c0 / (1 + done / 2000) ** 0.101
    eta = a.eta / (1 + done / 2000) ** 0.602
    jobs, deltas = [], []
    for b in range(a.batch):
        d = np.array([rng.choice((-1, 1)) for _ in range(5)])
        plus = np.round(theta + ck * d).astype(int); minus = np.round(theta - ck * d).astype(int)
        vp = '100,' + ','.join(map(str, plus)); vm = '100,' + ','.join(map(str, minus))
        seed = a.seed * 100003 + done + b
        for col in range(2):
            jobs.append(dict(id=len(jobs), board=START, rand_plies=8, rand_margin=40, seed=seed,
                             nodes_w=a.nodes, nodes_b=a.nodes, vals_w=vp if col == 0 else vm,
                             vals_b=vm if col == 0 else vp, feat_w=a.feat, feat_b=a.feat, keep=a.keep * 3))
        deltas.append(d)
    res, _ = run_jobs(jobs, workers=4, progress=False)
    step = np.zeros(5)
    for b, d in enumerate(deltas):
        s = res[2 * b]['result'] + (1 - res[2 * b + 1]['result'])   # theta+'s points in the pair
        step += eta * ck * (s - 1) * d
    theta = theta + step
    done += a.batch
    traj.write(json.dumps({'pairs': done, 'theta': [round(x, 1) for x in theta], 't': round(time.time() - t0)}) + '\n')
    traj.flush()
print('final', [round(x) for x in theta])
