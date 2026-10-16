import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';
import { EARLY_PICTURE_ID } from '../screens/earlyPicture';

// React logs the caught error loudly; keep test output readable.
beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  vi.mocked(console.error).mockRestore();
});

const Boom = () => {
  throw new Error('boom');
};

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>all good</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('all good')).toBeInTheDocument();
  });

  it('shows the fallback with a way home instead of unmounting on a render error', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('link', { name: 'Back to start' })).toHaveAttribute('href', '/');
  });

  it("takes down the start page's early picture, which would stand over the fallback", () => {
    const early = document.createElement('div');
    early.id = EARLY_PICTURE_ID;
    document.body.prepend(early);
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(document.getElementById(EARLY_PICTURE_ID)).toBeNull();
  });
});
