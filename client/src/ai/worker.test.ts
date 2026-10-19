import { expect, it, vi } from 'vitest';

// A search that throws is answered with its error, stack and all, so the
// page's log says where it failed (computer.ts makes it the Error it rejects with)

vi.mock('./choose', () => ({
  chooseMove: () => {
    throw new Error('no move');
  },
  assessPosition: () => 0,
  analysePosition: () => null,
}));

it('answers a failed search with its stack', async () => {
  const post = vi.spyOn(self, 'postMessage').mockImplementation(() => {});
  await import('./worker');
  self.onmessage!(
    new MessageEvent('message', { data: { id: 7, records: [], difficulty: 'easy' } }),
  );
  const reply = post.mock.calls[0][0] as { id: number; error: string };
  expect(reply.id).toBe(7);
  expect(reply.error).toMatch(/^Error: no move\n\s+at /);
  post.mockRestore();
});
