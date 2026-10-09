import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import LearnScreen from './LearnScreen';
import type { LearnCanvasProps } from './LearnCanvas';
import { toZXY } from '../../engine/coords';
import { ChunkLoadError } from '../../lib/cachedImport';

const canvas = vi.hoisted(() => ({ fails: false }));

// The board is a WebGL canvas, which jsdom can't provide: a stand-in that
// shows what it was handed and plays what the player would tap
vi.mock('./LearnCanvas', () => ({
  default: ({ practice, boardKey, onMove, onChoosePromotion, disabled }: LearnCanvasProps) => {
    if (canvas.fails) throw new ChunkLoadError(new Error('Failed to fetch'));
    const moves = practice.focus ? practice.board.generateLegalMoves(practice.focus) : [];
    return (
      <div
        data-testid="board"
        data-key={boardKey}
        data-focus={practice.focus ? toZXY(practice.focus) : ''}
        data-disabled={String(disabled)}
        data-side={practice.side}
      >
        {[...new Set(moves.map((m) => toZXY(m.to)))].map((to) => (
          <button
            key={to}
            onClick={() => {
              const choices = moves.filter((m) => toZXY(m.to) === to);
              if (choices.length > 1) onChoosePromotion(choices);
              else onMove(choices[0]);
            }}
          >
            {`ring ${to}`}
          </button>
        ))}
      </div>
    );
  },
}));

const Where = () => <output data-testid="where">{useLocation().pathname}</output>;

