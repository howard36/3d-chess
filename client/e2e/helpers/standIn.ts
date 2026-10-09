import type { Page, WebSocketRoute } from '@playwright/test';

/** The wire records of `moves` (`'Ab2-De5'`), White first. */
const records = (moves: string[]) =>
  moves.map((m, i) => {
    const [from, to] = m.split('-');
    return { by: i % 2 === 0 ? 'white' : 'black', from, to };
  });

/**
 * Opens game `gameId` on `page`, seated as `seat`, against a stand-in for the
 * server: the page's socket is routed here, and on joining it is sent a
 * snapshot of the game at `moves` and its opponent online. The returned
 * handles change what the next snapshot holds (`setMoves`, taken by a
 * reload) and whether the opponent is online (`presence`, pushed at once).
 * Resolves once the page has been navigated to the game.
 */
export async function openStandInGame(
  page: Page,
  seat: 'white' | 'black',
  gameId: string,
  moves: string[] = [],
) {
  const opponent = seat === 'white' ? 'black' : 'white';
  let socket: WebSocketRoute | null = null;
  let record = moves;
  await page.routeWebSocket(/\/ws$/, (ws) => {
    socket = ws;
    ws.onMessage((raw) => {
      if (JSON.parse(String(raw)).type !== 'rejoin_game') return;
      ws.send(
        JSON.stringify({ type: 'game_state', color: seat, started: true, moves: records(record) }),
      );
      ws.send(JSON.stringify({ type: 'presence', color: opponent, online: true }));
    });
  });
  await page.addInitScript(
    ([id, s]) => localStorage.setItem(`3dchess:role:${id}`, s),
    [gameId, seat],
  );
  await page.goto(`/game/${gameId}`);
  return {
    setMoves: (next: string[]) => {
      record = next;
    },
    presence: (online: boolean) =>
      socket!.send(JSON.stringify({ type: 'presence', color: opponent, online })),
    /** The opponent offers a draw, at once, in the position served. */
    offerDraw: () =>
      socket!.send(JSON.stringify({ type: 'draw_offered', by: opponent, ply: record.length })),
  };
}
