import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PieceType } from '../engine';
import HoverReadout from './HoverReadout';

describe('HoverReadout', () => {
  it('reads out the hovered cell and its piece', () => {
    const { rerender } = render(
      <HoverReadout cell={{ zxy: 'Cc4', piece: { type: PieceType.Bishop, color: 'white' } }} />,
    );
    const readout = screen.getByTestId('hover-readout');
    expect(readout.textContent).toBe('Cc4 · White Bishop');
    expect(readout.style.opacity).toBe('1');

    rerender(<HoverReadout cell={{ zxy: 'Bd2', piece: null }} />);
    expect(readout.textContent).toBe('Bd2');
  });

  it('fades out keeping its last text when the pointer leaves the board', () => {
    const { rerender } = render(<HoverReadout cell={{ zxy: 'Ea5', piece: null }} />);
    rerender(<HoverReadout cell={null} />);
    const readout = screen.getByTestId('hover-readout');
    expect(readout.style.opacity).toBe('0');
    expect(readout.textContent).toBe('Ea5');
  });

  it('keeps its place before anything is hovered, and stays out of the accessibility tree', () => {
    render(<HoverReadout cell={null} />);
    const readout = screen.getByTestId('hover-readout');
    expect(readout.textContent).toBe(' ');
    expect(readout.getAttribute('aria-hidden')).toBe('true');
  });
});
