"""SPSA for playing strength on five numbers: a multiplier per piece (N B R U Q) on all of its
terms (its tables, constant included, mobility, king pressure, the bishop pair, its value for
ordering and the lead), the rest of the evaluation as the game has it. Each step
k+ = k + c*D plays k- = k - c*D twice from one random opening, the game's own search at a fixed
number of nodes; k moves by eta * c * (pair score of k+ less 1) * D."""
import json, argparse, random, os, time
import numpy as np
from pv import run_jobs, START
from evalnums import scaled, write_numbers

ap = argparse.ArgumentParser()
ap.add_argument('--tag', default='spsak'); ap.add_argument('--nodes', type=int, default=20000)
ap.add_argument('--pairs', type=int, default=3000); ap.add_argument('--batch', type=int, default=16)
ap.add_argument('--eta', type=float, default=0.02); ap.add_argument('--c', type=float, default=0.05)
ap.add_argument('--seed', type=int, default=4242); ap.add_argument('--resume', action='store_true')
a = ap.parse_args()
k = np.ones(5); done = 0
if a.resume and os.path.exists(f'{a.tag}.traj'):
    j = json.loads(open(f'{a.tag}.traj').read().strip().split('\n')[-1]); k = np.array(j['k']); done = j['pairs']
kd = lambda v: dict(zip('NBRUQ', v))
tmp = f'{a.tag}_tmp'; os.makedirs(tmp, exist_ok=True)
rng = random.Random(a.seed * 7919 + done)
traj = open(f'{a.tag}.traj', 'a'); t0 = time.time()
while done < a.pairs:
    ck = a.c / (1 + done / 2000) ** 0.101
    eta = a.eta / (1 + done / 2000) ** 0.602
    jobs, deltas = [], []
    for b in range(a.batch):
        d = np.array([rng.choice((-1, 1)) for _ in range(5)])
        pp, mp = f'{tmp}/p{b}.txt', f'{tmp}/m{b}.txt'
        write_numbers(pp, scaled(kd(k + ck * d))); write_numbers(mp, scaled(kd(k - ck * d)))
        seed = a.seed * 100003 + done + b
        for col in range(2):
            jobs.append(dict(id=len(jobs), board=START, rand_plies=8, rand_margin=40, seed=seed,
                             nodes_w=a.nodes, nodes_b=a.nodes, vals_w='@' + (pp if col == 0 else mp),
                             vals_b='@' + (mp if col == 0 else pp), feat_w=0, feat_b=0, keep=0))
        deltas.append(d)
    res, _ = run_jobs(jobs, workers=4, progress=False)
    step = np.zeros(5)
    for b, d in enumerate(deltas):
        s = res[2 * b]['result'] + (1 - res[2 * b + 1]['result'])
        step += eta * ck * (s - 1) * d
    k = k + step; done += a.batch
    traj.write(json.dumps({'pairs': done, 'k': [round(float(v), 5) for v in k], 't': round(time.time() - t0)}) + '\n'); traj.flush()
write_numbers(f'{a.tag}_final.txt', scaled(kd(k)))
print('final', {p: round(float(v), 4) for p, v in zip('NBRUQ', k)}, flush=True)
