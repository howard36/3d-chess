import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import StartScreen from './StartScreen';
import { EARLY_PICTURE_ID, earlyPicture, placeEarlyPicture } from './earlyPicture';
import { picturePlacement } from '../three/landingLens';

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

/** A phone's window. */
const phoneWindow = () => {
  vi.stubGlobal('innerWidth', 390);
  vi.stubGlobal('innerHeight', 844);
};

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
  // As fine as the screen
  expect(picture.querySelector('source')!.getAttribute('srcset')).toBe(
    '/landing/phone.avif 1x, /landing/phone@2x.avif 2x',
  );
  // Larger than the window, which it covers
  expect(img.style.transform).toMatch(/^translate\(-[\d.]+px, -[\d.]+px\)$/);
  expect(parseFloat(img.style.width)).toBeGreaterThan(390);
  await screen.findByTestId('preview');
  expect(screen.getByTestId('landing-picture')).toBe(picture);
  act(() => shownPreview!());
  expect(screen.queryByTestId('landing-picture')).toBeNull();
  expect(screen.getByText(/^Preview: games play themselves/)).toBeInTheDocument();
});

test('the page takes in the picture the built page placed early, while its layout fits', () => {
  reduceMotion(false);
  phoneWindow();
  const root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
  placeEarlyPicture();
  const placed = earlyPicture()!;
  renderStart();
  const box = screen.getByTestId('landing-picture');
  // The very element, alone, and its wrapper gone
  expect(box.querySelectorAll('picture')).toHaveLength(1);
  expect(box.querySelector('picture')).toBe(placed);
  expect(document.getElementById(EARLY_PICTURE_ID)).toBeNull();
  // A window of another layout asks for another file: the page's own
  act(() => {
    vi.stubGlobal('innerWidth', 1440);
    vi.stubGlobal('innerHeight', 900);
    window.dispatchEvent(new Event('resize'));
  });
  expect(box.querySelectorAll('picture')).toHaveLength(1);
  expect(placed.isConnected).toBe(false);
  expect(box.querySelector('img')!.getAttribute('src')).toBe('/landing/wide.webp');
  // Back to a phone, of another size: one picture, the phone's, placed for this window
  act(() => {
    vi.stubGlobal('innerWidth', 360);
    vi.stubGlobal('innerHeight', 640);
    window.dispatchEvent(new Event('resize'));
  });
  expect(box.querySelectorAll('picture')).toHaveLength(1);
  const img = box.querySelector('img')!;
  expect(img.getAttribute('src')).toBe('/landing/phone.webp');
  const { width } = picturePlacement(360, 640);
  expect(parseFloat(img.style.width)).toBeCloseTo(width, 3);
  root.remove();
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

test('a click while the preview is on its way in takes it down before the next page renders', async () => {
  reduceMotion(false);
  let previewAtNext: boolean | undefined;
  const Next = () => {
    previewAtNext ??= document.querySelector('[data-testid="preview"]') !== null;
    return <p>choose a side</p>;
  };
  render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<StartScreen />} />
        <Route path="/new" element={<Next />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByTestId('preview');
  await userEvent.click(screen.getByRole('button', { name: 'Play a friend' }));
  expect(screen.getByText('choose a side')).toBeInTheDocument();
  expect(previewAtNext).toBe(false);
});

test('a preview already shown stays until the next page replaces it', async () => {
  reduceMotion(false);
  let previewAtNext: boolean | undefined;
  const Next = () => {
    previewAtNext ??= document.querySelector('[data-testid="preview"]') !== null;
    return <p>choose a side</p>;
  };
  render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<StartScreen />} />
        <Route path="/new" element={<Next />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByTestId('preview');
  act(() => shownPreview!());
  await userEvent.click(screen.getByRole('button', { name: 'Play a friend' }));
  expect(screen.getByText('choose a side')).toBeInTheDocument();
  expect(previewAtNext).toBe(true);
});
