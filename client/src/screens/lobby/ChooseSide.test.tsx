import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useNavigationType, useParams } from 'react-router-dom';
import ChooseSide from './ChooseSide';
import { LobbyContext } from './lobbyContext';
import type { LobbyApi, LobbyStage } from './lobbyContext';
import type { GameSocket } from '../../hooks/useGameSocket';
import type { WebSocketMessage } from '../../types/messages';
import { getStoredRole } from '../../lib/playerRole';
import { fakeSocket } from '../testSupport';

// The lobby's stage (a WebGL canvas) is LobbyLayout's; here the page runs
// under a stand-in that keeps the latest view it was shown, so a test can
// look at the picture and play the scene's part (onSettled).
let view: LobbyStage | null = null;
const lobby: LobbyApi = {
  show: (next) => {
    view = next;
  },
};

function GamePage() {
  const { gameId } = useParams();
  // How the page was reached: the side choice is not a page to go back to
  return (
    <p>
      game page {gameId} by {useNavigationType()}
    </p>
  );
}

const at = (socket: GameSocket) => (
  <LobbyContext.Provider value={lobby}>
    <MemoryRouter initialEntries={['/', '/new']} initialIndex={1}>
      <Routes>
        <Route path="/" element={<p>home</p>} />
        <Route path="/new" element={<ChooseSide gameSocket={socket} />} />
        <Route path="/game/:gameId" element={<GamePage />} />
      </Routes>
    </MemoryRouter>
  </LobbyContext.Provider>
);

const created = (color: 'white' | 'black', gameId = 'ABC123'): WebSocketMessage => ({
  type: 'game_created',
  gameId,
  color,
});

const settle = () => act(() => view!.onSettled!());

const white = () => screen.getByRole('button', { name: 'White Moves first' });
const random = () => screen.getByRole('button', { name: 'Random Let chance decide' });
const black = () => screen.getByRole('button', { name: 'Black Moves second' });

