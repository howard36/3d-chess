"""Fit the evaluation's numbers (the 58, and optionally the six extension terms) to the scores of
deeper searches: minimise the mean squared difference in expected score (logistic, 400 cp a factor
of ten) between the static evaluation and the label, over quiet positions from games and one random
move away from them. The loss is the C engine's own evaluation (engine9 loss), so rounding and
mobility are exactly as played. Gradients by central differences, a step scaled per number, a line
search along it; a light pull towards the starting numbers; the held-out positions (other games)
say whether the fit generalises.

usage: fit_search.py train.lab test.lab start.txt out.txt [--ext] [--lam L] [--iters N]"""
import sys, os, subprocess, argparse, time
import numpy as np
from evalnums import FIXED, C, order_values

ap = argparse.ArgumentParser()
ap.add_argument('train'); ap.add_argument('test'); ap.add_argument('start'); ap.add_argument('out')
ap.add_argument('--ext', action='store_true'); ap.add_argument('--lam', type=float, default=1e-4)
ap.add_argument('--iters', type=int, default=40); ap.add_argument('--procs', type=int, default=4)
ap.add_argument('--engine', default='./engine11')
ap.add_argument('--K', type=float, default=1.0, help='the evaluation\'s scale against the labels (game results: fit it first)')
a = ap.parse_args()

nums = open(a.start).read().split()
theta0 = np.array([float(x) for x in nums[:58]])
ext0 = np.array([float(x) for x in nums[64:70]]) if len(nums) >= 70 else np.zeros(6)
x0 = np.concatenate([theta0, ext0])
N = 64
free = np.array([i not in FIXED for i in range(58)] + [a.ext] * 6)
H = np.concatenate([C / 4, [0.05, 0.05, 1, 0.5, 0.5, 2]])          # finite-difference step
H[47:58] = 1                                                        # rounded to whole numbers
S = np.concatenate([C, [0.15, 0.15, 4, 2, 4, 12]])                  # scale of a sensible change

def split(path, k):
    lines = open(path).read().strip().split('\n')
    parts = []
    for i in range(k):
        p = f'{path}.part{i}'
        open(p, 'w').write('\n'.join(lines[i::k]) + '\n')
        parts.append(p)
    return parts, len(lines)

class Loss:
    def __init__(self, path, k):
        parts, self.n = split(path, k)
        env = dict(os.environ, LOSS_K=str(a.K))
        self.ps = [subprocess.Popen([a.engine, 'loss', p], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                    text=True, bufsize=1, env=env) for p in parts]
    def __call__(self, xs):
        """Mean loss for each of several number vectors, the work shared between the processes."""
        lines = []
        for x in xs:
            line = ' '.join(f'{v:.4f}' for v in x[:58]) + ' ' + ' '.join(map(str, order_values(x[:58])))
            if a.ext: line += ' ' + ' '.join(f'{v:.4f}' for v in x[58:])
            lines.append(line + '\n')
        for p in self.ps:
            p.stdin.write(''.join(lines)); p.stdin.flush()
        tot = np.zeros(len(xs))
        for p in self.ps:
            for k in range(len(xs)): tot[k] += float(p.stdout.readline().split()[0])
        return list(tot / self.n)

train = Loss(a.train, a.procs)
test = Loss(a.test, a.procs)

def reg(x):
    r = (x - x0)[free] / S[free]
    return a.lam * float(np.sum(r ** 2))

x = x0.copy()
base_tr, = train([x]); base_te, = test([x])
print(f'start: train {base_tr:.6f} held out {base_te:.6f} ({train.n} / {test.n} positions)', flush=True)
idx = np.where(free)[0]
t0 = time.time()
for it in range(a.iters):
    xs = []
    for i in idx:
        xp = x.copy(); xp[i] += H[i]; xm = x.copy(); xm[i] -= H[i]
        xs += [xp, xm]
    ls = train(xs)
    g = np.zeros(N)
    for j, i in enumerate(idx):
        g[i] = (ls[2 * j] - ls[2 * j + 1]) / (2 * H[i]) + 2 * a.lam * (x[i] - x0[i]) / S[i] ** 2
    d = -(S ** 2) * g
    d[~free] = 0
    d /= np.max(np.abs(d[free]) / S[free])   # the largest move one unit of its scale
    # line search: the step that lowers the regularised training loss most
    cur = train([x])[0] + reg(x)
    steps = [0.5 ** k for k in range(-1, 9)]
    cand = [x + t * d for t in steps]
    vals = [l + reg(c) for l, c in zip(train(cand), cand)]
    b = int(np.argmin(vals))
    if vals[b] >= cur:
        print(f'iter {it}: no step lowers the loss; stopping', flush=True)
        break
    x = cand[b]
    te, = test([x])
    print(f'iter {it}: train {vals[b]:.6f} (step {steps[b]:g}) held out {te:.6f} ({te - base_te:+.6f}) {time.time() - t0:.0f}s', flush=True)

with open(a.out, 'w') as f:
    f.write(' '.join(f'{v:.3f}' for v in x[:58]) + ' ' + ' '.join(map(str, order_values(x[:58]))))
    if a.ext: f.write(' ' + ' '.join(f'{v:.4f}' for v in x[58:]))
    f.write('\n')
from evalnums import NAMES
names = NAMES + ['x force', 'x queen', 'x shield', 'x pass mg', 'x pass eg', 'x threat']
for i in idx:
    if abs(x[i] - x0[i]) > 1e-9: print(f'   {names[i]:>12}: {x0[i]:8.2f} -> {x[i]:8.2f}')
