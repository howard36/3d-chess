"""Every player on one Elo scale, fitted to all the matches in results.txt.

Bradley-Terry on the games' scores (a draw counts half), the anchor at 0,
by Newton's method; standard errors from the curvature, scaled by how much
the scores varied about the fit (draws make a game's score vary less than a
win or a loss would). Prints each pairing's score against the fit's, then the
scale. usage: python3 fit.py [anchor]   (default medium)
"""

import math
import os
import re
import sys

import numpy as np

here = os.path.dirname(os.path.abspath(__file__))
anchor = sys.argv[1] if len(sys.argv) > 1 else 'medium'
line = re.compile(r'^\w+: (\S+) vs (\S+): .* \+(\d+) =(\d+) -(\d+) ')

# (A, B) -> [wins, draws, losses] for A
pairs: dict[tuple[str, str], list[int]] = {}
with open(os.path.join(here, 'results.txt')) as f:
    lines = f.readlines()
for text in lines:
    m = line.match(text)
    if not m:
        continue
    a, b = m[1], m[2]
    counts = pairs.setdefault((a, b), [0, 0, 0])
    for i in range(3):
        counts[i] += int(m[3 + i])

players = sorted({p for pair in pairs for p in pair})
if anchor not in players:
    sys.exit(f'no player {anchor}')
idx = {p: i for i, p in enumerate(players)}
keys = list(pairs)
A = np.array([idx[a] for a, _ in keys])
B = np.array([idx[b] for _, b in keys])
W, D, L = (np.array([pairs[k][i] for k in keys], dtype=float) for i in range(3))
N = W + D + L
S = W + D / 2
K = math.log(10) / 400

free = [i for i in range(len(players)) if players[i] != anchor]
R = np.zeros(len(players))
for _ in range(100):
    p = 1 / (1 + np.exp(-K * (R[A] - R[B])))
    g = np.zeros(len(players))
    np.add.at(g, A, K * (S - N * p))
    np.add.at(g, B, -K * (S - N * p))
    w = K * K * N * p * (1 - p)
    H = np.zeros((len(players), len(players)))
    np.add.at(H, (A, A), -w)
    np.add.at(H, (B, B), -w)
    np.add.at(H, (A, B), w)
    np.add.at(H, (B, A), w)
    Hf = H[np.ix_(free, free)]
    step = np.clip(np.linalg.solve(Hf, -g[free]), -200, 200)
    R[free] += step
    if np.abs(step).max() < 1e-6:
        break

p = 1 / (1 + np.exp(-K * (R[A] - R[B])))
spread = (W * (1 - p) ** 2 + D * (0.5 - p) ** 2 + L * p**2).sum() / (N * p * (1 - p)).sum()
se = np.zeros(len(players))
se[free] = np.sqrt(np.diag(np.linalg.inv(-Hf)) * spread)


def elo(q: float) -> str:
    return f'{-400 * math.log10(1 / q - 1):+5.0f}' if 0 < q < 1 else ('  +∞' if q >= 1 else '  −∞')


print(f'{int(N.sum())} games, {len(keys)} pairings; the scores vary {spread:.2f}× as a win or loss would')
print()
print(f'{"":>18}    {"":<18}  games   score          Elo    fit')
for k in sorted(range(len(keys)), key=lambda k: R[A[k]] + R[B[k]]):
    a, b = keys[k]
    q = S[k] / N[k]
    e = math.sqrt((W[k] * (1 - q) ** 2 + D[k] * (0.5 - q) ** 2 + L[k] * q**2) / (N[k] - 1) / N[k])
    print(
        f'{a:>18} vs {b:<18} {int(N[k]):5d}  {100 * q:5.1f}% ± {100 * e:3.1f}%  {elo(q)}  '
        f'{R[A[k]] - R[B[k]]:+5.0f} ({100 * p[k]:4.1f}%)'
    )
print()
for i in sorted(range(len(players)), key=lambda i: R[i]):
    print(f'{players[i]:>18} {R[i]:+6.0f} ± {se[i]:2.0f}')
