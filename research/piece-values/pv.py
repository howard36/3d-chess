"""Orchestration for piece-value experiments with the C engine."""
import os, subprocess, sys, threading, random, time, math

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.join(HERE, os.environ.get('PV_ENGINE', 'engine'))

TYPES = 'PNBRUQ'
CUR = {'P': 100, 'N': 320, 'B': 295, 'R': 245, 'U': 140, 'Q': 980}


def cell(x, y, z):
    return z * 25 + x * 5 + y


def start_board():
    b = ['.'] * 125
    first = 'RNKNR'
    second = 'BUQBU'
    for x in range(5):
        def place(y, z, t):
            b[cell(x, y, z)] = t
            b[cell(4 - x, 4 - y, 4 - z)] = t.lower()
        place(0, 0, first[x])
        place(1, 0, second[x])
        place(0, 1, 'P')
        place(1, 1, 'P')
    return ''.join(b)


START = start_board()


def flip(board):
    """Colours swapped: the board turned through the centre, cases exchanged."""
    return ''.join(ch.swapcase() for ch in reversed(board))


def remove(board, white_types='', black_types='', rng=random):
    """Removes one piece of each listed type (a random instance) per side."""
    b = list(board)
    for side, types in ((0, white_types), (1, black_types)):
        for t in types:
            want = t if side == 0 else t.lower()
            cells = [c for c in range(125) if b[c] == want]
            if not cells:
                raise ValueError(f'no {want} to remove')
            b[rng.choice(cells)] = '.'
    return ''.join(b)


def vals(d):
    return ','.join(str(int(round(d[t]))) for t in TYPES)


def run_jobs(jobs, workers=4, resign=1200, max_plies=1000, out_path=None, progress=True):
    """jobs: list of dicts. Returns (results, records) keyed by id."""
    lines = []
    for j in jobs:
        lines.append(' '.join(str(x) for x in (
            j['id'], j['board'], j.get('side', 0), j.get('rand_plies', 8), j.get('rand_margin', 40),
            j.get('seed', j['id']), j['nodes_w'], j['nodes_b'], j['vals_w'], j['vals_b'],
            j.get('record', 0), j.get('keep', 0), j.get('dump', 0), j.get('feat_w', 0), j.get('feat_b', 0))))
    chunks = [lines[i::workers] for i in range(workers)]
    results, records = {}, {}
    lock = threading.Lock()
    done = [0]
    t0 = time.time()
    fout = open(out_path, 'a') if out_path else None

    def work(chunk):
        if not chunk:
            return
        p = subprocess.Popen([ENGINE, 'play', str(resign), str(max_plies)], stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE, text=True, bufsize=1)
        def feed():
            for l in chunk:
                p.stdin.write(l + '\n')
            p.stdin.close()
        threading.Thread(target=feed, daemon=True).start()
        for line in p.stdout:
            parts = line.split()
            with lock:
                if fout:
                    fout.write(line)
                    fout.flush()
                if parts[0] == 'R':
                    gid = int(parts[1])
                    results[gid] = {'result': float(parts[2]), 'plies': int(parts[3]), 'reason': parts[4],
                                    'final': parts[5], 'depth_w': float(parts[6]) if len(parts) > 6 else 0, 'depth_b': float(parts[7]) if len(parts) > 7 else 0}
                    done[0] += 1
                    if progress and done[0] % max(1, len(jobs) // 20) == 0:
                        el = time.time() - t0
                        print(f'  {done[0]}/{len(jobs)} games, {el:.0f}s', file=sys.stderr, flush=True)
                elif parts[0] == 'S':
                    records[int(parts[1])] = parts[2:]
        p.wait()

    threads = [threading.Thread(target=work, args=(c,)) for c in chunks]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    if fout:
        fout.close()
    return results, records


def score_stats(scores):
    n = len(scores)
    m = sum(scores) / n
    var = sum((s - m) ** 2 for s in scores) / max(1, n - 1)
    return m, math.sqrt(var / n)
