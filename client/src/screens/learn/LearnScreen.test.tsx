import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
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

const renderAt = async (at: string) => {
  render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path="/learn/:lesson?" element={<LearnScreen />} />
        <Route path="/" element={<p>home</p>} />
        <Route path="/new" element={<p>choose a side</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
  await screen.findByTestId('board');
};

const count = () => screen.getByTestId('learn-count').getAttribute('data-count');
const board = () => screen.getByTestId('board');

test('opens on the board, its starting position, nothing picked up', async () => {
  await renderAt('/learn');
  expect(screen.getByRole('heading', { level: 1, name: 'Board' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Board' })).toHaveAttribute('aria-current', 'page');
  expect(board()).toHaveAttribute('data-focus', '');
  expect(screen.queryByTestId('learn-count')).toBeNull();
});

test('shows a lesson from its address: the piece in the middle, its moves counted', async () => {
  await renderAt('/learn/rook');
  expect(screen.getByRole('heading', { level: 1, name: 'Rook' })).toBeInTheDocument();
  expect(board()).toHaveAttribute('data-focus', 'Cc3');
  expect(count()).toBe('12');
  expect(screen.getByText('6 directions')).toBeInTheDocument();
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
  await userEvent.click(screen.getByRole('button', { name: 'Board' }));
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

test("walks through the pawn's steps, then on to a game", async () => {
  await renderAt('/learn/pawn');
  const steps = screen.getByRole('group', { name: 'Pawn lessons' });
  expect(within(steps).getByRole('button', { name: 'Move' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(count()).toBe('2');
  await userEvent.click(screen.getByRole('button', { name: 'Next: Capture' }));
  expect(within(steps).getByRole('button', { name: 'Capture' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(count()).toBe('7');
  expect(screen.getByText('5 ways to capture')).toBeInTheDocument();
  await userEvent.click(within(steps).getByRole('button', { name: 'Promote' }));
  expect(count()).toBe('1');
  expect(screen.getByText('5 squares')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Next: Play a game' }));
  expect(screen.getByText('choose a side')).toBeInTheDocument();
});

test('asks which piece a pawn becomes, and plays the pick', async () => {
  await renderAt('/learn/pawn');
  await userEvent.click(screen.getByRole('button', { name: 'Promote' }));
  await userEvent.click(screen.getByRole('button', { name: 'ring Dc5' }));
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
  await userEvent.click(screen.getByRole('button', { name: 'ring Dc5' }));
  await userEvent.click(screen.getByRole('button', { name: 'ring Ec5' }));
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(board()).toHaveAttribute('data-focus', 'Dc5');
  expect(count()).toBe('1');
});

test('sends an unknown lesson to the first', async () => {
  await renderAt('/learn/dragon');
  expect(screen.getByTestId('where')).toHaveTextContent(/^\/learn$/);
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
    expect(await screen.findByText('8 directions')).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.queryByTestId('learn-count')).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Next: Queen' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Queen' })).toBeInTheDocument();
  } finally {
    canvas.fails = false;
    vi.mocked(console.error).mockRestore();
  }
});
