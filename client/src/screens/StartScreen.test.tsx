import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
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
        <Route path="/learn" element={<p>the tutorial</p>} />
        <Route path="/computer" element={<p>play the computer</p>} />
      </Routes>
    </MemoryRouter>,
  );

test('playing a friend is the first thing Tab reaches, and the preview has no controls', async () => {
  reduceMotion(false);
  renderStart();
  await userEvent.tab();
  expect(screen.getByRole('button', { name: 'Play a friend' })).toHaveFocus();
  // It always plays: the two ways to play, and the way to the tutorial, are the page's only controls
  expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
    'Play a friend',
    'Play the computer',
    'How to play',
  ]);
});

test('for a player who asked for less motion the preview holds still', async () => {
  reduceMotion(true);
  renderStart();
  expect(await screen.findByTestId('preview')).toHaveAttribute('data-still', 'true');
});

test('nothing is written under the buttons', () => {
  reduceMotion(false);
  renderStart();
  const foot = screen.getByRole('button', { name: 'Play a friend' }).parentElement!;
  expect([...foot.children].map((c) => c.tagName)).toEqual(['BUTTON', 'BUTTON']);
});

test('the second button opens the side choice against the computer', async () => {
  reduceMotion(false);
  renderStart();
  await userEvent.click(screen.getByRole('button', { name: 'Play the computer' }));
  expect(screen.getByText('play the computer')).toBeInTheDocument();
});

test('the tutorial is a click away', async () => {
  reduceMotion(false);
  renderStart();
  await userEvent.click(screen.getByRole('button', { name: 'How to play' }));
  expect(screen.getByText('the tutorial')).toBeInTheDocument();
});

test('playing a friend opens the side choice, which creates the game', async () => {
  reduceMotion(false);
  renderStart();
  await userEvent.click(screen.getByRole('button', { name: 'Play a friend' }));
  expect(screen.getByText('choose a side')).toBeInTheDocument();
});

test('a keyboard player reaches the side choice with the first Tab and Enter', async () => {
  reduceMotion(false);
  renderStart();
  await userEvent.tab();
  await userEvent.keyboard('{Enter}');
  expect(screen.getByText('choose a side')).toBeInTheDocument();
});
