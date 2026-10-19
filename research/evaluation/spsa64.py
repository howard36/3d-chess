"""SPSA on the whole evaluation with the extension terms: the 58 numbers (eval_features' layout)
and six more (engine.h EvalParams: king danger by the enemy's force and queen, pawns by the king,
passed pawns middlegame and endgame, pawn threats), for playing strength.

Each step a random sign vector D; x+ = x + c*D plays x- = x - c*D twice from one
random opening (colours swapped), the game's own search (no added pruning, fresh table each move)
at a fixed number of positions; x moves by eta * c * (pair score of x+ less 1) * D. The numbers no
position can use, and any listed in --fix, stay put. Writes the trajectory to <tag>.traj."""
import json, argparse, random, os, time
import numpy as np
from pv import run_jobs, START
from evalnums import FIXED, C, order_values

NAMES_X = ['x force', 'x queen', 'x shield', 'x pass mg', 'x pass eg', 'x threat']
CX_ = np.array([0.15, 0.15, 3, 1, 3, 10])
CALL = np.concatenate([C, CX_])

def write_x(path, x):
    with open(path, 'w') as f:
        f.write(' '.join(f'{v:.3f}' for v in x[:58]) + ' ' + ' '.join(map(str, order_values(x[:58]))) + ' ' +
                ' '.join(f'{v:.4f}' for v in x[58:]) + '\n')

def read_x(path):
    n = open(path).read().split()
    x = np.array([float(v) for v in n[:58]] + ([float(v) for v in n[64:70]] if len(n) >= 70 else [0] * 6))
    return x

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--tag', default='spsa64'); ap.add_argument('--start', required=True)
    ap.add_argument('--nodes', type=int, default=20000); ap.add_argument('--pairs', type=int, default=9000)
    ap.add_argument('--batch', type=int, default=16); ap.add_argument('--eta', type=float, default=0.02)
    ap.add_argument('--seed', type=int, default=6464); ap.add_argument('--fix', default='61,62')
    ap.add_argument('--resume', action='store_true')
    a = ap.parse_args()
    x = read_x(a.start)
    done = 0
    if a.resume and os.path.exists(f'{a.tag}.traj'):
        j = json.loads(open(f'{a.tag}.traj').read().strip().split('\n')[-1])
        x = np.array(j['x']); done = j['pairs']
    fixed = set(FIXED) | {int(v) for v in a.fix.split(',') if v}
    mask = np.array([0.0 if i in fixed else 1.0 for i in range(64)])
    tmp = f'{a.tag}_tmp'; os.makedirs(tmp, exist_ok=True)
    rng = random.Random(a.seed * 7919 + done)
    traj = open(f'{a.tag}.traj', 'a')
    t0 = time.time()
    while done < a.pairs:
        ck = CALL / (1 + done / 2000) ** 0.101
        eta = a.eta / (1 + done / 2000) ** 0.602
        jobs, deltas = [], []
        for b in range(a.batch):
            d = np.array([rng.choice((-1, 1)) for _ in range(64)]) * mask
            pp, mp = f'{tmp}/p{b}.txt', f'{tmp}/m{b}.txt'
            write_x(pp, x + ck * d); write_x(mp, x - ck * d)
            seed = a.seed * 100003 + done + b
            for col in range(2):
                jobs.append(dict(id=len(jobs), board=START, rand_plies=8, rand_margin=40, seed=seed,
                                 nodes_w=a.nodes, nodes_b=a.nodes, vals_w='@' + (pp if col == 0 else mp),
                                 vals_b='@' + (mp if col == 0 else pp), feat_w=0, feat_b=0, keep=0))
            deltas.append(d)
        res, _ = run_jobs(jobs, workers=4, progress=False)
        step = np.zeros(64)
        for b, d in enumerate(deltas):
            s = res[2 * b]['result'] + (1 - res[2 * b + 1]['result'])
            step += eta * ck * (s - 1) * d
        x = x + step
        done += a.batch
        traj.write(json.dumps({'pairs': done, 'x': [round(float(v), 4) for v in x], 't': round(time.time() - t0)}) + '\n')
        traj.flush()
    write_x(f'{a.tag}_final.txt', x)
    print('done', done)
