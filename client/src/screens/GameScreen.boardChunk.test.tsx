import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSocket, gameScreenAt } from './testSupport';
import { setStoredRole } from '../lib/playerRole';
import { reloadPage } from '../lib/cachedImport';

// The board's chunk fails to load while `chunk.fail` is set: every ask for it
// is refused, as the browser refuses a chunk it could not fetch
const chunk = vi.hoisted(() => ({ fail: true }));
vi.mock('../lib/cachedImport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/cachedImport')>();
  return {
    ...actual,
    lazyChunk: ((load) =>
      actual.lazyChunk(() =>
        chunk.fail ? Promise.reject(new Error('Failed to fetch')) : load(),
      )) as typeof actual.lazyChunk,
    reloadPage: vi.fn(),
  };
});
// No WebGL in jsdom: the three.js layer is stubbed
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children, ...props }: { children: React.ReactNode; 'data-testid'?: string }) => (
    <div data-testid={props['data-testid']}>{children}</div>
  ),
}));
vi.mock('../three/CameraControls', () => ({ CameraControls: () => null }));
vi.mock('../three/FitCameraToBoard', () => ({ FitCameraToBoard: () => null }));
vi.mock('../three/scene/stage', () => ({ Stage: () => null }));
vi.mock('../three/scene/warm', () => ({ WarmPrograms: () => null }));
vi.mock('../three/intro/IntroDirector', () => ({ IntroDirector: () => null }));
vi.mock('../three/Board', () => ({ default: () => null }));

beforeAll(() => {
  // React reports each error a boundary catches
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  vi.mocked(console.error).mockRestore();
});

beforeEach(() => {
  localStorage.clear();
  setStoredRole('abc123', 'white');
  vi.mocked(reloadPage).mockClear();
});

const renderGame = () => render(gameScreenAt(fakeSocket([{ type: 'game_start', color: 'white' }])));

/** The HUD, the move box and the move record, all there. */
const expectHud = () => {
  expect(screen.getByTestId('turn-indicator')).toHaveAttribute('data-turn', 'white');
  expect(screen.getByTestId('seat')).toHaveAttribute('data-seat', 'white');
  expect(screen.getByTestId('move-announcer')).toBeInTheDocument();
  expect(screen.queryByText('Something went wrong')).toBeNull();
};

// In this order: the chunk's component is the module's, kept from one test
// to the next, and once it has loaded it stays loaded
describe('a board that fails to load', () => {
  it('leaves the HUD up, with a retry; a retry that fails too loads the page afresh', async () => {
    chunk.fail = true;
    renderGame();
    const notice = await screen.findByTestId('board-failed');
    expect(notice).toHaveAttribute('role', 'alert');
    expect(notice).toHaveTextContent("Couldn't load the board");
    expectHud();
    expect(screen.queryByTestId('r3f-canvas')).toBeNull();
    // No entrance to wait for: the HUD shows at once
    expect(document.querySelector('[data-intro]')).toHaveAttribute('data-intro', 'done');
    // The move box stays the first Tab stop, ahead of the retry
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Retry' })).not.toHaveFocus();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
    expectHud();
  });

  it('shows the board once a retry loads it', async () => {
    chunk.fail = true;
    renderGame();
    await screen.findByTestId('board-failed');
    expectHud();

    chunk.fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('r3f-canvas')).toBeInTheDocument();
    expect(screen.queryByTestId('board-failed')).toBeNull();
    expectHud();
    expect(reloadPage).not.toHaveBeenCalled();
  });
});
