"""Whether a position is quiet: the side to move not in check, and a capture-only search moving
the evaluation by at most `limit` centipawns (nothing left hanging). One engine process, reused."""
import subprocess, os
HERE = os.path.dirname(os.path.abspath(__file__))
_p = None
def is_quiet(board, side, limit=100):
    global _p
    if _p is None:
        _p = subprocess.Popen([os.path.join(HERE, 'engine'), 'quiet'], stdin=subprocess.PIPE,
                              stdout=subprocess.PIPE, text=True, bufsize=1)
    _p.stdin.write(f'{board} {side}\n'); _p.stdin.flush()
    st, q, chk = map(int, _p.stdout.readline().split())
    return not chk and abs(q - st) <= limit
