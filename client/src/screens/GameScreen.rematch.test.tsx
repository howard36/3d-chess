import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameSocket } from '../hooks/useGameSocket';
import type { WebSocketMessage } from '../types/messages';
import { getStoredRole } from '../lib/playerRole';
import GameScreen from './GameScreen';
import { fakeSocket } from './testSupport';

// As in App.test.tsx: no WebGL in jsdom, so the three.js layer is stubbed.
vi.mock('@react-three/fiber', () => ({
  Canvas: () => <div data-testid="r3f-canvas" />,
}));
vi.mock('../three/CameraControls', () => ({ CameraControls: () => null }));
vi.mock('../three/FitCameraToBoard', () => ({ FitCameraToBoard: () => null }));
vi.mock('../three/scene/stage', () => ({ Stage: () => null }));
vi.mock('../three/scene/backdropCache', () => ({
  BackdropCache: ({ children }: { children?: unknown }) => children ?? null,
}));
vi.mock('../three/framePacer', () => ({ PaceOnGpu: () => null }));
vi.mock('../three/scene/warm', () => ({
  WarmPrograms: () => null,
}));
vi.mock('../three/intro/IntroDirector', () => ({
  IntroDirector: () => null,
}));
vi.mock('../three/Board', () => ({ default: () => null }));

/** Where the rematch led: the new game's page, and the state it was opened with. */
function Arrived() {
  const { gameId } = useParams();
  const { state } = useLocation();
  return (
    <p data-testid="arrived" data-state={JSON.stringify(state)}>
      {gameId}
    </p>
  );
}

const pageFor = (socket: GameSocket) => (
  <MemoryRouter initialEntries={['/game/OLD123']}>
    <Routes>
      <Route path="/game/OLD123" element={<GameScreen gameSocket={socket} />} />
      <Route path="/game/:gameId" element={<Arrived />} />
      <Route path="/" element={<p data-testid="home" />} />
    </Routes>
  </MemoryRouter>
);

// White resigned: the game is over, its card up at once (reopened)
const over = (rematch?: Extract<WebSocketMessage, { type: 'game_state' }>['rematch']) =>
  ({
    type: 'game_state',
    color: 'white',
    started: true,
    moves: [{ by: 'white', from: 'Aa2', to: 'Aa3' }],
    ending: { result: 'resignation', winner: 'black' },
    ...(rematch ? { rematch } : {}),
  }) satisfies WebSocketMessage;

const go = () => screen.getByTestId('rematch-go');

describe('GameScreen: a rematch against a friend', () => {
  beforeEach(() => localStorage.setItem('3dchess:role:OLD123', 'white'));
  afterEach(() => localStorage.clear());

  it('offers one from the result card, with the way home under it', () => {
    const send = vi.fn(() => true);
    render(pageFor(fakeSocket([over()], send)));
    expect(screen.getByRole('dialog', { name: 'You lose' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Play again' })).not.toBeInTheDocument();
    expect(go()).toHaveAccessibleName('Rematch');
    expect(go()).toHaveFocus();
    act(() => go().click());
    expect(send).toHaveBeenCalledWith({ type: 'offer_rematch' });
    act(() => screen.getByRole('button', { name: 'Home' }).click());
    expect(screen.getByTestId('home')).toBeInTheDocument();
  });

  it('waits on its own offer, the button kept and the focus on it', () => {
    const send = vi.fn(() => true);
    const { rerender } = render(pageFor(fakeSocket([over()], send)));
    const button = go();
    rerender(pageFor(fakeSocket([over(), { type: 'rematch_offered', by: 'white' }], send)));
    expect(go()).toBe(button);
    expect(go()).toHaveFocus();
    expect(go()).toHaveAccessibleName('Rematch offered');
    expect(go()).toHaveAttribute('aria-disabled', 'true');
    act(() => go().click());
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByTestId('rematch-announcer')).toHaveTextContent('Rematch offered.');
  });

  it("answers the opponent's offer", () => {
    const send = vi.fn(() => true);
    render(pageFor(fakeSocket([over({ by: 'black' })], send)));
    expect(go()).toHaveAccessibleName('Accept rematch');
    act(() => go().click());
    expect(send).toHaveBeenLastCalledWith({ type: 'accept_rematch' });
    act(() => screen.getByRole('button', { name: 'Decline' }).click());
    expect(send).toHaveBeenLastCalledWith({ type: 'decline_rematch' });
    expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument();
  });

  it('turns to the way home once its own offer is declined', () => {
    render(pageFor(fakeSocket([over({ by: 'white', declined: true })])));
    expect(screen.getByTestId('rematch-declined')).toHaveTextContent('Rematch declined');
    expect(go()).toHaveAccessibleName('Home');
    expect(screen.getByTestId('rematch-announcer')).toHaveTextContent('Rematch declined.');
    expect(screen.getAllByRole('button', { name: 'Home' })).toHaveLength(1);
    act(() => go().click());
    expect(screen.getByTestId('home')).toBeInTheDocument();
  });

  it("offers one again after declining the opponent's", () => {
    render(pageFor(fakeSocket([over({ by: 'black', declined: true })])));
    expect(go()).toHaveAccessibleName('Rematch');
  });

  it('sends nothing while the connection is down', () => {
    const send = vi.fn(() => true);
    render(pageFor(fakeSocket([over({ by: 'black' })], send, { status: 'reconnecting' })));
    expect(go()).toHaveAttribute('aria-disabled', 'true');
    act(() => go().click());
    act(() => screen.getByRole('button', { name: 'Decline' }).click());
    expect(send).not.toHaveBeenCalled();
  });

  it('opens the rematch at once when it begins, in the other colour', () => {
    const { rerender } = render(pageFor(fakeSocket([over({ by: 'white' })])));
    rerender(
      pageFor(fakeSocket([over({ by: 'white' }), { type: 'rematch_started', gameId: 'NEW456' }])),
    );
    expect(screen.getByTestId('arrived')).toHaveTextContent('NEW456');
    expect(screen.getByTestId('arrived')).toHaveAttribute('data-state', '{"rematch":true}');
    expect(getStoredRole('NEW456')).toBe('black');
  });

  it('waits for the player to join a rematch begun before the page opened', () => {
    render(pageFor(fakeSocket([over({ by: 'black', gameId: 'NEW456' })])));
    expect(screen.queryByTestId('arrived')).not.toBeInTheDocument();
    expect(go()).toHaveAccessibleName('Join rematch');
    act(() => go().click());
    expect(screen.getByTestId('arrived')).toHaveTextContent('NEW456');
    expect(getStoredRole('NEW456')).toBe('black');
  });

  it('keeps the rematch below the tower once the card is put away', () => {
    const send = vi.fn(() => true);
    render(pageFor(fakeSocket([over({ by: 'black' })], send)));
    act(() => screen.getByRole('button', { name: 'Close' }).click());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('rematch')).toHaveAttribute('data-bar');
    expect(go()).not.toHaveFocus();
    act(() => go().click());
    expect(send).toHaveBeenLastCalledWith({ type: 'accept_rematch' });
  });
});
