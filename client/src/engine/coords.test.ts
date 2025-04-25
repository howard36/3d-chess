import { toZXY, fromZXY, Coord } from './coords';

describe('coords', () => {
  const cases: { str: string; coord: Coord }[] = [
    { str: 'Aa1', coord: { x: 0, y: 0, z: 0 } },
    { str: 'Ee5', coord: { x: 4, y: 4, z: 4 } },
    { str: 'Cc3', coord: { x: 2, y: 2, z: 2 } },
    { str: 'Ba2', coord: { x: 0, y: 1, z: 1 } },
    { str: 'Db4', coord: { x: 1, y: 3, z: 3 } },
  ];

  it('converts Coord to ZXY and back (round-trip)', () => {
    for (const { str, coord } of cases) {
      expect(toZXY(coord)).toBe(str);
      expect(fromZXY(str)).toEqual(coord);
    }
  });

  it('throws on invalid Coord (toZXY)', () => {
    expect(() => toZXY({ x: -1, y: 0, z: 0 })).toThrow();
    expect(() => toZXY({ x: 0, y: 5, z: 0 })).toThrow();
    expect(() => toZXY({ x: 0, y: 0, z: 5 })).toThrow();
  });

  it('throws on invalid ZXY string (fromZXY)', () => {
    expect(() => fromZXY('')).toThrow();
    expect(() => fromZXY('Zz9')).toThrow();
    expect(() => fromZXY('Aa0')).toThrow();
    expect(() => fromZXY('Aaa')).toThrow();
    expect(() => fromZXY('A1a')).toThrow();
    expect(() => fromZXY('Aa')).toThrow();
    expect(() => fromZXY('Aa11')).toThrow();
  });

  it('throws if ZXY string has valid format but invalid chars (fromZXY)', () => {
    // These pass the regex but have at least one invalid char for LEVELS, FILES, or RANKS
    expect(() => fromZXY('Fa1')).toThrow(); // F not in LEVELS
    expect(() => fromZXY('Af1')).toThrow(); // f not in FILES
    expect(() => fromZXY('Aa6')).toThrow(); // 6 not in RANKS
  });
});
