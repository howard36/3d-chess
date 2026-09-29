import { expect, type Page } from '@playwright/test';
import { playOn, turnText } from './vh';
type G = { white: Page; black: Page };
export async function playLine(g: G, moves: string[], firstSeat: 'white' | 'black' = 'white') {
  let seat = firstSeat;
  for (const m of moves) {
    const [from, to] = m.split('-');
    await playOn(g[seat], seat, from, to);
    const next = seat === 'white' ? 'Black to move' : 'White to move';
    await expect(g.white.getByTestId('turn-indicator')).toHaveText(next);
    await expect(g.black.getByTestId('turn-indicator')).toHaveText(next);
    seat = seat === 'white' ? 'black' : 'white';
  }
}
export const PROMO_LINE = ['Ba2-Ba3', 'Ee4-Ee3', 'Ba3-Ca3', 'Ee3-Ee2', 'Ca3-Da4', 'Ee2-Ee1'];
export const MATE_LINE = ['Ad1-Cc1', 'Dc5-Bc3', 'Bc1-Ad1', 'Bc3-Ab2'];
export { turnText };
