import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import StartScreen from './StartScreen';

// The preview is a WebGL canvas, which jsdom can't provide: a stand-in that
// can say it has faded in over the picture
let shownPreview: (() => void) | undefined;
vi.mock('./LandingPreview', () => ({
  LandingPreview: ({ onShown }: { onShown: () => void }) => {
    shownPreview = onShown;
    return <div data-testid="preview" />;
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
  vi.restoreAllMocks();
});

/** The page's box as a phone's window (jsdom lays nothing out). */
const phoneWindow = () =>
  vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockReturnValue({ width: 390, height: 844 } as DOMRect);

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

test('the picture of the preview shows at once, and goes once the preview has faded in over it', async () => {
  reduceMotion(false);
  phoneWindow();
  renderStart();
  const picture = screen.getByTestId('landing-picture');
  const img = picture.querySelector('img')!;
  expect(img.getAttribute('src')).toBe('/landing/phone.webp');
  expect(picture.querySelector('source')!.getAttribute('srcset')).toBe('/landing/phone.avif');
  // Larger than the window, which it covers
  expect(img.style.transform).toMatch(/^translate\(-[\d.]+px, -[\d.]+px\)$/);
  expect(parseFloat(img.style.width)).toBeGreaterThan(390);
  await screen.findByTestId('preview');
  expect(screen.getByTestId('landing-picture')).toBe(picture);
  act(() => shownPreview!());
  expect(screen.queryByTestId('landing-picture')).toBeNull();
  expect(screen.getByText(/^Preview: games play themselves/)).toBeInTheDocument();
});

test('for a player who asked for less motion the picture is all there is: no preview, no three.js', async () => {
  reduceMotion(true);
  phoneWindow();
  renderStart();
  expect(screen.getByTestId('landing-picture').querySelector('img')).not.toBeNull();
  // The preview's chunk is never asked for
  await act(() => new Promise((r) => setTimeout(r, 20)));
  expect(screen.queryByTestId('preview')).toBeNull();
  expect(screen.getByText(/^Preview: the five-level tower, every piece/)).toBeInTheDocument();
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
