import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import StartScreen from './StartScreen';

// The preview is a WebGL canvas, which jsdom can't provide: a stand-in that
// shows what it was handed
vi.mock('./LandingPreview', () => ({
  LandingPreview: ({ still }: { still: boolean }) => (
    <div data-testid="preview" data-still={String(still)} />
  ),
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

test('the start button is the first thing Tab reaches, and the preview has no controls', async () => {
  reduceMotion(false);
  renderStart();
  await userEvent.tab();
  expect(screen.getByRole('button', { name: 'Start a game' })).toHaveFocus();
  // It always plays: the start button is the page's only control
  expect(screen.getAllByRole('button')).toHaveLength(1);
});

test('for a player who asked for less motion the preview holds still', () => {
  reduceMotion(true);
  renderStart();
  expect(screen.getByTestId('preview')).toHaveAttribute('data-still', 'true');
});

test('nothing is written under the button', () => {
  reduceMotion(false);
  renderStart();
  const foot = screen.getByRole('button', { name: 'Start a game' }).parentElement!;
  expect(foot.children).toHaveLength(1);
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
