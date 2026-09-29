import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import StartScreen from './StartScreen';
import { fakeSocket } from './testSupport';

// The preview is a WebGL canvas, which jsdom can't provide: a stand-in that
// shows what it was handed and lets a test finish or restart its game
let endDemo: (ended: boolean) => void = () => {};
vi.mock('./LandingPreview', () => ({
  LandingPreview: ({
    paused,
    still,
    onEnded,
  }: {
    paused: boolean;
    still: boolean;
    onEnded?: (ended: boolean) => void;
  }) => {
    endDemo = (ended) => onEnded?.(ended);
    return <div data-testid="preview" data-paused={String(paused)} data-still={String(still)} />;
  },
}));

const reduceMotion = (reduce: boolean) =>
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduce && query.includes('reduce'),
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

const renderStart = () =>
  render(
    <MemoryRouter>
      <StartScreen gameSocket={fakeSocket()} />
    </MemoryRouter>,
  );

test('the start button is the first thing Tab reaches, then the pause', async () => {
  reduceMotion(false);
  renderStart();
  await userEvent.tab();
  expect(screen.getByRole('button', { name: 'Start a game' })).toHaveFocus();
  await userEvent.tab();
  expect(screen.getByRole('button', { name: 'Pause preview' })).toHaveFocus();
});

test('the pause button stops and restarts the preview', async () => {
  reduceMotion(false);
  renderStart();
  const pause = screen.getByRole('button', { name: 'Pause preview' });
  expect(pause).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByTestId('preview')).toHaveAttribute('data-paused', 'false');
  await userEvent.click(pause);
  expect(pause).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTestId('preview')).toHaveAttribute('data-paused', 'true');
  await userEvent.click(pause);
  expect(screen.getByTestId('preview')).toHaveAttribute('data-paused', 'false');
});

test('for a player who asked for less motion the preview holds still, with nothing to pause', () => {
  reduceMotion(true);
  renderStart();
  expect(screen.getByTestId('preview')).toHaveAttribute('data-still', 'true');
  expect(screen.queryByRole('button', { name: 'Pause preview' })).not.toBeInTheDocument();
});

test("the line under the button names the preview's result while its mate stands", () => {
  reduceMotion(false);
  renderStart();
  expect(screen.queryByText('Checkmate · White wins')).not.toBeInTheDocument();
  act(() => endDemo(true));
  expect(screen.getByText('Checkmate · White wins')).toBeInTheDocument();
  act(() => endDemo(false));
  expect(screen.queryByText('Checkmate · White wins')).not.toBeInTheDocument();
});

test('held still, the preview names no result (it always shows the mate)', () => {
  reduceMotion(true);
  renderStart();
  act(() => endDemo(true));
  expect(screen.queryByText('Checkmate · White wins')).not.toBeInTheDocument();
});

test('each line under the button is a fresh element, so its fade plays', async () => {
  reduceMotion(false);
  render(
    <MemoryRouter>
      <StartScreen gameSocket={fakeSocket([], () => true, { status: 'connecting' })} />
    </MemoryRouter>,
  );
  act(() => endDemo(true));
  const result = screen.getByText('Checkmate · White wins');
  // A request waiting on the connection takes the line's place
  await userEvent.click(screen.getByRole('button', { name: 'Start a game' }));
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('Connecting to server…');
  expect(status).not.toBe(result);
  expect(screen.queryByText('Checkmate · White wins')).not.toBeInTheDocument();
});

test('a keyboard player keeps their place while the game is created', async () => {
  reduceMotion(false);
  const send = vi.fn(() => true);
  render(
    <MemoryRouter>
      <StartScreen gameSocket={fakeSocket([], send)} />
    </MemoryRouter>,
  );
  await userEvent.tab();
  await userEvent.keyboard('{Enter}');
  const button = screen.getByRole('button', { name: 'Creating game…' });
  expect(button).toHaveFocus();
  expect(button).toHaveAttribute('aria-disabled', 'true');
  // Held: a second press sends nothing more
  await userEvent.keyboard('{Enter}');
  expect(send).toHaveBeenCalledTimes(1);
});
