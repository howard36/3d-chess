"""The candidate's score in a finished match (screen.py's <tag>.raw: game i has the candidate
White when i is even): python3 score.py <tag>..."""
import sys, math, collections
for tag in sys.argv[1:]:
    sc, why = [], collections.Counter()
    for line in open(f'{tag}.raw'):
        p = line.split()
        if p[0] != 'R': continue
        i, r = int(p[1]), float(p[2])
        sc.append(r if i % 2 == 0 else 1 - r); why[p[4]] += 1
    n = len(sc); m = sum(sc) / n
    se = math.sqrt(sum((x - m) ** 2 for x in sc) / (n - 1) / n)
    elo = -400 * math.log10(1 / m - 1) if 0 < m < 1 else float('nan')
    print(f'{tag}: {m:.3f} ± {se:.3f} ({elo:+.0f} Elo) over {n} games', dict(why), flush=True)
