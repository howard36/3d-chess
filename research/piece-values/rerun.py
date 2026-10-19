"""Replays another run's exact games at a different number of positions a move (paired comparison)."""
import json, argparse, shutil, os
from pv import run_jobs
ap = argparse.ArgumentParser()
ap.add_argument('--src'); ap.add_argument('--nodes', type=int); ap.add_argument('--tag')
ap.add_argument('--limit', type=int, default=0)
a = ap.parse_args()
jobs = sorted(json.load(open(f'{a.src}.jobs.json')), key=lambda j: j['id'])
gaps = json.load(open(f'{a.src}.qgap.json')) if os.path.exists(f'{a.src}.qgap.json') else {}
# drop starts that are not quiet, keeping the pairs whole
bad_pairs = {int(k) // 2 for k, v in gaps.items() if v > 100}
jobs = [j for j in jobs if j['id'] // 2 not in bad_pairs]
if a.limit:
    jobs = jobs[:a.limit]
for j in jobs:
    j['nodes_w'] = j['nodes_b'] = a.nodes
json.dump(jobs, open(f'{a.tag}.jobs.json', 'w'))
if os.path.exists(f'{a.src}.qgap.json'):
    shutil.copy(f'{a.src}.qgap.json', f'{a.tag}.qgap.json')
res, _ = run_jobs(jobs, workers=4, out_path=f'{a.tag}.raw', progress=False)
print('done', len(res))
