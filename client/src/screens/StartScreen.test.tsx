import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import StartScreen from './StartScreen';

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
      <Routes>
        <Route path="/" element={<StartScreen />} />
        <Route path="/new" element={<p>choose a side</p>} />
      </Routes>
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

test('the start button opens the side choice, which creates the game', async () => {
  reduceMotion(false);
  renderStart();
  await userEvent.click(screen.getByRole('button', { name: 'Start a game' }));
  expect(screen.getByText('choose a side')).toBeInTheDocument();
});

test('a keyboard player reaches the side choice with the first Tab and Enter', async () => {
  reduceMotion(false);
  renderStart();
  await userEvent.tab();
  await userEvent.keyboard('{Enter}');
  expect(screen.getByText('choose a side')).toBeInTheDocument();
});
