import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import ComputerGameScreen from './ComputerGameScreen';
import { LobbyContext } from './lobby/lobbyContext';
import type { LobbyApi, LobbyStage } from './lobby/lobbyContext';
import { isArriving, markArriving, saveComputerGame } from '../lib/computerGames';
import { setStoredRole } from '../lib/playerRole';
import { loadBoardChunk } from './testSupport';

// A game against the computer, from the page's side: the lobby's short wait
// (no one to invite), the computer's arrival, and the game with the computer
// named in the pill. The canvas and the board are stubbed as in
// GameScreen.lobby.test.tsx, and the computer answers at once.
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
vi.mock('../three/scene/backdropCache', () => ({
  BackdropCache: ({ children }: { children?: unknown }) => children ?? null,
}));
vi.mock('../three/scene/warm', () => ({ WarmPrograms: () => null }));
// The entrance is over as soon as it is drawn, or when a test says (entrance.end)
const entrance = vi.hoisted(() => ({ auto: true, end: null as (() => void) | null }));
vi.mock('../three/intro/IntroDirector', async () => {
  const React = await import('react');
  return {
    INTRO_SCENE_VAR: '--intro-scene',
    INTRO_HUD_VAR: '--intro-hud',
    IntroDirector: ({ onDone }: { onDone?: () => void }) => {
      entrance.end = onDone ?? null;
      React.useEffect(() => {
        if (entrance.auto) onDone?.();
      }, [onDone]);
      return null;
    },
  };
});
const thinking = vi.hoisted(() => ({ asked: 0 }));
vi.mock('../ai/computer', () => ({
  createComputer: () => ({
    think: () => {
      thinking.asked++;
      return Promise.resolve(null);
    },
    dispose: () => {},
  }),
}));

let view: LobbyStage | null | undefined;
const lobby: LobbyApi = {
  show: (next) => {
    view = next;
  },
};

beforeAll(loadBoardChunk);
beforeEach(() => {
  localStorage.clear();
  view = undefined;
  thinking.asked = 0;
  entrance.auto = true;
});

/** The tutorial's page, as far as this test needs: the way back it was handed. */
const Learn = () => {
  const { state } = useLocation();
  return <p data-testid="learn-back">{(state as { back?: string } | null)?.back}</p>;
};

const at = (gameId: string) => (
  <LobbyContext.Provider value={lobby}>
    <MemoryRouter initialEntries={[`/computer/${gameId}`]}>
      <Routes>
        <Route path="/computer" element={<p>choose a side and level</p>} />
        <Route path="/computer/:gameId" element={<ComputerGameScreen />} />
        <Route path="/learn" element={<Learn />} />
      </Routes>
    </MemoryRouter>
  </LobbyContext.Provider>
);

it('from its side choice, the computer takes its seat on the lobby’s stage, then the game begins', async () => {
  saveComputerGame({ id: 'g1', color: 'white', difficulty: 'hard', started: false, moves: [] });
  setStoredRole('g1', 'white');
  markArriving('g1');
  render(at('g1'));
  // At once, the arrival: no moment with the stage taken away (a blackout),
  // and no waiting picture
  expect(view).toMatchObject({ beat: 'arrive', arriving: 'black', mine: 'white' });
  expect(view!.caption).toBe('Computer · Hard');
  expect(screen.queryByTestId('invite-card')).toBeNull();
  act(() => view!.onArrived!());
  const pill = await screen.findByTestId('turn-indicator');
  expect(pill).toHaveTextContent('Computer');
  expect(pill).toHaveAttribute('data-turn', 'white');
  // White to move: the computer waits for the player
  expect(thinking.asked).toBe(0);
  // Once only: a reload opens on the game itself
  expect(isArriving('g1')).toBe(false);
});

it('opened any other way (a reload, history), it opens on the game, no lobby over it', async () => {
  saveComputerGame({ id: 'g3', color: 'white', difficulty: 'easy', started: false, moves: [] });
  render(at('g3'));
  expect(await screen.findByTestId('turn-indicator')).toHaveAttribute('data-turn', 'white');
  expect(view ?? null).toBeNull();
});

it('leads to the tutorial, which is told the way back to this game', async () => {
  saveComputerGame({ id: 'g5', color: 'white', difficulty: 'easy', started: true, moves: [] });
  render(at('g5'));
  await screen.findByTestId('turn-indicator');
  // After the move box, which stays the first Tab stop
  const learn = screen.getByRole('button', { name: 'How to play' });
  expect(
    screen.getByTestId('move-card').compareDocumentPosition(learn) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  await userEvent.click(learn);
  expect(screen.getByTestId('learn-back')).toHaveTextContent('/computer/g5');
});

it('the computer moves first when it plays White, once the entrance is over', async () => {
  entrance.auto = false;
  saveComputerGame({ id: 'g2', color: 'black', difficulty: 'easy', started: true, moves: [] });
  render(at('g2'));
  const announcer = await screen.findByTestId('move-announcer');
  await new Promise((r) => setTimeout(r, 50));
  expect(thinking.asked).toBe(0);
  act(() => entrance.end!());
  await waitFor(() => expect(announcer).toHaveAttribute('data-move-count', '1'), {
    timeout: 4000,
  });
  expect(thinking.asked).toBe(1);
  expect(screen.getByTestId('seat')).toHaveAttribute('data-seat', 'black');
});

it('a game not kept here: "No game here", and a new game against the computer', async () => {
  render(at('missing'));
  expect(await screen.findByRole('heading', { name: 'No game here' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Play the computer' }));
  expect(screen.getByText('choose a side and level')).toBeInTheDocument();
});
