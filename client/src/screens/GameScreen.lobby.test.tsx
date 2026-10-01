import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import GameScreen from './GameScreen';
import EndGameModal from './EndGameModal';
import { LobbyContext } from './lobby/lobbyContext';
import type { LobbyApi, LobbyStage } from './lobby/lobbyContext';
import type { GameSocket } from '../hooks/useGameSocket';
import type { WebSocketMessage } from '../types/messages';
import { getStoredRole, setStoredRole } from '../lib/playerRole';
import { fakeSocket, loadBoardChunk } from './testSupport';

// The game's page before it starts: the host's invitation to send, and the
// guest's invitation to accept, over the lobby's stage, and the handover from
// the lobby to the game. The stage (WebGL) is LobbyLayout's; a stand-in keeps
// the latest view the page shows. The game's canvas renders its component
// children only, the board is stubbed, and the entrance's director is a
// stand-in that shows whether it is held and plays the canvas's first frame.
vi.mock('@react-three/fiber', async () => {
  const React = await import('react');
  return {
    Canvas: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="r3f-canvas">
        {React.Children.map(children, (child) =>
          React.isValidElement(child) && typeof child.type !== 'string' ? child : null,
        )}
      </div>
    ),
  };
});
vi.mock('../three/CameraControls', () => ({ CameraControls: () => null }));
vi.mock('../three/FitCameraToBoard', () => ({ FitCameraToBoard: () => null }));
vi.mock('../three/scene/stage', () => ({ Stage: () => null }));
vi.mock('../three/Board', () => ({ default: () => null }));
const intro = vi.hoisted(() => ({
  paused: null as boolean | null,
  firstFrame: null as (() => void) | null,
}));
vi.mock('../three/scene/backdropCache', () => ({
  BackdropCache: ({ children }: { children?: unknown }) => children ?? null,
}));
vi.mock('../three/scene/warm', () => ({
  WarmPrograms: () => null,
}));
vi.mock('../three/intro/IntroDirector', () => ({
  INTRO_SCENE_VAR: '--intro-scene',
  INTRO_HUD_VAR: '--intro-hud',
  IntroDirector: ({ paused, onFirstFrame }: { paused?: boolean; onFirstFrame?: () => void }) => {
    intro.paused = !!paused;
    intro.firstFrame = onFirstFrame ?? null;
    return null;
  },
}));

let view: LobbyStage | null | undefined;
const lobby: LobbyApi = {
  show: (next) => {
    view = next;
  },
};

// The 3D board is a lazy chunk: load it before any test looks for it
beforeAll(loadBoardChunk);

const at = (socket: GameSocket, gameId = 'abc123') => (
  <LobbyContext.Provider value={lobby}>
    <MemoryRouter initialEntries={[`/game/${gameId}`]}>
      <Routes>
        <Route path="/" element={<p>home</p>} />
        <Route path="/new" element={<p>choose a side</p>} />
        <Route path="/game/:gameId" element={<GameScreen gameSocket={socket} />} />
      </Routes>
    </MemoryRouter>
  </LobbyContext.Provider>
);

const info = (seats: ('white' | 'black')[], gameId = 'abc123'): WebSocketMessage => ({
  type: 'game_info',
  gameId,
  seats,
});
const looks = (send: ReturnType<typeof vi.fn>) =>
  send.mock.calls.filter(([m]) => (m as WebSocketMessage).type === 'look_game');

/** The words under the kings (aria-hidden: the card says the same). */
const seatLabels = () =>
  Array.from(document.querySelectorAll('.lobby-seat')).map((el) => el.textContent);

