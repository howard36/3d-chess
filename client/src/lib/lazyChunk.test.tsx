import { Suspense } from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { lazyChunk } from './cachedImport';

const fallback = <p>waiting</p>;

it('renders a chunk already loaded in the page’s own commit, never its fallback', async () => {
  const chunk = lazyChunk(() => Promise.resolve({ default: () => <p>canvas</p> }));
  chunk.preload();
  await new Promise((r) => setTimeout(r));
  const { Component } = chunk;
  render(
    <Suspense fallback={fallback}>
      <Component />
    </Suspense>,
  );
  // (React.lazy suspends once even here, and reveals it up to 300 ms later)
  expect(screen.getByText('canvas')).toBeInTheDocument();
  expect(screen.queryByText('waiting')).toBeNull();
});

it('shows the fallback while the chunk is on its way, then the chunk', async () => {
  const chunk = lazyChunk(() => Promise.resolve({ default: () => <p>canvas</p> }));
  const { Component } = chunk;
  render(
    <Suspense fallback={fallback}>
      <Component />
    </Suspense>,
  );
  expect(screen.getByText('waiting')).toBeInTheDocument();
  expect(await screen.findByText('canvas')).toBeInTheDocument();
});

it('is ready once the chunk is in, and the page then renders it in its own commit', async () => {
  const chunk = lazyChunk(() => Promise.resolve({ default: () => <p>game</p> }));
  await chunk.ready();
  const { Component } = chunk;
  render(
    <Suspense fallback={fallback}>
      <Component />
    </Suspense>,
  );
  expect(screen.getByText('game')).toBeInTheDocument();
  expect(screen.queryByText('waiting')).toBeNull();
});

it('is ready when the chunk fails to load too, so a page waiting on it goes on', async () => {
  const chunk = lazyChunk<() => null>(() => Promise.reject(new Error('offline')));
  await expect(chunk.ready()).resolves.toBeUndefined();
});
