"""Final values per strength level: one shared set fitted to every design at that level (random
removals for the ratios between pieces, targeted trades for pieces against pawns), each phase with
its own intercept and scale and an equal share of the weight, quiet starts only, pawn = 1 at the
end. Then each value against playing strength (Elo, 80k = 0), read off at the levels asked for."""
import sys, json
import numpy as np
from an_phase2 import rows, NAMES
from analysis import pooled, fmt, T

LEVELS = {  # name: (runs, Elo relative to the 80k bot)
    '20k': (['e2', 'eq', 'e3', 'e3b', 's20'], -375.0),
    '80k': (['e4a', 'e5', 'e5b', 's80', 'e6'], 0.0),
    '320k': (['s320b', 'e5x320'], None),
}

def level_fit(tags, nboot=60):
    have = []
    for t in tags:
        try:
            open(f'{t}.raw').close(); have.append(t)
        except FileNotFoundError:
            pass
    D, y, st, g = rows(have)
    groups = sorted(set(st))
    share = [1.0 / len(groups) if i in groups else 0.0 for i in range(4)]
    v, sd, k, a, boots = pooled(D, y, st, g, np.ones(len(y)), share, nboot=nboot)
    per = {}
    for s_ in groups:   # each phase alone, same model (noisier)
        m = st == s_
        one = [1.0 if i == s_ else 0.0 for i in range(4)]
        vp, sdp, _, _, _ = pooled(D[m], y[m], st[m], g[m], np.ones(m.sum()), one, nboot=20)
        per[s_] = (vp, sdp, int(m.sum()))
    return have, len(y), v, sd, per

if __name__ == '__main__':
    elo = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
    out = {}
    for name, (tags, e) in LEVELS.items():
        if name in elo: e = elo[name]
        try:
            have, n, v, sd, per = level_fit(tags)
        except Exception as ex:
            print(name, 'skipped:', ex); continue
        out[name] = (e, v, sd)
        print(f'== {name} (Elo {e}) from {have}: {n} games')
        print(f'   all phases: {fmt(v, sd)}')
        for s_, (vp, sdp, m) in per.items():
            print(f'   {NAMES[s_]:>15} ({m:4d}): {fmt(vp, sdp)}')
    pts = [(e, v, sd) for e, v, sd in out.values() if e is not None]
    if len(pts) >= 2:
        for target in (205.0, 305.0, 405.0):
            est = []
            for i, t in enumerate(T):
                if i == 0: est.append(1.0); continue
                x = np.array([p[0] for p in pts]); yv = np.array([p[1][i] for p in pts]); w = 1 / np.array([p[2][i] for p in pts]) ** 2
                A = np.vstack([np.ones_like(x), x]).T
                cov = np.linalg.inv(A.T @ (A * w[:, None])); b = cov @ A.T @ (w * yv)
                est.append((b[0] + b[1] * target, np.sqrt(np.array([1, target]) @ cov @ np.array([1, target]))))
            print(f'   straight line through the levels, at Elo {target:+.0f}: ' +
                  '  '.join(f'{t}={e_[0]:.2f}±{e_[1]:.2f}' for t, e_ in zip(T[1:], est[1:])))
