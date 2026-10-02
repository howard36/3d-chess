import { act, fireEvent, render, screen } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useCaptureStyle } from '../lib/captureStyle';
import CapturePicker from './CapturePicker';

describe('CapturePicker', () => {
  it('chooses how captures play, remembers it, and plays the last move again in it', () => {
    const { result } = renderHook(() => useCaptureStyle());
    render(<CapturePicker canReplay />);
    const before = result.current.replay;
    act(() => {
      fireEvent.change(screen.getByLabelText('Capture'), { target: { value: 'shatter' } });
    });
    expect(result.current.style).toBe('shatter');
    expect(localStorage.getItem('capture-style')).toBe('shatter');
    expect(result.current.replay).toBe(before + 1);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Replay the last move' }));
    });
    expect(result.current.replay).toBe(before + 2);
  });

  it('has nothing to replay before the first move', () => {
    const { result } = renderHook(() => useCaptureStyle());
    render(<CapturePicker canReplay={false} />);
    const before = result.current.replay;
    act(() => {
      fireEvent.change(screen.getByLabelText('Capture'), { target: { value: 'sink' } });
    });
    expect(result.current.style).toBe('sink');
    expect(result.current.replay).toBe(before);
    expect(screen.getByRole('button', { name: 'Replay the last move' })).toBeDisabled();
  });
});
