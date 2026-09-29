// This tab's identity towards the server. The server remembers which client
// claimed each seat, so a tab can re-send a join whose answer was lost, and an
// automatic rejoin can tell its own stale connection from another tab's live
// one (rejoin_game's `takeover`). It is per tab rather than per browser:
// sessionStorage survives a reload of the tab but is not shared with other
// tabs, and two tabs of one browser must count as two clients for the second
// of those. (A duplicated tab copies sessionStorage and so shares its id;
// that only costs it the "don't take the seat back unasked" protection.)

const KEY = '3dchess:clientId';

const randomId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

let cached: string | null = null;

export function getClientId(): string {
  if (cached) return cached;
  try {
    cached = sessionStorage.getItem(KEY);
    if (!cached) {
      cached = randomId();
      sessionStorage.setItem(KEY, cached);
    }
  } catch {
    // Storage disabled: an id for this page load still covers a reconnect
    cached ??= randomId();
  }
  return cached;
}
