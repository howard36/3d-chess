import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PlayButton } from './PlayButton';

describe('PlayButton', () => {
  it('is the pill of starlight, its ref the button', () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(
      <PlayButton ref={ref} className="hud-result-go" data-testid="go">
        Play again
      </PlayButton>,
    );
    const button = screen.getByTestId('go');
    expect(button).toHaveClass('landing-play', 'lobby-go', 'hud-result-go');
    expect(ref.current).toBe(button);
    expect(button).not.toHaveAttribute('data-rim');
  });

  it('wears the turning rim only when asked to', () => {
    render(
      <PlayButton rim data-testid="go">
        Join game
      </PlayButton>,
    );
    expect(screen.getByTestId('go')).toHaveAttribute('data-rim');
  });

  it('stops its rim turning when it goes', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let ids = 0;
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => {
      frames.set(++ids, f);
      return ids;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    try {
      const { unmount } = render(<PlayButton rim>Join game</PlayButton>);
      expect(frames.size).toBe(1);
      unmount();
      expect(frames.size).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
