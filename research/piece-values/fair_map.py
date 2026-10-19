"""Constants whose effective worth (constant + average positional credit, in units of the average
pawn's effective worth) matches target values, given the engine's positional terms unchanged.
Phases weighted as given. Prints constants in centipawns (pawn constant stays 100)."""
import sys, json, collections
import numpy as np
V = {1: 100, 2: 320, 3: 295, 4: 245, 5: 140, 6: 980}
def bonuses(decomp='pool_decomp.txt', pos='pool_pos.txt'):
    rows = [list(map(float, l.split())) for l in open(decomp)]
    boards = [l.split()[0] for l in open(pos)]
    agg = {b: collections.defaultdict(lambda: np.zeros(4)) for b in range(3)}
    for r, board in zip(rows, boards):
        n = sum(1 for ch in board if ch in 'NBRUQnbruq')
        if n == 0: continue
        b = 0 if n <= 5 else 1 if n <= 11 else 2
        k = 1
        for s in range(2):
            for t in range(1, 7):
                agg[b][t] += np.array(r[k:k + 4]); k += 4
    return {b: {t: (a[1] + a[2] + a[3]) / a[0] for t, a in agg[b].items() if a[0] > 0} for b in agg}
def fair(target, w):
    """target: {type: pawns} (single values) or {phase: {type: pawns}}; w: phase weights."""
    B = bonuses()
    out = {1: 100}
    for t in range(2, 7):
        num = den = 0
        for b, wb in w.items():
            tv = target[b][t] if isinstance(target.get(b, None), dict) else target[t]
            effP = 100 + B[b][1]
            num += wb * (tv * effP - B[b][t]); den += wb
        out[t] = round(num / den)
    return out
if __name__ == '__main__':
    tgt = {int(k): v for k, v in json.loads(sys.argv[1]).items()}
    w = {int(k): v for k, v in json.loads(sys.argv[2]).items()} if len(sys.argv) > 2 else {0: 1, 1: 1, 2: 1}
    f = fair(tgt, w)
    print('constants (P N B R U Q):', ','.join(str(f[t]) for t in range(1, 7)))
