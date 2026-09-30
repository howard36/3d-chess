// The pages with the scene's chunk failing to load (a dropped connection, a
// deploy that replaced it): each goes on without its canvas, never the app's
// "Something went wrong".
import WS from 'jest-websocket-mock';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { WS_URL } from './hooks/useGameSocket';

// Every chunk made with lazyChunk (the preview, the lobby's canvas, the
// game's board) is refused
vi.mock('./lib/cachedImport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/cachedImport')>();
  return {
    ...actual,
    lazyChunk: (() =>
      actual.lazyChunk(() =>
        Promise.reject(new Error('Failed to fetch')),
      )) as typeof actual.lazyChunk,
    reloadPage: vi.fn(),
  };
});

beforeAll(() => {
  // React reports each error a boundary catches
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  vi.mocked(console.error).mockRestore();
});

let server: WS;
beforeEach(() => {
  localStorage.clear();
  server = new WS(WS_URL, { jsonProtocol: true });
});
afterEach(() => {
  WS.clean();
});

const renderApp = (at: string) =>
  render(
    <ErrorBoundary>
      <MemoryRouter initialEntries={[at]}>
        <App />
      </MemoryRouter>
    </ErrorBoundary>,
  );

/** Lets the refused loads settle. */
const settle = () => act(() => new Promise((r) => setTimeout(r, 20)));

test('the start page goes without its preview', async () => {
  renderApp('/');
  await settle();
  expect(screen.getByRole('heading', { name: '3D Chess' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Start a game' })).toBeInTheDocument();
  // Nor is a preview described that is not there
  expect(screen.queryByText(/Preview:/)).toBeNull();
  expect(screen.queryByText('Something went wrong')).toBeNull();
});

test('without the lobby’s scene, a new game goes from the side choice through the invitation to the board', async () => {
  renderApp('/new');
  expect(await screen.findByTestId('choose-side')).toBeInTheDocument();
  await settle();
  // The page's words come in at once, without waiting on a scene
  expect(screen.getByTestId('lobby')).toHaveAttribute('data-scene', 'late');
  await server.connected;
  await userEvent.click(screen.getByRole('button', { name: 'Black' }));
  await expect(server).toReceiveMessage(expect.objectContaining({ type: 'create_game' }));
  act(() => {
    server.send({ type: 'game_created', gameId: 'NEWG00', color: 'black' });
  });
  // The pick's moment is over at once, and the page moves on
  expect(await screen.findByTestId('invite-card')).toHaveAttribute('data-seat', 'black');

  // The opponent arrives: the handover plays out with no scene, onto the
  // game's HUD, and the board's own failure is said
  act(() => {
    server.send({ type: 'game_start', color: 'black' });
  });
  expect(await screen.findByTestId('board-failed')).toBeInTheDocument();
  await vi.waitFor(() => expect(screen.getByTestId('lobby')).not.toHaveAttribute('data-beat'));
  expect(screen.getByTestId('turn-indicator')).toHaveAttribute('data-turn', 'white');
  expect(document.querySelector('[data-intro]')).toHaveAttribute('data-intro', 'done');
  expect(screen.queryByText('Something went wrong')).toBeNull();
});
