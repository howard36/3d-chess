import type { Browser, BrowserContext, Page } from '@playwright/test';
import { waitForBoard } from './board';

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

/**
 * Starts a game against the computer in a context of its own, asking for
 * reduced motion: the side choice, then the level, then the board. The page
 * is watched (watchComputerGame) from before it opens.
 */
export async function startComputerGame(
  browser: Browser,
  { side = 'White', level = 'Easy' }: { side?: 'White' | 'Black'; level?: string } = {},
): Promise<{ context: BrowserContext; page: Page; seen: () => string[] }> {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  const seen = watchComputerGame(page);
  await page.goto('/computer');
  await page.getByRole('button', { name: new RegExp(`^${side}`) }).click();
  await page
    .getByRole('group', { name: 'Difficulty' })
    .getByRole('button', { name: level })
    .click();
  await page.waitForURL(/\/computer\/[a-z0-9]+$/);
  await waitForBoard(page);
  return { context, page, seen };
}
