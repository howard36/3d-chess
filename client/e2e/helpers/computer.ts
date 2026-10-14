import type { Page } from '@playwright/test';

/**
 * Watches a game against the computer for what no assertion on the board
 * can see: the app's own fallbacks, which keep the game going but say so
 * on the console (a worker that failed, a search that could not think or
 * chose a move the rules refuse, a draw it could not weigh up), errors
 * thrown on the page, and anything sent to the server, which a game
 * against the computer never touches. Call before the first navigation;
 * the returned function lists what was seen.
 */
export function watchComputerGame(page: Page): () => string[] {
  const seen: string[] = [];
  page.on('console', (m) => {
    if (/^The computer/.test(m.text())) seen.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => seen.push(`page error: ${e.message}`));
  page.on('websocket', (ws) => {
    // The game server's socket (VITE_WS_URL), not the dev server's own
    if (!new URL(ws.url()).pathname.endsWith('/ws')) return;
    ws.on('framesent', (f) => {
      if (page.url().includes('/computer')) seen.push(`sent to the server: ${String(f.payload)}`);
    });
  });
  return () => seen;
}
