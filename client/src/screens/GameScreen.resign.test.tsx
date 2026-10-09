import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocketMessage } from '../types/messages';
import { fakeSocket, gameScreenAt } from './testSupport';

// As in GameScreen.endModal.test.tsx: no WebGL in jsdom, so the three.js layer is stubbed.
vi.mock('@react-three/fiber', () => ({
  Canvas: () => <div data-testid="r3f-canvas" />,
}));
vi.mock('../three/CameraControls', () => ({ CameraControls: () => null }));
vi.mock('../three/FitCameraToBoard', () => ({ FitCameraToBoard: () => null }));
vi.mock('../three/scene/stage', () => ({ Stage: () => null }));
vi.mock('../three/scene/backdropCache', () => ({
  BackdropCache: ({ children }: { children?: unknown }) => children ?? null,
}));
vi.mock('../three/scene/warm', () => ({ WarmPrograms: () => null }));
vi.mock('../three/intro/IntroDirector', () => ({
  INTRO_SCENE_VAR: '--intro-scene',
  INTRO_HUD_VAR: '--intro-hud',
  IntroDirector: () => null,
}));
vi.mock('../three/Board', () => ({ default: () => null }));

const started = (color: 'white' | 'black' = 'white'): WebSocketMessage[] => [
  { type: 'game_state', color, started: true, moves: [{ by: 'white', from: 'Bc2', to: 'Cc2' }] },
];

/** The game page over a log, with what it sends recorded. */
const play = (messages: WebSocketMessage[]) => {
  const sent: WebSocketMessage[] = [];
  const socket = (log: WebSocketMessage[]) =>
    fakeSocket(log, (m) => {
      // (not the page's own asks for its seat)
      if (!['look_game', 'rejoin_game'].includes(m.type)) sent.push(m);
      return true;
    });
  const view = render(gameScreenAt(socket(messages)));
  return { sent, rerender: (log: WebSocketMessage[]) => view.rerender(gameScreenAt(socket(log))) };
};

const flag = () => screen.getByRole('button', { name: 'Resign or offer a draw' });

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
});
afterEach(() => vi.useRealTimers());

describe('resigning', () => {
  it('asks once more, and a doubled click or Cancel resigns nothing', () => {
    const { sent } = play(started());
    act(() => flag().click());
    expect(flag()).toHaveAttribute('aria-expanded', 'true');
    act(() => screen.getByRole('button', { name: 'Resign' }).click());
    expect(screen.getByText('Resign?')).toBeInTheDocument();
    // The safe answer has the focus
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    // A click hard on the heels of the first is the same click, doubled
    act(() => screen.getByRole('button', { name: 'Resign' }).click());
    expect(sent).toEqual([]);
    act(() => screen.getByRole('button', { name: 'Cancel' }).click());
    expect(screen.queryByText('Resign?')).not.toBeInTheDocument();
    expect(flag()).toHaveAttribute('aria-expanded', 'false');
    expect(flag()).toHaveFocus();
    expect(sent).toEqual([]);
  });

  it('sends the resignation once confirmed', () => {
    const { sent } = play(started());
    act(() => flag().click());
    act(() => screen.getByRole('button', { name: 'Resign' }).click());
    act(() => vi.advanceTimersByTime(500));
    act(() => screen.getByRole('button', { name: 'Resign' }).click());
    expect(sent).toEqual([{ type: 'resign' }]);
    expect(screen.queryByRole('group', { name: 'Game' })).not.toBeInTheDocument();
  });

  it('puts the menu away on Escape', () => {
    play(started());
    act(() => flag().click());
    act(() => {
      fireEvent.keyDown(screen.getByRole('button', { name: 'Offer draw' }), { key: 'Escape' });
    });
    expect(screen.queryByRole('group', { name: 'Game' })).not.toBeInTheDocument();
  });

  it('shows the result to both sides, and the controls go', () => {
    const ended: WebSocketMessage = { type: 'game_ended', result: 'resignation', winner: 'white' };
    const { rerender } = play(started());
    rerender([...started(), ended]);
    const pill = screen.getByTestId('turn-indicator');
    expect(pill).toHaveTextContent('Black resigned · you win');
    expect(pill).toHaveAttribute('data-result', 'resignation');
    expect(pill).toHaveAttribute('data-winner', 'white');
    expect(screen.queryByTestId('game-actions')).not.toBeInTheDocument();
    expect(screen.getByTestId('move-announcer')).toHaveTextContent('Black resigned. You win.');
    // The card follows a moment later
    act(() => vi.advanceTimersByTime(700));
    expect(screen.getByRole('dialog', { name: 'You win' })).toHaveAccessibleDescription(
      'Black resigned',
    );
  });

  it('tells the side that resigned, and comes back that way on a rejoin', () => {
    play([
      {
        ...started('black')[0],
        ending: { result: 'resignation', winner: 'white' },
      } as WebSocketMessage,
    ]);
    expect(screen.getByTestId('turn-indicator')).toHaveTextContent('Black resigned · you lose');
    expect(screen.getByRole('dialog', { name: 'You lose' })).toBeInTheDocument();
  });
});

