"""The strength curve of each piece's worth: every version of the tuned evaluation with one piece
moved (curves/<P>_<value>.txt) against the tuned evaluation, scored in Elo, and a parabola through
the points (the tuned evaluation itself at 0) weighted by their errors: its peak, and each point.

usage: analyse.py dir-with-raw-files"""
import sys, os, math, glob
import numpy as np

BASE = {'N': 3.30, 'B': 2.89, 'R': 2.35, 'U': 1.41, 'Q': 8.78}   # the tuned evaluation, by removal
TAGS = {'cQ78': ('Q', 7.8), 'cQ100': ('Q', 10.0), 'cQ112': ('Q', 11.2), 'cR20': ('R', 2.0), 'cR26': ('R', 2.6),
        'cR284': ('R', 2.84), 'cU10': ('U', 1.0), 'cU12': ('U', 1.2), 'cU16': ('U', 1.6), 'cN30': ('N', 3.0),
        'cN36': ('N', 3.6), 'cB26': ('B', 2.6), 'cB32': ('B', 3.2)}
d = sys.argv[1] if len(sys.argv) > 1 else '.'
elo = lambda m: -400 * math.log10(1 / m - 1)
pts = {p: [(v, 0.0, 0.0)] for p, v in BASE.items()}
for tag, (p, v) in TAGS.items():
    f = os.path.join(d, f'{tag}.raw')
    if not os.path.exists(f): continue
    sc = []
    for line in open(f):
        q = line.split()
        if q and q[0] == 'R': sc.append(float(q[2]) if int(q[1]) % 2 == 0 else 1 - float(q[2]))
    n = len(sc); m = sum(sc) / n
    se = math.sqrt(sum((x - m) ** 2 for x in sc) / (n - 1) / n)
    e = elo(m); ee = (elo(min(m + se, 0.999)) - elo(max(m - se, 0.001))) / 2
    pts[p].append((v, e, ee))
    print(f'{p} {v:5.2f}: {100 * m:5.1f}% ± {100 * se:.1f} ({e:+5.0f} ± {ee:.0f} Elo) over {len(sc)} games')
for p, ps in pts.items():
    ps.sort()
    if len(ps) < 3: continue
    v = np.array([q[0] for q in ps]); e = np.array([q[1] for q in ps]); w = np.array([1 / max(q[2], 3) ** 2 for q in ps])
    a, b, c = np.polyfit(v, e, 2, w=np.sqrt(w))
    peak = -b / (2 * a) if a < 0 else float('nan')
    print(f'{p}: points ' + ', '.join(f'{q[0]:.2f}: {q[1]:+.0f}' for q in ps) +
          (f'; parabola peaks at {peak:.2f} ({a * peak**2 + b * peak + c:+.0f} Elo)' if a < 0 else '; no peak (parabola opens upward)'))