const renderAt = async (at: string, state?: unknown) => {
  render(
    <MemoryRouter initialEntries={[{ pathname: at, state }]}>
      <Routes>
        <Route path="/learn/:lesson?" element={<LearnScreen />} />
        <Route path="/" element={<p>home</p>} />
        <Route path="/new" element={<p>choose a side</p>} />
        <Route path="/game/:id" element={<p>the game</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
  await screen.findByTestId('board');
};

const count = () => screen.getByTestId('learn-count').getAttribute('data-count');
const board = () => screen.getByTestId('board');

test('opens on the armies as a game starts: what each side has, nothing picked up', async () => {
  await renderAt('/learn');
  expect(screen.getByRole('heading', { level: 1, name: 'Setup' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Setup' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByText(/Each side has 20 pieces/)).toBeInTheDocument();
  const army = screen.getByRole('figure', { name: "Each side's pieces" });
  // In one row, the kinds and their counts: K Q R B N U P
  expect([...army.querySelectorAll('li')].map((e) => e.textContent)).toEqual([
    '1',
    '1',
    '2',
    '2',
    '2',
    '2',
    '10',
  ]);
  expect(board()).toHaveAttribute('data-focus', '');
  expect(screen.queryByTestId('learn-count')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Next: Rook' }));
  expect(screen.getByTestId('where')).toHaveTextContent('/learn/rook');
  expect(board()).toHaveAttribute('data-focus', 'Cc3');
});

test('gives a piece other than the pawn one step: no switcher, Next goes to the next piece', async () => {
  await renderAt('/learn/rook');
  expect(screen.queryByRole('group', { name: 'Rook lessons' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Next: Bishop' }));
  expect(screen.getByTestId('where')).toHaveTextContent('/learn/bishop');
});

test('says only what the board cannot show: a line, and a quieter note for a rule', async () => {
  await renderAt('/learn/king');
  expect(screen.getByText('Kings move like a queen, but only by one square.')).toBeInTheDocument();
  expect(screen.getByText('There’s no castling.')).toHaveClass('learn-note');
  expect(document.querySelectorAll('.learn-card li')).toHaveLength(0);
});

test('shows a lesson from its address: the piece in the middle, its moves counted', async () => {
  await renderAt('/learn/rook');
  expect(screen.getByRole('heading', { level: 1, name: 'Rook' })).toBeInTheDocument();
  expect(board()).toHaveAttribute('data-focus', 'Cc3');
  expect(count()).toBe('12');
  expect(screen.getByText('6 lines')).toBeInTheDocument();
});

test('says the unicorn is the new piece', async () => {
  await renderAt('/learn/unicorn');
  const card = screen.getByRole('region', { name: /Unicorn/ });
  expect(within(card).getByText('New')).toBeInTheDocument();
  expect(count()).toBe('16');
  // Only its lesson says so
  await userEvent.click(screen.getByRole('button', { name: 'Queen' }));
  expect(screen.queryByText('New')).toBeNull();
});

test('moves between lessons from the menu and from the card, keeping one canvas', async () => {
  await renderAt('/learn/rook');
  const canvas = board();
  await userEvent.click(screen.getByRole('button', { name: 'Knight' }));
  expect(screen.getByTestId('where')).toHaveTextContent('/learn/knight');
  expect(count()).toBe('24');
  await userEvent.click(screen.getByRole('button', { name: 'Next: Pawn' }));
  expect(screen.getByTestId('where')).toHaveTextContent('/learn/pawn');
  expect(screen.getByRole('heading', { level: 1, name: 'Pawn' })).toBeInTheDocument();
  expect(board()).toBe(canvas);
  await userEvent.click(screen.getByRole('button', { name: 'Rook' }));
  expect(screen.getByTestId('where')).toHaveTextContent('/learn/rook');
  await userEvent.click(screen.getByRole('button', { name: 'Setup' }));
  expect(screen.getByTestId('where')).toHaveTextContent(/^\/learn$/);
});

test('plays a tapped ring, keeps the piece picked up there, and starts over', async () => {
  await renderAt('/learn/queen');
  expect(count()).toBe('52');
  expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();
  const key = board().getAttribute('data-key');
  await userEvent.click(screen.getByRole('button', { name: 'ring Dc3' }));
  expect(board()).toHaveAttribute('data-focus', 'Dc3');
  expect(count()).toBe('44');
  // The same board plays on: only Reset makes a fresh one
  expect(board().getAttribute('data-key')).toBe(key);
  await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
  expect(board()).toHaveAttribute('data-focus', 'Cc3');
  expect(count()).toBe('52');
  expect(board().getAttribute('data-key')).not.toBe(key);
});

const pressed = (group: HTMLElement) =>
  within(group)
    .getAllByRole('button')
    .filter((b) => b.getAttribute('aria-current') === 'step')
    .map((b) => b.getAttribute('aria-label'));

test("walks through the pawn's steps, Black's mirroring White's second, then on to a game", async () => {
  await renderAt('/learn/pawn');
  const steps = screen.getByRole('group', { name: 'Pawn lessons' });
  expect(pressed(steps)).toEqual(['Move']);
  expect(screen.getByText(/^White pawns move/)).toBeInTheDocument();
  expect(screen.getByText(/even on the starting move/)).toHaveClass('learn-note');
  expect(count()).toBe('2');
  // No board turned round, no switch of sides: one step for Black
  expect(screen.queryByRole('group', { name: 'Side' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Next: Black' }));
  expect(pressed(steps)).toEqual(['Black']);
  expect(screen.getByText(/^Black pawns mirror White’s/)).toBeInTheDocument();
  expect(screen.getByText('Mirrored')).toBeInTheDocument();
  expect(board()).toHaveAttribute('data-side', 'black');
  await userEvent.click(screen.getByRole('button', { name: 'ring Bc3' }));
  expect(board()).toHaveAttribute('data-focus', 'Bc3');
  await userEvent.click(screen.getByRole('button', { name: 'Next: Capture' }));
  expect(pressed(steps)).toEqual(['Capture']);
  expect(board()).toHaveAttribute('data-side', 'white');
  expect(count()).toBe('7');
  expect(screen.getByText('5 captures')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Next: Promote' }));
  expect(count()).toBe('1');
  // White's promotion row, and Black's on White's side
  expect(screen.getByText(/Black pawns promote at A1, on White’s side/)).toHaveClass('learn-note');
  expect(document.querySelectorAll('[data-square^="E"]')).toHaveLength(5);
  expect(document.querySelectorAll('[data-square^="A"]')).toHaveLength(5);
  await userEvent.click(screen.getByRole('button', { name: 'Next: Play a game' }));
  expect(screen.getByText('choose a side')).toBeInTheDocument();
});

test('asks which piece a pawn becomes, and plays the pick', async () => {
  await renderAt('/learn/pawn');
  await userEvent.click(screen.getByRole('button', { name: 'Promote' }));
  await userEvent.click(screen.getByRole('button', { name: 'ring Ec5' }));
  const dialog = screen.getByRole('dialog', { name: 'Promote to' });
  expect(board()).toHaveAttribute('data-disabled', 'true');
  await userEvent.click(within(dialog).getByRole('button', { name: /Unicorn/ }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(board()).toHaveAttribute('data-focus', 'Ec5');
  expect(board()).toHaveAttribute('data-disabled', 'false');
  // A unicorn on the top level's far rank: only down and back, to either side
  expect(count()).toBe('4');
});

test('leaves the pawn unpromoted when the choice is cancelled', async () => {
  await renderAt('/learn/pawn');
  await userEvent.click(screen.getByRole('button', { name: 'Promote' }));
  await userEvent.click(screen.getByRole('button', { name: 'ring Ec5' }));
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(board()).toHaveAttribute('data-focus', 'Dc5');
  expect(count()).toBe('1');
});

test('sends an unknown lesson to the first', async () => {
  await renderAt('/learn/dragon');
  expect(screen.getByTestId('where')).toHaveTextContent(/^\/learn$/);
});

test('opened from a game, leads back to it: from Home, and from the last Next', async () => {
  await renderAt('/learn', { back: '/game/ABCD' });
  expect(screen.getByRole('button', { name: /Game/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Home/ })).toBeNull();
  // The game goes along from lesson to lesson: the menu, Next, and an unknown lesson
  await userEvent.click(screen.getByRole('button', { name: 'Knight' }));
  await userEvent.click(screen.getByRole('button', { name: 'Next: Pawn' }));
  for (const step of ['Black', 'Capture', 'Promote'])
    await userEvent.click(screen.getByRole('button', { name: `Next: ${step}` }));
  await userEvent.click(screen.getByRole('button', { name: 'Next: Back to game' }));
  expect(screen.getByText('the game')).toBeInTheDocument();
  expect(screen.getByTestId('where')).toHaveTextContent('/game/ABCD');
});

test('opened from a game, its Home button is the way back to the game', async () => {
  await renderAt('/learn/king', { back: '/game/ABCD' });
  await userEvent.click(screen.getByRole('button', { name: /Game/ }));
  expect(screen.getByText('the game')).toBeInTheDocument();
});

test('takes only a game page as the way back', async () => {
  await renderAt('/learn/pawn', { back: 'https://elsewhere.example/' });
  expect(screen.getByRole('button', { name: /Home/ })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Promote' }));
  expect(screen.getByRole('button', { name: 'Next: Play a game' })).toBeInTheDocument();
});

test('goes home', async () => {
  await renderAt('/learn/king');
  await userEvent.click(screen.getByRole('button', { name: /Home/ }));
  expect(screen.getByText('home')).toBeInTheDocument();
});

test('stands the card beside the tower in a wide window, under it in a narrow one', async () => {
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('innerHeight', 800);
  await renderAt('/learn/king');
  expect(screen.getByTestId('learn')).toHaveAttribute('data-card', 'beside');
  vi.stubGlobal('innerWidth', 390);
  vi.stubGlobal('innerHeight', 844);
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
  expect(screen.getByTestId('learn')).toHaveAttribute('data-card', 'below');
  vi.unstubAllGlobals();
});

test('goes without its board, its lessons still there to read', async () => {
  canvas.fails = true;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    render(
      <MemoryRouter initialEntries={['/learn/unicorn']}>
        <Routes>
          <Route path="/learn/:lesson?" element={<LearnScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('8 lines')).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.queryByTestId('learn-count')).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Queen' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Queen' })).toBeInTheDocument();
  } finally {
    canvas.fails = false;
    vi.mocked(console.error).mockRestore();
  }
});
