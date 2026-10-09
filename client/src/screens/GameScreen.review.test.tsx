import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PieceType } from '../engine';
import { fromZXY } from '../engine/coords';
import type { MoveRecord, WebSocketMessage } from '../types/messages';
import type { BoardProps } from '../three/Board';
import { fakeSocket, gameScreenAt } from './testSupport';
import { setStoredRole } from '../lib/playerRole';

// Stepping back through a game on its page: the board shows the position
// stepped to and takes no move there, the HUD's pill and announcer follow the
// live game, and a move landing meanwhile leaves the view where it is. No
// WebGL in jsdom: the three.js layer is stubbed, and the board hands over the
// props it was drawn with.
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

const boardMounted = () =>
  vi.waitFor(() => {
    if (!drawn.board) throw new Error('the board has not mounted yet');
  });
const board = () => drawn.board!;
const pieceOn = (zxy: string) => board().board.getPiece(fromZXY(zxy));
const nav = () => screen.getByTestId('move-history');

beforeEach(() => {
  localStorage.clear();
  setStoredRole('abc123', 'white');
  drawn.board = null;
});

describe('stepping back through the game', () => {
  it('shows the position after a move clicked, and takes no move there', async () => {
    const send = vi.fn(() => true);
    render(gameScreenAt(fakeSocket([snapshot], send)));
    await boardMounted();
    await vi.waitFor(() => expect(board().disabled).toBe(false));
    expect(board().review).toBe(true);
    await userEvent.click(document.querySelector<HTMLElement>('[data-ply="1"]')!);
    expect(nav()).toHaveAttribute('data-viewing-ply', '1');
    expect(pieceOn('Cb1')).toEqual({ type: PieceType.Pawn, color: 'white' });
    expect(pieceOn('Cd5')).toBeNull();
    expect(board().lastMove?.moveCount).toBe(1);
    expect(board().currentTurn).toBe('black');
    expect(board().disabled).toBe(true);
    // The board would not ask, but a move sent from there goes nowhere
    act(() => board().onMove!({ from: fromZXY('Dd5'), to: fromZXY('Cd5') }));
    // The pill and the announcer say the live game
    expect(screen.getByTestId('turn-indicator')).toHaveAttribute('data-turn', 'black');
    expect(screen.getByTestId('move-announcer')).toHaveAttribute('data-move-count', '3');
    // The move box says where to play from
    const box = screen.getByRole('textbox', { name: 'Type a move, like Bb1-Cb1' });
    await userEvent.type(box, 'Ba1-Ca1{Enter}');
    expect(screen.getByText('Go to the latest move first.')).toBeInTheDocument();
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'move' }));
  });

  it('steps with the keys, to the start and back to the live position', async () => {
    render(gameScreenAt(fakeSocket([snapshot])));
    await boardMounted();
    const live = board().board;
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
    // The live position, the same board as before
    expect(board().board).toBe(live);
    expect(board().disabled).toBe(false);
  });

  it('stays put as a move lands, the way back marking it', async () => {
    const { rerender } = render(gameScreenAt(fakeSocket([snapshot])));
    await boardMounted();
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    const there = board().board;
    rerender(
      gameScreenAt(
        fakeSocket([snapshot, { type: 'move_made', by: 'black', from: 'Ed5', to: 'Cc5' }]),
      ),
    );
    expect(nav()).toHaveAttribute('data-viewing-ply', '2');
    expect(board().board).toBe(there);
    expect(document.querySelector('.hud-latest')).toHaveAttribute('data-newer', 'true');
    expect(screen.getByTestId('turn-indicator')).toHaveAttribute('data-turn', 'white');
    await userEvent.click(screen.getByRole('button', { name: 'Latest' }));
    expect(nav()).toHaveAttribute('data-viewing-ply', '4');
    expect(pieceOn('Cc5')).toEqual({ type: PieceType.Knight, color: 'black' });
    expect(board().disabled).toBe(false);
  });

  it('shows the pieces taken by then', async () => {
    const takes: WebSocketMessage = {
      ...snapshot,
      moves: [
        { by: 'white', from: 'Ae2', to: 'Db5' },
        { by: 'black', from: 'Ec4', to: 'Bc1' },
      ],
    };
    render(gameScreenAt(fakeSocket([takes])));
    await boardMounted();
    const haul = () => screen.queryByTestId('captured-pieces')?.textContent ?? '';
    const live = haul();
    fireEvent.keyDown(document.body, { key: 'Home' });
    expect(live).not.toBe('');
    expect(haul()).toBe('');
    fireEvent.keyDown(document.body, { key: 'End' });
    expect(haul()).toBe(live);
  });

  it('takes no step while the promotion dialog is up', async () => {
    render(gameScreenAt(fakeSocket([snapshot])));
    await boardMounted();
    act(() =>
      board().onChoosePromotion!([
        { from: fromZXY('Db1'), to: fromZXY('Eb1'), promotion: PieceType.Queen },
        { from: fromZXY('Db1'), to: fromZXY('Eb1'), promotion: PieceType.Rook },
      ]),
    );
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(nav()).toHaveAttribute('data-viewing-ply', '3');
  });

  it('resigns and answers draws for the live game while looking back', async () => {
    const sent: WebSocketMessage[] = [];
    const send = (m: WebSocketMessage) => {
      if (!['look_game', 'rejoin_game'].includes(m.type)) sent.push(m);
      return true;
    };
    const offered: WebSocketMessage[] = [snapshot, { type: 'draw_offered', by: 'black', ply: 3 }];
    const { rerender } = render(gameScreenAt(fakeSocket(offered, send)));
    await boardMounted();
    fireEvent.keyDown(document.body, { key: 'Home' });
    expect(nav()).toHaveAttribute('data-viewing-ply', '0');
    // The opponent's offer stands, and is answered, whatever the board shows
    const offer = screen.getByTestId('draw-offer');
    await userEvent.click(within(offer).getByRole('button', { name: 'Decline' }));
    expect(sent).toEqual([{ type: 'decline_draw' }]);
    // The flag's menu is there too, and resigning resigns the game
    await userEvent.click(screen.getByRole('button', { name: 'Resign or offer a draw' }));
    await userEvent.click(screen.getByRole('button', { name: 'Resign' }));
    await new Promise((r) => setTimeout(r, 400));
    await userEvent.click(screen.getByRole('button', { name: 'Resign' }));
    expect(sent).toEqual([{ type: 'decline_draw' }, { type: 'resign' }]);
    // The board stays where the player left it as the game ends
    rerender(
      gameScreenAt(
        fakeSocket([...offered, { type: 'game_ended', result: 'resignation', winner: 'black' }]),
      ),
    );
    expect(screen.getByTestId('turn-indicator')).toHaveAttribute('data-result', 'resignation');
    expect(nav()).toHaveAttribute('data-viewing-ply', '0');
    expect(board().gameOver).toBeNull();
    expect(screen.queryByTestId('game-actions')).not.toBeInTheDocument();
  });

  it('steps through a game that ended by agreement, the board taking no move at its end', async () => {
    render(
      gameScreenAt(
        fakeSocket([
          snapshot,
          { type: 'draw_offered', by: 'black', ply: 3 },
          { type: 'game_ended', result: 'agreement' },
        ]),
      ),
    );
    await boardMounted();
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
