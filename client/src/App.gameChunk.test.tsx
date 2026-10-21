// A game's address with the game's page refused (a dropped connection, a
// deploy that replaced its chunk): the page says so with a way to try again,
// never the app's "Something went wrong".
import WS from 'jest-websocket-mock';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { WS_URL } from './hooks/useGameSocket';
import { reloadPage } from './lib/cachedImport';

// Every chunk made with lazyChunk, the game's page among them, is refused
vi.mock('./lib/cachedImport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/cachedImport')>();
  return {
    ...actual,
    lazyChunk: (() =>
      actual.lazyChunk(() =>
        Promise.reject(new Error('Failed to fetch')),
      )) as typeof actual.lazyChunk,
    reloadPage: vi.fn(),
  };
});

beforeAll(() => {
  // React reports each error a boundary catches
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  vi.mocked(console.error).mockRestore();
});

beforeEach(() => {
  localStorage.clear();
  new WS(WS_URL, { jsonProtocol: true });
});
afterEach(() => {
  WS.clean();
});

test('a game whose page fails to load says so, with a retry, never the crash screen', async () => {
  render(
    <ErrorBoundary>
      <MemoryRouter initialEntries={['/game/ABC123']}>
        <App />
      </MemoryRouter>
    </ErrorBoundary>,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the game");
  expect(screen.queryByText('Something went wrong')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(reloadPage).toHaveBeenCalled();
  await act(async () => {});
});