describe('draw offers', () => {
  it('offers a draw, then waits on it', () => {
    const { sent, rerender } = play(started());
    act(() => flag().click());
    act(() => screen.getByRole('button', { name: 'Offer draw' }).click());
    expect(sent).toEqual([{ type: 'offer_draw' }]);
    rerender([...started(), { type: 'draw_offered', by: 'white', ply: 1 }]);
    expect(screen.getByTestId('draw-pending')).toHaveTextContent('Draw offered');
    expect(screen.getByTestId('draw-announcer')).toHaveTextContent('Draw offered.');
    act(() => flag().click());
    expect(screen.getByRole('button', { name: 'Draw offered' })).toBeDisabled();
    // Declined: said, and no other offer until a move
    rerender([
      ...started(),
      { type: 'draw_offered', by: 'white', ply: 1 },
      { type: 'draw_declined', by: 'black', ply: 1 },
    ]);
    expect(screen.queryByTestId('draw-pending')).not.toBeInTheDocument();
    expect(screen.getByTestId('draw-declined')).toHaveTextContent('Draw declined');
    expect(screen.getByRole('button', { name: 'Offer draw' })).toBeDisabled();
  });

  it('puts the opponent’s offer to the player, to accept or decline', () => {
    const offered: WebSocketMessage[] = [
      ...started('black'),
      { type: 'draw_offered', by: 'white', ply: 1 },
    ];
    const { sent, rerender } = play(offered);
    const prompt = screen.getByTestId('draw-offer');
    expect(prompt).toHaveTextContent('Draw offered');
    expect(screen.getByTestId('draw-announcer')).toHaveTextContent('Your opponent offers a draw.');
    // Nothing takes the focus on its own
    expect(document.body).toHaveFocus();
    act(() => within(prompt).getByRole('button', { name: 'Decline' }).click());
    act(() => within(prompt).getByRole('button', { name: 'Accept' }).click());
    expect(sent).toEqual([{ type: 'decline_draw' }, { type: 'accept_draw' }]);
    // A move cancels it
    rerender([...offered, { type: 'move_made', by: 'black', from: 'Dc4', to: 'Cc4' }]);
    expect(screen.queryByTestId('draw-offer')).not.toBeInTheDocument();
  });

  it('ends the game drawn by agreement', () => {
    play([
      ...started(),
      { type: 'draw_offered', by: 'white', ply: 1 },
      { type: 'game_ended', result: 'agreement' },
    ]);
    const pill = screen.getByTestId('turn-indicator');
    expect(pill).toHaveTextContent('Draw agreed');
    expect(pill).toHaveAttribute('data-result', 'agreement');
    expect(pill).not.toHaveAttribute('data-winner');
    act(() => vi.advanceTimersByTime(700));
    expect(screen.getByRole('dialog', { name: 'Draw' })).toHaveAccessibleDescription(
      'by agreement',
    );
  });

  it('takes nothing while the connection is down', () => {
    render(gameScreenAt(fakeSocket(started(), () => true, { status: 'reconnecting' })));
    expect(flag()).toBeDisabled();
  });
});
