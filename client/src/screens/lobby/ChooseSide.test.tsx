import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useNavigationType, useParams } from 'react-router-dom';
import ChooseSide from './ChooseSide';
import { LobbyContext } from './lobbyContext';
import type { LobbyApi, LobbyStage } from './lobbyContext';
import type { GameSocket } from '../../hooks/useGameSocket';
import type { WebSocketMessage } from '../../types/messages';
import { getStoredRole } from '../../lib/playerRole';
import { isArriving } from '../../lib/computerGames';
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

const white = () => screen.getByRole('button', { name: 'White' });
const random = () => screen.getByRole('button', { name: 'Random' });
const black = () => screen.getByRole('button', { name: 'Black' });

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
    ['White', 0.5, 'You play White'],
    ['Black', 0.5, 'You play Black'],
    // The toss's outcome is not told before the coin lands
    ['Random', 0.2, 'Leaving it to chance…'],
  ])('answers a pick of %s in its heading at once', async (name, draw, heading) => {
    render(at(fakeSocket()));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Choose your side');
    vi.spyOn(Math, 'random').mockReturnValue(draw);
    await userEvent.click(screen.getByRole('button', { name }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(heading);
  });

  it("lets Random's button go once the coin has left the middle", async () => {
    render(at(fakeSocket()));
    vi.spyOn(Math, 'random').mockReturnValue(0.2);
    await userEvent.click(random());
    expect(random()).toHaveAttribute('data-chosen');
    expect(random()).not.toHaveAttribute('data-faded');
    act(() => view!.onGlide!());
    expect(random()).toHaveAttribute('data-faded');
    expect(white()).toHaveAttribute('data-faded');
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
    expect(screen.getByRole('status')).toHaveTextContent('');
    expect(
      await screen.findByText('Waiting for server…', {}, { timeout: 4000 }),
    ).toBeInTheDocument();
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
    // "Play again" from a finished game lands here with that game's
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
    expect(
      await screen.findByText('Reconnecting to server…', {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    rerender(at(fakeSocket([], send, { sessionId: 2 })));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
    // Answered on the new socket: nothing more is sent
    rerender(at(fakeSocket([created('white')], send, { sessionId: 2 })));
    rerender(at(fakeSocket([created('white')], send, { sessionId: 3 })));
    await new Promise((r) => setTimeout(r, 20));
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('says it is connecting only once the connection is slow to open', async () => {
    const send = vi.fn<GameSocket['send']>(() => false);
    render(at(fakeSocket([], send, { status: 'connecting' })));
    expect(screen.getByRole('status')).toHaveTextContent('');
    expect(
      await screen.findByText('Connecting to server…', {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    // A pick is queued, and goes out when the socket opens
    await userEvent.click(white());
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('goes home from the Home link', async () => {
    render(at(fakeSocket()));
    await userEvent.click(screen.getByRole('button', { name: /Home/ }));
    expect(screen.getByText('home')).toBeInTheDocument();
  });
});

describe('against the computer', () => {
  const computerAt = (socket: GameSocket) => (
    <LobbyContext.Provider value={lobby}>
      <MemoryRouter initialEntries={['/', '/computer']} initialIndex={1}>
        <Routes>
          <Route path="/computer" element={<ChooseSide gameSocket={socket} computer />} />
          <Route path="/computer/:gameId" element={<GamePage />} />
        </Routes>
      </MemoryRouter>
    </LobbyContext.Provider>
  );

  const level = (name: string) => screen.getByRole('button', { name });
  const levels = () => screen.queryByRole('group', { name: 'Difficulty' });

  it('asks for the side first, then the computer’s level under its open seat', async () => {
    render(computerAt(fakeSocket()));
    expect(screen.getByRole('heading', { name: 'Choose your side' })).toBeInTheDocument();
    expect(levels()).toBeNull();
    await userEvent.click(black());
    // The pick plays out first: the chosen king set down, the others going
    expect(view).toMatchObject({ beat: 'choose', mine: 'black' });
    expect(levels()).toBeNull();
    // ...then the computer's seat opens across from it, the kings framed as
    // they were for the side (nothing docked under them: the levels hang
    // where the side's buttons were)
    settle();
    expect(view).toMatchObject({
      beat: 'invited',
      taken: { black: true, white: false },
      mine: 'black',
      seat: 'black',
    });
    expect(view?.card).toBeFalsy();
    expect(screen.getByRole('heading', { name: 'Choose difficulty' })).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('Computer')).toBeInTheDocument();
    expect(levels()).toBeInTheDocument();
    expect(['Easy', 'Medium', 'Hard'].map((n) => level(n).textContent)).toEqual([
      'Easy',
      'Medium',
      'Hard',
    ]);
    expect(black()).toHaveAttribute('data-faded');
  });

  it('makes the game in the browser with the level chosen, and moves on as the page’s words go', async () => {
    const send = vi.fn<GameSocket['send']>(() => true);
    // Even with no connection to the server, nothing is said about it
    render(computerAt(fakeSocket([], send, { status: 'connecting' })));
    await new Promise((r) => setTimeout(r, 1700));
    expect(screen.queryByText(/server/)).toBeNull();
    await userEvent.click(white());
    settle();
    expect(send).not.toHaveBeenCalled();
    await userEvent.click(level('Easy'));
    expect(send).not.toHaveBeenCalled();
    // The computer's king fills at once, the camera holding still...
    expect(view).toMatchObject({
      beat: 'invited',
      taken: { white: true, black: true },
    });
    expect(view?.card).toBeFalsy();
    // ...the level chosen stays lit as the others go, and the page's words
    // make way
    expect(level('Easy')).toHaveAttribute('data-chosen');
    expect(level('Medium')).toHaveAttribute('data-faded');
    expect(level('Hard')).toBeDisabled();
    expect(
      screen.getByRole('heading', { name: 'Choose difficulty' }).parentElement,
    ).toHaveAttribute('data-out');
    expect(screen.getByRole('button', { name: /Home/ }).parentElement).toHaveAttribute('data-out');
    expect(screen.queryByText(/^game page/)).toBeNull();
    // A button's own animation ending is not the page going
    const dock = levels()!;
    const ended = () =>
      Object.assign(new Event('animationend', { bubbles: true }), { animationName: 'lobby-out' });
    fireEvent(level('Easy'), ended());
    expect(screen.queryByText(/^game page/)).toBeNull();
    // As they go, the game's page opens on the computer's arrival (jsdom has
    // no AnimationEvent to carry the animation's name)
    fireEvent(dock, ended());
    const page = await screen.findByText(/^game page [a-z0-9]+ by REPLACE$/);
    const id = page.textContent!.split(' ')[2];
    expect(isArriving(id)).toBe(true);
    expect(getStoredRole(id)).toBe('white');
    expect(JSON.parse(localStorage.getItem(`3dchess:computer:${id}`)!)).toMatchObject({
      color: 'white',
      difficulty: 'easy',
      started: false,
      moves: [],
    });
  });

  it('offers the last level played first (Medium the first time)', async () => {
    const { unmount } = render(computerAt(fakeSocket()));
    await userEvent.click(white());
    settle();
    expect(level('Medium')).toHaveFocus();
    await userEvent.click(level('Hard'));
    unmount();
    render(computerAt(fakeSocket()));
    await userEvent.click(white());
    settle();
    expect(level('Hard')).toHaveFocus();
  });

  it('leaves the side to the coin, then asks for the level', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    render(computerAt(fakeSocket()));
    await userEvent.click(random());
    expect(screen.getByRole('heading', { name: 'Leaving it to chance…' })).toBeInTheDocument();
    settle();
    expect(screen.getByRole('heading', { name: 'Choose difficulty' })).toBeInTheDocument();
    expect(view).toMatchObject({ beat: 'invited', mine: 'black', toss: null });
  });

  it('moves on at once, for a player who asked for less motion', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query.includes('reduce'),
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
    try {
      render(computerAt(fakeSocket()));
      await userEvent.click(black());
      settle();
      await userEvent.click(level('Hard'));
      expect(await screen.findByText(/^game page [a-z0-9]+ by REPLACE$/)).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
