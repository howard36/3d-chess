"""Put an evaluation file's numbers into the game (client/src/ai/position.ts and evaluate.ts), rounded
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

pos = open(f'{ai}/position.ts').read()
for i, name in enumerate(['PAWN', 'KNIGHT', 'BISHOP', 'ROOK', 'UNICORN', 'QUEEN']):
    pos, k = re.subn(rf'VALUE\[{name}\] = -?\d+;', f'VALUE[{name}] = {vals[i]};', pos); assert k == 1
pos, k = re.subn(r'const PAWN_MG = \[[^\]]*\];', 'const PAWN_MG = [' + ', '.join(f(v) for v in t[0:9]) + '];', pos); assert k == 1
pos, k = re.subn(r'const PAWN_EG = \[[^\]]*\];', 'const PAWN_EG = [' + ', '.join(f(v) for v in t[9:18]) + '];', pos); assert k == 1
pos, k = re.subn(r'const file = x === 2 \? [-\d.]+ : x === 1 \|\| x === 3 \? [-\d.]+ : 0;',
                 f'const file = x === 2 ? {f(t[18])} : x === 1 || x === 3 ? {f(t[19])} : 0;', pos); assert k == 1
def term(c, v, var):   # " - 5.3 * centre" / " + 0.1 * centre"
    return f' {"-" if v < 0 else "+"} {f(abs(v))} * {var}'
for name, b, homevar in (('KNIGHT', 20, 'home'), ('BISHOP', 25, 'home'), ('UNICORN', 30, 'unicornHome')):
    line = (f'set({name}, {f(t[b])}{term(0, t[b + 1], "centre")}{term(0, t[b + 2], homevar)}, '
            f'{f(t[b + 3])}{term(0, t[b + 4], "centre")});')
    pos, k = re.subn(rf'set\({name}, [^;]*\);', line, pos); assert k == 1, name
for name, b in (('ROOK', 35), ('QUEEN', 39)):
    line = f'set({name}, {f(t[b])}{term(0, t[b + 1], "centre")}, {f(t[b + 2])}{term(0, t[b + 3], "centre")});'
    pos, k = re.subn(rf'set\({name}, [^;]*\);', line, pos); assert k == 1, name
line = f'set(KING, {f(t[43])} * out{term(0, t[44], "Math.abs(x - 2)")}, {f(t[45])}{term(0, t[46], "centre")});'
pos, k = re.subn(r'set\(KING, [^;]*\);', line, pos); assert k == 1
trop = [int(t[52]), int(t[53]), int(t[54]), int(t[55]), int(t[56])]   # N B R U Q
pos, k = re.subn(r'export const TROPISM_WEIGHT = \[[^\]]*\];',
                 f'export const TROPISM_WEIGHT = [0, 0, {trop[0]}, {trop[1]}, {trop[2]}, {trop[3]}, {trop[4]}, 0];', pos); assert k == 1
open(f'{ai}/position.ts', 'w').write(pos)

ev = open(f'{ai}/evaluate.ts').read()
mob = [int(t[47]), int(t[48]), int(t[49]), int(t[50]), int(t[51])]   # N B R U Q
ev, k = re.subn(r'const MOBILITY_WEIGHT = \[[^\]]*\];', f'const MOBILITY_WEIGHT = [0, 0, {mob[0]}, {mob[1]}, {mob[2]}, {mob[3]}, {mob[4]}, 0];', ev); assert k == 1
for name, v in (('BISHOP_PAIR', f(t[57])), ('DANGER_FORCE', f'{xa:g}'), ('DANGER_QUEEN', f'{xb:g}'),
                ('SHIELD', f(shield)), ('PAWN_THREAT', f(threat)), ('TEMPO', f'{tempo}')):
    ev, k = re.subn(rf'const {name} = -?[\d.]+;', f'const {name} = {v};', ev)
    assert k == 1 or name == 'TEMPO', name
    if k == 0: print('note: evaluate.ts has no TEMPO yet; add it by hand')
open(f'{ai}/evaluate.ts', 'w').write(ev)

with open(out, 'w') as fo:
    fo.write(' '.join(f'{v:.1f}' for v in t) + ' ' + ' '.join(map(str, vals)) + ' ' +
             f'{xa} {xb} {shield} 0 0 {threat}' + (f' 0 0 {tempo} 0 0 0 0 0' if tempo else '') + '\n')
print('values', vals, 'mob', mob, 'trop', trop, 'tempo', tempo)