beforeEach(() => {
  localStorage.clear();
  view = null;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('choosing a side', () => {
  it('offers White, Random and Black, and shows all three kings on the glass', () => {
    render(at(fakeSocket()));
    expect(screen.getByRole('group', { name: 'Choose your side' })).toBeInTheDocument();
    for (const button of [white(), random(), black()]) {
      expect(button).toBeEnabled();
      expect(button).toHaveAttribute('aria-pressed', 'false');
    }
    expect(view).toMatchObject({
      beat: 'choose',
      taken: { white: true, black: true },
      mine: null,
      hover: null,
      toss: null,
      seat: 'white',
    });
  });

  it.each(['white', 'black'] as const)('asks for a game as %s', async (side) => {
    const send = vi.fn(() => true);
    render(at(fakeSocket([], send)));
    await userEvent.click(side === 'white' ? white() : black());
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      type: 'create_game',
      clientId: expect.any(String),
      color: side,
    });
    // The chosen king is lifted, the other seat left free
    expect(view).toMatchObject({
      mine: side,
      seat: side,
      toss: null,
      taken: { [side]: true, [side === 'white' ? 'black' : 'white']: false },
    });
  });

  it.each([
    [0.2, 'white'],
    [0.8, 'black'],
  ] as const)('tosses for Random before asking (a draw of %s gives %s)', async (draw, side) => {
    const send = vi.fn(() => true);
    render(at(fakeSocket([], send)));
    vi.spyOn(Math, 'random').mockReturnValue(draw);
    await userEvent.click(random());
    expect(send).toHaveBeenCalledWith({
      type: 'create_game',
      clientId: expect.any(String),
      color: side,
    });
    // The coin is thrown to land on the side the server will give
    expect(view).toMatchObject({ toss: side, mine: side, seat: side });
    expect(random()).toHaveAttribute('aria-pressed', 'true');
  });

  it.each([
    ['White Moves first', 0.5, 'You play White'],
    ['Black Moves second', 0.5, 'You play Black'],
    // The toss's outcome is not told before the coin lands
    ['Random Let chance decide', 0.2, 'Leaving it to chance…'],
  ])('answers a pick of %s in its heading at once', async (name, draw, heading) => {
    render(at(fakeSocket()));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Choose your side');
    expect(
      screen.getByText('Then send a friend the link to take the other side.'),
    ).toBeInTheDocument();
    vi.spyOn(Math, 'random').mockReturnValue(draw);
    await userEvent.click(screen.getByRole('button', { name }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(heading);
    expect(screen.getByText('Setting the board…')).toBeInTheDocument();
  });

  it('makes a pick final: every choice is held, and nothing more is sent', async () => {
    const send = vi.fn(() => true);
    render(at(fakeSocket([], send)));
    await userEvent.click(white());
    for (const button of [white(), random(), black()]) expect(button).toBeDisabled();
    expect(white()).toHaveAttribute('aria-pressed', 'true');
    expect(white()).toHaveAttribute('data-chosen');
    expect(black()).toHaveAttribute('data-faded');
    // The scene can still report a click on a king: it is ignored too
    act(() => view!.onPick!('black'));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('follows the pointer and keyboard focus on the kings until a pick', async () => {
    render(at(fakeSocket()));
    await userEvent.hover(black());
    expect(view!.hover).toBe('black');
    await userEvent.unhover(black());
    expect(view!.hover).toBeNull();
    act(() => view!.onHover!('random'));
    expect(view!.hover).toBe('random');
    act(() => black().focus());
    expect(view!.hover).toBe('black');
    act(() => black().blur());
    expect(view!.hover).toBeNull();
    // A pick from the scene (a click on a king) counts like the button
    act(() => view!.onPick!('white'));
    expect(view!.hover).toBeNull();
    act(() => view!.onHover!('black'));
    expect(view!.hover).toBeNull();
  });

  it('goes on to the game once both the answer and the moment are over', async () => {
    const send = vi.fn(() => true);
    const { rerender } = render(at(fakeSocket([], send)));
    await userEvent.click(black());

    // The answer first: the role is kept at once, the page stays for the moment
    rerender(at(fakeSocket([created('black')], send)));
    expect(getStoredRole('ABC123')).toBe('black');
    expect(screen.getByTestId('choose-side')).toBeInTheDocument();

    settle();
    // Replacing the side choice in history
    expect(await screen.findByText('game page ABC123 by REPLACE')).toBeInTheDocument();
  });

  it('waits for the answer when the moment is over first, and says so', async () => {
    const send = vi.fn(() => true);
    const { rerender } = render(at(fakeSocket([], send)));
    await userEvent.click(white());
    expect(screen.getByRole('status')).toHaveTextContent('');
    settle();
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for the server…');
    expect(screen.getByTestId('choose-side')).toBeInTheDocument();

    rerender(at(fakeSocket([created('white')], send)));
    expect(await screen.findByText('game page ABC123 by REPLACE')).toBeInTheDocument();
    expect(getStoredRole('ABC123')).toBe('white');
  });

  it('keeps the side the server gave, if it is not the one asked for', async () => {
    const { rerender } = render(at(fakeSocket()));
    await userEvent.click(white());
    rerender(at(fakeSocket([created('black')])));
    expect(getStoredRole('ABC123')).toBe('black');
  });

  it('ignores a game_created left in the log by a previous game', () => {
    // "Start new game" from a finished game lands here with that game's
    // game_created still in the log for the first render (App resets the
    // session in a layout effect, after this screen's first render). Reacting
    // to it would store a role and go straight back into the finished game.
    render(at(fakeSocket([created('white', 'OLD000')])));
    act(() => view!.onSettled!());
    expect(screen.queryByText(/game page/)).not.toBeInTheDocument();
    expect(getStoredRole('OLD000')).toBeNull();
    expect(white()).toBeEnabled();
    expect(screen.queryByText(/Couldn't start a game/)).not.toBeInTheDocument();
  });

  it('answers only to its own request, not to an older game_created or error', async () => {
    const stale: WebSocketMessage[] = [
      created('white', 'OLD000'),
      { type: 'error', code: 'invalid_game', message: 'Cannot rejoin' },
    ];
    const send = vi.fn(() => true);
    const { rerender } = render(at(fakeSocket(stale, send)));
    expect(screen.queryByText(/Couldn't start a game/)).not.toBeInTheDocument();
    await userEvent.click(black());
    settle();
    expect(screen.queryByText(/game page/)).not.toBeInTheDocument();
    rerender(at(fakeSocket([...stale, created('black')], send)));
    expect(await screen.findByText('game page ABC123 by REPLACE')).toBeInTheDocument();
    expect(getStoredRole('OLD000')).toBeNull();
  });

  it('puts the kings back and lets the player choose again after a refusal', async () => {
    const send = vi.fn(() => true);
    const { rerender } = render(at(fakeSocket([], send)));
    await userEvent.click(white());
    settle();
    const refused: WebSocketMessage[] = [
      { type: 'error', code: 'already_in_game', message: 'Already in a game' },
    ];
    rerender(at(fakeSocket(refused, send)));
    expect(screen.getByRole('status')).toHaveTextContent(
      "Couldn't start a game: Already in a game",
    );
    for (const button of [white(), random(), black()]) expect(button).toBeEnabled();
    expect(view).toMatchObject({ mine: null, toss: null, taken: { white: true, black: true } });

    // A second pick is a fresh request: the old refusal no longer answers it,
    // and the settled moment of the first pick does not count for it
    await userEvent.click(black());
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ color: 'black' }));
    expect(screen.queryByText(/Couldn't start a game/)).not.toBeInTheDocument();
    rerender(at(fakeSocket([...refused, created('black')], send)));
    expect(getStoredRole('ABC123')).toBe('black');
    expect(screen.queryByText(/game page/)).not.toBeInTheDocument();
    settle();
    expect(await screen.findByText('game page ABC123 by REPLACE')).toBeInTheDocument();
  });

  it('asks again when the connection drops before the game is created', async () => {
    const send = vi.fn<GameSocket['send']>(() => true);
    const { rerender } = render(at(fakeSocket([], send)));
    await userEvent.click(white());
    rerender(at(fakeSocket([], send, { status: 'reconnecting' })));
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting to the server…');
    rerender(at(fakeSocket([], send, { sessionId: 2 })));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
    // Answered on the new socket: nothing more is sent
    rerender(at(fakeSocket([created('white')], send, { sessionId: 2 })));
    rerender(at(fakeSocket([created('white')], send, { sessionId: 3 })));
    await new Promise((r) => setTimeout(r, 20));
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('says it is connecting only until a pick is made', async () => {
    const send = vi.fn<GameSocket['send']>(() => false);
    render(at(fakeSocket([], send, { status: 'connecting' })));
    expect(screen.getByRole('status')).toHaveTextContent('Connecting to the server…');
    // The request is queued, and goes out when the socket opens
    await userEvent.click(white());
    expect(send).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('goes home from the Home link', async () => {
    render(at(fakeSocket()));
    await userEvent.click(screen.getByRole('button', { name: /Home/ }));
    expect(screen.getByText('home')).toBeInTheDocument();
  });
});
