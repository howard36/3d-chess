import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPPONENT_JOINED_TITLE, TURN_ICON, YOUR_MOVE_TITLE, useTabSignal } from './useTabSignal';

const TITLE = '3D Chess — Online Multiplayer';
const ICON = '/favicon.svg';
const icon = () => document.querySelector('link[rel~="icon"]')!.getAttribute('href');

let hidden = false;
beforeEach(() => {
  hidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  document.head.innerHTML = `<link rel="icon" type="image/svg+xml" href="${ICON}" /><link rel="apple-touch-icon" href="/apple-touch-icon.png" />`;
  document.title = TITLE;
});
afterEach(() => {
  vi.restoreAllMocks();
  document.head.innerHTML = '';
});

const look = (away: boolean) =>
  act(() => {
    hidden = away;
    document.dispatchEvent(new Event('visibilitychange'));
  });

type Props = Parameters<typeof useTabSignal>[0];
const signal = (props: Props) => renderHook((p: Props) => useTabSignal(p), { initialProps: props });

describe('useTabSignal', () => {
  it('says "Your move" in the title and puts the dot on the icon, in view or not', () => {
    const { rerender } = signal({ yourMove: true, opponentJoined: false });
    expect(document.title).toBe(YOUR_MOVE_TITLE);
    expect(icon()).toBe(TURN_ICON);
    look(true);
    expect(document.title).toBe(YOUR_MOVE_TITLE);
    expect(icon()).toBe(TURN_ICON);
    // (the other icon links are left alone)
    expect(document.querySelector('link[rel="apple-touch-icon"]')!.getAttribute('href')).toBe(
      '/apple-touch-icon.png',
    );
    rerender({ yourMove: true, opponentJoined: false });
    expect(document.title).toBe(YOUR_MOVE_TITLE);
  });

  it("gives the page's own title and icon back on the opponent's move, and again on the next", () => {
    const { rerender } = signal({ yourMove: true, opponentJoined: false });
    rerender({ yourMove: false, opponentJoined: false });
    expect(document.title).toBe(TITLE);
    expect(icon()).toBe(ICON);
    rerender({ yourMove: true, opponentJoined: false });
    expect(document.title).toBe(YOUR_MOVE_TITLE);
    expect(icon()).toBe(TURN_ICON);
  });

  it('gives them back when the page goes', () => {
    const { unmount } = signal({ yourMove: true, opponentJoined: false });
    unmount();
    expect(document.title).toBe(TITLE);
    expect(icon()).toBe(ICON);
  });

  it('says nothing when there is nothing to say', () => {
    signal({ yourMove: false, opponentJoined: false });
    expect(document.title).toBe(TITLE);
    expect(icon()).toBe(ICON);
  });

  it('tells a host away from the tab that their guest is here, until they look', () => {
    hidden = true;
    const { rerender } = signal({ yourMove: false, opponentJoined: true });
    expect(document.title).toBe(OPPONENT_JOINED_TITLE);
    expect(icon()).toBe(ICON);
    look(false);
    expect(document.title).toBe(TITLE);
    rerender({ yourMove: false, opponentJoined: false });
    expect(document.title).toBe(TITLE);
  });

  it('says "Opponent joined" over "Your move" while the host is away, then the move', () => {
    hidden = true;
    const { rerender, unmount } = signal({ yourMove: true, opponentJoined: true });
    expect(document.title).toBe(OPPONENT_JOINED_TITLE);
    // The dot is the move's, whatever the title says
    expect(icon()).toBe(TURN_ICON);
    look(false);
    expect(document.title).toBe(YOUR_MOVE_TITLE);
    rerender({ yourMove: true, opponentJoined: false });
    expect(document.title).toBe(YOUR_MOVE_TITLE);
    unmount();
    expect(document.title).toBe(TITLE);
    expect(icon()).toBe(ICON);
  });

  it('keeps an arriving guest to the title of a host who is looking', () => {
    signal({ yourMove: false, opponentJoined: true });
    expect(document.title).toBe(TITLE);
  });

  it('changes only the title on a page with no icon link', () => {
    document.head.innerHTML = '';
    document.title = TITLE;
    const { unmount } = signal({ yourMove: true, opponentJoined: false });
    expect(document.title).toBe(YOUR_MOVE_TITLE);
    unmount();
    expect(document.title).toBe(TITLE);
  });
});
