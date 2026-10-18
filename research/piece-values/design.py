"""Random removal designs: imbalances imposed at random, never chosen by the engines."""
import itertools, random, math
from pv import *

PRIOR = {'P': 1.0, 'N': 3.2, 'B': 2.95, 'R': 2.45, 'U': 1.4, 'Q': 9.8}
PIECES = 'PNBRUQ'

def combos(maxsize=4):
    out = set()
    for size in range(0, maxsize + 1):
        for c in itertools.combinations_with_replacement(PIECES, size):
            if c.count('Q') > 1 or c.count('P') > 3: continue
            if any(c.count(t) > 2 for t in 'NBRU'): continue
            out.add(''.join(c))
    return sorted(out)

COMBOS = combos()

def value(c):
    return sum(PRIOR[t] for t in c)

def sample_pair(rng, sigma=1.5):
    while True:
        a = rng.choice(COMBOS); b = rng.choice(COMBOS)
        # cancel the types both lose
        la, lb = list(a), list(b)
        for t in list(la):
            if t in lb:
                la.remove(t); lb.remove(t)
        if not la and not lb: continue
        if len(la) + len(lb) > 5: continue
        d = value(la) - value(lb)
        if rng.random() < math.exp(-(d / sigma) ** 2):
            return ''.join(la), ''.join(lb)

def make_jobs(n, nodes, base_id, seed, values=None, keep=3, record=1, boards=None):
    rng = random.Random(seed)
    v = vals(values or CUR)
    jobs = []
    for i in range(n):
        wl, bl = sample_pair(rng)
        base = START if boards is None else rng.choice(boards)
        b = remove(base, wl, bl, rng)
        jobs.append(dict(id=base_id + i, board=b, nodes_w=nodes, nodes_b=nodes, vals_w=v, vals_b=v,
                         rand_plies=8 if boards is None else 2, rand_margin=40, seed=seed * 100000 + i,
                         record=record, keep=keep, wl=wl, bl=bl))
    return jobs
