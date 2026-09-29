import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import StartScreen from './StartScreen';
import { fakeSocket } from './testSupport';

// The preview is a WebGL canvas, which jsdom can't provide: a stand-in that
// shows what it was handed
vi.mock('./LandingPreview', () => ({
  LandingPreview: ({ paused, still }: { paused: boolean; still: boolean }) => (
    <div data-testid="preview" data-paused={String(paused)} data-still={String(still)} />
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

test('nothing is written under the button', () => {
  reduceMotion(false);
  renderStart();
  const foot = screen.getByRole('button', { name: 'Start a game' }).parentElement!;
  // Only the button shows; the live regions beside it are empty and unseen
  for (const region of foot.querySelectorAll('[role="status"], [role="alert"]')) {
    expect(region).toBeEmptyDOMElement();
    expect(region).toHaveClass('sr-only');
  }
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
