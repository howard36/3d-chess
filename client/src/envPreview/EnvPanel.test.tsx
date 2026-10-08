import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EnvPanel } from './EnvPanel';
import { envLink } from './link';
import { createEnvStore, defineEnvFeature, replaceEnvStoreForTest } from './index';
import type { EnvStore } from './index';
import { restoreEnvFeaturesForTest, takeEnvFeaturesForTest } from './registry';
import type { EnvFeature } from './registry';
import { mountEnvPanel } from './mount';

// ENV PREVIEW (temporary): the settings menu.

let saved: EnvFeature[];
let store: EnvStore;
let before: EnvStore;
beforeEach(() => {
  saved = takeEnvFeaturesForTest();
  defineEnvFeature({
    id: 'sky',
    label: 'Sky glow',
    group: 'Sky',
    options: [
      { id: 'off', label: 'Off' },
      { id: 'soft', label: 'Soft' },
      { id: 'bold', label: 'Bold' },
    ],
    default: 'soft',
    note: 'low down',
  });
  defineEnvFeature({
    id: 'mist',
    label: 'Mist',
    group: 'Garden',
    options: [
      { id: 'off', label: 'Off' },
      { id: 'on', label: 'On' },
    ],
    default: 'on',
  });
  store = createEnvStore({ start: { host: 'localhost', search: '?envpanel' }, storage: null });
  before = replaceEnvStoreForTest(store);
});
afterEach(() => {
  replaceEnvStoreForTest(before);
  restoreEnvFeaturesForTest(saved);
});

const open = async () => {
  const user = userEvent.setup();
  render(<EnvPanel />);
  await user.click(screen.getByRole('button', { name: 'Environment settings' }));
  return user;
};

describe('the settings menu', () => {
  it('starts closed, as a small pill with the comparison and the way in', () => {
    render(<EnvPanel />);
    expect(screen.getByTestId('env-panel').dataset.open).toBe('false');
    expect(screen.getByRole('button', { name: 'Environment settings' })).toBeInTheDocument();
    expect(screen.queryByText('Sky glow')).toBeNull();
  });

  it('offers each feature in its group: a choice of several, or a switch', async () => {
    const user = await open();
    expect(screen.getByRole('region', { name: 'Sky' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Garden' })).toBeInTheDocument();
    expect(screen.getByText('low down')).toBeInTheDocument();
    const sky = screen.getByRole('group', { name: 'Sky glow' });
    const soft = sky.querySelector<HTMLButtonElement>('[data-option="soft"]')!;
    expect(soft.getAttribute('aria-pressed')).toBe('true');
    await user.click(sky.querySelector<HTMLButtonElement>('[data-option="bold"]')!);
    expect(store.get('sky')).toBe('bold');
    expect(soft.getAttribute('aria-pressed')).toBe('false');
    const mist = screen.getByRole('switch', { name: 'Mist' });
    expect(mist.getAttribute('aria-checked')).toBe('true');
    await user.click(mist);
    expect(store.get('mist')).toBe('off');
    expect(screen.getByText('sky:bold,mist:off')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset to recommended' }));
    expect([store.get('sky'), store.get('mist')]).toEqual(['soft', 'on']);
  });

  it('compares with main from its switch, the pill, and B (not while typing)', async () => {
    const user = await open();
    await user.click(screen.getByRole('switch', { name: /Baseline/ }));
    expect(store.compare()).toBe(true);
    expect(store.get('sky')).toBe('off');
    expect(screen.getByText('baseline')).toBeInTheDocument();
    await user.keyboard('b');
    expect(store.compare()).toBe(false);
    await user.keyboard('{Control>}b{/Control}');
    expect(store.compare()).toBe(false);
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    await user.keyboard('b');
    expect(store.compare()).toBe(false);
    field.remove();
    // Closed, Escape from inside, then the pill's own button
    fireEvent.keyDown(screen.getByRole('region', { name: 'Environment settings' }), {
      key: 'Escape',
    });
    expect(screen.getByTestId('env-panel').dataset.open).toBe('false');
    await user.click(screen.getByRole('button', { name: 'A/B' }));
    expect(store.compare()).toBe(true);
    expect(screen.getByRole('button', { name: 'Main' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('copies a link with every value, and says if it could not', async () => {
    const user = await open();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(`${location.origin}/?env=sky:soft,mist:on`);
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    writeText.mockRejectedValue(new Error('denied'));
    const exec = vi.fn().mockReturnValue(false);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    await user.click(screen.getByRole('button', { name: 'Copied' }));
    expect(exec).toHaveBeenCalledWith('copy');
    expect(await screen.findByRole('button', { name: 'Copy failed' })).toBeInTheDocument();
  });

  it('shows the closed pill again after Close', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByTestId('env-panel').dataset.open).toBe('false');
  });
});

describe('envLink', () => {
  const where = (pathname: string, search = '') => ({
    origin: 'https://abc.3d-chess.pages.dev',
    pathname,
    search,
  });

  it('keeps the page, but a game becomes a new game against the computer', () => {
    expect(envLink(where('/'), 'a:b')).toBe('https://abc.3d-chess.pages.dev/?env=a:b');
    expect(envLink(where('/learn', '?env=x:y&envpanel=0'), 'a:b')).toBe(
      'https://abc.3d-chess.pages.dev/learn?envpanel=0&env=a:b',
    );
    expect(envLink(where('/computer/AB12'), 'a:b')).toBe(
      'https://abc.3d-chess.pages.dev/computer?env=a:b',
    );
    expect(envLink(where('/game/XYZ9'), 'a:b')).toBe(
      'https://abc.3d-chess.pages.dev/computer?env=a:b',
    );
  });
});

describe('mountEnvPanel', () => {
  it('adds the menu once, after the app', async () => {
    await act(async () => mountEnvPanel());
    await act(async () => mountEnvPanel());
    expect(document.querySelectorAll('#env-preview')).toHaveLength(1);
    expect(document.body.lastElementChild?.id).toBe('env-preview');
    expect(await screen.findByTestId('env-panel')).toBeInTheDocument();
  });
});
