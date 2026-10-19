"""An evaluation with one piece's own numbers (its tables, mobility, king pressure, and the bishop
pair for the bishop) scaled so that its worth by removal (engine removal: the evaluation's drop
when the piece alone is taken off, in pawns, phases weighted equally) is a given value; the rest of
the evaluation unchanged, the ordering values following the bases as the game derives them.

usage: piecescale.py numbers.txt PIECE VALUE out.txt positions.txt"""
import sys, subprocess
import numpy as np
from evalnums import SLOTS, MOB, TROP, order_values

src, piece, target, out, positions = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4], sys.argv[5]
n = [float(v) for v in open(src).read().split()]
th = np.array(n[:58]); ext = n[64:70] if len(n) >= 70 else [0] * 6
own = list(SLOTS[piece]) + [MOB[piece], TROP[piece]] + ([57] if piece == 'B' else [])

def build(k):
    t = th.copy()
    t[own] *= k
    return t

def write(t, path):
    # mobility and pressure weights may come out fractional: written as the fractional weights
    frac = [t[i] for i in range(47, 57)] + [t[57]]
    with open(path, 'w') as f:
        f.write(' '.join(f'{v:.4f}' for v in t) + ' ' + ' '.join(map(str, order_values(t))) + ' ' +
                ' '.join(f'{v:.4f}' for v in ext) + ' ' + ' '.join(f'{v:.4f}' for v in frac) + '\n')

def worth(k):
    write(build(k), out)
    r = subprocess.run(['./engine', 'removal', '@' + out], stdin=open(positions), capture_output=True, text=True).stdout
    last = r.strip().split('\n')[-1].split()
    return float(last[last.index(piece) + 1])

k, w = 1.0, worth(1.0)
for _ in range(6):   # the worth is close to proportional to k
    k *= target / w
    w = worth(k)
    if abs(w - target) < 0.005: break
print(f'{out}: {piece} x{k:.4f} -> {w:.3f} (target {target})')
