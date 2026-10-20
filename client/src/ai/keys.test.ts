import { Board } from '../engine/board';
import { fromZXY } from '../engine/coords';
import { positionHash } from '../engine/draws';
import { Position, SIDE_HI, SIDE_LO } from './position';

// The hash keys are pinned to their values: a change to a seed, to the
// generator (splitmix32, engine/draws.ts) or to the order the keys are drawn
// in changes every hash, and fails here rather than passing unseen. The
// constants are the keys as they stood before ababfbb shared the generator.

const u32 = (n: number) => n >>> 0;

it("the computer's board hashes as it always has", () => {
  expect(u32(SIDE_LO)).toBe(0xaac11d09);
  expect(u32(SIDE_HI)).toBe(0xebea651b);
  const start = Position.start();
  expect(u32(start.hashLo)).toBe(0x653c896e);
  expect(u32(start.hashHi)).toBe(0x8999e2c9);
  const after = Position.fromRecords([{ from: 'Ab1', to: 'Cc1' }]);
  expect(u32(after.hashLo)).toBe(0x76bc928d);
  expect(u32(after.hashHi)).toBe(0x437b7c21);
});

it("the draws' hash is as it always has been", () => {
  const start = Board.setupStartingPosition();
  expect(positionHash(start, 'white')).toBe(4781433518188608);
  expect(positionHash(start, 'black')).toBe(5833400404608476);
  const after = start.applyMove({ from: fromZXY('Ab1'), to: fromZXY('Cc1') });
  expect(positionHash(after, 'black')).toBe(1779298485467620);
});
