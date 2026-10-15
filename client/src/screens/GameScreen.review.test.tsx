import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PieceType } from '../engine';
import { fromZXY } from '../engine/coords';
import type { MoveRecord, WebSocketMessage } from '../types/messages';
import type { BoardProps } from '../three/Board';
import { fakeSocket, gameScreenAt } from './testSupport';
import { setStoredRole } from '../lib/playerRole';

// Stepping back through a game on its page, once it is over: while it is on
// the record is out of sight and takes no step; with the result it comes into
// sight, the board shows the position stepped to and takes no move there, and
// the HUD's pill and announcer follow the game. No WebGL in jsdom: the
// three.js layer is stubbed, and the board hands over the props it was drawn
// with.
const drawn = vi.hoisted(() => ({ board: null as BoardProps | null }));
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../three/CameraControls', () => ({ CameraControls: () => null }));
vi.mock('../three/FitCameraToBoard', () => ({ FitCameraToBoard: () => null }));
vi.mock('../three/scene/stage', () => ({ Stage: () => null }));
vi.mock('../three/scene/backdropCache', () => ({
  BackdropCache: ({ children }: { children?: unknown }) => children ?? null,
}));
vi.mock('../three/framePacer', () => ({ PaceOnGpu: () => null }));
vi.mock('../three/scene/warm', () => ({ WarmPrograms: () => null }));
// The entrance is over at once
vi.mock('../three/intro/IntroDirector', async () => {
  const { useEffect } = await import('react');
  return {
    IntroDirector: ({ onDone }: { onDone: () => void }) => {
      useEffect(() => onDone(), [onDone]);
      return null;
    },
  };
});
vi.mock('../three/Board', () => ({
  default: (props: BoardProps) => {
    drawn.board = props;
    return null;
  },
}));

// The review's searches, answered at once from a script: each position's
// best move and score, the start first
const REVIEW = vi.hoisted(() => [
  { best: { from: 'Bb1', to: 'Cb1' }, score: 30 },
  { best: { from: 'Ed5', to: 'Ee4' }, score: 0 },
  { best: { from: 'Cb1', to: 'Db1' }, score: 400 },
  { best: { from: 'Ee5', to: 'Ed4' }, score: -420 },
]);
const searched = vi.hoisted(() => [] as number[]);
vi.mock('../ai/computer', () => ({
  createComputer: () => ({
    analyse: (records: unknown[]) => {
      searched.push(records.length);
      return Promise.resolve(REVIEW[records.length]);
    },
    dispose: () => {},
  }),
}));

const RECORD: MoveRecord[] = [
  { by: 'white', from: 'Bb1', to: 'Cb1' },
  { by: 'black', from: 'Dd5', to: 'Cd5' },
  { by: 'white', from: 'Cb1', to: 'Db1' },
];
const snapshot: WebSocketMessage = {
  type: 'game_state',
  color: 'white',
  started: true,
  moves: RECORD,
};
/** The same game reopened after Black resigned: the result card shows at once. */
const resigned: WebSocketMessage = {
  ...snapshot,
  ending: { result: 'resignation', winner: 'white' },
};

const boardMounted = () =>
  vi.waitFor(() => {
    if (!drawn.board) throw new Error('the board has not mounted yet');
  });
const board = () => drawn.board!;
const pieceOn = (zxy: string) => board().board.getPiece(fromZXY(zxy));
const nav = () => screen.getByTestId('move-history');
/** The result card put away, to study the final board. */
const closeResult = () => userEvent.click(screen.getByRole('button', { name: 'Close' }));

beforeEach(() => {
  localStorage.clear();
  setStoredRole('abc123', 'white');
  drawn.board = null;
});

