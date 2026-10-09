import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { ChunkBoundary } from './ChunkBoundary';
import { ErrorBoundary } from './ErrorBoundary';
import { ChunkLoadError } from '../lib/cachedImport';

// React (and the boundary, for no WebGL) log the caught error; keep the output readable
beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  vi.mocked(console.error).mockRestore();
});

const Throws = ({ error }: { error: Error }) => {
  throw error;
};
// three.js's words when the browser gives it no context
const noContext = new Error('THREE.WebGLRenderer: Error creating WebGL context.');

const page = (error: Error, canvas: boolean, onFail = vi.fn()) => {
  render(
    <ErrorBoundary>
      <ChunkBoundary canvas={canvas} onFail={onFail}>
        <Throws error={error} />
      </ChunkBoundary>
      <p>the rest of the page</p>
    </ErrorBoundary>,
  );
  return onFail;
};

describe('ChunkBoundary', () => {
  it('leaves out a part whose chunk failed, and says so', () => {
    const onFail = page(new ChunkLoadError(new Error('fetch failed')), false);
    expect(screen.getByText('the rest of the page')).toBeInTheDocument();
    expect(onFail).toHaveBeenCalledWith('chunk');
  });

  it('round a canvas, leaves it out when the browser has no WebGL', () => {
    const onFail = page(noContext, true);
    expect(screen.getByText('the rest of the page')).toBeInTheDocument();
    expect(onFail).toHaveBeenCalledWith('webgl');
  });

  it('passes on no WebGL where it is not round a canvas, and any other error anywhere', () => {
    page(noContext, false);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
  });

  it('passes on a canvas error that is not about WebGL (a bug in the scene)', () => {
    const onFail = page(new Error('boom'), true);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(onFail).not.toHaveBeenCalled();
  });
});