beforeEach(() => {
  localStorage.clear();
  view = undefined;
  intro.paused = null;
  intro.firstFrame = null;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a guest's invitation", () => {
  it('asks which seats are taken once per socket session, until answered', async () => {
    const send = vi.fn(() => true);
    const { rerender } = render(at(fakeSocket([], send)));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: 'look_game', gameId: 'abc123' });
    // Any number of renders on the same socket: asked once
    rerender(at(fakeSocket([{ type: 'presence', color: 'white', online: true }], send)));
    expect(send).toHaveBeenCalledTimes(1);

    // Dropped before the answer: nothing while down, asked again on the next socket
    rerender(at(fakeSocket([], send, { status: 'reconnecting' })));
    expect(send).toHaveBeenCalledTimes(1);
    rerender(at(fakeSocket([], send, { sessionId: 2 })));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send).toHaveBeenLastCalledWith({ type: 'look_game', gameId: 'abc123' });

    // Answered: a later socket does not ask again
    rerender(at(fakeSocket([info(['white'])], send, { sessionId: 2 })));
    rerender(at(fakeSocket([info(['white'])], send, { sessionId: 3, sessionStartIndex: 1 })));
    await new Promise((r) => setTimeout(r, 20));
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not ask before a socket is open', () => {
    const send = vi.fn(() => false);
    const { rerender } = render(at(fakeSocket([], send, { status: 'connecting', sessionId: 0 })));
    rerender(at(fakeSocket([], send, { status: 'connecting', sessionId: 1 })));
    expect(send).not.toHaveBeenCalled();
    rerender(at(fakeSocket([], send)));
    expect(looks(send)).toHaveLength(1);
  });

  it("does not take another game's answer for this one's", async () => {
    const send = vi.fn(() => true);
    const { rerender } = render(at(fakeSocket([info(['white'], 'OTHER0')], send)));
    expect(screen.queryByRole('button', { name: 'Join game' })).not.toBeInTheDocument();
    expect(looks(send)).toHaveLength(1);
    rerender(at(fakeSocket([info(['white'], 'OTHER0')], send, { sessionId: 2 })));
    await waitFor(() => expect(looks(send)).toHaveLength(2));
  });

  it('is never sent by a page that holds a stored seat: it rejoins instead', async () => {
    setStoredRole('abc123', 'black');
    const send = vi.fn(() => true);
    render(at(fakeSocket([], send)));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'rejoin_game' })),
    );
    expect(looks(send)).toHaveLength(0);
    expect(screen.getByText('Returning to your game…')).toBeInTheDocument();
    expect(screen.queryByText(/server…/)).not.toBeInTheDocument();
  });

  it('opens with the stage waiting and no seat offered yet, and speaks of the server only if it is slow', async () => {
    render(at(fakeSocket()));
    expect(screen.queryByText(/server…/)).not.toBeInTheDocument();
    expect(
      await screen.findByText('Connecting to server…', {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(view).toMatchObject({
      beat: 'invited',
      taken: { white: false, black: false },
      mine: null,
      seat: 'white',
    });
  });

  it.each([
    ['white', 'Black', 'black'],
    ['black', 'White', 'white'],
  ] as const)('offers the seat the host left free (host %s: play %s)', (host, name, seat) => {
    render(at(fakeSocket([info([host])])));
    expect(
      screen.getByRole('heading', { name: `You're invited to play ${name}` }),
    ).toBeInTheDocument();
    const accept = screen.getByRole('button', { name: 'Join game' });
    expect(accept).toBeEnabled();
    expect(accept).toHaveFocus();
    // Named under the kings too
    expect(seatLabels()).toContain('Opponent');
    expect(seatLabels()).toContain('You');
    // The host's king in material across from the guest's free seat
    expect(view).toMatchObject({
      beat: 'invited',
      taken: { [host]: true, [seat]: false },
      mine: null,
      // Framed as the host's wait, "Join game" under the kings
      card: true,
      seat,
    });
  });

  it('takes the seat: sends join_game and fills the seat at once', async () => {
    const send = vi.fn(() => true);
    render(at(fakeSocket([info(['white'])], send)));
    await userEvent.click(screen.getByRole('button', { name: 'Join game' }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      type: 'join_game',
      gameId: 'abc123',
      clientId: expect.any(String),
    });
    const button = screen.getByRole('button', { name: 'Joining…' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    // The camera eases on from the invitation's framing as the game gets under way
    expect(view).toMatchObject({ taken: { white: true, black: true }, mine: null, card: false });
    expect(seatLabels()).toEqual(['Opponent', 'You']);
    // Held: nothing more goes out
    fireEvent.click(button);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('says so when both seats are taken, and offers a new game', async () => {
    render(at(fakeSocket([info(['white', 'black'])])));
    expect(screen.getByRole('alert')).toHaveTextContent('This game is taken');
    expect(screen.queryByRole('button', { name: 'Join game' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start a new game' }));
    expect(screen.getByText('choose a side')).toBeInTheDocument();
  });

  it('says so when there is no such game', async () => {
    const send = vi.fn(() => true);
    render(
      at(fakeSocket([{ type: 'error', code: 'invalid_game', message: 'No such game' }], send)),
    );
    expect(screen.getByRole('heading', { name: 'No game here' })).toBeInTheDocument();
    // The card says it; no error banner repeats it
    expect(screen.queryByTestId('error-banner')).not.toBeInTheDocument();
    // The refusal answers the look
    expect(send).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Start a new game' }));
    expect(screen.getByText('choose a side')).toBeInTheDocument();
  });

  it('shows any other error under the card, until dismissed', async () => {
    render(
      at(
        fakeSocket([
          info(['white']),
          { type: 'error', code: 'invalid_message', message: 'Bad request' },
        ]),
      ),
    );
    expect(screen.getByTestId('error-banner')).toHaveTextContent('Bad request');
    expect(screen.getByRole('button', { name: 'Join game' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));
    expect(screen.queryByTestId('error-banner')).not.toBeInTheDocument();
  });

  it('goes home from the Home link', async () => {
    render(at(fakeSocket([info(['white'])])));
    await userEvent.click(screen.getByRole('button', { name: /Home/ }));
    expect(screen.getByText('home')).toBeInTheDocument();
  });

  it('keeps the seat once the join is confirmed, still as the guest', () => {
    const joined: WebSocketMessage[] = [info(['white']), { type: 'game_joined', color: 'black' }];
    render(at(fakeSocket(joined)));
    expect(getStoredRole('abc123')).toBe('black');
    // A stored seat, but joined here: not the host's card
    expect(screen.queryByTestId('invite-card')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Joining…' })).toBeInTheDocument();
    expect(view).toMatchObject({
      beat: 'invited',
      taken: { white: true, black: true },
      mine: null,
      seat: 'black',
    });
  });
});

describe("the host's invitation to send", () => {
  const hosting = (color: 'white' | 'black'): WebSocketMessage[] => [
    { type: 'game_created', gameId: 'abc123', color },
  ];

  it('gives the link to the game and the seat the host plays', () => {
    setStoredRole('abc123', 'black');
    const send = vi.fn(() => true);
    render(at(fakeSocket(hosting('black'), send)));
    const card = screen.getByTestId('invite-card');
    expect(card).toHaveAttribute('data-seat', 'black');
    // The page's heading says the side; the card, what to do about the other
    expect(screen.getByRole('heading', { name: 'You play Black' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Invite a friend' })).toBeInTheDocument();
    // Nothing more: the heading, the link and its button say it all
    const link = screen.getByTestId('share-link');
    expect(card.querySelector('h2')?.nextElementSibling).toBe(link);
    expect(link).toHaveAttribute('data-link', `${window.location.origin}/game/abc123`);
    // Set without its scheme, plain
    expect(link).toHaveTextContent(new RegExp(`^${window.location.host}/game/abc123$`));
    expect(screen.getByText('Waiting for your friend…')).toBeInTheDocument();
    expect(seatLabels()).toEqual(['Opponent', 'You']);
    // Nothing to ask the server: the seat is held, the game is known
    expect(send).not.toHaveBeenCalled();
    // The host's king in its light, across from the empty seat, framed
    // higher over the card
    expect(view).toMatchObject({
      beat: 'wait',
      taken: { black: true, white: false },
      mine: 'black',
      card: true,
      seat: 'black',
    });
  });

  it('keeps the lobby through a dropped connection, not playing its entrance again', () => {
    setStoredRole('abc123', 'black');
    const send = vi.fn(() => true);
    const { rerender } = render(at(fakeSocket(hosting('black'), send)));
    expect(view).toMatchObject({ beat: 'wait' });
    rerender(
      at(
        fakeSocket(hosting('black'), send, {
          sessionId: 2,
          sessionStartIndex: 1,
          status: 'reconnecting',
        }),
      ),
    );
    expect(view).toMatchObject({ beat: 'wait', mine: 'black' });
    expect(screen.getByTestId('invite-card')).toBeInTheDocument();
  });

  it('copies the link, and says whether it could', async () => {
    setStoredRole('abc123', 'white');
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    vi.useFakeTimers();
    try {
      const { unmount } = render(at(fakeSocket(hosting('white'))));
      const copy = screen.getByRole('button', { name: 'Copy link' });
      // First in line: the next thing to do is send the link
      expect(copy).toHaveFocus();
      expect(screen.queryByRole('button', { name: 'Share link' })).not.toBeInTheDocument();
      await act(async () => fireEvent.click(copy));
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/game/abc123`);
      expect(copy).toHaveTextContent(/Copied/);
      expect(screen.getByText('Link copied')).toBeInTheDocument();
      // ...for a moment, then the button offers to copy again
      act(() => vi.advanceTimersByTime(10_000));
      expect(copy).toHaveTextContent('Copy link');
      unmount();

      writeText.mockImplementation(() => Promise.reject(new Error('denied')));
      render(at(fakeSocket(hosting('white'))));
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy link' })));
      expect(screen.getByText(/Couldn't copy/)).toHaveAttribute('role', 'status');
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers only the copy, even where there is a system share sheet', () => {
    setStoredRole('abc123', 'white');
    vi.stubGlobal('navigator', { ...navigator, share: vi.fn(), clipboard: { writeText: vi.fn() } });
    render(at(fakeSocket(hosting('white'))));
    expect(screen.getByRole('button', { name: 'Copy link' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Share link' })).not.toBeInTheDocument();
  });

  it('shows the link alone where it cannot be copied', () => {
    setStoredRole('abc123', 'white');
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    render(at(fakeSocket(hosting('white'))));
    expect(screen.getByTestId('share-link')).toHaveTextContent('/game/abc123');
    expect(screen.queryByRole('button', { name: /link/ })).not.toBeInTheDocument();
  });

  it('goes back home from its link', async () => {
    setStoredRole('abc123', 'white');
    render(at(fakeSocket(hosting('white'))));
    await userEvent.click(screen.getByRole('button', { name: /Home/ }));
    expect(screen.getByText('home')).toBeInTheDocument();
  });
});

describe('the handover from the lobby to the game', () => {
  const start = (color: 'white' | 'black'): WebSocketMessage => ({ type: 'game_start', color });
  const created: WebSocketMessage[] = [{ type: 'game_created', gameId: 'abc123', color: 'white' }];

  it("fills the guest's seat, then leaves for the game once its first frame is drawn", () => {
    setStoredRole('abc123', 'white');
    const { rerender } = render(at(fakeSocket(created)));
    rerender(at(fakeSocket([...created, start('white')])));

    // The game mounts under the lobby, held on its first frame
    expect(screen.queryByTestId('invite-card')).not.toBeInTheDocument();
    expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
    expect(intro.paused).toBe(true);
    // The empty seat across from the host fills
    expect(view).toMatchObject({
      beat: 'arrive',
      arriving: 'black',
      mine: 'white',
      seat: 'white',
      taken: { white: true, black: true },
    });
    expect(view!.caption).toMatch(/Opponent joined/);

    // The arrival alone does not leave: the game has not drawn yet
    act(() => view!.onArrived!());
    expect(view!.beat).toBe('arrive');
    act(() => intro.firstFrame!());
    expect(view!.beat).toBe('leave');
    // Still held until the lobby begins to fade off it
    expect(intro.paused).toBe(true);
    act(() => view!.onReveal!());
    expect(intro.paused).toBe(false);
    act(() => view!.onLeft!());
    expect(view).toBeNull();
  });

  it("fills the guest's own seat on their page, in either order", () => {
    const joined: WebSocketMessage[] = [info(['white']), { type: 'game_joined', color: 'black' }];
    const { rerender } = render(at(fakeSocket(joined)));
    rerender(at(fakeSocket([...joined, start('black')])));
    expect(view).toMatchObject({ beat: 'arrive', arriving: 'black', mine: 'black' });
    expect(view!.caption).toMatch(/You play Black/);
    // The game drawn first, then the arrival over
    act(() => intro.firstFrame!());
    expect(view!.beat).toBe('arrive');
    act(() => view!.onArrived!());
    expect(view!.beat).toBe('leave');
  });

  it('has no lobby to leave on a page that opens on a game under way', () => {
    setStoredRole('abc123', 'white');
    render(at(fakeSocket([{ type: 'game_state', color: 'white', started: true, moves: [] }])));
    expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
    expect(view).toBeNull();
    expect(intro.paused).toBe(false);
  });

  it('tells a host in another tab that their guest is here, until they look', () => {
    setStoredRole('abc123', 'white');
    let hidden = true;
    const spy = vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    const title = document.title;
    try {
      const { rerender } = render(at(fakeSocket(created)));
      rerender(at(fakeSocket([...created, start('white')])));
      expect(document.title).toMatch(/Opponent joined/);
      hidden = false;
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(document.title).toBe(title);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('the end of a game', () => {
  it('starts the next one at the side choice', async () => {
    render(
      <MemoryRouter initialEntries={['/game/abc123']}>
        <Routes>
          <Route path="/new" element={<p>choose a side</p>} />
          <Route
            path="/game/:gameId"
            element={<EndGameModal result="checkmate" winner="white" seat="white" />}
          />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Start new game' }));
    expect(screen.getByText('choose a side')).toBeInTheDocument();
  });
});
