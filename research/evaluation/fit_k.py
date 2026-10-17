"""Five multipliers (one per piece, N B R U Q, on all of its terms; evalnums.scaled) fitted for
win accuracy: the evaluation's expected score, 1 / (1 + 10^(-K e / 400)), against each position's
game result, by squared error, over independent positions (one per game, gen_onepos.py). K is
fitted for the game's evaluation first and held. A fifth of the positions, chosen at random, is
held out. Also scores any evaluation files given with --score on the held-out positions."""
import argparse, subprocess, random
import numpy as np
from scipy.optimize import minimize_scalar, minimize
from evalnums import scaled

ap = argparse.ArgumentParser()
ap.add_argument('pos', nargs='+'); ap.add_argument('--engine', default='./engine')
ap.add_argument('--out', default='k_win.txt'); ap.add_argument('--score', nargs='*', default=[])
a = ap.parse_args()
lines = [l for f in a.pos for l in open(f) if l.strip()]
random.Random(1).shuffle(lines)
cut = len(lines) // 5
open('fitk_test.lab', 'w').writelines(lines[:cut]); open('fitk_train.lab', 'w').writelines(lines[cut:])

def losses(path, specs, K):
    p = subprocess.run([a.engine, 'loss', path], input=''.join(s + '\n' for s in specs), capture_output=True,
                       text=True, env={'LOSS_K': str(K)})
    return [float(l.split()[0]) / float(l.split()[1]) for l in p.stdout.strip().split('\n')]
line = lambda nums: ' '.join(f'{x:.5f}' if isinstance(x, float) else str(x) for x in nums)
one = line(scaled({p: 1.0 for p in 'NBRUQ'}))
K = minimize_scalar(lambda K: losses('fitk_train.lab', [one], K)[0], bounds=(0.1, 3), method='bounded').x
print(f'{len(lines)} positions ({cut} held out); K {K:.3f}', flush=True)
f = lambda v: losses('fitk_train.lab', [line(scaled(dict(zip('NBRUQ', v))))], K)[0]
r = minimize(f, np.ones(5), method='Nelder-Mead', options={'xatol': 0.005, 'fatol': 1e-7, 'maxfev': 400})
k = dict(zip('NBRUQ', r.x))
print('fitted multipliers', {p: round(float(v), 3) for p, v in k.items()}, flush=True)
with open(a.out, 'w') as fo: fo.write(line(scaled(k)) + '\n')
specs = {'game': one, 'win-fitted': line(scaled(k))}
for s in a.score: specs[s] = open(s).read().strip()
tr = losses('fitk_train.lab', list(specs.values()), K); te = losses('fitk_test.lab', list(specs.values()), K)
for (name, _), l1, l2 in zip(specs.items(), tr, te):
    print(f'  {name:>24}: training {l1:.5f}, held out {l2:.5f}', flush=True)
