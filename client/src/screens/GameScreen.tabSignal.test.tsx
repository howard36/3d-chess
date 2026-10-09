import { render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocketMessage } from '../types/messages';
import { TURN_ICON, YOUR_MOVE_TITLE } from '../hooks/useTabSignal';
import { fakeSocket, gameScreenAt, loadBoardChunk } from './testSupport';

// The browser tab's title and icon through a game: "Your move" and the dot
// while it is the player's move, the page's own otherwise. As in
// GameScreen.endModal.test.tsx, the three.js layer is stubbed.
vi.mock('@react-three/fiber', () => ({
  Canvas: () => <div data-testid="r3f-canvas" />,
}));
vi.mock('../three/CameraControls', () => ({ CameraControls: () => null }));
vi.mock('../three/FitCameraToBoard', () => ({ FitCameraToBoard: () => null }));
vi.mock('../three/scene/stage', () => ({ Stage: () => null }));
vi.mock('../three/scene/backdropCache', () => ({
  BackdropCache: ({ children }: { children?: unknown }) => children ?? null,
}));
vi.mock('../three/scene/warm', () => ({ WarmPrograms: () => null }));
vi.mock('../three/intro/IntroDirector', () => ({
  INTRO_SCENE_VAR: '--intro-scene',
  INTRO_HUD_VAR: '--intro-hud',
  IntroDirector: () => null,
}));
vi.mock('../three/Board', () => ({ default: () => null }));

// The showcase game: 17 plies ending in White's mate.
const GAME =
  'Ab2-De5 Ed4-Ba1 Ac2-Cc4 Dc4-Dc3 Ad2-Dd5 Ec4-Dd5 Aa1-Ba1 Dd5-Db3 Cc4-Db3 Db4-Cb4 Ad1-Cd2 Dc3-Cc3 Aa2-Da5 Eb4-Ed2 Da5-Db4 Ed2-Cb2 Db3-Ec4'.split(
    ' ',
  );
const moves = GAME.map((m, i): WebSocketMessage => {
  const [from, to] = m.split('-');
  return { type: 'move_made', by: i % 2 === 0 ? 'white' : 'black', from, to };
});

const TITLE = '3D Chess — Online Multiplayer';
const ICON = '/favicon.svg';
const icon = () => document.querySelector('link[rel~="icon"]')!.getAttribute('href');
const at = (messages: WebSocketMessage[]) => gameScreenAt(fakeSocket(messages));

beforeAll(loadBoardChunk);
beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = `<link rel="icon" type="image/svg+xml" href="${ICON}" />`;
  document.title = TITLE;
});
afterEach(() => {
  document.head.innerHTML = '';
});

describe("the tab's title and icon", () => {
  it('follow the turn: "Your move" and the dot on your move, the page\'s own on theirs', async () => {
    const white: WebSocketMessage[] = [{ type: 'game_start', color: 'white' }];
    const { rerender } = render(at(white));
    expect(await screen.findByTestId('turn-indicator')).toHaveAttribute('data-turn', 'white');
    expect(document.title).toBe(YOUR_MOVE_TITLE);
    expect(icon()).toBe(TURN_ICON);

    rerender(at([...white, moves[0]]));
    expect(screen.getByTestId('turn-indicator')).toHaveAttribute('data-turn', 'black');
    expect(document.title).toBe(TITLE);
    expect(icon()).toBe(ICON);

    rerender(at([...white, moves[0], moves[1]]));
    expect(document.title).toBe(YOUR_MOVE_TITLE);
    expect(icon()).toBe(TURN_ICON);
  });

  it('go back to the page’s own once the game is over, though the mated side is to move', async () => {
    const black: WebSocketMessage[] = [{ type: 'game_start', color: 'black' }];
    const { rerender } = render(at([...black, ...moves.slice(0, -1)]));
    await screen.findByTestId('turn-indicator');
    expect(document.title).toBe(TITLE);
    rerender(at([...black, ...moves.slice(0, -2)]));
    expect(document.title).toBe(YOUR_MOVE_TITLE);
    rerender(at([...black, ...moves]));
    expect(screen.getByTestId('turn-indicator')).toHaveAttribute('data-result', 'checkmate');
    expect(document.title).toBe(TITLE);
    expect(icon()).toBe(ICON);
  });

  it('go back to the page’s own when the page goes', async () => {
    const { unmount } = render(at([{ type: 'game_start', color: 'white' }]));
    await screen.findByTestId('turn-indicator');
    expect(document.title).toBe(YOUR_MOVE_TITLE);
    unmount();
    expect(document.title).toBe(TITLE);
    expect(icon()).toBe(ICON);
  });

  it('say nothing to a guest who has not taken a seat', () => {
    render(at([{ type: 'game_info', gameId: 'abc123', seats: ['white'] }]));
    expect(document.title).toBe(TITLE);
    expect(icon()).toBe(ICON);
  });

  it('say nothing in a tab whose seat moved to another', async () => {
    render(
      gameScreenAt(
        fakeSocket([{ type: 'game_start', color: 'white' }], () => true, { status: 'replaced' }),
      ),
    );
    await screen.findByTestId('turn-indicator');
    expect(document.title).toBe(TITLE);
  });
});
