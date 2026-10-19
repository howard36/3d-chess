import { expect, it, vi } from 'vitest';

// A search that throws is answered with its error, stack and all, so the
// page's log says what failed and where (computer.ts makes it the Error it
// rejects with), whichever engine's stack it has

const thrown = vi.hoisted(() => ({ stack: null as string | null, value: null as string | null }));

vi.mock('./choose', () => ({
  chooseMove: () => {
    if (thrown.value !== null) throw thrown.value;
    const e = new Error('no move');
    if (thrown.stack !== null) e.stack = thrown.stack;
    throw e;
  },
  assessPosition: () => 12,
  analysePosition: () => 'analysis',
}));

const ask = async (request: object = {}) => {
  const post = vi.spyOn(self, 'postMessage').mockImplementation(() => {});
  await import('./worker');
  self.onmessage!(
    new MessageEvent('message', {
      data: { id: 7, records: [], difficulty: 'easy', ...request },
    }),
  );
  const reply = post.mock.calls[0][0] as { id: number; error: string };
  post.mockRestore();
  return reply;
};
const fail = () => ask();

it('answers each kind of request', async () => {
  expect(await ask({ assess: true })).toEqual({ id: 7, score: 12 });
  expect(await ask({ analyse: true })).toEqual({ id: 7, analysis: 'analysis' });
});

it('answers a throw that is not an Error with what was thrown', async () => {
  thrown.value = 'out of time';
  const reply = await fail();
  thrown.value = null;
  expect(reply.error).toBe('out of time');
});

it('answers a failed search with its stack', async () => {
  const reply = await fail();
  expect(reply.id).toBe(7);
  expect(reply.error).toMatch(/^Error: no move\n\s+at /);
});

it('keeps the message where the stack has only the frames (Firefox, Safari)', async () => {
  thrown.stack = 'chooseMove@worker.js:1:2\n';
  const reply = await fail();
  thrown.stack = null;
  expect(reply.error).toBe('Error: no move\nchooseMove@worker.js:1:2');
});