describe('while the game is on', () => {
  it('keeps the record out of sight and takes no step', async () => {
    render(gameScreenAt(fakeSocket([snapshot])));
    await boardMounted();
    await vi.waitFor(() => expect(board().disabled).toBe(false));
    expect(nav()).toHaveAttribute('data-hidden');
    // Read by a screen reader, but nothing to press
    expect(screen.getByTestId('move-list')).toHaveTextContent('Cb1–Db1');
    expect(document.querySelector('[data-ply]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    for (const key of ['ArrowLeft', 'Home']) fireEvent.keyDown(document.body, { key });
    expect(nav()).toHaveAttribute('data-viewing-ply', '3');
    expect(board().board.getPiece(fromZXY('Db1'))).not.toBeNull();
    expect(board().disabled).toBe(false);
  });

  it('brings it into sight with the result, once the end has played', async () => {
    const { rerender } = render(gameScreenAt(fakeSocket([snapshot])));
    await boardMounted();
    rerender(
      gameScreenAt(
        fakeSocket([snapshot, { type: 'game_ended', result: 'resignation', winner: 'white' }]),
      ),
    );
    expect(screen.getByTestId('turn-indicator')).toHaveAttribute('data-result', 'resignation');
    // The end plays out first; the record comes with the card
    expect(nav()).toHaveAttribute('data-hidden');
    await screen.findByRole('dialog', {}, { timeout: 3000 });
    expect(nav()).not.toHaveAttribute('data-hidden');
    await closeResult();
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(nav()).toHaveAttribute('data-viewing-ply', '2');
  });
});

describe('stepping back through a finished game', () => {
  it('shows the position after a move clicked, and takes no move there', async () => {
    const send = vi.fn(() => true);
    render(gameScreenAt(fakeSocket([resigned], send)));
    await boardMounted();
    expect(board().review).toBe(true);
    await closeResult();
    await userEvent.click(document.querySelector<HTMLElement>('[data-ply="1"]')!);
    expect(nav()).toHaveAttribute('data-viewing-ply', '1');
    expect(nav()).toHaveAttribute('data-review', 'true');
    expect(pieceOn('Cb1')).toEqual({ type: PieceType.Pawn, color: 'white' });
    expect(pieceOn('Cd5')).toBeNull();
    expect(board().lastMove?.moveCount).toBe(1);
    expect(board().currentTurn).toBe('black');
    expect(board().gameOver).toBeNull();
    expect(board().disabled).toBe(true);
    // The board would not ask, but a move sent from there goes nowhere
    act(() => board().onMove!({ from: fromZXY('Dd5'), to: fromZXY('Cd5') }));
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'move' }));
    // The pill and the announcer say the game
    expect(screen.getByTestId('turn-indicator')).toHaveAttribute('data-result', 'resignation');
    expect(screen.getByTestId('move-announcer')).toHaveAttribute('data-move-count', '3');
  });

  it('steps with the keys, to the start and back to the end', async () => {
    render(gameScreenAt(fakeSocket([resigned])));
    await boardMounted();
    await closeResult();
    const end = board().board;
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(nav()).toHaveAttribute('data-viewing-ply', '2');
    expect(pieceOn('Db1')).toBeNull();
    fireEvent.keyDown(document.body, { key: 'Home' });
    expect(nav()).toHaveAttribute('data-viewing-ply', '0');
    expect(board().lastMove).toBeUndefined();
    expect(board().currentTurn).toBe('white');
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(nav()).toHaveAttribute('data-viewing-ply', '1');
    fireEvent.keyDown(document.body, { key: 'End' });
    expect(nav()).not.toHaveAttribute('data-review');
    // The final position, the same board as before, and still no move on it
    expect(board().board).toBe(end);
    expect(board().gameOver).toMatchObject({ result: 'resignation' });
    expect(board().disabled).toBe(true);
  });

  it('shows the pieces taken by then', async () => {
    const takes: WebSocketMessage = {
      ...resigned,
      moves: [
        { by: 'white', from: 'Ae2', to: 'Db5' },
        { by: 'black', from: 'Ec4', to: 'Bc1' },
      ],
    };
    render(gameScreenAt(fakeSocket([takes])));
    await boardMounted();
    await closeResult();
    const haul = () => screen.queryByTestId('captured-pieces')?.textContent ?? '';
    const end = haul();
    fireEvent.keyDown(document.body, { key: 'Home' });
    expect(end).not.toBe('');
    expect(haul()).toBe('');
    fireEvent.keyDown(document.body, { key: 'End' });
    expect(haul()).toBe(end);
  });

  it('takes no step while the result card is up', async () => {
    render(gameScreenAt(fakeSocket([resigned])));
    await boardMounted();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(nav()).toHaveAttribute('data-viewing-ply', '3');
  });

  it('steps through a game that ended by agreement, the board taking no move at its end', async () => {
    render(gameScreenAt(fakeSocket([{ ...snapshot, ending: { result: 'agreement' } }])));
    await boardMounted();
    await closeResult();
    expect(board().gameOver).toMatchObject({ result: 'agreement' });
    expect(board().disabled).toBe(true);
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(nav()).toHaveAttribute('data-viewing-ply', '2');
    expect(pieceOn('Db1')).toBeNull();
    expect(board().gameOver).toBeNull();
    fireEvent.keyDown(document.body, { key: 'End' });
    expect(nav()).not.toHaveAttribute('data-review');
    expect(board().gameOver).toMatchObject({ result: 'agreement' });
    expect(board().disabled).toBe(true);
  });
});

