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
        <Route path="/learn" element={<p>the tutorial</p>} />
        <Route path="/computer" element={<p>play the computer</p>} />
      </Routes>
    </MemoryRouter>,
  );

test('the start button is the first thing Tab reaches, and the preview has no controls', async () => {
  reduceMotion(false);
  renderStart();
  await userEvent.tab();
  expect(screen.getByRole('button', { name: 'Start a game' })).toHaveFocus();
  // It always plays: the two ways in, and the way to the tutorial, are the page's only controls
  expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
    'Start a game',
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
  const foot = screen.getByRole('button', { name: 'Start a game' }).parentElement!;
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

test.each([
  ['/', 'column'],
  ['/?design=split', 'split'],
  ['/?design=nonsense', 'column'],
])('at %s the page is laid out as %s', (path, design) => {
  reduceMotion(false);
  render(
    <MemoryRouter initialEntries={[path]}>
      <StartScreen />
    </MemoryRouter>,
  );
  expect(screen.getByTestId('landing')).toHaveAttribute('data-design', design);
});
