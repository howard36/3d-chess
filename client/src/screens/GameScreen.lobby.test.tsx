import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import GameScreen from './GameScreen';
import EndGameModal from './EndGameModal';
import { LobbyContext } from './lobby/lobbyContext';
import type { LobbyApi, LobbyStage } from './lobby/lobbyContext';
import type { GameSocket } from '../hooks/useGameSocket';
import type { WebSocketMessage } from '../types/messages';
import { getStoredRole, setStoredRole } from '../lib/playerRole';
import { fakeSocket } from './testSupport';

// The game's page before it starts: the host's invitation to send, and the
// guest's invitation to accept, over the lobby's stage. The stage (WebGL) is
// LobbyLayout's; a stand-in keeps the latest view the page shows. The board
// is stubbed for the moment the game starts.
vi.mock('@react-three/fiber', () => ({
  Canvas: () => <div data-testid="r3f-canvas" />,
}));
vi.mock('../three/CameraControls', () => ({ CameraControls: () => null }));
vi.mock('../three/FitCameraToBoard', () => ({ FitCameraToBoard: () => null }));
vi.mock('../three/scene/stage', () => ({ Stage: () => null }));
vi.mock('../three/Board', () => ({ default: () => null }));

let view: LobbyStage | null | undefined;
const lobby: LobbyApi = {
  show: (next) => {
    view = next;
  },
};

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

beforeEach(() => {
  localStorage.clear();
  view = undefined;
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
    expect(screen.getByText('Opening the invitation…')).toBeInTheDocument();
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
    expect(screen.queryByText('Opening the invitation…')).not.toBeInTheDocument();
  });

  it('opens with the stage waiting and no seat offered yet', () => {
    render(at(fakeSocket()));
    expect(screen.getByText('Opening the invitation…')).toBeInTheDocument();
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
    const accept = screen.getByRole('button', { name: 'Take your seat' });
    expect(accept).toBeEnabled();
    expect(accept).toHaveFocus();
    // The host's king in material across from the guest's free seat
    expect(view).toMatchObject({
      beat: 'invited',
      taken: { [host]: true, [seat]: false },
      mine: null,
      seat,
    });
  });

  it('takes the seat: sends join_game and fills the seat at once', async () => {
    const send = vi.fn(() => true);
    render(at(fakeSocket([info(['white'])], send)));
    await userEvent.click(screen.getByRole('button', { name: 'Take your seat' }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      type: 'join_game',
      gameId: 'abc123',
      clientId: expect.any(String),
    });
    const button = screen.getByRole('button', { name: 'Taking your seat…' });
    expect(button).toBeDisabled();
    expect(view).toMatchObject({ taken: { white: true, black: true }, mine: 'black' });
    // Held: nothing more goes out
    fireEvent.click(button);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('says so when both seats are taken, and offers a new game', async () => {
    render(at(fakeSocket([info(['white', 'black'])])));
    expect(screen.getByRole('alert')).toHaveTextContent('This game is taken');
    expect(screen.queryByRole('button', { name: 'Take your seat' })).not.toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Take your seat' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));
    expect(screen.queryByTestId('error-banner')).not.toBeInTheDocument();
  });

  it('goes home from the Home link', async () => {
    render(at(fakeSocket([info(['white'])])));
    await userEvent.click(screen.getByRole('button', { name: /Home/ }));
    expect(screen.getByText('home')).toBeInTheDocument();
  });

  it('keeps the seat once the join is confirmed, and hands the stage over when the game starts', () => {
    const joined: WebSocketMessage[] = [info(['white']), { type: 'game_joined', color: 'black' }];
    const { rerender } = render(at(fakeSocket(joined)));
    expect(getStoredRole('abc123')).toBe('black');
    rerender(at(fakeSocket([...joined, { type: 'game_start', color: 'black' }])));
    expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
    expect(view).toBeNull();
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
    expect(card).toHaveTextContent('You play Black');
    expect(screen.getByRole('heading', { name: 'Invite a friend' })).toBeInTheDocument();
    const link = screen.getByTestId('share-link');
    expect(link).toHaveAttribute('data-link', `${window.location.origin}/game/abc123`);
    // Set without its scheme, the game's id standing on its own
    expect(link).toHaveTextContent(`${window.location.host}/game/abc123`);
    expect(link.querySelector('.lobby-url-id')).toHaveTextContent(/^abc123$/);
    expect(screen.getByText('Waiting for them to join…')).toBeInTheDocument();
    // Nothing to ask the server: the seat is held, the game is known
    expect(send).not.toHaveBeenCalled();
    // The host's king lifted, across from the empty seat
    expect(view).toMatchObject({
      beat: 'wait',
      taken: { black: true, white: false },
      mine: 'black',
      seat: 'black',
    });
  });

  it('copies the link, and says whether it could', async () => {
    setStoredRole('abc123', 'white');
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const { unmount } = render(at(fakeSocket(hosting('white'))));
    const link = screen.getByTestId('share-link');
    expect(link).toHaveAccessibleName(`Copy the link, ${window.location.origin}/game/abc123`);
    // First in line: the next thing to do is send the link
    expect(link).toHaveFocus();
    expect(link).toHaveTextContent('Copy');
    await act(async () => fireEvent.click(link));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/game/abc123`);
    expect(link).toHaveTextContent('Copied');
    expect(screen.getByText('Link copied. Waiting for them to join…')).toBeInTheDocument();
    unmount();

    writeText.mockImplementation(() => Promise.reject(new Error('denied')));
    render(at(fakeSocket(hosting('white'))));
    await act(async () => fireEvent.click(screen.getByTestId('share-link')));
    expect(
      screen.getByText("Couldn't copy; select the link instead. Waiting for them to join…"),
    ).toBeInTheDocument();
  });

  it('offers the system share sheet where there is one', async () => {
    setStoredRole('abc123', 'white');
    const share = vi.fn(() => Promise.reject(new Error('dismissed')));
    vi.stubGlobal('navigator', { ...navigator, share, clipboard: undefined });
    render(at(fakeSocket(hosting('white'))));
    const button = screen.getByRole('button', { name: 'Share link' });
    expect(button).toHaveFocus();
    // No clipboard: the link is only shown
    expect(screen.getByTestId('share-link')).not.toHaveTextContent('Copy');
    await act(async () => fireEvent.click(button));
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ url: `${window.location.origin}/game/abc123` }),
    );
    // A dismissed sheet changes nothing
    expect(screen.getByText('Waiting for them to join…')).toBeInTheDocument();
  });

  it('goes back home from its link', async () => {
    setStoredRole('abc123', 'white');
    render(at(fakeSocket(hosting('white'))));
    await userEvent.click(screen.getByRole('button', { name: /Back to home/ }));
    expect(screen.getByText('home')).toBeInTheDocument();
  });

  it('gives way to the board when the guest arrives', () => {
    setStoredRole('abc123', 'white');
    const { rerender } = render(at(fakeSocket(hosting('white'))));
    rerender(at(fakeSocket([...hosting('white'), { type: 'game_start', color: 'white' }])));
    expect(screen.queryByTestId('invite-card')).not.toBeInTheDocument();
    expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
    expect(view).toBeNull();
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
