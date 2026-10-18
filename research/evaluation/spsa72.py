"""SPSA as spsa64.py, with the further extension terms (engine.h: piece threats, attacks next to the
king, the side to move, pieces and pawns a pawn defends, isolated pawns, the queen's attacks): the
58 numbers, six extension terms and eight more, written as evaluation files of 78 numbers. Numbers
listed in --fix stay put (by default those no position uses, the passed pawns and the switches);
--from starts from a 64- or 78-number path or file.

usage: spsa72.py --start file --tag T [--y 'threat,kzone,...' starting values] [--fix ...]"""
import json, argparse, random, os, time
import numpy as np
from pv import run_jobs, START
from evalnums import FIXED, C, order_values

NAMES_Y = ['y threat', 'y kzone', 'y tempo', 'y prot', 'y chain', 'y iso', 'y kq', 'y spare']
CX_ = np.array([0.15, 0.15, 3, 1, 3, 10])
CY_ = np.array([10, 2, 6, 3, 2, 3, 0, 0])
CALL = np.concatenate([C, CX_, CY_])
N = 72

def write_x(path, x):
    with open(path, 'w') as f:
        f.write(' '.join(f'{v:.3f}' for v in x[:58]) + ' ' + ' '.join(map(str, order_values(x[:58]))) + ' ' +
                ' '.join(f'{v:.4f}' for v in x[58:64]) + ' ' + ' '.join(f'{v:.4f}' for v in x[64:72]) + '\n')

def read_x(path):
    n = open(path).read().split()
    th = [float(v) for v in n[:58]]
    ext = [float(v) for v in n[64:70]] if len(n) >= 70 else [0] * 6
    y = [float(v) for v in n[70:78]] if len(n) == 78 else [float(v) for v in n[81:89]] if len(n) == 89 else [0] * 8
    return np.array(th + ext + y)

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--tag', required=True); ap.add_argument('--start', required=True)
    ap.add_argument('--nodes', type=int, default=20000); ap.add_argument('--pairs', type=int, default=9000)
    ap.add_argument('--batch', type=int, default=16); ap.add_argument('--eta', type=float, default=0.02)
    ap.add_argument('--seed', type=int, default=7272); ap.add_argument('--fix', default='61,62,70,71')
    ap.add_argument('--y', default='', help='starting values of the eight further terms, comma-separated')
    ap.add_argument('--resume', action='store_true')
    a = ap.parse_args()
    x = read_x(a.start)
    if a.y: x[64:72] = [float(v) for v in a.y.split(',')]
    done = 0
    if a.resume and os.path.exists(f'{a.tag}.traj'):
        j = json.loads(open(f'{a.tag}.traj').read().strip().split('\n')[-1])
        x = np.array(j['x']); done = j['pairs']
    fixed = set(FIXED) | {int(v) for v in a.fix.split(',') if v}
    mask = np.array([0.0 if i in fixed else 1.0 for i in range(N)])
    tmp = f'{a.tag}_tmp'; os.makedirs(tmp, exist_ok=True)
    rng = random.Random(a.seed * 7919 + done)
    traj = open(f'{a.tag}.traj', 'a')
    t0 = time.time()
    while done < a.pairs:
        ck = CALL / (1 + done / 2000) ** 0.101
        eta = a.eta / (1 + done / 2000) ** 0.602
        jobs, deltas = [], []
        for b in range(a.batch):
            d = np.array([rng.choice((-1, 1)) for _ in range(N)]) * mask
            pp, mp = f'{tmp}/p{b}.txt', f'{tmp}/m{b}.txt'
            write_x(pp, x + ck * d); write_x(mp, x - ck * d)
            seed = a.seed * 100003 + done + b
            for col in range(2):
                jobs.append(dict(id=len(jobs), board=START, rand_plies=8, rand_margin=40, seed=seed,
                                 nodes_w=a.nodes, nodes_b=a.nodes, vals_w='@' + (pp if col == 0 else mp),
                                 vals_b='@' + (mp if col == 0 else pp), feat_w=0, feat_b=0, keep=0))
            deltas.append(d)
        res, _ = run_jobs(jobs, workers=4, progress=False)
        step = np.zeros(N)
        for b, d in enumerate(deltas):
            s = res[2 * b]['result'] + (1 - res[2 * b + 1]['result'])
            step += eta * ck * (s - 1) * d
        x = x + step
        done += a.batch
        traj.write(json.dumps({'pairs': done, 'x': [round(float(v), 4) for v in x], 't': round(time.time() - t0)}) + '\n')
        traj.flush()
    write_x(f'{a.tag}_final.txt', x)
    print('done', done)
