"""Whether a board (125 chars, c = z*25 + x*5 + y) leaves the side not to move in check."""
import itertools
DIRS = [d for d in itertools.product((-1, 0, 1), repeat=3) if any(d)]
def xyz(c): return (c // 5) % 5, c % 5, c // 25
def at(b, x, y, z):
    if 0 <= x < 5 and 0 <= y < 5 and 0 <= z < 5: return b[z * 25 + x * 5 + y]
    return None
def attacked(b, cell, by_white):
    x, y, z = xyz(cell)
    own = str.isupper if by_white else str.islower
    for d in DIRS:
        nz = sum(1 for v in d if v)
        for n in range(1, 5):
            q = at(b, x + d[0] * n, y + d[1] * n, z + d[2] * n)
            if q is None: break
            if q == '.': continue
            if own(q):
                t = q.upper()
                if t == 'Q' or (t == 'R' and nz == 1) or (t == 'B' and nz == 2) or (t == 'U' and nz == 3) or (t == 'K' and n == 1): return True
            break
    for d in itertools.permutations((2, 1, 0)):
        for s in itertools.product((-1, 1), repeat=3):
            q = at(b, x + d[0] * s[0], y + d[1] * s[1], z + d[2] * s[2])
            if q and q != '.' and own(q) and q.upper() == 'N': return True
    # pawns: White's pawn attacks (0,+1,+1), (-1,+1,0), (+1,+1,0), (-1,0,+1), (+1,0,+1) as (dx,dy,dz)
    dirn = 1 if by_white else -1
    for dx, dy, dz in ((0, dirn, dirn), (-1, dirn, 0), (1, dirn, 0), (-1, 0, dirn), (1, 0, dirn)):
        q = at(b, x - dx, y - dy, z - dz)
        if q and q == ('P' if by_white else 'p'): return True
    return False
def illegal(board, side):
    """The side not to move is in check (its king could be taken)."""
    other_king = 'k' if side == 0 else 'K'
    if other_king not in board: return True
    return attacked(board, board.index(other_king), side == 0)
if __name__ == '__main__':
    import json, sys, collections
    jobs = json.load(open(sys.argv[1]))
    bad = [j for j in jobs if illegal(j['board'], j['side'])]
    print(len(bad), 'of', len(jobs), 'start positions illegal', collections.Counter(j.get('stratum') for j in bad))
