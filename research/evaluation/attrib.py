"""Split each piece's removal value (engine removal: the evaluation's drop when that piece alone is
taken off, phases weighted equally, in the full evaluation's pawns) by the numbers it comes from.
The evaluation is linear in each group of numbers once the lead term (from the ordering values)
and the danger blend's weights are held, so each group's share is exact up to rounding.

usage: attrib.py numbers.txt positions.txt   (lines "board side")"""
import sys, subprocess
import numpy as np

T = ['P', 'N', 'B', 'R', 'U', 'Q']
OWN = {'P': list(range(0, 20)), 'N': [20, 21, 22, 23, 24, 47, 52], 'B': [25, 26, 27, 28, 29, 48, 53, 57],
       'U': [30, 31, 32, 33, 34, 50, 55], 'R': [35, 36, 37, 38, 49, 54], 'Q': [39, 40, 41, 42, 51, 56]}
CONST = {'N': [20, 23], 'B': [25, 28], 'U': [30, 33], 'R': [35, 37], 'Q': [39, 41]}
KING = [43, 44, 45, 46]
XSHIELD, XTHREAT = 66, 69

def run(nums, tag):
    path = f'attrib_{tag}.txt'
    open(path, 'w').write(' '.join(f'{v:.4f}' for v in nums[:58]) + ' ' + ' '.join(str(int(v)) for v in nums[58:64])
                          + ' ' + ' '.join(f'{v:.4f}' for v in nums[64:]) + '\n')
    out = subprocess.run(['./engine', 'removal', '@' + path], stdin=open(POSITIONS),
                         capture_output=True, text=True, env={'RAW': '1'}).stdout
    return np.array([[float(v) for v in l.split()[2:]] for l in out.strip().split('\n')])  # 3 phases x 6 types

def keep(full, idx):
    x = full.copy()
    x[:58] = 0
    x[XSHIELD] = x[XTHREAT] = 0
    for i in idx: x[i] = full[i]
    return x

name, POSITIONS = sys.argv[1], sys.argv[2]
full = np.array([float(v) for v in open(name).read().split()])
if len(full) < 70: full = np.concatenate([full, np.zeros(70 - len(full))])
F = run(full, 'full')
pawn = F[:, 0]
val = lambda R: (R / pawn[:, None]).mean(0)   # phases equal, in the full evaluation's pawns
lead = run(keep(full, []), 'lead')
rows = {}
rows['lead term'] = val(lead)
for t in ['P', 'N', 'B', 'R', 'U', 'Q']:
    rows[f'{t} numbers'] = val(run(keep(full, OWN[t]), t) - lead)
rows['K tables'] = val(run(keep(full, KING), 'K') - lead)
rows['shield'] = val(run(keep(full, [XSHIELD]), 'sh') - lead)
rows['threat'] = val(run(keep(full, [XTHREAT]), 'th') - lead)
const = {t: val(run(keep(full, CONST[t]), t + 'c') - lead) for t in CONST}
total = val(F)
print(f'{name}: removal value, split by the numbers it comes from (pawns)')
print(f'{"":12s}' + ''.join(f'{t:>7s}' for t in T))
print(f'{"total":12s}' + ''.join(f'{v:7.2f}' for v in total))
for k, r in rows.items(): print(f'{k:12s}' + ''.join(f'{v:7.2f}' for v in r))
s = sum(rows.values())
print(f'{"(sum)":12s}' + ''.join(f'{v:7.2f}' for v in s))
print('own numbers / total, own constants / total:')
for i, t in enumerate(T[1:], 1):
    own = rows[f'{t} numbers'][i]
    print(f'   {t}: own {own:.2f} ({100 * own / total[i]:.0f}%), constants {const[t][i]:.2f} '
          f'({100 * const[t][i] / total[i]:.0f}%), everything else {total[i] - own:+.2f}')
