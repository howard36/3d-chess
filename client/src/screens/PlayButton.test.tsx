import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
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
  });
});