describe('the review of a finished game', () => {
  it("comes with the result card's Review, each move marked as its positions are done, the better move on the board", async () => {
    searched.length = 0;
    render(gameScreenAt(fakeSocket([resigned])));
    await boardMounted();
    // Nothing searched until asked
    expect(searched).toEqual([]);
    expect(board().betterMove).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    // The card goes, and the focus lands on the move shown
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('[data-ply="3"]')).toHaveFocus();
    await vi.waitFor(() => expect(nav()).toHaveAttribute('data-analysis', 'done'));
    // Every position, the one the players ended it in too
    expect(searched).toEqual([0, 1, 2, 3]);
    // Black's reply threw the game away; White's moves were the best
    expect(document.querySelector('[data-ply="2"]')).toHaveAttribute('data-grade', 'blunder');
    expect(document.querySelectorAll('[data-grade].hud-ply')).toHaveLength(1);
    expect(document.querySelector('.hud-counts[data-side="black"]')).toHaveTextContent(/1 blunder/);
    // At the end, an unmarked move: nothing more on the board
    expect(board().betterMove).toBeNull();
    await userEvent.click(document.querySelector<HTMLElement>('[data-ply="2"]')!);
    expect(board().betterMove).toEqual({ from: fromZXY('Ed5'), to: fromZXY('Ee4') });
    expect(screen.getByTestId('best-move')).toHaveTextContent('Best Ed5–Ee4');
    await userEvent.click(document.querySelector<HTMLElement>('[data-ply="1"]')!);
    expect(board().betterMove).toBeNull();
    expect(screen.queryByTestId('best-move')).toBeNull();
  });

  it('begins with a step back through the record once the card is put away', async () => {
    searched.length = 0;
    render(gameScreenAt(fakeSocket([resigned])));
    await boardMounted();
    await closeResult();
    // Put away, the card asks for nothing; the rematch below the tower is all
    expect(searched).toEqual([]);
    expect(nav()).not.toHaveAttribute('data-analysis');
    expect(screen.queryByRole('button', { name: 'Review' })).toBeNull();
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    await vi.waitFor(() => expect(nav()).toHaveAttribute('data-analysis', 'done'));
    expect(searched).toEqual([0, 1, 2, 3]);
  });

  it('is not offered while the game is on', async () => {
    render(gameScreenAt(fakeSocket([snapshot])));
    await boardMounted();
    expect(screen.queryByRole('button', { name: 'Review' })).toBeNull();
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(nav()).not.toHaveAttribute('data-analysis');
  });
});
