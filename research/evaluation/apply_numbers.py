"""Put an evaluation file's numbers into the game as the expert's (EXPERT_NUMBERS in
client/src/ai/numbers.ts), rounded
as the game holds them (tables to tenths, the weights per move and of pressure to whole numbers, the
danger shares to hundredths, the shield and threat to tenths, the move's bonus to whole centipawns),
and write those rounded numbers as an evaluation file, for checking the port (ref.ts) against them.

Takes the 70- or 78-number form (58, six values, six extension terms, and optionally eight more: of
which the game has the move's bonus only; the others must be 0).

usage: apply_numbers.py numbers.txt client/src/ai rounded.txt"""
import re, sys
from evalnums import order_values

src, ai, out = sys.argv[1], sys.argv[2], sys.argv[3]
n = [float(v) for v in open(src).read().split()]
th = n[:58]
ext = n[64:70] if len(n) >= 70 else [0] * 6
y = n[70:78] if len(n) >= 78 else [0] * 8
assert all(abs(v) < 1e-9 for i, v in enumerate(y) if i != 2), 'only the move bonus is in the game'
assert abs(ext[3]) < 1e-9 and abs(ext[4]) < 1e-9, 'no passed pawns in the game'
t = [round(v, 1) for v in th]
for i in range(47, 58): t[i] = float(round(th[i]))
xa, xb, shield, threat = round(ext[0], 2), round(ext[1], 2), round(ext[2], 1), round(ext[5], 1)
tempo = round(y[2])
vals = order_values(t)
f = lambda v: f'{v:g}' if v == int(v) else f'{v:.1f}'

mob = [int(t[47]), int(t[48]), int(t[49]), int(t[50]), int(t[51])]   # N B R U Q
trop = [int(t[52]), int(t[53]), int(t[54]), int(t[55]), int(t[56])]   # N B R U Q
lst = lambda vs: '[' + ', '.join(f(v) for v in vs) + ']'
# The table numbers' places: knight 20-24, bishop 25-29, unicorn 30-34 (middlegame, per step
# out, at home; endgame, per step out), rook 35-38 and queen 39-42 (no home), king 43-46
p5 = lambda b: f'piece({f(t[b])}, {f(t[b + 1])}, {f(t[b + 2])}, {f(t[b + 3])}, {f(t[b + 4])})'
p4 = lambda b: f'piece({f(t[b])}, {f(t[b + 1])}, 0, {f(t[b + 2])}, {f(t[b + 3])})'
block = f"""export const EXPERT_NUMBERS: EvalNumbers = {{
  value: {lst(vals)},
  pawnMg: {lst(t[0:9])},
  pawnEg: {lst(t[9:18])},
  pawnFile: [{f(t[18])}, {f(t[19])}],
  knight: {p5(20)},
  bishop: {p5(25)},
  unicorn: {p5(30)},
  rook: {p4(35)},
  queen: {p4(39)},
  king: {{ out: {f(t[43])}, file: {f(t[44])}, eg: {f(t[45])}, egCentre: {f(t[46])} }},
  mobility: {lst(mob)},
  tropism: {lst(trop)},
  bishopPair: {f(t[57])},
  dangerForce: {xa:g},
  dangerQueen: {xb:g},
  shield: {f(shield)},
  pawnThreat: {f(threat)},
  tempo: {tempo},
}};"""
num = open(f'{ai}/numbers.ts').read()
num, k = re.subn(r'export const EXPERT_NUMBERS: EvalNumbers = \{.*?\n\};', lambda m: block, num, flags=re.S); assert k == 1
open(f'{ai}/numbers.ts', 'w').write(num)

with open(out, 'w') as fo:
    fo.write(' '.join(f'{v:.1f}' for v in t) + ' ' + ' '.join(map(str, vals)) + ' ' +
             f'{xa} {xb} {shield} 0 0 {threat}' + (f' 0 0 {tempo} 0 0 0 0 0' if tempo else '') + '\n')
print('values', vals, 'mob', mob, 'trop', trop, 'tempo', tempo)
