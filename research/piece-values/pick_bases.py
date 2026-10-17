import json, sys, collections
src, out = sys.argv[1], sys.argv[2]
bases = []; plies = collections.Counter()
for line in open(src):
    p = line.split()
    if p[0] != 'B': continue
    gid, ply, side, score, board = int(p[1]), int(p[2]), int(p[3]), int(p[4]), p[5]
    cnt = collections.Counter(board)
    if any(cnt[t] != cnt[t.lower()] for t in 'PNBRUQ'): continue
    if abs(score) > 100 or ply < 16: continue
    nonpawn = sum(cnt[t] + cnt[t.lower()] for t in 'NBRUQ')
    bases.append(dict(board=board, side=side, key=gid * 1000 + ply, ply=ply, nonpawn=nonpawn))
    plies[ply // 20 * 20] += 1
json.dump(bases, open(out, 'w'))
print(len(bases), 'bases; by ply', sorted(plies.items()))
print('non-pawn pieces on board (both sides):', sorted(collections.Counter(b['nonpawn'] for b in bases).items()))
